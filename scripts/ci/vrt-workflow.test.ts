import type {Workflow} from './workflow-types.ts';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync, existsSync, mkdtempSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import yaml from 'js-yaml';
const workflow = yaml.load(readFileSync('.github/workflows/visual-regression.yml', 'utf8')) as Workflow;
const job = workflow.jobs['visual-regression'];
const condition = job.if.replace('github.event.pull_request.labels.*.name', 'github.event.pull_request.labels.map(label => label.name)');
const eligible = new Function('github', 'contains', 'vars', `return ${condition}`);
function accepts(action: string, labels: string[], changedLabel?: string, author = 'human', fork = false, enableDev = 'TRUE') {
  if (!workflow.on.pull_request.types.includes(action)) return false;
  return eligible({event: {action, label: {name: changedLabel}, pull_request: {
    labels: labels.map(name => ({name})), user: {login: author}, head: {repo: {fork}},
  }}}, (values: string[], value: string) => values.includes(value), {ENABLE_DEV: enableDev.toUpperCase()});
}
test('保守CI有効時のVRTは人間、Dependabot、フォークのPRでラベルに基づいて実行し、後続のプッシュも対象にする', () => {
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
test('保守CI無効時はvrtラベル付きのPRや後続プッシュでもVRTを実行しない', () => {
  for (const value of ['', 'FALSE', '1', 'yes', ' TRUE ']) {
    for (const action of ['opened', 'reopened', 'synchronize', 'labeled']) {
      assert.equal(accepts(action, ['vrt'], 'vrt', 'human', false, value), false);
      assert.equal(accepts(action, ['vrt'], 'vrt', 'human', true, value), false);
    }
  }
  for (const value of ['TRUE', 'true', 'TrUe']) assert.equal(accepts('labeled', ['vrt'], 'vrt', 'human', false, value), true);
});
test('無関係なラベルは実行中のVRTをキャンセルせず、同じPRのジョブだけが同時実行制御を共有する', () => {
  assert.equal(workflow.concurrency, undefined);
  assert.equal(job.concurrency.group, 'pdf-vrt-${{ github.event.pull_request.number }}');
  assert.equal(job.concurrency['cancel-in-progress'], true);
  assert.equal(job['timeout-minutes'], 90);
});
test('信頼できないPRのビルドは読み取り専用権限を使い、チェックアウトの認証情報を保持しない', () => {
  assert.deepEqual(workflow.permissions, {contents: 'read'});
  assert.deepEqual(job.permissions, {contents: 'read', actions: 'read'});
  assert.equal(job.steps[0].with['persist-credentials'], false);
  assert.equal(job.steps[0].with.ref, '${{ github.event.pull_request.head.sha }}');
  assert.equal(workflow.on.pull_request_target, undefined);
  assert.equal(job.steps.some(s => /sticky-pull-request-comment|github-script/.test(s.uses || '')), false);
});
test("Dependabot設定はトークンを使うラベル付けワークフローではなく、vrtを直接指定する", () => {
  const config = yaml.load(readFileSync('.github/dependabot.yml', 'utf8')) as {updates: {labels: string[]; schedule: {interval: string}}[]};
  assert.deepEqual(config.updates[0].labels, ['vrt']);
  assert.equal(config.updates[0].schedule.interval, 'daily');
  assert.equal(existsSync('.github/workflows/dependabot-visual-regression.yml'), false);
});
test("baselineとcurrentのPDF比較、300dpi、診断用アーティファクトの7日間保持を維持する", () => {
  const build = job.steps.find(s => s.name === 'Build, render, and compare PDFs in Docker')!.run;
  for (const command of ['npm ci', 'npm run build', 'npm run build:print', 'npm run check:pdf',
    'scripts/pdf/render-pdf-pages.sh', 'scripts/vrt/compare-pdf-pages.ts']) assert.ok(build.includes(command));
  assert.match(readFileSync('scripts/pdf/render-pdf-pages.sh', 'utf8'), /-r 300/);
  const uploads = job.steps.filter(s => s.uses?.startsWith('actions/upload-artifact@'));
  assert.equal(uploads.length, 2);
  assert.ok(uploads.every(s => s.with['retention-days'] === 7));
  assert.equal(uploads[0].if, 'failure()');
  assert.equal(uploads[0].with.name, 'pr-${{ github.event.pull_request.number }}-visual-regression');
  assert.equal(uploads[1].if, 'always()');
  assert.equal(uploads[1].with.archive, false);
});

test("EPUBは独立してビルドした両ソースに同じhead側リーダーを使い、失敗結果を集約する", () => {
  const epub = job.steps.find(s => s.name === 'Build, render, and compare EPUBs in Docker')!;
  assert.equal(epub.if, '${{ !cancelled() }}');
  assert.match(epub.run, /scripts\/vrt\/run-epub-vrt.sh/);
  const setup = readFileSync('scripts/vrt/run-epub-vrt.sh', 'utf8');
  assert.match(setup, /uv sync --locked --only-group vrt/);
  assert.match(epub.run, /docker build -t techbook-epub-vrt - < scripts\/vrt\/epub-vrt\.Dockerfile/);
  assert.match(epub.run, /techbook-epub-vrt sh scripts\/vrt\/run-epub-vrt.sh/);
  assert.match(setup, /node --import tsx scripts\/vrt\/run-epub-vrt.ts/);
  assert.equal(job.steps.find(s => s.name === 'Combine PDF and EPUB results')!.if, 'always()');
  const smoke = yaml.load(readFileSync('.github/workflows/epub-vrt-smoke.yml', 'utf8')) as Workflow;
  assert.deepEqual(smoke.permissions, {contents: 'read'});
  assert.ok(smoke.jobs['epub-vrt-smoke'].steps.some(s => s.run?.includes('npm run test:vrt')));
});

test("ホスト側のレポート統合と代替処理はDocker出力に書き込まず、ランナーの一時領域を使う", t => {
  const combine = job.steps.find(s => s.name === 'Combine PDF and EPUB results')!;
  const prepare = job.steps.find(s => s.name === 'Prepare comparison report')!;
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

test('コンテナー制御とホスト側レポート集約の前にtsxを導入する', () => {
  const setup = readFileSync('scripts/vrt/run-epub-vrt.sh', 'utf8');
  assert.ok(setup.indexOf('npm ci') < setup.indexOf('node --import tsx'));
  const install = job.steps.findIndex(s => s.name === 'Install host report dependencies');
  const combine = job.steps.findIndex(s => s.name === 'Combine PDF and EPUB results');
  assert.ok(install >= 0 && install < combine);
  const dockerSteps = job.steps.flatMap((step, index) => step.run?.includes('docker run') ? [index] : []);
  assert.equal(dockerSteps.length, 2);
  assert.ok(dockerSteps.every(index => install < index), 'Host npm ci must precede Docker anonymous volume mount creation');
  assert.equal(job.steps[install].if, 'always()');
  assert.equal(job.steps[install].run, 'npm ci');
  assert.ok(job.steps.slice(0, install).some(s => s.uses?.startsWith('actions/setup-node@') && s.with['node-version'] === '24' && s.if === 'always()'));
  assert.match(job.steps[combine].run, /node --import tsx scripts\/vrt\/combine-vrt-reports\.ts/);
});
