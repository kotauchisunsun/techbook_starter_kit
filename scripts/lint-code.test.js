import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ESLint } from 'eslint';
import { repositoryRoot, sourceFiles } from './lint-code.js';

function fixture(t, paths) {
  const root = mkdtempSync(join(tmpdir(), 'techbook-lint-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, 'scripts'));
  for (const [path, text] of Object.entries(paths)) {
    mkdirSync(join(root, path, '..'), { recursive: true });
    writeFileSync(join(root, path), text);
  }
  return root;
}

test('source allowlist includes configs, implementations and nested tests, not generated or document files', t => {
  const included = ['vivliostyle.config.js', 'eslint.config.js', 'scripts/nested/test.js', 'scripts/render.py', 'scripts/setup.sh'];
  const excluded = ['README.md', 'custom.css', 'package.json', '.github/workflows/pr.yml', 'manuscript/example.js',
    'assets/epub-generated/bad.js', 'output/bad.js', '.vivliostyle/bad.js', 'tmp/bad.js', 'node_modules/bad.js',
    'scripts/fixtures/example.md', 'scripts/output/bad.py', 'scripts/tmp/bad.sh', 'scripts/node_modules/bad.js'];
  const root = fixture(t, Object.fromEntries([...included, ...excluded].map(path => [path, 'invalid source !'])));
  assert.deepEqual(Object.values(sourceFiles(root)).flat().sort(), included.sort());
});

test('ESLint checks undefined variables and unused bindings in maintained source', async () => {
  const eslint = new ESLint({ cwd: repositoryRoot });
  for (const filePath of ['vivliostyle.config.js', 'scripts/example.js', 'scripts/nested/example.test.js']) {
    const [result] = await eslint.lintText('const unused = 1; missingFunction();', { filePath });
    assert.ok(result.messages.some(message => message.ruleId === 'no-undef'));
    assert.ok(result.messages.some(message => message.ruleId === 'no-unused-vars'));
  }
  for (const filePath of ['node_modules/bad.js', 'output/bad.js', '.vivliostyle/bad.js', 'assets/epub-generated/bad.js', 'tmp/bad.js']) {
    assert.equal(await eslint.isPathIgnored(filePath), true, filePath);
  }
});

test('CI enforces source lint separately from the unchanged manuscript lint', () => {
  const pkg = JSON.parse(readFileSync(join(repositoryRoot, 'package.json'), 'utf8'));
  assert.equal(pkg.scripts.lint, 'textlint "manuscript/**/*.md"');
  assert.equal(pkg.scripts['lint:code'], 'node scripts/lint-code.js');
  for (const name of ['pr', 'build']) {
    const workflow = readFileSync(join(repositoryRoot, `.github/workflows/${name}.yml`), 'utf8');
    const testJob = workflow.split('  test:')[1].split('  build:')[0];
    assert.match(testJob, /pip install -r requirements-lint.txt/);
    assert.match(testJob, /- run: npm run lint:code/);
    assert.match(testJob, /- run: npm run test:lint/);
    assert.doesNotMatch(testJob, /continue-on-error|\|\| true/);
  }
});
