const {test} = require('node:test');
const assert = require('node:assert/strict');
const {readFileSync, existsSync} = require('node:fs');
const yaml = require('js-yaml');
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
  assert.equal(job['timeout-minutes'], 45);
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
    'scripts/render-pdf-pages.sh', 'scripts/compare-pdf-pages.mjs']) assert.ok(build.includes(command));
  assert.match(readFileSync('scripts/render-pdf-pages.sh', 'utf8'), /-r 300/);
  const uploads = job.steps.filter(s => s.uses?.startsWith('actions/upload-artifact@'));
  assert.equal(uploads.length, 2);
  assert.ok(uploads.every(s => s.with['retention-days'] === 7));
  assert.equal(uploads[0].if, 'failure()');
  assert.equal(uploads[0].with.name, 'pr-${{ github.event.pull_request.number }}-visual-regression');
  assert.equal(uploads[1].if, 'always()');
  assert.equal(uploads[1].with.archive, false);
});
