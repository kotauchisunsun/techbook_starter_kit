import { mkdir, copyFile, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { createCanvas, GlobalFonts, loadImage } from '@napi-rs/canvas';
import sourceConfig from '../vivliostyle.config.js';
import config from '../vivliostyle.epub.config.js';
import { epubAssetDirectory, epubCoverEntries } from './epub-assets.js';

const require = createRequire(import.meta.url);
const sourceRoot = fileURLToPath(new URL('../', import.meta.url));

export function renderLicenses(licenses) {
  const escape = text => text.replace(/[&<>"']/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;',
  })[character]);
  const sections = licenses.map(({ name, text }) =>
    `<section><h2>${escape(name)}</h2><pre>${escape(text)}</pre></section>`).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" lang="en" xml:lang="en">
<head><meta charset="UTF-8"/><title>Third-party licenses</title>
<style>pre { white-space: pre-wrap; overflow-wrap: anywhere; }</style></head>
<body><h1>Third-party licenses</h1>
${sections}
</body></html>\n`;
}

export async function prepareEpub({ root = sourceRoot, outputRoot = root, source = sourceConfig, outputs = config.output } = {}) {
  // Vivliostyle's EPUB writer requires the destination directory to exist.
  for (const output of outputs) await mkdir(dirname(resolve(outputRoot, output.path)), { recursive: true });
  const target = resolve(outputRoot, epubAssetDirectory);
  await mkdir(target, { recursive: true });
  const copy = (from, to) => copyFile(from, join(target, to));
  await copy(require.resolve('prismjs/themes/prism-okaidia.css'), 'prism-okaidia.css');
  // EPUB prohibits CSS direction, and data URLs must percent-encode SVG markup.
  // Neither adaptation changes the math layout rules supplied by Temml.
  const mathCss = (await readFile(require.resolve('temml/dist/Temml-Latin-Modern.css'), 'utf8'))
    .replace(/^\s*direction:\s*ltr;\s*$/gm, '')
    .replace(/url\("data:image\/svg\+xml,([^"\n]*)"\)/g,
      (_, svg) => `url("data:image/svg+xml,${encodeURIComponent(decodeURIComponent(svg))}")`);
  await writeFile(join(target, 'temml.css'), mathCss);
  // EPUB.js and other ZIP readers cannot reliably resolve nested @import URLs.
  // Publish one stylesheet, with every font URL relative to that stylesheet.
  const bodyCss = (await readFile(join(sourceRoot, 'epub.css'), 'utf8'))
    .replace(/^@import[^;]+;\s*/gm, '')
    .replaceAll('./assets/epub-generated/', './');
  const codeCss = await readFile(require.resolve('prismjs/themes/prism-okaidia.css'), 'utf8');
  await writeFile(join(target, 'epub.css'), `${codeCss}\n${mathCss}\n${bodyCss}`);
  await copy(require.resolve('temml/dist/Temml.woff2'), 'Temml.woff2');
  await copy(join(root, 'assets/fonts/latinmodernmath.woff2'), 'latinmodernmath.woff2');
  const fontRoot = join(dirname(require.resolve('@mitsuharu/vivliostyle-theme-noto-sans-jp/package.json')), 'fonts');
  for (const weight of ['Regular', 'Bold']) {
    const font = join(fontRoot, `Noto_Sans_JP/static/NotoSansJP-${weight}.ttf`);
    if (!GlobalFonts.registerFromPath(font, 'Noto Sans JP')) throw new Error(`Could not load cover font: ${font}`);
  }
  await copy(join(fontRoot, 'Noto_Sans_Mono/static/NotoSansMono-Regular.ttf'), 'NotoSansMono-Regular.ttf');
  const licenses = [
    ['Prism', require.resolve('prismjs/LICENSE')],
    ['Temml', require.resolve('temml/LICENSE')],
    ['Noto Sans Mono', join(fontRoot, 'Noto_Sans_Mono/OFL.txt')],
    ['Noto Sans JP', join(fontRoot, 'Noto_Sans_JP/OFL.txt')],
    ['Latin Modern Math', join(sourceRoot, 'assets/fonts/GUST-FONT-LICENSE.txt')],
  ];
  await writeFile(join(target, 'licenses.xhtml'), renderLicenses(await Promise.all(
    licenses.map(async ([name, path]) => ({ name, text: await readFile(path, 'utf8') }))
  )));
  // Bake SVG text into a portable cover thumbnail, with the same Japanese fonts
  // as the source artwork. Bitmap covers are passed through unchanged.
  for (const cover of epubCoverEntries(source)) {
    if (cover.source === cover.target) continue;
    const image = await loadImage(await readFile(resolve(root, cover.source)));
    const canvas = createCanvas(image.width, image.height);
    canvas.getContext('2d').drawImage(image, 0, 0);
    await writeFile(resolve(outputRoot, cover.target), await canvas.encode('png'));
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await prepareEpub({ outputRoot: process.cwd() });
}
