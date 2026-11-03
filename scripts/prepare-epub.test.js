import test from 'node:test';
import assert from 'node:assert/strict';
import { copyFileSync, mkdirSync, mkdtempSync, statSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { createCanvas, loadImage } from '@napi-rs/canvas';
import { prepareEpub, renderLicenses } from './prepare-epub.js';
import { epubAssetDirectory, epubCoverEntries } from './epub-assets.js';

const require = createRequire(import.meta.url);

test('npm EPUB build prepares its configured destination without deleting prior output', () => {
  const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
  assert.equal(pkg.scripts['prebuild:epub'], 'node scripts/prepare-epub.js');
  const cwd = mkdtempSync(join(tmpdir(), 'prepare-epub-'));
  try {
    const script = resolve('scripts/prepare-epub.js');
    const run = () => spawnSync(process.execPath, [script], { cwd, encoding: 'utf8' });
    let result = run();
    assert.equal(result.status, 0, result.stderr);
    assert(statSync(join(cwd, 'output/epub')).isDirectory());
    assert(statSync(join(cwd, epubAssetDirectory, 'cover-0.png')).size > 0);
    const file = join(cwd, 'output/epub/book.epub');
    writeFileSync(file, 'existing EPUB');
    result = run();
    assert.equal(result.status, 0, result.stderr);
    assert.equal(readFileSync(file, 'utf8'), 'existing EPUB');
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test('EPUB cover mapping preserves order, explicit image sources and bitmap covers', () => {
  const config = {
    cover: { src: 'assets/front.SVG' },
    entry: [{ rel: 'cover' }, { rel: 'contents' }, 'chapter.md',
      { rel: 'cover', imageSrc: 'assets/back.svg', output: 'back.html' },
      { rel: 'cover', imageSrc: 'assets/bitmap.png' }],
  };
  const before = structuredClone(config);
  assert.deepEqual(epubCoverEntries(config), [
    { index: 0, source: 'assets/front.SVG', target: `${epubAssetDirectory}/cover-0.png` },
    { index: 3, source: 'assets/back.svg', target: `${epubAssetDirectory}/cover-3.png` },
    { index: 4, source: 'assets/bitmap.png', target: 'assets/bitmap.png' },
  ]);
  assert.deepEqual(config, before);
  assert.deepEqual(epubCoverEntries({ entry: [{ rel: 'cover' }, 'chapter.md'] }), []);
});

test('EPUB preparation rasterizes SVG covers with their dimensions and pixels and leaves bitmap sources intact', async () => {
  const root = mkdtempSync(join(tmpdir(), 'prepare-epub-covers-'));
  try {
    mkdirSync(join(root, 'assets/fonts'), { recursive: true });
    copyFileSync('assets/fonts/latinmodernmath.woff2', join(root, 'assets/fonts/latinmodernmath.woff2'));
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="80" height="120"><rect width="80" height="120" fill="#123456"/><rect y="60" width="80" height="60" fill="#abcdef"/></svg>';
    writeFileSync(join(root, 'assets/front.svg'), svg);
    writeFileSync(join(root, 'assets/back.svg'), svg.replace('#123456', '#654321'));
    const bitmap = await createCanvas(2, 3).encode('png');
    writeFileSync(join(root, 'assets/bitmap.png'), bitmap);
    const source = {
      cover: 'assets/front.svg',
      entry: [{ rel: 'cover' }, 'chapter.md', { rel: 'cover', imageSrc: 'assets/back.svg' },
        { rel: 'cover', imageSrc: 'assets/bitmap.png' }],
    };
    await prepareEpub({ root, source, outputs: [{ path: 'custom/book.epub' }] });
    assert(statSync(join(root, 'custom')).isDirectory());
    for (const [index, topColor] of [[0, [0x12, 0x34, 0x56, 255]], [2, [0x65, 0x43, 0x21, 255]]]) {
      const bytes = readFileSync(join(root, epubAssetDirectory, `cover-${index}.png`));
      assert.deepEqual([...bytes.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
      const image = await loadImage(bytes);
      assert.equal(image.width, 80);
      assert.equal(image.height, 120);
      const canvas = createCanvas(image.width, image.height);
      const context = canvas.getContext('2d');
      context.drawImage(image, 0, 0);
      assert.deepEqual([...context.getImageData(10, 10, 1, 1).data], topColor);
      assert.deepEqual([...context.getImageData(10, 100, 1, 1).data], [0xab, 0xcd, 0xef, 255]);
    }
    assert.equal(readFileSync(join(root, 'assets/front.svg'), 'utf8'), svg);
    assert.deepEqual(readFileSync(join(root, 'assets/bitmap.png')), bitmap);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('EPUB preparation bundles code and MathML styles with every referenced font', async () => {
  const outputRoot = mkdtempSync(join(tmpdir(), 'prepare-epub-fonts-'));
  try {
    await prepareEpub({ outputRoot, source: { entry: [] } });
    const generated = join(outputRoot, epubAssetDirectory);
    const fontRoot = join(dirname(require.resolve('@mitsuharu/vivliostyle-theme-noto-sans-jp/package.json')), 'fonts');
    const assets = [
      ['prism-okaidia.css', require.resolve('prismjs/themes/prism-okaidia.css')],
      ['Temml.woff2', require.resolve('temml/dist/Temml.woff2')],
      ['latinmodernmath.woff2', 'assets/fonts/latinmodernmath.woff2'],
      ['NotoSansMono-Regular.ttf', join(fontRoot, 'Noto_Sans_Mono/static/NotoSansMono-Regular.ttf')],
    ];
    for (const [name, source] of assets) {
      const bytes = readFileSync(join(generated, name));
      assert(bytes.length > 0, name);
      assert.deepEqual(bytes, readFileSync(source), name);
    }
    const mathCss = readFileSync(join(generated, 'temml.css'), 'utf8');
    const originalMathCss = readFileSync(require.resolve('temml/dist/Temml-Latin-Modern.css'), 'utf8');
    assert.doesNotMatch(mathCss, /\bdirection\s*:/);
    const svgUrls = css => [...css.matchAll(/url\("data:image\/svg\+xml,([^"\n]*)"\)/g)].map(match => match[1]);
    const originalSvgUrls = svgUrls(originalMathCss);
    const encodedSvgUrls = svgUrls(mathCss);
    assert(originalSvgUrls.length > 0);
    assert.equal(encodedSvgUrls.length, originalSvgUrls.length);
    for (const [index, svg] of encodedSvgUrls.entries()) {
      assert.doesNotMatch(svg, /[<>#\s]/);
      assert.match(svg, /^%3Csvg/);
      assert.equal(decodeURIComponent(svg), decodeURIComponent(originalSvgUrls[index]));
    }
    // Apart from those EPUB conformance adaptations, keep Temml's layout rules.
    const layoutRules = css => css.replace(/url\("data:image\/svg\+xml,[^"\n]*"\)/g, 'url(SVG)')
      .replace(/\bdirection\s*:\s*ltr;/g, '').replace(/\s+/g, ' ').trim();
    assert.equal(layoutRules(mathCss), layoutRules(originalMathCss));
    assert.match(mathCss, /font-family:\s*["']?Latin Modern Math/);
    const fontFaces = [...mathCss.matchAll(/@font-face\s*\{([^}]+)\}/g)];
    assert.equal(fontFaces.length, 2);
    for (const [, fontFace] of fontFaces) {
      const [, fontPath] = fontFace.match(/url\(['"]?([^)'"\s]+)['"]?\)/);
      assert(statSync(resolve(generated, fontPath)).isFile(), fontPath);
    }
    const bundle = readFileSync(join(generated, 'epub.css'), 'utf8');
    assert.doesNotMatch(bundle, /@import/);
    assert.match(bundle, /\.token\.keyword/);
    assert.match(bundle, /\.tml-right/);
    assert.match(bundle, /url\('\.\/NotoSansMono-Regular\.ttf'\)/);
    assert.match(bundle, /font-family: 'Noto Sans Mono'/);
    const css = readFileSync('epub.css', 'utf8');
    assert.match(css, /@import ['"]\.\/assets\/epub-generated\/prism-okaidia\.css['"]/);
    assert.match(css, /@import ['"]\.\/assets\/epub-generated\/temml\.css['"]/);
    assert.match(css, /url\(['"]\.\/assets\/epub-generated\/NotoSansMono-Regular\.ttf['"]\)/);
    assert.match(css, /font-family:\s*['"]Noto Sans Mono['"],\s*monospace/);
  } finally {
    rmSync(outputRoot, { recursive: true, force: true });
  }
});

test('EPUB license XHTML escapes headings and full license text safely', () => {
  const xhtml = renderLicenses([{ name: 'A & <B> "C"', text: "<script>bad & 'quoted'</script>\nOriginal line." }]);
  assert.match(xhtml, /<html xmlns="http:\/\/www.w3.org\/1999\/xhtml"/);
  assert(xhtml.includes('<h2>A &amp; &lt;B&gt; &quot;C&quot;</h2>'));
  assert(xhtml.includes('<pre>&lt;script&gt;bad &amp; &apos;quoted&apos;&lt;/script&gt;\nOriginal line.</pre>'));
  assert.doesNotMatch(xhtml, /<script>|<B>/);
});

test('EPUB preparation includes the complete licenses for every bundled style and font', async () => {
  const outputRoot = mkdtempSync(join(tmpdir(), 'prepare-epub-licenses-'));
  try {
    await prepareEpub({ outputRoot, source: { entry: [] } });
    const xhtml = readFileSync(join(outputRoot, epubAssetDirectory, 'licenses.xhtml'), 'utf8');
    const fontRoot = join(dirname(require.resolve('@mitsuharu/vivliostyle-theme-noto-sans-jp/package.json')), 'fonts');
    const paths = [require.resolve('prismjs/LICENSE'), require.resolve('temml/LICENSE'),
      join(fontRoot, 'Noto_Sans_Mono/OFL.txt'), join(fontRoot, 'Noto_Sans_JP/OFL.txt'),
      'assets/fonts/GUST-FONT-LICENSE.txt'];
    const decoded = [...xhtml.matchAll(/<pre>([\s\S]*?)<\/pre>/g)].map(([, text]) =>
      text.replace(/&(amp|lt|gt|quot|apos);/g, (_, entity) => ({
        amp: '&', lt: '<', gt: '>', quot: '"', apos: "'",
      })[entity]));
    assert.deepEqual(decoded, paths.map(path => readFileSync(path, 'utf8')));
    for (const name of ['Prism', 'Temml', 'Noto Sans Mono', 'Noto Sans JP', 'Latin Modern Math']) {
      assert(xhtml.includes(`<h2>${name}</h2>`));
    }
    assert(xhtml.includes('MANIFEST-&lt;fontid&gt;.txt'));
  } finally {
    rmSync(outputRoot, { recursive: true, force: true });
  }
});
