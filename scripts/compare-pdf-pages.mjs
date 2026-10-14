import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const [before, after, diff, report] = process.argv.slice(2);
if (!before || !after || !diff || !report) {
  console.error('Usage: node scripts/compare-pdf-pages.mjs BEFORE_IMAGES AFTER_IMAGES DIFF_IMAGES REPORT_JSON');
  process.exit(2);
}
if ([before, after].some((dir) => resolve(dir) === resolve(diff))) {
  throw new Error('差分画像の出力先は比較元・比較先と別のディレクトリにしてください');
}

mkdirSync(diff, { recursive: true });
const pages = (dir) => new Set(readdirSync(dir).filter((name) => /^book(?:_print)?-\d+\.png$/.test(name)));
for (const page of pages(diff)) rmSync(join(diff, page));
const oldPages = pages(before);
const newPages = pages(after);
if (oldPages.size === 0) throw new Error('比較元の画像がありません');

const errors = [];
for (const page of [...new Set([...oldPages, ...newPages])].sort()) {
  const images = {
    before: oldPages.has(page) ? `before/${page}` : null,
    after: newPages.has(page) ? `after/${page}` : null,
    diff: null,
  };
  if (!images.before || !images.after) {
    errors.push({ page, reason: images.before ? '更新後のページがありません' : '更新前のページがありません', images });
    continue;
  }

  const oldFile = join(before, page);
  const newFile = join(after, page);
  const comparison = spawnSync('compare', ['-metric', 'AE', '-fuzz', '4%', oldFile, newFile, 'null:'], { encoding: 'utf8' });
  const pixels = comparison.stderr?.trim();
  if (comparison.error || ![0, 1].includes(comparison.status) || !/^\d+$/.test(pixels)) {
    throw new Error(`${page}: 比較に失敗しました: ${comparison.error?.message || pixels}`);
  }
  if (Number(pixels) <= 100) continue;

  const diffFile = join(diff, page);
  const rendering = spawnSync('compare', ['-fuzz', '4%', oldFile, newFile, diffFile], { encoding: 'utf8' });
  if (rendering.error || ![0, 1].includes(rendering.status) || !existsSync(diffFile)) {
    throw new Error(`${page}: 差分画像の生成に失敗しました: ${rendering.error?.message || rendering.stderr?.trim()}`);
  }
  images.diff = `diff/${page}`;
  errors.push({ page, reason: `${pixels} pixels changed`, images });
}

writeFileSync(report, `${JSON.stringify({ errors }, null, 2)}\n`);
for (const error of errors) console.error(`${error.page}: ${error.reason}`);
if (errors.length) process.exitCode = 1;
