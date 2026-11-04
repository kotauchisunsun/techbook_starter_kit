// Real reader smoke test. No dependency on the template author's manuscript.
// Run with npm run test:vrt after installing Playwright browsers and ImageMagick.
import assert from 'node:assert/strict';
import {mkdir, writeFile, readFile} from 'node:fs/promises';
import {resolve, join} from 'node:path';
import {spawnSync} from 'node:child_process';
import JSZip from 'jszip';

const root = resolve(process.argv[2] || 'output/epub-vrt-smoke');
await mkdir(root, {recursive: true});
// Text color is supported by all three readers; MuPDF ignores this fixture's
// former div background fill, so it was not a valid cross-reader change probe.
async function fixture(name, color) {
  const zip = new JSZip();
  zip.file('mimetype', 'application/epub+zip', {compression: 'STORE'});
  zip.file('META-INF/container.xml', '<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="book.opf" media-type="application/oebps-package+xml"/></rootfiles></container>');
  zip.file('book.opf', '<?xml version="1.0"?><package xmlns="http://www.idpf.org/2007/opf" unique-identifier="id" version="3.0"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="id">vrt-fixture</dc:identifier><dc:title>VRT</dc:title><dc:language>en</dc:language><meta property="dcterms:modified">2026-01-01T00:00:00Z</meta></metadata><manifest><item id="chapter" href="chapter.xhtml" media-type="application/xhtml+xml"/><item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/></manifest><spine><itemref idref="chapter"/></spine></package>');
  zip.file('nav.xhtml', '<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><head><title>Contents</title></head><body><nav epub:type="toc"><ol><li><a href="chapter.xhtml">VRT</a></li></ol></nav></body></html>');
  zip.file('chapter.xhtml', `<html xmlns="http://www.w3.org/1999/xhtml"><head><title>VRT</title><style>body { color: black; background: white; } .box { font-size: 24px; color: ${color}; }</style></head><body><h1>Visual comparison</h1><p>Stable fixture independent of manuscript contents.</p><div class="box">Visible color change</div></body></html>`);
  const path = join(root, `${name}.epub`);
  await writeFile(path, await zip.generateAsync({type: 'nodebuffer'}));
  return path;
}
function run(command, args, expected = 0) {
  const result = spawnSync(command, args, {stdio: 'inherit'});
  assert.equal(result.status, expected, `${command} ${args.join(' ')}: ${result.error?.message || ''}`);
}
const original = await fixture('original', '#000000');
const changed = await fixture('changed', '#ff0000');
for (const [side, input] of [['before', original], ['after', original], ['changed', changed]]) {
  for (const browser of ['chromium', 'webkit']) {
    run(process.execPath, ['scripts/render-epub.js', input, join(root, side, browser), `--browser=${browser}`, '--baseline']);
  }
  run(process.env.EPUB_VRT_PYTHON || 'python', ['scripts/render-epub-mupdf.py', input, join(root, side, 'mupdf')]);
}
run(process.execPath, ['scripts/compare-epub-pages.js', join(root, 'before'), join(root, 'after'), join(root, 'same-diff'), join(root, 'same-report.json')]);
run(process.execPath, ['scripts/compare-epub-pages.js', join(root, 'before'), join(root, 'changed'), join(root, 'changed-diff'), join(root, 'changed-report.json')], 1);

const differences = JSON.parse(await readFile(join(root, 'changed-report.json'), 'utf8')).errors;
for (const reader of ['chromium', 'webkit', 'mupdf']) {
  assert(differences.some(error => error.page.startsWith(`EPUB ${reader}/`) && /pixels changed/.test(error.reason) && error.images?.diff), `${reader} must detect a real pixel difference`);
}
assert(differences.every(error => /pixels changed/.test(error.reason)), 'A rendering failure must not satisfy the deliberate-change smoke test');

console.log('Real EPUB readers: repeated identical renders agree; intentional visible change fails.');
