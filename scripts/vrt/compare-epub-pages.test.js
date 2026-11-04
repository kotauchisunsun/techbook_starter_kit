import nodeTest from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { compareEpubPages, configurations } from './compare-epub-pages.js';

const imageMagickAvailable = ['convert', 'compare', 'identify'].every(command => spawnSync(command, ['-version']).status === 0);
const test = (name, callback) => nodeTest(name, { skip: imageMagickAvailable ? false : 'ImageMagick is required; CI EPUB integration installs it' }, callback);

function command(name, args) {
  const result = spawnSync(name, args, { encoding: 'utf8' });
  assert.equal(result.status, 0, result.error?.message || result.stderr);
}

function fixtures(t) {
  const root = mkdtempSync(join(tmpdir(), 'epub-vrt-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const before = join(root, 'before'), after = join(root, 'after'), diff = join(root, 'diff');
  for (const [engine, config] of Object.entries(configurations)) {
    const report = { reader: engine === 'mupdf' ? 'MuPDF EPUB renderer' : 'EPUB.js 0.3.93',
      browserEngine: engine, browser: '123.0', pymupdfVersion: '1.26.1', mupdfVersion: '1.26.1',
      scale: 2, fontSize: 11, coordinateUnits: 'points', complete: true, errors: [], warnings: [], viewports: [] };
    for (const width of config.widths) {
      const directory = join(before, engine, `${width}x${config.height}`);
      mkdirSync(directory, { recursive: true });
      command('convert', ['-size', `${width * config.scale}x${config.height * config.scale}`, 'xc:white', '-fill', 'black', '-draw', 'rectangle 10,10 100,100', join(directory, 'page-0001.png')]);
      report.viewports.push({ width, height: config.height, complete: true, pageCount: 1,
        spine: [{ index: 0, href: 'chapter.xhtml' }], pages: [{ sequence: 1, file: 'page-0001.png', spineIndex: 0,
          href: 'chapter.xhtml', diagnostics: [], location: { start: { index: 0, displayed: { page: 1, total: 1 } },
            end: { index: 0, displayed: { page: 1, total: 1 } } } }] });
    }
    writeFileSync(join(before, engine, 'report.json'), JSON.stringify(report));
  }
  cpSync(before, after, { recursive: true });
  return { before, after, diff };
}

function modifyReport(directory, engine, mutate) {
  const path = join(directory, engine, 'report.json');
  const report = JSON.parse(readFileSync(path, 'utf8'));
  mutate(report);
  writeFileSync(path, JSON.stringify(report));
}

test('identical actual PNG renders pass all six fixed viewports', t => {
  const { before, after, diff } = fixtures(t);
  assert.deepEqual(compareEpubPages(before, after, diff), { errors: [] });
});

test('visible image change produces a useful diff with artifact-relative paths', t => {
  const { before, after, diff } = fixtures(t);
  const relative = 'chromium/600x780/page-0001.png';
  const file = join(after, relative);
  command('convert', [file, '-type', 'TrueColor', '-fill', 'red', '-draw', 'rectangle 200,200 300,300', file]);
  const { errors } = compareEpubPages(before, after, diff);
  assert.equal(errors.length, 1);
  assert.match(errors[0].reason, /10201 pixels changed/);
  assert.deepEqual(errors[0].images, { before: `epub/before/${relative}`, after: `epub/after/${relative}`, diff: `epub/diff/${relative}` });
  assert.ok(existsSync(join(diff, relative)));
});

test('missing baseline EPUB rendering never reports no difference', t => {
  const { before, after, diff } = fixtures(t);
  rmSync(before, { recursive: true });
  assert.equal(compareEpubPages(before, after, diff).errors.length, 3);
});

test('incomplete renders, missing pages, invalid images and renderer mismatch fail closed', async t => {
  const cases = [
    ['incomplete report', dir => modifyReport(dir, 'chromium', r => { r.complete = false; })],
    ['render error', dir => modifyReport(dir, 'chromium', r => { r.errors = ['failed']; })],
    ['incomplete viewport', dir => modifyReport(dir, 'chromium', r => { r.viewports[0].complete = false; })],
    ['missing viewport', dir => modifyReport(dir, 'chromium', r => { r.viewports.pop(); })],
    ['missing spine section', dir => modifyReport(dir, 'chromium', r => { r.viewports[0].spine.push({ index: 1, href: 'missing.xhtml' }); })],
    ['incomplete pagination', dir => modifyReport(dir, 'chromium', r => { r.viewports[0].pages[0].location.end.displayed.total = 2; })],
    ['missing page image', dir => rmSync(join(dir, 'chromium/600x780/page-0001.png'))],
    ['empty page image', dir => writeFileSync(join(dir, 'chromium/600x780/page-0001.png'), '')],
    ['truncated PNG with intact header', dir => { const file = join(dir, 'chromium/600x780/page-0001.png'); writeFileSync(file, readFileSync(file).subarray(0, 100)); }],
    ['missing diagnostics', dir => modifyReport(dir, 'chromium', r => { delete r.viewports[0].pages[0].diagnostics; })],
    ['font loading diagnostic', dir => modifyReport(dir, 'webkit', r => { r.viewports[0].pages[0].diagnostics = [{ type: 'font-load-error' }]; })],
    ['corrupt page image', dir => writeFileSync(join(dir, 'chromium/600x780/page-0001.png'), 'not a PNG')],
    ['wrong dimensions', dir => command('convert', ['-size', '10x10', 'xc:white', join(dir, 'chromium/600x780/page-0001.png')])],
    ['unreported page image', dir => cpSync(join(dir, 'chromium/600x780/page-0001.png'), join(dir, 'chromium/600x780/page-0002.png'))],
    ['unsafe image path', dir => modifyReport(dir, 'chromium', r => { r.viewports[0].pages[0].file = '../../outside.png'; })],
    ['browser version mismatch', dir => modifyReport(dir, 'chromium', r => { r.browser = '124.0'; })],
    ['MuPDF version mismatch', dir => modifyReport(dir, 'mupdf', r => { r.mupdfVersion = '1.27'; })],
    ['MuPDF warning', dir => modifyReport(dir, 'mupdf', r => { r.warnings = ['font error']; })],
    ['MuPDF missing page', dir => modifyReport(dir, 'mupdf', r => { r.viewports[0].pageCount = 2; })],
    ['image loading diagnostic', dir => modifyReport(dir, 'webkit', r => { r.viewports[0].pages[0].diagnostics = [{ type: 'missing-image' }]; })],
  ];
  for (const [name, mutate] of cases) await t.test(name, t => {
    const { before, after, diff } = fixtures(t);
    mutate(after);
    assert.ok(compareEpubPages(before, after, diff).errors.length > 0);
  });
});

test('a valid added page is reported as a visual difference', t => {
  const { before, after, diff } = fixtures(t);
  modifyReport(after, 'mupdf', report => {
    const viewport = report.viewports[0];
    viewport.pageCount = 2;
    viewport.pages.push({ sequence: 2, file: 'page-0002.png' });
  });
  cpSync(join(after, 'mupdf/420x595/page-0001.png'), join(after, 'mupdf/420x595/page-0002.png'));
  const { errors } = compareEpubPages(before, after, diff);
  assert.equal(errors.length, 1);
  assert.equal(errors[0].reason, 'Baseline page missing');
  assert.equal(errors[0].images.before, null);
});

test('CLI writes failure report and exits nonzero for a baseline without EPUB', t => {
  const { before, after, diff } = fixtures(t);
  rmSync(before, { recursive: true });
  const report = join(diff, 'report.json');
  const result = spawnSync(process.execPath, ['scripts/vrt/compare-epub-pages.js', before, after, diff, report], { encoding: 'utf8' });
  assert.equal(result.status, 1);
  assert.equal(JSON.parse(readFileSync(report, 'utf8')).errors.length, 3);
});

test('author-dependent overflow and syntax highlighting diagnostics are informational', t => {
  const { before, after, diff } = fixtures(t);
  modifyReport(after, 'chromium', r => { r.viewports[0].pages[0].diagnostics = [{ type: 'code-overflow' }, { type: 'math-overflow' }, { type: 'unhighlighted-code' }]; });
  assert.deepEqual(compareEpubPages(before, after, diff), { errors: [] });
});
