const {test} = require('node:test');
const assert = require('node:assert/strict');
const {mkdtempSync, writeFileSync, rmSync, symlinkSync, readFileSync} = require('node:fs');
const {tmpdir} = require('node:os');
const {join} = require('node:path');
const {validate, prepare, publish, reportLines} = require('./vrt-report.cjs');
const head = 'a'.repeat(40);

function fixture(options = {}) {
  const run = {id: 100, workflow_id: 8, run_attempt: 2, event: 'pull_request', status: 'completed',
    conclusion: 'failure', repository: {full_name: 'owner/repo'}, head_sha: head,
    head_repository: {full_name: 'fork/repo'}, pull_requests: [{number: 26}], run_number: 20,
    run_started_at: '2026-10-29T20:00:00Z', ...options.run};
  const pr = {number: 26, state: 'open', head: {sha: head, repo: {full_name: 'fork/repo'}},
    base: {repo: {full_name: 'owner/repo'}}, labels: [{name: 'vrt'}], ...options.pr};
  const job = {name: 'visual-regression', status: 'completed', conclusion: 'failure', ...options.job};
  const artifacts = options.artifacts || [
    {id: 40, name: 'pr-26-vrt-report.json', size_in_bytes: 300, workflow_run: {id: 100}, created_at: '2026-10-29T20:01:00Z'},
    {id: 41, name: 'pr-26-visual-regression', size_in_bytes: 9000, workflow_run: {id: 100}, created_at: '2026-10-29T20:01:00Z', expires_at: '2099-01-02T15:00:00Z'},
  ];
  const comments = options.comments || [];
  const writes = [], warnings = [], calls = [];
  let prCalls = 0;
  const github = {rest: {
    actions: {
      getWorkflowRun: async args => {calls.push(['run', args]); return {data: run};},
      getWorkflow: async () => ({data: {path: options.path || '.github/workflows/visual-regression.yml'}}),
      listJobsForWorkflowRun: 'jobs', listWorkflowRunArtifacts: 'artifacts',
      getArtifact: async args => ({data: artifacts.find(a => a.id === args.artifact_id)}),
    },
    pulls: {list: 'pulls', get: async () => {prCalls++; return {data: options.prAtCall ? options.prAtCall(pr, prCalls) : pr};}},
    issues: {listComments: 'comments',
      createComment: async args => writes.push({type: 'create', ...args}),
      updateComment: async args => writes.push({type: 'update', ...args}),
    },
  }, paginate: async (endpoint, args) => {
    calls.push([endpoint, args]);
    if (endpoint === 'jobs') return options.jobs || [job];
    if (endpoint === 'artifacts') return artifacts;
    if (endpoint === 'pulls') return options.open || [pr];
    if (endpoint === 'comments') return comments;
    throw new Error('Unexpected endpoint');
  }};
  const context = {repo: {owner: 'owner', repo: 'repo'}, payload: {workflow_run: {id: 100, run_attempt: 2}}};
  const core = {warning: s => warnings.push(s)};
  return {github, context, core, writes, warnings, calls, pr, run,
    validate: () => validate({github, context, runId: 100, attempt: 2}),
    prepare: () => prepare({github, context})};
}

async function withReport(fn, contents = JSON.stringify({errors: [{page: 'book-1.png', reason: '差分あり', images: {diff: 'diff/book-1.png'}}]})) {
  const directory = mkdtempSync(join(tmpdir(), 'vrt-report-'));
  try {
    if (contents !== null) writeFileSync(join(directory, 'pr-26-vrt-report.json'), contents);
    await fn(directory);
  } finally { rmSync(directory, {recursive: true, force: true}); }
}

test('validates fork and Dependabot-style read-only upstream runs using API metadata', async () => {
  const f = fixture();
  const p = await f.prepare();
  assert.equal(p.prNumber, 26); assert.equal(p.reportId, 40); assert.equal(p.visualId, 41);
  assert.equal(p.head, head); assert.equal(p.attempt, 2);
  assert.deepEqual(f.calls.find(([name]) => name === 'jobs')[1],
    {owner: 'owner', repo: 'repo', run_id: 100, filter: 'latest', per_page: 100});
});

