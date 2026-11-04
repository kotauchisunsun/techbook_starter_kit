import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync, existsSync, mkdtempSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import yaml from 'js-yaml';
const workflow = yaml.load(readFileSync('.github/workflows/visual-regression.yml', 'utf8'));
const job = workflow.jobs['visual-regression'];
const condition = job.if.replace('github.event.pull_request.labels.*.name', 'github.event.pull_request.labels.map(label => label.name)');
const eligible = new Function('github', 'contains', `return ${condition}`);
function accepts(action, labels, changedLabel, author = 'human', fork = false) {
  if (!workflow.on.pull_request.types.includes(action)) return false;
  return eligible({event: {action, label: {name: changedLabel}, pull_request: {
    labels: labels.map(name => ({name})), user: {login: author}, head: {repo: {fork}},
  }}}, (values, value) => values.includes(value));
}
test('VRT is label-based for humans, Dependabot and forks, including subsequent pushes', () => {
  assert.equal(workflow.on.pull_request.branches, undefined);
  for (const author of ['human', 'dependabot[bot]']) for (const fork of [false, true]) {
    for (const action of ['opened', 'reopened', 'synchronize']) {
      assert.equal(accepts(action, ['vrt'], undefined, author, fork), true);
      assert.equal(accepts(action, [], undefined, author, fork), false);
    }
    assert.equal(accepts('labeled', ['vrt'], 'vrt', author, fork), true);
    assert.equal(accepts('labeled', ['vrt', 'bug'], 'bug', author, fork), false);
    assert.equal(accepts('unlabeled', [], 'vrt', author, fork), false);
  }
});
test('unrelated labels cannot cancel active VRT; only matching PR jobs share concurrency', () => {
  assert.equal(workflow.concurrency, undefined);
  assert.equal(job.concurrency.group, 'pdf-vrt-${{ github.event.pull_request.number }}');
  assert.equal(job.concurrency['cancel-in-progress'], true);
  assert.equal(job['timeout-minutes'], 90);
});
test('untrusted PR builds have read-only permissions and do not retain checkout credentials', () => {
  assert.deepEqual(workflow.permissions, {contents: 'read'});
  assert.deepEqual(job.permissions, {contents: 'read', actions: 'read'});
  assert.equal(job.steps[0].with['persist-credentials'], false);
  assert.equal(job.steps[0].with.ref, '${{ github.event.pull_request.head.sha }}');
  assert.equal(workflow.on.pull_request_target, undefined);
  assert.equal(job.steps.some(s => /sticky-pull-request-comment|github-script/.test(s.uses || '')), false);
});
test('Dependabot config supplies vrt directly, rather than a token-driven labeling workflow', () => {
  const config = yaml.load(readFileSync('.github/dependabot.yml', 'utf8'));
  assert.deepEqual(config.updates[0].labels, ['vrt']);
  assert.equal(config.updates[0].schedule.interval, 'daily');
  assert.equal(existsSync('.github/workflows/dependabot-visual-regression.yml'), false);
});
test('baseline/current PDF comparison, 300dpi and seven-day diagnostic artifacts remain', () => {
  const build = job.steps.find(s => s.name === 'Build, render, and compare PDFs in Docker').run;
  for (const command of ['npm ci', 'npm run build', 'npm run build:print', 'npm run check:pdf',
    'scripts/pdf/render-pdf-pages.sh', 'scripts/vrt/compare-pdf-pages.js']) assert.ok(build.includes(command));
  assert.match(readFileSync('scripts/pdf/render-pdf-pages.sh', 'utf8'), /-r 300/);
  const uploads = job.steps.filter(s => s.uses?.startsWith('actions/upload-artifact@'));
  assert.equal(uploads.length, 2);
  assert.ok(uploads.every(s => s.with['retention-days'] === 7));
  assert.equal(uploads[0].if, 'failure()');
  assert.equal(uploads[0].with.name, 'pr-${{ github.event.pull_request.number }}-visual-regression');
  assert.equal(uploads[1].if, 'always()');
  assert.equal(uploads[1].with.archive, false);
});

test('EPUB uses the same head readers for both independently built sources and combines failures', () => {
  const epub = job.steps.find(s => s.name === 'Build, render, and compare EPUBs in Docker');
  assert.equal(epub.if, '${{ !cancelled() }}');
  assert.match(epub.run, /scripts\/vrt\/run-epub-vrt.sh/);
  const setup = readFileSync('scripts/vrt/run-epub-vrt.sh', 'utf8');
  assert.match(setup, /uv sync --locked --only-group vrt/);
  assert.match(epub.run, /docker build -t techbook-epub-vrt - < scripts\/vrt\/epub-vrt\.Dockerfile/);
  assert.match(epub.run, /techbook-epub-vrt sh scripts\/vrt\/run-epub-vrt.sh/);
  assert.match(setup, /node scripts\/vrt\/run-epub-vrt.js/);
  assert.equal(job.steps.find(s => s.name === 'Combine PDF and EPUB results').if, 'always()');
  const smoke = yaml.load(readFileSync('.github/workflows/epub-vrt-smoke.yml', 'utf8'));
  assert.deepEqual(smoke.permissions, {contents: 'read'});
  assert.ok(smoke.jobs['epub-vrt-smoke'].steps.some(s => s.run?.includes('npm run test:vrt')));
});

test('host report merge and fallback use runner temp without writing Docker output', t => {
  const combine = job.steps.find(s => s.name === 'Combine PDF and EPUB results');
  const prepare = job.steps.find(s => s.name === 'Prepare comparison report');
  assert.match(combine.run, /output\/visual "\$RUNNER_TEMP\/vrt-report\/pr-\$\{PR_NUMBER\}-vrt-report\.json"/);
  assert.doesNotMatch(prepare.run, /output\/visual|chown|chmod/);
  const root = mkdtempSync(join(tmpdir(), 'vrt-report-fallback-'));
  t.after(() => rmSync(root, {recursive: true, force: true}));
  const env = {...process.env, RUNNER_TEMP: root, PR_NUMBER: '45'};
  const execute = () => spawnSync('sh', ['-ec', prepare.run], {cwd: root, env, encoding: 'utf8'});
  assert.equal(execute().status, 0);
  const output = join(root, 'vrt-report/pr-45-vrt-report.json');
  assert.match(JSON.parse(readFileSync(output, 'utf8')).errors[0].reason, /unavailable/);
  assert.equal(existsSync(join(root, 'output')), false);
  const original = readFileSync(output, 'utf8');
  assert.equal(execute().status, 0);
  assert.equal(readFileSync(output, 'utf8'), original);
});
