import type {Artifact, NoticeOptions, Repo} from './pr-artifact-notice.ts';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import * as notices from './pr-artifact-notice.ts';
const {formatExpiryDate, artifactDownloadLine, runDetails} = notices;
const context = {repo: {owner: 'owner', repo: 'repo'}, runId: 123, runNumber: 42};
const env = {GITHUB_SERVER_URL: 'https://github.com', GITHUB_RUN_ATTEMPT: '2'};
const url = 'https://github.com/owner/repo/actions/runs/123/artifacts/456';

function fixture(overrides: Partial<Artifact> = {}, status?: number) {
  const requested: (Repo & {artifact_id: number})[] = [], warnings: string[] = [];
  const artifact = {id: 456, name: 'pr-26-pdf.pdf', workflow_run: {id: 123}, expired: false,
    expires_at: '2026-11-02T15:30:00Z', ...overrides};
  const github = {rest: {actions: {getArtifact: async (args: Repo & {artifact_id: number}) => {
    requested.push(args);
    if (status) throw Object.assign(new Error('API error'), {status});
    return {data: artifact};
  }}}};
  const core = {warning: (message: string) => warnings.push(message)};
  const args = {github, core, context, artifactId: '456', artifactUrl: url,
    expectedName: 'pr-26-pdf.pdf', label: '通常版 PDF', now: Date.parse('2026-10-26T01:00:00Z')};
  return {args, requested, warnings, line: (extra: Partial<NoticeOptions> = {}) => artifactDownloadLine({...args, ...extra})};
}

test('有効期限はUTCの日付・年の境界をまたいでもゼロ埋めしたJSTで表示する', () => {
  for (const [timestamp, date] of [
    ['2026-01-02T14:59:59Z', '2026/01/02'],
    ['2026-01-02T15:00:00Z', '2026/01/03'],
    ['2026-12-31T15:00:00Z', '2027/01/01'],
    ['2026-01-03T00:00:00+09:00', '2026/01/03'],
  ]) assert.equal(formatExpiryDate(timestamp), date);
  for (const value of [undefined, null, '', ' ', 'not-a-date', '0', '2026/01/02', '2026-01-02', '2026-02-30T00:00:00Z', '2026-01-02T24:00:00Z', 123]) assert.equal(formatExpiryDate(value), null);
});

test('アップロードされた正確なアーティファクトIDを読み取り、現在から7日後ではなくAPIの実際の有効期限を表示する', async () => {
  const f = fixture();
  assert.equal(await f.line(), `- [通常版 PDF](${url}) — 保持期限:2026/11/03（JST）`);
  assert.deepEqual(f.requested, [{owner: 'owner', repo: 'repo', artifact_id: 456}]);
  assert.deepEqual(f.warnings, []);
});

test('有効期限が欠落または不正でも日付を捏造せず、検証済みのアーティファクトリンクを保持する', async () => {
  for (const expires_at of [null, undefined, '', 'invalid']) {
    assert.equal(await fixture({expires_at}).line(), `- [通常版 PDF](${url}) — 保持期限:不明`);
  }
});

test('アップロード出力がない場合はAPI呼び出しと不正なリンクを生成しない', async () => {
  for (const extra of [{artifactId: ''}, {artifactId: 'NaN'}, {artifactId: '0'}, {artifactId: '-1'}, {artifactId: '1.2'}, {artifactUrl: ''}]) {
    const f = fixture();
    assert.equal(await f.line(extra), '- 通常版 PDF — 保持期限:不明（Artifact をアップロードできませんでした）');
    assert.deepEqual(f.requested, []);
  }
});

test('404と410では利用できないリンクを省き、その他のAPIエラーでは正確なアップロードURLを保持して期限を推測しない', async () => {
  for (const status of [404, 410]) {
    assert.equal(await fixture({}, status).line(), '- 通常版 PDF — 保持期限:不明（Artifact が見つからないか、削除済みです）');
  }
  for (const status of [403, 429, 500]) {
    const f = fixture({}, status);
    assert.equal(await f.line(), `- [通常版 PDF](${url}) — 保持期限:取得できませんでした`);
    assert.match(f.warnings[0], new RegExp(`HTTP ${status}`));
  }
});

test('APIのフラグまたは正確な期限時刻が期限切れを示す場合はダウンロードリンクを表示しない', async () => {
  for (const extra of [{expired: true}, {expires_at: '2026-10-26T01:00:00Z'}, {expires_at: '2026-10-25T23:59:59Z'}]) {
    const line = await fixture(extra).line();
    assert.match(line, /（期限切れ）$/);
    assert.doesNotMatch(line, /https:/);
  }
  assert.equal(await fixture({expired: true, expires_at: null}).line(), '- 通常版 PDF — 保持期限:不明（期限切れ）');
});

