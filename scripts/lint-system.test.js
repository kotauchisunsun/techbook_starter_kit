import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { systemFiles, workflowScripts } from './lint-system.js';

function fixture(t, paths) {
  const root = mkdtempSync(join(tmpdir(), 'techbook-system-lint-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  for (const path of paths) {
    mkdirSync(join(root, path, '..'), { recursive: true });
    writeFileSync(join(root, path), 'invalid source !');
  }
  return root;
}

test('system allowlist includes implementation/config/CI/styles but never editorial content', t => {
  const included = ['vivliostyle.config.js', '.textlintrc.json', 'custom.css', 'epub.css', 'package.json',
    'scripts/render.py', 'scripts/nested/test.js', 'scripts/setup.sh', 'scripts/settings.yaml', '.github/dependabot.yml', '.github/workflows/pr.yml'];
  const excluded = ['README.md', 'AGENTS.md', 'requirements-lint.txt', 'package-lock.json'];
  for (const dir of ['manuscript', 'docs', 'assets', 'node_modules', 'output', '.vivliostyle', 'tmp', '.git',
    'scripts/fixtures', 'scripts/tmp', 'scripts/node_modules', 'scripts/.venv-lint', 'release']) {
    for (const extension of ['js', 'sh', 'py', 'json', 'yaml', 'css', 'md']) excluded.push(`${dir}/bad.${extension}`);
  }
  const root = fixture(t, [...included, ...excluded]);
  symlinkSync(join(root, 'output'), join(root, 'scripts/linked'), 'dir');
  symlinkSync(join(root, 'output/bad.js'), join(root, 'scripts/link.js'));
  const files = systemFiles(root);
  assert.deepEqual([...files.eslint, ...files.shell, ...files.python].sort(), included.sort());
  assert.deepEqual(files.workflows, ['.github/workflows/pr.yml']);
});

test('workflow scripts honor shell defaults and mask expressions without evaluation', () => {
  const snippets = workflowScripts(`on: push
jobs:
  build:
    defaults:
      run:
        shell: sh
    steps:
      - run: echo "\${{ github.ref }}"
      - shell: bash
        run: echo ok
      - uses: actions/github-script@v9
        with:
          script: return "\${{ github.ref }}";
      - shell: pwsh
        run: Write-Output ok
`);
  assert.deepEqual(snippets.map(item => item.language), ['sh', 'bash', 'javascript', 'pwsh']);
  assert.equal(snippets[0].source, 'echo "EXPRESSION"');
  assert.equal(snippets[2].source, 'return "EXPRESSION";');
});

test('system CI gate never makes manuscript textlint required', () => {
  const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
  assert.equal(pkg.scripts.lint, 'textlint "manuscript/**/*.md"');
  assert.equal(pkg.scripts['lint:system'], 'node scripts/lint-system.js');
  for (const name of ['pr', 'build']) {
    const workflow = readFileSync(`.github/workflows/${name}.yml`, 'utf8');
    const job = workflow.split('  test:')[1].split('  build:')[0];
    assert.match(job, /- run: npm run lint:system/);
    assert.doesNotMatch(job, /npm run lint\s|textlint|ruff|actionlint|yamllint|stylelint/);
  }
  assert.match(readFileSync('.github/workflows/pr.yml', 'utf8'), /if npm run lint >/);
});


test('top-level system directory symlinks are not followed', t => {
  const root = fixture(t, ['outside/bad.js', 'outside/bad.yml']);
  symlinkSync(join(root, 'outside'), join(root, 'scripts'), 'dir');
  symlinkSync(join(root, 'outside'), join(root, '.github'), 'dir');
  assert.deepEqual(systemFiles(root), { eslint: [], shell: [], python: [], workflows: [] });
});
