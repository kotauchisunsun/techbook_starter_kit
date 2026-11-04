import type {TestContext} from 'node:test';
import type {CommandRunner, VrtOptions} from './run-epub-vrt.ts';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {runEpubVrt} from './run-epub-vrt.ts';

function fixture(t: TestContext) {
  const root = mkdtempSync(join(tmpdir(), 'epub-runner-'));
  t.after(() => rmSync(root, {recursive: true, force: true}));
  const options: VrtOptions & {success: CommandRunner} = {success: () => ({status: 0}), baseline: join(root, 'baseline'), current: join(root, 'current'), output: join(root, 'visual'), compare: () => ({errors: []})};
  for (const dir of [options.baseline, options.current]) {
    mkdirSync(dir); writeFileSync(join(dir, 'package.json'), JSON.stringify({scripts: {'build:epub': 'build'}}));
  }
  options.success = (_command, args, cwd) => {
    if (args[0] === 'run' && args[1] === 'build:epub') {
      mkdirSync(join(cwd, 'output/epub'), {recursive: true});
      writeFileSync(join(cwd, 'output/epub/book.epub'), 'fixture EPUB');
    }
    return {status: 0};
  };
  return options;
}
test("各ソースを独立してビルドし、両方に head のリーダーを使い、各コマンドの成功で検証が通る", t => {
  const options = fixture(t), calls: {command: string; args: string[]; cwd?: string}[] = [];
  const report = runEpubVrt({...options, run: (command, args, cwd) => { calls.push({command, args, cwd}); return options.success(command, args, cwd); }});
  assert.deepEqual(report.errors, []);
  assert.equal(calls.filter(c => c.command === 'npm' && c.args[1] === 'build:epub').length, 2);
  assert.deepEqual(calls.filter(c => c.command === 'npm' && c.args[0] === 'ci').map(c => c.cwd), [options.baseline, options.current]);
  const browserRenders = calls.filter(c => c.command === 'npm' && c.args[1] === 'check:epub:render');
  assert.equal(browserRenders.length, 4);
  assert(browserRenders.every(c => c.cwd === options.current && c.args[2] === '--'));
  assert.deepEqual([...new Set(browserRenders.map(c => c.args[3]))], [join(options.baseline, 'output/epub/book.epub'), join(options.current, 'output/epub/book.epub')]);
  const renders = calls.filter(c => c.args[0]?.startsWith('scripts/epub/render-epub') || c.args[1] === 'check:epub:render');
  assert.equal(renders.length, 6);
  assert(renders.every(c => c.cwd === options.current));
  const mupdf = renders.filter(c => c.args[0] === 'scripts/epub/render-epub-mupdf.py');
  assert.equal(mupdf.length, 2);
  assert(mupdf.every(c => c.command === (process.env.EPUB_VRT_PYTHON || 'python')));
});
test("レポートが完了し比較が成功しても、描画の非ゼロ終了を成功扱いしない", t => {
  const options = fixture(t);
  const stale = join(options.output, 'epub/before/chromium/report.json');
  mkdirSync(join(options.output, 'epub/before/chromium'), {recursive: true});
  writeFileSync(stale, '{"complete":true}');
  const report = runEpubVrt({...options, run: (_command, args, cwd) => {
    if (args[1] === 'check:epub:render' && args[4].endsWith('before/chromium')) {
      assert.equal(existsSync(stale), false);
      writeFileSync(stale, '{"complete":true}');
      return {status: 1};
    }
    return options.success(_command, args, cwd);
  }});
  assert.match(report.errors[0].reason, /Baseline chromium render failed/);
  assert.equal(JSON.parse(readFileSync(join(options.output, 'epub-report.json'), 'utf8')).errors.length, 1);
});
test("比較元の EPUB 非対応やソースのビルド失敗をレポートに明示する", t => {
  const options = fixture(t);
  writeFileSync(join(options.baseline, 'package.json'), '{"scripts":{}}');
  const report = runEpubVrt({...options, run: (_command, args) => ({status: args[0] === 'run' ? 1 : 0})});
  assert(report.errors.some(e => /Baseline source does not support build:epub/.test(e.reason)));
  assert(report.errors.some(e => /Current EPUB build failed/.test(e.reason)));
});

test("ビルドが成功しても EPUB が生成されていなければ古いアーカイブを再利用しない", t => {
  const options = fixture(t);
  mkdirSync(join(options.baseline, 'output/epub'), {recursive: true});
  writeFileSync(join(options.baseline, 'output/epub/book.epub'), 'stale');
  const report = runEpubVrt({...options, run: () => ({status: 0})});
  assert(report.errors.some(e => /Baseline build produced no nonempty EPUB/.test(e.reason)));
  assert.equal(existsSync(join(options.baseline, 'output/epub/book.epub')), false);
});

test("両方の MuPDF 比較で明示的に選択した Python インタープリターを使う", t => {
  const options = fixture(t), calls: {command: string; args: string[]; cwd?: string}[] = [];
  const python = join(options.current, 'environment with spaces', 'python');
  const report = runEpubVrt({...options, python, run: (command, args, cwd) => {
    calls.push({command, args});
    return options.success(command, args, cwd);
  }});
  assert.deepEqual(report.errors, []);
  assert.equal(calls.filter(c => c.command === python).length, 2);
});
