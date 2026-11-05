import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync, readdirSync} from 'node:fs';
import yaml from 'js-yaml';
import type {Workflow} from './workflow-types.ts';

const load = (file: string) => yaml.load(readFileSync(`.github/workflows/${file}.yml`, 'utf8')) as Workflow;
const workflows = Object.fromEntries(readdirSync('.github/workflows').map(file => [file.replace(/\.yml$/, ''), load(file.replace(/\.yml$/, ''))]));
const maintenance: Record<string, string[]> = {
  build: ['test'],
  pr: ['test', 'epub-visual', 'docker-build'],
  'epub-vrt-smoke': ['epub-vrt-smoke'],
  'visual-regression': ['visual-regression'],
  'vrt-report': ['report'],
};
const writing: Record<string, string[]> = {
  build: ['build'],
  pr: ['build', 'comment'],
  'cleanup-pr-artifacts': ['cleanup'],
};
const gate = "vars.ENABLE_DEV == 'TRUE'";

// These expressions use string comparisons and boolean operators. GitHub's
// string comparisons ignore case; normalize the variable to model that behavior.
function evaluate(condition: string, value = '', result = 'skipped', cancelled = false, event = 'pull_request') {
  const expression = condition.replace(/^\$\{\{\s*|\s*\}\}$/g, '');
  const run = new Function('vars', 'needs', 'cancelled', 'github', `return (${expression});`);
  return Boolean(run({ENABLE_DEV: value.toUpperCase()}, {test: {result}}, () => cancelled,
    {event: {workflow_run: {event}}}));
}

test('すべてのワークフロージョブを保守用と執筆用に区分する', () => {
  assert.deepEqual(Object.keys(workflows).sort(), [...new Set([...Object.keys(maintenance), ...Object.keys(writing)])].sort());
  for (const [file, workflow] of Object.entries(workflows)) {
    assert.deepEqual(Object.keys(workflow.jobs).sort(), [...(maintenance[file] ?? []), ...(writing[file] ?? [])].sort(), file);
  }
});

test('保守ジョブはランナーや依存ツールの準備前にリポジトリ変数で無効化する', () => {
  for (const [file, jobs] of Object.entries(maintenance)) for (const name of jobs) {
    const job = workflows[file].jobs[name];
    assert.ok(job.if.startsWith(gate), `${file}: ${name}`);
    assert.doesNotMatch(job.if, /secrets\.|env\.|inputs\.|repository_owner|\.fork/);
    if (['visual-regression', 'vrt-report'].includes(file)) continue;
    assert.equal(job.if, gate);
    for (const value of ['', 'FALSE', 'false', '0', '1', 'yes', ' TRUE ']) assert.equal(evaluate(job.if, value), false, value);
    for (const value of ['TRUE', 'true', 'TrUe']) assert.equal(evaluate(job.if, value), true, value);
  }
});

test('VRTレポーターも無効時は動かず、有効時だけPRの完了を処理する', () => {
  const condition = workflows['vrt-report'].jobs.report.if;
  assert.equal(condition, `${gate} && github.event.workflow_run.event == 'pull_request'`);
  for (const event of ['pull_request', 'push', 'workflow_dispatch']) {
    for (const value of ['', 'FALSE']) assert.equal(evaluate(condition, value, 'success', false, event), false);
    assert.equal(evaluate(condition, 'TRUE', 'success', false, event), event === 'pull_request');
  }
});

test('mainの出版ビルドは保守無効時にも進み、有効時のテスト失敗や予期しないskipでは止まる', () => {
  const job = workflows.build.jobs.build;
  assert.equal(job.needs, 'test');
  assert.match(job.if, /!cancelled\(\)/, 'Override the default success() condition after a skipped dependency.');
  for (const value of ['', 'FALSE', 'TRUE', 'true']) {
    for (const result of ['success', 'failure', 'cancelled', 'skipped']) {
      const expected = result === 'success' || (value.toUpperCase() !== 'TRUE' && result === 'skipped');
      assert.equal(evaluate(job.if, value, result), expected, `${value}: ${result}`);
      assert.equal(evaluate(job.if, value, result, true), false, `cancelled: ${value}: ${result}`);
    }
  }
});