test('別のID、アーティファクト名、実行のメタデータを今回のアップロードとして表示しない', async () => {
  for (const extra of [{id: 457}, {name: 'pr-27-pdf.pdf'}, {workflow_run: {id: 122}}, {workflow_run: null}]) {
    const f = fixture(extra);
    assert.equal(await f.line(), '- 通常版 PDF — 保持期限:不明（この実行の Artifact を確認できませんでした）');
    assert.equal(f.warnings.length, 1);
  }
});

test('実行詳細は該当するワークフローの実行試行に直接リンクする', () => {
  assert.equal(runDetails({context, env}), '[実行 #42 / attempt 2](https://github.com/owner/repo/actions/runs/123/attempts/2)');
});

const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
function workflowScript(path: string) {
  const lines = readFileSync(path, 'utf8').split('          script: |\n')[1].split('\n');
  const end = lines.findIndex(line => line.trim() && !line.startsWith('            '));
  return lines.slice(0, end < 0 ? lines.length : end).map(line => line.slice(12)).join('\n');
}

test('PDF・EPUBワークフローは個別のアップロードIDとURLを渡し、アーティファクトごとの有効期限を表示する', async () => {
  const script = workflowScript('.github/workflows/pr.yml');
  const execute = new AsyncFunction('github', 'core', 'context', 'process', script);
  const seen: number[] = [];
  const github = {rest: {actions: {getArtifact: async ({artifact_id}: {artifact_id: 456 | 789 | 987}) => {
    seen.push(artifact_id);
    return {data: {id: artifact_id, workflow_run: {id: 123},
      name: {456: 'pr-26-pdf.pdf', 789: 'pr-26-print-pdf.pdf', 987: 'pr-26-epub.epub'}[artifact_id],
      expires_at: {456: '2099-01-02T14:59:59Z', 789: '2099-01-02T15:00:00Z', 987: '2099-01-03T15:00:00Z'}[artifact_id]}};
  }}}};
  const result = await execute(github, {warning() {}}, context, {env: {...env, GITHUB_WORKSPACE: process.cwd(), PR_NUMBER: '26',
    PDF_ID: '456', PDF_URL: url, PRINT_PDF_ID: '789', PRINT_PDF_URL: url.replace('456', '789'),
    EPUB_ID: '987', EPUB_URL: url.replace('456', '987')}});
  assert.deepEqual(seen, [456, 789, 987]);
  assert.match(result, /通常版 PDF.*artifacts\/456.*保持期限:2099\/01\/02/);
  assert.match(result, /印刷用 PDF.*artifacts\/789.*保持期限:2099\/01\/03/);
  assert.match(result, /EPUB.*artifacts\/987.*保持期限:2099\/01\/04/);
  assert.match(result, /actions\/runs\/123\/attempts\/2/);
  assert.match(result, /期限前に削除されることがあります/);
});

test('すべてのPRアップロードは7日間保持し、PDF・EPUBの直接ダウンロードとPR以外の保持期間を維持する', () => {
  const pdf = readFileSync('.github/workflows/pr.yml', 'utf8');
  const vrt = readFileSync('.github/workflows/visual-regression.yml', 'utf8');
  assert.equal((pdf.match(/retention-days: 7/g) || []).length, 4);
  assert.equal((vrt.match(/retention-days: 7/g) || []).length, 2);
  assert.doesNotMatch(pdf + vrt, /retention-days: 3/);
  assert.equal((pdf.match(/archive: false/g) || []).length, 3);
  assert.match(pdf, /PDF_ID: \$\{\{ steps.pdf.outputs.artifact-id \}\}/);
  assert.match(pdf, /PRINT_PDF_ID: \$\{\{ steps.print_pdf.outputs.artifact-id \}\}/);
  assert.match(pdf, /EPUB_ID: \$\{\{ steps.epub.outputs.artifact-id \}\}/);
  assert.match(pdf, /EPUB_URL: \$\{\{ steps.epub.outputs.artifact-url \}\}/);
  assert.match(pdf, /built_at: \$\{\{ steps.build.outputs.built_at \}\}/);
  assert.match(pdf, /needs.build.outputs.artifact_notice/);
  assert.doesNotMatch(readFileSync('.github/workflows/build.yml', 'utf8'), /retention-days:/);
});