test('empty fork pull_requests resolves only an unambiguous matching API PR', async () => {
  assert.equal((await fixture({run: {pull_requests: []}}).prepare()).prNumber, 26);
  const f = fixture({run: {pull_requests: []}});
  assert.equal(await fixture({run: {pull_requests: []}, open: [f.pr, {...f.pr, number: 27}]}).prepare(), null);
  assert.equal(await fixture({run: {pull_requests: []}, open: [{...f.pr, head: {sha: 'b'.repeat(40)}}]}).prepare(), null);
});

test('rejects wrong run, repository, workflow, event, attempt and incomplete conclusions', async () => {
  for (const run of [{id: 101}, {run_attempt: 3}, {event: 'push'}, {status: 'in_progress'},
    {conclusion: 'cancelled'}, {conclusion: 'skipped'}, {repository: {full_name: 'other/repo'}},
    {head_sha: 'invalid'}, {head_repository: {full_name: 'other/repo'}}, {pull_requests: [{number: -1}, {number: 26}, {number: 27}]}]) {
    assert.equal(await fixture({run}).prepare(), null, JSON.stringify(run));
  }
  assert.equal(await fixture({path: '.github/workflows/other.yml'}).prepare(), null);
});

test('rejects closed, unlabelled, different-head and different-base-repository PRs', async () => {
  for (const pr of [{state: 'closed'}, {number: 27}, {labels: []},
    {head: {sha: 'b'.repeat(40), repo: {full_name: 'fork/repo'}}}, {base: {repo: {full_name: 'other/repo'}}}]) {
    assert.equal(await fixture({pr}).prepare(), null);
  }
});

test('skipped or missing VRT job is not a successful visual comparison', async () => {
  assert.equal(await fixture({job: {conclusion: 'skipped'}, run: {conclusion: 'success'}}).prepare(), null);
  assert.equal(await fixture({jobs: []}).prepare(), null);
  assert.equal(await fixture({job: {status: 'in_progress'}}).prepare(), null);
});

test('accepts only bounded, unique, current-attempt artifacts from the exact run', async () => {
  const base = {id: 40, name: 'pr-26-vrt-report.json', size_in_bytes: 300,
    workflow_run: {id: 100}, created_at: '2026-10-29T20:01:00Z'};
  for (const mismatch of [{size_in_bytes: 1048577}, {size_in_bytes: 0}, {expired: true},
    {workflow_run: {id: 99}}, {created_at: '2026-10-29T19:59:59Z'}, {created_at: 'invalid'},
    {name: 'pr-27-vrt-report.json'}, {id: -1}]) {
    assert.equal((await fixture({artifacts: [{...base, ...mismatch}]}).prepare()).reportId, null);
  }
  assert.equal((await fixture({artifacts: [base, {...base, id: 42}]}).prepare()).reportId, null);
});

test('failure comment preserves safe details, actual expiry, head and exact attempt link', async () => {
  const f = fixture(), plan = await f.prepare();
  await withReport(async directory => assert.equal(await publish({...f, plan, directory}), true));
  assert.equal(f.writes.length, 1);
  const body = f.writes[0].body;
  assert.match(body, /差分あり/); assert.match(body, /diff\/book-1.png/);
  assert.match(body, /保持期限:2099\/01\/03/); assert.match(body, /最大7日間/);
  assert.match(body, /actions\/runs\/100\/attempts\/2/); assert.match(body, new RegExp(head));
  assert.equal(f.writes[0].issue_number, 26);
});

test('success comment does not read a missing diagnostic file or claim skipped success', async () => {
  const f = fixture({run: {conclusion: 'success'}, job: {conclusion: 'success'}}), plan = await f.prepare();
  await withReport(async directory => assert.equal(await publish({...f, plan, directory}), true), null);
  assert.match(f.writes[0].body, /差分はありません/); assert.equal(f.warnings.length, 0);
});

