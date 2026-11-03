import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, statSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { createCanvas, loadImage } from '@napi-rs/canvas';
import { prepareEpub, renderLicenses } from './prepare-epub.js';
import { epubAssetDirectory, epubCoverEntries } from './epub-assets.js';

const require = createRequire(import.meta.url);

test('incremental EPUB preparation removes only obsolete generated math assets', async () => {
  const outputRoot = mkdtempSync(join(tmpdir(), 'prepare-epub-obsolete-'));
  try {
    const generated = join(outputRoot, epubAssetDirectory);
    mkdirSync(generated, { recursive: true });
    for (const name of ['temml.css', 'Temml.woff2', 'latinmodernmath.woff2', 'unrelated.txt']) {
      writeFileSync(join(generated, name), 'old generated file');
    }
    await prepareEpub({ outputRoot, source: { entry: [] } });
    for (const name of ['temml.css', 'Temml.woff2', 'latinmodernmath.woff2']) assert(!existsSync(join(generated, name)));
    assert.equal(readFileSync(join(generated, 'unrelated.txt'), 'utf8'), 'old generated file');
  } finally { rmSync(outputRoot, { recursive: true, force: true }); }
});

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

test('EPUB preparation bundles portable token styles with every referenced body font', async () => {
  const outputRoot = mkdtempSync(join(tmpdir(), 'prepare-epub-fonts-'));
  try {
    await prepareEpub({ outputRoot, source: { entry: [] } });
    const generated = join(outputRoot, epubAssetDirectory);
    const fontRoot = join(dirname(require.resolve('@mitsuharu/vivliostyle-theme-noto-sans-jp/package.json')), 'fonts');
    const assets = [
      ...['Regular', 'Bold'].map(weight => [`NotoSansJP-${weight}.ttf`, join(fontRoot, `Noto_Sans_JP/static/NotoSansJP-${weight}.ttf`)]),
      ['NotoSansMono-Regular.ttf', join(fontRoot, 'Noto_Sans_Mono/static/NotoSansMono-Regular.ttf')],
    ];
    for (const [name, source] of assets) {
      const bytes = readFileSync(join(generated, name));
      assert(bytes.length > 0, name);
      assert.deepEqual(bytes, readFileSync(source), name);
    }
    const palette = readFileSync(join(generated, 'prism-okaidia.css'), 'utf8');
    const originalPalette = readFileSync(require.resolve('prismjs/themes/prism-okaidia.css'), 'utf8');
    assert.equal(palette, originalPalette.slice(originalPalette.indexOf('.token.comment')));
    const bundle = readFileSync(join(generated, 'epub.css'), 'utf8');
    assert.doesNotMatch(bundle, /@import/);
    // Validate every emitted selector, not just selected happy-path rules.
    const rules = bundle.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{[^{}]*\}/g);
    for (const [, selector] of rules) assert.doesNotMatch(selector, /\[|:not|:nth-|:has|>/, selector);
    assert.doesNotMatch(bundle, /Temml|Latin Modern|math\.tml|svg\s*\{[^}]*height:\s*auto/);
    for (const [, fontPath] of bundle.matchAll(/url\(['"]?([^)'"\s]+)['"]?\)/g)) {
      assert(statSync(resolve(generated, fontPath)).isFile(), fontPath);
    }
    assert.match(bundle, /\.token\.keyword/);
    assert.match(bundle, /url\('NotoSansMono-Regular\.ttf'\)/);
    assert.match(bundle, /font-family: 'Noto Sans Mono'/);
    const css = readFileSync('epub.css', 'utf8');
    assert.match(css, /@import ['"]\.\/assets\/epub-generated\/prism-okaidia\.css['"]/);
    assert.match(css, /url\(['"]\.\/assets\/epub-generated\/NotoSansMono-Regular\.ttf['"]\)/);
    assert.match(css, /font-family:\s*['"]Noto Sans Mono['"],\s*['"]Noto Sans JP['"],\s*monospace/);
    for (const weight of ['Regular', 'Bold']) assert(bundle.includes(`url('NotoSansJP-${weight}.ttf')`));
    assert.doesNotMatch(bundle, /url\(['"]?\.\//);
    assert.match(bundle, /body\s*\{[^}]*font-family: 'Noto Sans JP', sans-serif/);
    assert.match(bundle, /code\.epub-inline-code\s*\{[^}]*background-color: #ecf0f1;[^}]*color: #34495e;/);
    assert.match(bundle, /\.epub-caption\s*\{[^}]*text-align: center;[^}]*break-before: avoid;/);
    assert.match(bundle, /\.epub-figure\s*\{[^}]*break-inside: avoid;/);
    assert.match(bundle, /max-height: min\(135mm, 60vh\) !important/);
    assert.match(bundle, /table\s*\{[^}]*margin: 1em auto;[^}]*border-top: 1px solid;/);
    assert.match(bundle, /pre\s*\{[^}]*background-color: #272822;/);
    assert.match(bundle, /pre code\s*\{[^}]*background-color: transparent;/);
  } finally {
    rmSync(outputRoot, { recursive: true, force: true });
  }
});

test('EPUB license XHTML escapes headings and full license text safely', () => {
  // Compare the complete document rather than trying to blacklist HTML tags.
  // Keep expected encodings literal, independent of the production escape code.
  const cases = [
    ['A & <B> "C" \'D\'', 'A &amp; &lt;B&gt; &quot;C&quot; &apos;D&apos;'],
    ['<script>bad</script>', '&lt;script&gt;bad&lt;/script&gt;'],
    ['<SCRIPT>bad</SCRIPT>', '&lt;SCRIPT&gt;bad&lt;/SCRIPT&gt;'],
    ['<ScRiPt type="text/javascript">bad</ScRiPt>', '&lt;ScRiPt type=&quot;text/javascript&quot;&gt;bad&lt;/ScRiPt&gt;'],
    ["<script\nsrc='file.js'>bad</script foo='bar'>", '&lt;script\nsrc=&apos;file.js&apos;&gt;bad&lt;/script foo=&apos;bar&apos;&gt;'],
    ['</pre></section><img src=x onerror="bad">', '&lt;/pre&gt;&lt;/section&gt;&lt;img src=x onerror=&quot;bad&quot;&gt;'],
    ['&lt;script&gt; &amp;\nOriginal line.', '&amp;lt;script&amp;gt; &amp;amp;\nOriginal line.'],
  ];
  for (const [input, escaped] of cases) {
    const xhtml = renderLicenses([{ name: input, text: input }]);
    assert.equal(xhtml, `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" lang="en" xml:lang="en">
<head><meta charset="UTF-8"/><title>Third-party licenses</title>
<style>pre { white-space: pre-wrap; overflow-wrap: anywhere; }</style></head>
<body><h1>Third-party licenses</h1>
<section><h2>${escaped}</h2><pre>${escaped}</pre></section>
</body></html>\n`, input);
  }
});

test('EPUB preparation includes the complete licenses for every bundled style and font', async () => {
  const outputRoot = mkdtempSync(join(tmpdir(), 'prepare-epub-licenses-'));
  try {
    await prepareEpub({ outputRoot, source: { entry: [] } });
    const xhtml = readFileSync(join(outputRoot, epubAssetDirectory, 'licenses.xhtml'), 'utf8');
    const fontRoot = join(dirname(require.resolve('@mitsuharu/vivliostyle-theme-noto-sans-jp/package.json')), 'fonts');
    const paths = [require.resolve('prismjs/LICENSE'), require.resolve('@mathjax/src/LICENSE'), require.resolve('@mathjax/src/LICENSE'),
      join(fontRoot, 'Noto_Sans_Mono/OFL.txt'), join(fontRoot, 'Noto_Sans_JP/OFL.txt')];
    const decoded = [...xhtml.matchAll(/<pre>([\s\S]*?)<\/pre>/g)].map(([, text]) =>
      text.replace(/&(amp|lt|gt|quot|apos);/g, (_, entity) => ({
        amp: '&', lt: '<', gt: '>', quot: '"', apos: "'",
      })[entity]));
    assert.deepEqual(decoded, paths.map(path => readFileSync(path, 'utf8')));
    for (const name of ['Prism', 'MathJax', 'MathJax TeX fonts (Apache-2.0)', 'Noto Sans Mono', 'Noto Sans JP']) {
      assert(xhtml.includes(`<h2>${name}</h2>`));
    }
  } finally {
    rmSync(outputRoot, { recursive: true, force: true });
  }
});

test('SVG cover conversion preserves letter spacing instead of collapsing subtitle tracking', async () => {
  const root = mkdtempSync(join(tmpdir(), 'prepare-epub-tracking-'));
  try {
    mkdirSync(join(root, 'assets/fonts'), { recursive: true });
    for (const spacing of [0, 8]) {
      writeFileSync(join(root, `assets/spacing-${spacing}.svg`), `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="100"><text x="10" y="70" font-family="Noto Sans JP" font-size="40" letter-spacing="${spacing}">ABCD</text></svg>`);
    }
    await prepareEpub({ root, source: { entry: [0, 8].map(spacing => ({rel: 'cover', imageSrc: `assets/spacing-${spacing}.svg`})) } });
    const widths = [];
    for (const index of [0, 1]) {
      const image = await loadImage(readFileSync(join(root, epubAssetDirectory, `cover-${index}.png`)));
      const context = createCanvas(image.width, image.height).getContext('2d');
      context.drawImage(image, 0, 0);
      const pixels = context.getImageData(0, 0, image.width, image.height).data;
      let left = image.width, right = 0;
      for (let y = 0; y < image.height; y++) for (let x = 0; x < image.width; x++) {
        if (pixels[(y * image.width + x) * 4 + 3] > 0) {left = Math.min(left, x); right = Math.max(right, x);}
      }
      widths.push(right - left);
    }
    assert.ok(widths[0] > 50);
    assert.ok(widths[1] - widths[0] >= 22, `Expected 8px spacing across 3 gaps, got widths ${widths}`);
  } finally { rmSync(root, {recursive: true, force: true}); }
});
