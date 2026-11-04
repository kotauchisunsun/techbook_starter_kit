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

test('同一の PNG 描画結果は固定した全6ビューポートで成功する', t => {
  const { before, after, diff } = fixtures(t);
  assert.deepEqual(compareEpubPages(before, after, diff), { errors: [] });
});

test('目に見える画像変更は Artifact からの相対パスを持つ確認可能な差分画像を生成する', t => {
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

test('比較元の EPUB 描画結果がない場合に差分なしと報告しない', t => {
  const { before, after, diff } = fixtures(t);
  rmSync(before, { recursive: true });
  assert.equal(compareEpubPages(before, after, diff).errors.length, 3);
});

test('描画未完了・ページ欠落・不正な画像・描画エンジン不一致を成功扱いせず失敗させる', async t => {
  const cases = [
    ['レポートが未完了', dir => modifyReport(dir, 'chromium', r => { r.complete = false; })],
    ['描画エラー', dir => modifyReport(dir, 'chromium', r => { r.errors = ['failed']; })],
    ['ビューポートの描画が未完了', dir => modifyReport(dir, 'chromium', r => { r.viewports[0].complete = false; })],
    ['ビューポートが欠落', dir => modifyReport(dir, 'chromium', r => { r.viewports.pop(); })],
    ['spine のセクションが欠落', dir => modifyReport(dir, 'chromium', r => { r.viewports[0].spine.push({ index: 1, href: 'missing.xhtml' }); })],
    ['ページ分割が未完了', dir => modifyReport(dir, 'chromium', r => { r.viewports[0].pages[0].location.end.displayed.total = 2; })],
    ['ページ画像が欠落', dir => rmSync(join(dir, 'chromium/600x780/page-0001.png'))],
    ['ページ画像が空', dir => writeFileSync(join(dir, 'chromium/600x780/page-0001.png'), '')],
    ['ヘッダーは正常だが途中で切れた PNG', dir => { const file = join(dir, 'chromium/600x780/page-0001.png'); writeFileSync(file, readFileSync(file).subarray(0, 100)); }],
    ['診断情報が欠落', dir => modifyReport(dir, 'chromium', r => { delete r.viewports[0].pages[0].diagnostics; })],
    ['フォント読み込みエラーの診断', dir => modifyReport(dir, 'webkit', r => { r.viewports[0].pages[0].diagnostics = [{ type: 'font-load-error' }]; })],
    ['ページ画像が破損', dir => writeFileSync(join(dir, 'chromium/600x780/page-0001.png'), 'not a PNG')],
    ['画像の寸法が不正', dir => command('convert', ['-size', '10x10', 'xc:white', join(dir, 'chromium/600x780/page-0001.png')])],
    ['レポートにないページ画像', dir => cpSync(join(dir, 'chromium/600x780/page-0001.png'), join(dir, 'chromium/600x780/page-0002.png'))],
    ['安全でない画像パス', dir => modifyReport(dir, 'chromium', r => { r.viewports[0].pages[0].file = '../../outside.png'; })],
    ['ブラウザーのバージョンが不一致', dir => modifyReport(dir, 'chromium', r => { r.browser = '124.0'; })],
    ['MuPDF のバージョンが不一致', dir => modifyReport(dir, 'mupdf', r => { r.mupdfVersion = '1.27'; })],
    ['MuPDF の警告', dir => modifyReport(dir, 'mupdf', r => { r.warnings = ['font error']; })],
    ['MuPDF のページが欠落', dir => modifyReport(dir, 'mupdf', r => { r.viewports[0].pageCount = 2; })],
    ['画像読み込みエラーの診断', dir => modifyReport(dir, 'webkit', r => { r.viewports[0].pages[0].diagnostics = [{ type: 'missing-image' }]; })],
  ];
  for (const [name, mutate] of cases) await t.test(name, t => {
    const { before, after, diff } = fixtures(t);
    mutate(after);
    assert.ok(compareEpubPages(before, after, diff).errors.length > 0);
  });
});

test('正常なページの追加は表示差分として報告する', t => {
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

test('比較元に EPUB がない場合、CLI は失敗レポートを書き出して非ゼロで終了する', t => {
  const { before, after, diff } = fixtures(t);
  rmSync(before, { recursive: true });
  const report = join(diff, 'report.json');
  const result = spawnSync(process.execPath, ['scripts/vrt/compare-epub-pages.js', before, after, diff, report], { encoding: 'utf8' });
  assert.equal(result.status, 1);
  assert.equal(JSON.parse(readFileSync(report, 'utf8')).errors.length, 3);
});

test('原稿内容に依存するはみ出しや構文強調の診断は参考情報として扱う', t => {
  const { before, after, diff } = fixtures(t);
  modifyReport(after, 'chromium', r => { r.viewports[0].pages[0].diagnostics = [{ type: 'code-overflow' }, { type: 'math-overflow' }, { type: 'unhighlighted-code' }]; });
  assert.deepEqual(compareEpubPages(before, after, diff), { errors: [] });
});
