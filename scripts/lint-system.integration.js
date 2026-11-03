import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { lintSystem } from './lint-system.js';

function fixture(t, overrides = {}) {
  const root = mkdtempSync(join(tmpdir(), 'techbook-system-integration-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const files = {
    'package.json': '{"type":"module"}\n',
    'scripts/good.js': 'console.log("ok");',
    'scripts/example.py': 'print("ok")\n',
    'scripts/good.sh': '#!/bin/sh\nprintf "%s\\n" "ok"\n',
    'custom.css': '@page { @footnote { border-top: 1px solid red; } } a { footnote-policy: line; }\n',
    '.github/dependabot.yml': 'version: 2\nupdates: []\n',
    '.github/workflows/good.yml': 'on: push\njobs:\n  test:\n    runs-on: ubuntu-latest\n    steps:\n      - run: echo "${{ github.ref }}"\n      - uses: actions/github-script@v9\n        with:\n          script: await github.rest.pulls.list({ ...context.repo }); return "ok";\n',
    ...overrides,
  };
  for (const dir of ['manuscript', 'docs', 'assets', 'node_modules', 'output', '.vivliostyle', 'tmp', 'scripts/fixtures']) {
    for (const extension of ['js', 'sh', 'py', 'json', 'yaml', 'css', 'md']) files[`${dir}/bad.${extension}`] = 'invalid source !';
  }
  files['README.md'] = '長い本文'.repeat(100);
  files['package-lock.json'] = 'generated lockfile excluded';
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(join(root, path, '..'), { recursive: true });
    writeFileSync(join(root, path), text);
  }
  return root;
}

function workflowStep(step) {
  return `on: push\njobs:\n  test:\n    runs-on: ubuntu-latest\n    steps:\n${step}\n`;
}

test('system aggregate passes despite invalid manuscript/examples/assets/generated files', async t => {
  assert.equal(await lintSystem(fixture(t)), 0);
});
for (const [kind, path, source] of [
  ['JavaScript', 'scripts/good.js', 'missingFunction();'],
  ['Python syntax', 'scripts/example.py', 'def broken(:'],
  ['shell', 'scripts/good.sh', '#!/bin/sh\necho $1\n'],
  ['JSON syntax', 'settings.json', '{ invalid }'],
  ['JSON duplicate keys', 'settings.json', '{"a":1,"a":2}'],
  ['YAML syntax', '.github/dependabot.yml', 'version: ['],
  ['YAML duplicate keys', '.github/dependabot.yml', 'version: 2\nversion: 3\n'],
  ['CSS property', 'custom.css', 'a { colr: red; }'],
  ['CSS value', 'custom.css', 'a { color: definitely-not-a-color; }'],
  ['CSS syntax', 'custom.css', 'a { color: red;'],
  ['embedded JavaScript', '.github/workflows/good.yml', workflowStep('      - uses: actions/github-script@v9\n        with:\n          script: missingFunction();')],
  ['embedded shell', '.github/workflows/good.yml', workflowStep('      - run: echo $UNQUOTED')],
]) {
  test(`${kind} errors fail the system aggregate`, async t => {
    assert.equal(await lintSystem(fixture(t, { [path]: source })), 1);
  });
}

test('Python and embedded shell/JavaScript are parsed but never executed', async t => {
  const root = fixture(t);
  const marker = join(root, 'executed');
  writeFileSync(join(root, 'scripts/example.py'), `from pathlib import Path\nPath('${marker}').write_text('executed')\n`);
  writeFileSync(join(root, '.github/workflows/good.yml'), workflowStep(
    `      - run: touch "${marker}"\n      - uses: actions/github-script@v9\n        with:\n          script: require('node:fs').writeFileSync('${marker}', 'executed');`));
  assert.equal(await lintSystem(root), 0);
  assert.equal(existsSync(marker), false);
});

test('a missing ShellCheck fails rather than silently skipping', async t => {
  const path = process.env.PATH;
  try {
    process.env.PATH = '';
    assert.equal(await lintSystem(fixture(t)), 1);
  } finally {
    process.env.PATH = path;
  }
});


test('quoted and unquoted GitHub expressions do not become undefined JS identifiers', async t => {
  const source = workflowStep('      - uses: actions/github-script@v9\n        with:\n          script: const flag = ${{ true }}; core.info(String(flag) + "${{ github.ref }}");');
  assert.equal(await lintSystem(fixture(t, { '.github/workflows/good.yml': source })), 0);
});
