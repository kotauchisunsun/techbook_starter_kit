import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { lintCode } from './lint-code.js';

function fixture(t, overrides = {}) {
  const root = mkdtempSync(join(tmpdir(), 'techbook-lint-integration-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const files = {
    'scripts/good.js': 'console.log("ok");',
    // Python remains supported by the EPUB renderer, but is not a lint target.
    'scripts/ignored.py': 'Python is intentionally not checked by this command',
    'scripts/good.sh': '#!/bin/sh\nprintf "%s\\n" "ok"\n',
    ...overrides,
  };
  for (const path of ['node_modules', 'output', '.vivliostyle', 'assets/epub-generated', 'tmp', 'scripts/tmp']) {
    for (const extension of ['js', 'py', 'sh']) files[`${path}/bad.${extension}`] = 'invalid source !';
  }
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(join(root, path, '..'), { recursive: true });
    writeFileSync(join(root, path), text);
  }
  return root;
}

test('all linters pass valid code despite invalid excluded generated files', t => {
  assert.equal(lintCode(fixture(t)), 0);
});
for (const [language, path, source] of [
  ['JavaScript', 'scripts/good.js', 'missingFunction();'],
  ['shell', 'scripts/good.sh', '#!/bin/sh\necho $1\n'],
]) {
  test(`${language} errors fail the aggregate command`, t => {
    assert.equal(lintCode(fixture(t, { [path]: source })), 1);
  });
}