test('原稿校正・出版物の生成検証・成果物通知と清掃を保守フラグから切り離す', () => {
  const pr = workflows.pr;
  assert.equal(pr.jobs.build.if, undefined);
  assert.equal(pr.jobs.build.needs, undefined);
  const lint = pr.jobs.build.steps.find(step => step.id === 'lint')!;
  assert.match(lint.run, /npm run lint/);
  assert.equal(lint.if, undefined);
  for (const workflow of [pr, workflows.build]) {
    const step = workflow.jobs.build.steps.find(step => step.run?.includes('npm run build:all'))!;
    assert.equal(step.if, undefined);
    assert.match(step.run, /npm run check:pdf/);
    assert.match(step.run, /npm run check:epub/);
    assert.doesNotMatch(workflow.jobs.build.steps.map(step => step.run ?? '').join('\n'), /npm (test|run (test(?::|\b)|lint:|typecheck))/);
  }
  assert.equal(pr.jobs.comment.needs, 'build');
  assert.doesNotMatch(pr.jobs.comment.if, /ENABLE_DEV/);
  assert.doesNotMatch(workflows['cleanup-pr-artifacts'].jobs.cleanup.if, /ENABLE_DEV/);
});

test('ローカルnpmコマンドに保守フラグや無効時の成功扱いを持ち込まない', () => {
  const {scripts} = JSON.parse(readFileSync('package.json', 'utf8')) as {scripts: Record<string, string>};
  assert.ok(Object.values(scripts).every(command => !command.includes('ENABLE_DEV')));
  assert.equal(scripts.lint, 'textlint "manuscript/**/*.md"');
  assert.equal(scripts.test, 'node --import tsx --test "scripts/**/*.test.{js,ts}"');
  assert.equal(scripts['lint:code'], 'npm run lint:js && npm run lint:shell');
  assert.equal(scripts.typecheck, 'tsc --project scripts/tsconfig.json');
});

test('テスト・出版ビルド・描画・Dockerの実行環境をNode.js 22系に統一する', () => {
  const jobs = Object.values(workflows).flatMap(workflow => Object.values(workflow.jobs));
  const steps = jobs.flatMap(job => job.steps);
  const setup = steps.filter(step => step.uses?.startsWith('actions/setup-node@'));
  assert.ok(setup.length > 0);
  for (const step of setup) {
    assert.equal(step.with['node-version'], '22');
    assert.equal(step.with['check-latest'], true);
  }
  for (const workflow of [workflows.pr, workflows.build]) {
    assert.equal('strategy' in workflow.jobs.test, false);
  }
  const {engines, scripts} = JSON.parse(readFileSync('package.json', 'utf8')) as {
    engines: {node: string}; scripts: Record<string, string>;
  };
  assert.equal(engines.node, '^22.13.0');
  const commands = [scripts['build:docker'], readFileSync('scripts/vrt/epub-vrt.Dockerfile', 'utf8'),
    ...steps.map(step => step.run ?? '')];
  const images = commands.flatMap(command => [...command.matchAll(/\bnode:([\w.-]+)/g)].map(match => match[1]));
  assert.ok(images.length > 0);
  for (const image of images) assert.match(image, /^22-(bookworm|trixie)-slim$/);
});


test('Dockerが必要なジョブだけフルVMを使い、それ以外は15分以内のslimを使う', () => {
  for (const [file, workflow] of Object.entries(workflows)) for (const [name, job] of Object.entries(workflow.jobs)) {
    const docker = (file === 'pr' && name === 'docker-build') || file === 'visual-regression';
    if (docker) {
      assert.match(job['runs-on'], /^ubuntu-(latest|24\.04)$/);
      assert.ok(job.steps.some(step => /docker (build|run)|npm run build:docker/.test(step.run ?? '')));
    } else {
      assert.equal(job['runs-on'], 'ubuntu-slim', `${file}: ${name}`);
      assert.ok(job['timeout-minutes'] <= 15, `${file}: ${name}`);
    }
  }
});