test('missing, malformed, oversized or symlinked reports preserve log fallback', async () => {
  for (const content of [null, 'not json', JSON.stringify({errors: [{}]}), 'x'.repeat(1048577)]) {
    const f = fixture(), plan = await f.prepare();
    await withReport(async directory => await publish({...f, plan, directory}), content);
    assert.match(f.writes[0].body, /詳細レポートを取得できません/);
    assert.match(f.writes[0].body, /actions\/runs\/100\/attempts\/2/);
  }
  const f = fixture(), plan = await f.prepare();
  await withReport(async directory => {
    writeFileSync(join(directory, 'other'), '{"errors":[]}');
    symlinkSync(join(directory, 'other'), join(directory, 'pr-26-vrt-report.json'));
    await publish({...f, plan, directory});
  }, null);
  assert.match(f.writes[0].body, /詳細レポートを取得できません/);
});

test('report text cannot inject Markdown, HTML, mentions or arbitrary image paths', () => {
  for (const page of ['<script>@all', '<SCRIPT>@all', '<img src=x>@all']) {
    const safe = reportLines(JSON.stringify({errors: [{page, reason: '[click](https://evil) @owner `x`'}]}));
    assert.equal(safe.includes('<'), false);
    assert.doesNotMatch(safe, /@owner|@all|\[click\]\(/);
  }
  for (const path of ['../secret', 'https://evil', 'diff/book-1.png`\n@owner', 'before/book-1.png']) {
    assert.throws(() => reportLines(JSON.stringify({errors: [{reason: 'x', images: {diff: path}}]})), /Invalid image path/);
  }
  assert.throws(() => reportLines(JSON.stringify({errors: Array(201).fill({reason: 'x'})})), /Invalid/);
});

test('newer result and repeated same attempt cannot be overwritten; older bot comment updates', async () => {
  for (const status of ['101:1', '100:2', '100:3']) {
    const f = fixture({comments: [{id: 1, user: {login: 'github-actions[bot]'}, body: `<!-- pdf-visual-regression -->\n<!-- vrt-run:${status} -->`}]}), plan = await f.prepare();
    await withReport(async directory => assert.equal(await publish({...f, plan, directory}), false));
    assert.equal(f.writes.length, 0);
  }
  const f = fixture({comments: [{id: 1, user: {login: 'github-actions[bot]'}, body: '<!-- pdf-visual-regression -->\n<!-- vrt-run:99:1 -->'}]}), plan = await f.prepare();
  await withReport(async directory => assert.equal(await publish({...f, plan, directory}), true));
  assert.equal(f.writes[0].type, 'update'); assert.equal(f.writes[0].comment_id, 1);
});

test('head/label is rechecked immediately before posting, and user comments are not edited', async () => {
  const f = fixture({prAtCall: (pr, count) => count >= 3 ? {...pr, labels: []} : pr}), plan = await f.prepare();
  await withReport(async directory => assert.equal(await publish({...f, plan, directory}), false));
  assert.equal(f.writes.length, 0);
  const user = fixture({comments: [{id: 1, user: {login: 'attacker'}, body: '<!-- pdf-visual-regression -->'}]}), p = await user.prepare();
  await withReport(async directory => await publish({...user, plan: p, directory}));
  assert.equal(user.writes[0].type, 'create');
});

test('reporter checks out only trusted workflow SHA and downloads only a validated artifact to temp', () => {
  const workflow = readFileSync('.github/workflows/vrt-report.yml', 'utf8');
  assert.match(workflow, /workflow_run:/); assert.match(workflow, /ref: \$\{\{ github.workflow_sha \}\}/);
  assert.match(workflow, /persist-credentials: false/);
  assert.match(workflow, /artifact-ids: \$\{\{ steps.prepare.outputs.report_id \}\}/);
  assert.match(workflow, /path: \$\{\{ runner.temp \}\}\/vrt-report/);
  assert.doesNotMatch(workflow, /pull_request_target|npm (ci|install)|head\.sha/);
});
