// This module is loaded only from the reporter workflow's trusted default-branch SHA.
const {readFileSync, lstatSync} = require('node:fs');
const {join} = require('node:path');
const {artifactDownloadLine, retentionNote} = require('./pr-artifact-notice.cjs');
const marker = '<!-- pdf-visual-regression -->';
const workflowPath = '.github/workflows/visual-regression.yml';
const positive = n => Number.isSafeInteger(n) && n > 0;
const sha = value => typeof value === 'string' && /^[a-f0-9]{40}$/.test(value);
const sameRepo = (value, repo) => value === `${repo.owner}/${repo.repo}`;

async function validate({github, context, runId, attempt}) {
  if (!positive(runId) || !positive(attempt)) return null;
  const {data: run} = await github.rest.actions.getWorkflowRun({...context.repo, run_id: runId});
  if (run.id !== runId || run.run_attempt !== attempt || run.event !== 'pull_request' ||
      run.status !== 'completed' || !['success', 'failure'].includes(run.conclusion) ||
      !sameRepo(run.repository?.full_name, context.repo) || !sha(run.head_sha)) return null;
  const {data: workflow} = await github.rest.actions.getWorkflow({...context.repo, workflow_id: run.workflow_id});
  if (workflow.path !== workflowPath) return null;
  let numbers = (run.pull_requests || []).map(pr => pr.number).filter(positive);
  // GitHub may omit pull_requests for fork workflow runs. Resolve via API, never an artifact claim.
  if (!numbers.length) {
    const open = await github.paginate(github.rest.pulls.list, {...context.repo, state: 'open', per_page: 100});
    numbers = open.filter(pr => pr.head?.sha === run.head_sha &&
      pr.head?.repo?.full_name === run.head_repository?.full_name).map(pr => pr.number);
  }
  if (numbers.length !== 1 || !positive(numbers[0])) return null;
  const {data: pr} = await github.rest.pulls.get({...context.repo, pull_number: numbers[0]});
  if (pr.number !== numbers[0] || pr.state !== 'open' || !sameRepo(pr.base?.repo?.full_name, context.repo) ||
      pr.head?.sha !== run.head_sha || !pr.head?.repo?.full_name ||
      pr.head.repo.full_name !== run.head_repository?.full_name ||
      !pr.labels?.some(label => label.name === 'vrt')) return null;
  const jobs = await github.paginate(github.rest.actions.listJobsForWorkflowRun,
    {...context.repo, run_id: runId, filter: 'latest', per_page: 100});
  const matches = jobs.filter(job => job.name === 'visual-regression');
  if (matches.length !== 1 || matches[0].status !== 'completed' ||
      !['success', 'failure'].includes(matches[0].conclusion)) return null;
  return {runId, attempt, prNumber: pr.number, head: run.head_sha,
    conclusion: matches[0].conclusion, runNumber: run.run_number, startedAt: run.run_started_at};
}

async function prepare({github, context}) {
  const event = context.payload.workflow_run;
  const plan = await validate({github, context, runId: event.id, attempt: event.run_attempt});
  if (!plan) return null;
  const artifacts = await github.paginate(github.rest.actions.listWorkflowRunArtifacts,
    {...context.repo, run_id: plan.runId, per_page: 100});
  const select = name => {
    const found = artifacts.filter(a => a.name === name && !a.expired && positive(a.id) &&
      a.workflow_run?.id === plan.runId && Number.isFinite(Date.parse(plan.startedAt)) &&
      Date.parse(a.created_at) >= Date.parse(plan.startedAt));
    return found.length === 1 ? found[0] : null;
  };
  const report = select(`pr-${plan.prNumber}-vrt-report.json`);
  const visual = select(`pr-${plan.prNumber}-visual-regression`);
  return {...plan, reportId: report && report.size_in_bytes > 0 && report.size_in_bytes <= 1048576 ? report.id : null,
    visualId: visual?.id || null};
}

