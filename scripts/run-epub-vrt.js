import {spawnSync} from 'node:child_process';
import {mkdirSync, rmSync, writeFileSync, readFileSync, statSync} from 'node:fs';
import {join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {compareEpubPages} from './compare-epub-pages.js';

export function runEpubVrt({baseline, current, output, python = process.env.EPUB_VRT_PYTHON || 'python',
  run = (command, args, cwd) => spawnSync(command, args, {cwd, stdio: 'inherit'}), compare = compareEpubPages}) {
  mkdirSync(output, {recursive: true});
  rmSync(join(output, 'epub-report.json'), {force: true});
  const errors = [];
  const execute = (label, command, args, cwd) => {
    const result = run(command, args, cwd);
    if (result.status === 0) return true;
    errors.push({reason: `${label} failed (exit ${result.status ?? 'unavailable'}): ${result.error?.message || result.signal || 'inspect workflow logs'}`});
    return false;
  };
  const built = new Map();
  for (const [side, source] of [['before', baseline], ['after', current]]) {
    const label = side === 'before' ? 'Baseline' : 'Current';
    let supported = false;
    try { supported = typeof JSON.parse(readFileSync(join(source, 'package.json'), 'utf8')).scripts?.['build:epub'] === 'string'; }
    catch (error) { errors.push({reason: `${label} source unavailable: ${error.message}`}); }
    if (!supported) {
      errors.push({reason: `${label} source does not support build:epub; EPUB comparison cannot succeed.`});
      built.set(side, false);
      continue;
    }
    rmSync(join(source, 'output/epub/book.epub'), {force: true});
    let ok = execute(`${label} npm ci`, 'npm', ['ci'], source)
      && execute(`${label} build browser installation`, 'npx', ['playwright', 'install', '--with-deps', 'chromium-headless-shell'], source)
      && execute(`${label} EPUB build`, 'npm', ['run', 'build:epub'], source);
    if (ok) {
      try { if (statSync(join(source, 'output/epub/book.epub')).size === 0) throw new Error('Empty EPUB'); }
      catch (error) { errors.push({reason: `${label} build produced no nonempty EPUB: ${error.message}`}); ok = false; }
    }
    built.set(side, ok);
  }
  const ready = built.get('after') && execute('Shared WebKit installation', 'npx', ['playwright', 'install', '--with-deps', 'webkit'], current);
  for (const [side, source] of [['before', baseline], ['after', current]]) {
    for (const engine of ['chromium', 'webkit', 'mupdf']) {
      const directory = join(output, 'epub', side, engine);
      // Delete only this tool's manifest, so a failed process cannot reuse a stale
      // complete report. Preserve images as diagnostics, never arbitrary files.
      rmSync(join(directory, 'report.json'), {force: true});
      if (!ready || !built.get(side)) continue;
      const input = join(source, 'output/epub/book.epub');
      const command = engine === 'mupdf' ? python : process.execPath;
      const args = engine === 'mupdf'
        ? ['scripts/render-epub-mupdf.py', input, directory, '--widths=420,240', '--height=595', '--font-size=11', '--scale=2']
        : ['scripts/render-epub.js', input, directory, `--browser=${engine}`, '--widths=600,360', '--height=780', '--baseline'];
      execute(`${side === 'before' ? 'Baseline' : 'Current'} ${engine} render`, command, args, current);
    }
  }
  try { errors.push(...compare(join(output, 'epub/before'), join(output, 'epub/after'), join(output, 'epub/diff')).errors); }
  catch (error) { errors.push({reason: `EPUB comparison failed: ${error.message}`}); }
  const report = {errors};
  writeFileSync(join(output, 'epub-report.json'), `${JSON.stringify(report, null, 2)}\n`);
  return report;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const report = runEpubVrt({baseline: '/work/baseline', current: '/work/current', output: '/work/current/output/visual'});
  for (const error of report.errors) console.error(error.reason);
  if (report.errors.length) process.exitCode = 1;
}
