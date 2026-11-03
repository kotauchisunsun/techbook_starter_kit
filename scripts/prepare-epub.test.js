import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, statSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

test('npm EPUB build creates its configured destination on a clean checkout without deleting prior output', () => {
  const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
  assert.equal(pkg.scripts['prebuild:epub'], 'node scripts/prepare-epub.js');
  const cwd = mkdtempSync(join(tmpdir(), 'prepare-epub-'));
  try {
    const script = resolve('scripts/prepare-epub.js');
    const run = () => spawnSync(process.execPath, [script], { cwd, encoding: 'utf8' });
    let result = run();
    assert.equal(result.status, 0, result.stderr);
    assert(statSync(join(cwd, 'output/epub')).isDirectory());
    const file = join(cwd, 'output/epub/book.epub');
    writeFileSync(file, 'existing EPUB');
    result = run();
    assert.equal(result.status, 0, result.stderr);
    assert.equal(readFileSync(file, 'utf8'), 'existing EPUB');
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});