function escapeText(value, max = 1000) {
  return String(value).slice(0, max).replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/@/g, '@\u200b').replace(/[\\`*_{}\[\]()#+!|]/g, '\\$&');
}
function reportLines(text) {
  if (Buffer.byteLength(text) > 1048576) throw new Error('Oversized VRT report');
  const report = JSON.parse(text);
  if (!report || !Array.isArray(report.errors) || report.errors.length > 200) throw new Error('Invalid VRT report');
  const lines = [];
  for (const error of report.errors) {
    if (!error || typeof error.reason !== 'string' || error.reason.length > 4000 ||
        (error.page != null && typeof error.page !== 'string')) throw new Error('Invalid VRT report entry');
    lines.push('', error.page ? `### ${escapeText(error.page, 100)}` : '### ビルドエラー', escapeText(error.reason));
    if (error.images != null) {
      if (typeof error.images !== 'object' || Array.isArray(error.images)) throw new Error('Invalid images');
      for (const [kind, label] of [['before', '更新前'], ['after', '更新後'], ['diff', '差分']]) {
        const path = error.images[kind];
        if (path != null && (typeof path !== 'string' || !new RegExp(`^${kind}/book(?:_print)?-[0-9]+\\.png$`).test(path))) {
          throw new Error('Invalid image path');
        }
        lines.push(`- ${label}: ${path ? `\`${path}\`` : '画像なし'}`);
      }
    }
  }
  // Keep a single GitHub comment comfortably below the API limit.
  return lines.join('\n').slice(0, 45000);
}

async function publish({github, context, core, plan, directory}) {
  const current = await validate({github, context, runId: plan.runId, attempt: plan.attempt});
  if (!current || current.prNumber !== plan.prNumber || current.head !== plan.head ||
      current.conclusion !== plan.conclusion) return false;
  const runUrl = `https://github.com/${context.repo.owner}/${context.repo.repo}/actions/runs/${plan.runId}`;
  const lines = [marker, `<!-- vrt-run:${plan.runId}:${plan.attempt} -->`,
    plan.conclusion === 'success' ? 'PDF の表示に差分はありませんでした。' : '❌ PDF のビジュアル回帰テストに失敗しました。'];
  if (plan.conclusion === 'failure') {
    try {
      if (!plan.reportId) throw new Error('Report artifact unavailable');
      const file = join(directory, `pr-${plan.prNumber}-vrt-report.json`);
      const stat = lstatSync(file);
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 1048576) throw new Error('Invalid report file');
      lines.push(reportLines(readFileSync(file, 'utf8')));
    } catch (error) {
      core.warning(`Could not read validated VRT diagnostics: ${error.message}`);
      lines.push('', '詳細レポートを取得できませんでした。実行ログを確認してください。');
    }
    lines.push('', await artifactDownloadLine({github, core,
      context: {...context, runId: plan.runId}, artifactId: plan.visualId ? String(plan.visualId) : '',
      artifactUrl: plan.visualId ? `${runUrl}/artifacts/${plan.visualId}` : '',
      expectedName: `pr-${plan.prNumber}-visual-regression`, label: '画像一式'}), '', retentionNote);
  }
  lines.push('', `対象コミット: \`${plan.head}\``,
    `[実行 #${plan.runNumber} / attempt ${plan.attempt}](${runUrl}/attempts/${plan.attempt})`);
  const comments = await github.paginate(github.rest.issues.listComments,
    {...context.repo, issue_number: plan.prNumber, per_page: 100});
  const existing = comments.filter(c => c.user?.login === 'github-actions[bot]' && c.body?.includes(marker));
  if (existing.length > 1) throw new Error('Multiple VRT status comments');
  if (existing[0]) {
    const match = existing[0].body.match(/<!-- vrt-run:(\d+):(\d+) -->/);
    if (match && (Number(match[1]) > plan.runId ||
      (Number(match[1]) === plan.runId && Number(match[2]) >= plan.attempt))) return false;
  }
  // Recheck immediately before the only write; no comment for a pushed/closed/unlabelled PR.
  const final = await validate({github, context, runId: plan.runId, attempt: plan.attempt});
  if (!final || final.prNumber !== plan.prNumber || final.head !== plan.head) return false;
  if (existing[0]) await github.rest.issues.updateComment({...context.repo, comment_id: existing[0].id, body: lines.join('\n')});
  else await github.rest.issues.createComment({...context.repo, issue_number: plan.prNumber, body: lines.join('\n')});
  return true;
}
module.exports = {validate, prepare, publish, reportLines};
