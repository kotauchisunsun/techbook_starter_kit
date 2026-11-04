import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, mkdirSync, readFileSync, existsSync, writeFileSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {spawnSync} from 'node:child_process';
import {join} from 'node:path';
import {combineReports} from './combine-vrt-reports.ts';

test('両形式のレポートを必須とし、差分は失敗として保持する', () => {
  const dir = mkdtempSync(join(tmpdir(), 'combine-vrt-'));
  try {
    assert.equal(combineReports(dir).errors.length, 2);
    writeFileSync(join(dir, 'pdf-report.json'), JSON.stringify({errors: []}));
    assert.equal(combineReports(dir).errors.length, 1);
    writeFileSync(join(dir, 'epub-report.json'), JSON.stringify({errors: []}));
    assert.equal(combineReports(dir).errors.length, 0);
    writeFileSync(join(dir, 'epub-report.json'), JSON.stringify({errors: [{reason: 'missing page'}]}));
    assert.match(combineReports(dir).errors[0].reason, /EPUB: missing page/);
    writeFileSync(join(dir, 'epub-report.json'), '{');
    assert.match(combineReports(dir).errors[0].reason, /unavailable/);
  } finally { rmSync(dir, {recursive: true, force: true}); }
});

test('明示したランナー所有の出力先を使い、コンテナーの出力先には書き込まない', t => {
  const root = mkdtempSync(join(tmpdir(), 'combine-vrt-owned-'));
  t.after(() => rmSync(root, {recursive: true, force: true}));
  const source = join(root, 'docker-output');
  const output = join(root, 'runner-temp', 'vrt-report', 'pr-45-vrt-report.json');
  // A directory at the old output filename makes an accidental write fail even
  // when tests run as root; no permission relaxation or chown is necessary.
  mkdirSync(join(source, 'report.json'), {recursive: true});
  for (const format of ['pdf', 'epub']) writeFileSync(join(source, `${format}-report.json`), '{"errors":[]}');
  assert.deepEqual(combineReports(source, output), {errors: []});
  assert.deepEqual(JSON.parse(readFileSync(output, 'utf8')), {errors: []});
  const cli = spawnSync(process.execPath, ['--import', 'tsx', 'scripts/vrt/combine-vrt-reports.ts', source, output], {encoding: 'utf8'});
  assert.equal(cli.status, 0, cli.stderr);
  assert.deepEqual(JSON.parse(readFileSync(output, 'utf8')), {errors: []});
  const absent = join(root, 'absent-output');
  assert.equal(combineReports(absent, output).errors.length, 2);
  assert.equal(existsSync(absent), false);
});

test('malformed report structures remain explicit failures after parsing JSON', t => {
  const directory = mkdtempSync(join(tmpdir(), 'combine-vrt-invalid-'));
  t.after(() => rmSync(directory, {recursive: true, force: true}));
  writeFileSync(join(directory, 'pdf-report.json'), '{"errors":[]}');
  for (const report of [null, [], {errors: null}, {errors: [null]}, {errors: [{reason: 123}]}]) {
    writeFileSync(join(directory, 'epub-report.json'), JSON.stringify(report));
    const result = combineReports(directory);
    assert.equal(result.errors.length, 1);
    assert.match(result.errors[0].reason, /EPUB build\/render\/comparison report unavailable/);
  }
});
