import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync, readdirSync} from 'node:fs';
import {resolve} from 'node:path';
import config from '../vivliostyle.config.js';
import printConfig from '../vivliostyle.print.config.js';
import documentProcessor from './mermaid.js';

test('all first-party JavaScript uses the explicit ESM package scope and .js extension', () => {
  const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
  assert.equal(pkg.type, 'module');
  const files = [...readdirSync('.'), ...readdirSync('scripts').map(name => `scripts/${name}`)];
  assert.deepEqual(files.filter(name => /\.[cm]js$/.test(name)), []);
});

test('ESM Vivliostyle configs preserve the processor, page size and print-only cover removal', () => {
  assert.equal(config.size, 'A5');
  assert.equal(config.documentProcessor, documentProcessor);
  assert.equal(typeof documentProcessor, 'function');
  assert.equal(printConfig.size, config.size);
  assert.equal(printConfig.documentProcessor, documentProcessor);
  assert.equal(config.entry.filter(entry => entry.rel === 'cover').length, 2);
  assert.equal(printConfig.entry.some(entry => entry.rel === 'cover'), false);
  assert.equal(printConfig.cover, undefined);
  assert.deepEqual(printConfig.entry, config.entry.filter(entry => entry.rel !== 'cover'));
  assert.equal(config.output[0].path, 'output/pdf/book.pdf');
  assert.equal(printConfig.output[0].path, 'output/pdf/book_print.pdf');
});

test('GitHub reporter loads the actual ESM helper in both inline steps', async () => {
  const source = readFileSync('.github/workflows/vrt-report.yml', 'utf8');
  const blocks = source.split('          script: |\n').slice(1).map(block => {
    const lines = block.split('\n');
    const end = lines.findIndex(line => line.trim() && !line.startsWith('            '));
    return lines.slice(0, end < 0 ? lines.length : end).map(line => line.slice(12)).join('\n');
  });
  assert.equal(blocks.length, 2);
  const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
  const outputs = {};
  const run = {id: 7, run_attempt: 1, event: 'push'};
  const github = {rest: {actions: {getWorkflowRun: async () => ({data: run})}}};
  const context = {repo: {owner: 'owner', repo: 'repo'}, payload: {workflow_run: run}};
  const core = {setOutput: (key, value) => {outputs[key] = value;}};
  const processStub = {env: {GITHUB_WORKSPACE: resolve('.'), VRT_PLAN: JSON.stringify({runId: 7, attempt: 1}), REPORT_DIRECTORY: '/unused'}};
  for (const block of blocks) {
    assert.match(block, /await import\(/);
    await new AsyncFunction('github', 'context', 'core', 'process', block)(github, context, core, processStub);
  }
  assert.deepEqual(outputs, {plan: '', report_id: ''});
});
