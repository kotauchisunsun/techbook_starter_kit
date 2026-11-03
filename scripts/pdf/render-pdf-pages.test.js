import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const renderer = fileURLToPath(new URL('./render-pdf-pages.sh', import.meta.url));

test('renders both PDF variants at 300 dpi and removes only stale page images', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'render-pdf-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const pdfDir = join(dir, 'input PDFs');
  const imageDir = join(dir, 'page images');
  const binDir = join(dir, 'bin');
  const log = join(dir, 'arguments.txt');
  await Promise.all([pdfDir, imageDir, binDir].map((path) => mkdir(path)));
  for (const name of ['book', 'book_print']) {
    await writeFile(join(pdfDir, `${name}.pdf`), 'test input');
    await writeFile(join(imageDir, `${name}-99.png`), 'stale page');
  }
  await writeFile(join(imageDir, 'keep.png'), 'unrelated image');
  await writeFile(join(binDir, 'pdftoppm'), `#!/bin/sh
set -eu
printf '%s\\n' "$@" >> "$RENDER_TEST_LOG"
printf 'rendered' > "$5-01.png"
`, { mode: 0o755 });

  const result = spawnSync('sh', [renderer, pdfDir, imageDir], {
    encoding: 'utf8',
    env: { ...process.env, PATH: `${binDir}${delimiter}${process.env.PATH}`, RENDER_TEST_LOG: log },
  });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual((await readFile(log, 'utf8')).trimEnd().split('\n'),
    ['book', 'book_print'].flatMap((name) => [
      '-r', '300', '-png', join(pdfDir, `${name}.pdf`), join(imageDir, name),
    ]));
  assert.deepEqual((await readdir(imageDir)).sort(), ['book-01.png', 'book_print-01.png', 'keep.png']);
  assert.equal(await readFile(join(imageDir, 'keep.png'), 'utf8'), 'unrelated image');
});

test('requires both input and output directories', () => {
  const result = spawnSync('sh', [renderer], { encoding: 'utf8' });
  assert.equal(result.status, 2);
  assert.match(result.stderr, /Usage:/);
});

test('fails when a required PDF is missing', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'render-pdf-missing-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const result = spawnSync('sh', [renderer, join(dir, 'missing'), join(dir, 'images')], { encoding: 'utf8' });
  assert.notEqual(result.status, 0);
});
