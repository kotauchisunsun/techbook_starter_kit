const {test} = require('node:test');
const assert = require('node:assert/strict');
const {readFileSync, mkdtempSync, mkdirSync, writeFileSync, rmSync} = require('node:fs');
const {tmpdir} = require('node:os');
const {join} = require('node:path');
const {execFileSync} = require('node:child_process');
const workflow = readFileSync('.github/workflows/cleanup-pr-artifacts.yml', 'utf8');
const script = workflow.split('          script: |\n')[1].split('\n').map(line => line.replace(/^            /, '')).join('\n');
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
const execute = new AsyncFunction('github', 'context', 'core', script);

function fixture({artifacts = [], state = 'closed', prResponse, listStatus, pullStatus, deletionStatus,
  verifyStatus, verifyArtifacts, summaryStatus} = {}) {
  const deleted = [], checked = [], events = [], removed = new Set();
  const summary = {text: '', rows: [], written: false,
    addHeading(text) { this.text += text; return this; },
    addRaw(text) { this.text += text; return this; },
    addTable(rows) { this.rows = rows.slice(1); return this; },
    async write() { if (summaryStatus) throw new Error('summary failed'); this.written = true; },
  };
  let listCalls = 0;
  const failure = status => Object.assign(new Error(`API failed: ${status}`), {status});
  const actions = {
    listArtifactsForRepo: 'listArtifactsForRepo',
    deleteArtifact: async ({owner, repo, artifact_id}) => {
      assert.equal(owner, 'owner');
      assert.equal(repo, 'repo');
      events.push(`delete:${artifact_id}`);
      deleted.push(artifact_id);
      const status = typeof deletionStatus === 'function' ? deletionStatus(artifact_id) : deletionStatus;
      if (!status || status === 404) removed.add(artifact_id);
      if (status) throw failure(status);
    },
  };
  const github = {rest: {actions, pulls: {get: async ({owner, repo, pull_number}) => {
    assert.equal(owner, 'owner');
    assert.equal(repo, 'repo');
    events.push(`check:${pull_number}`);
    checked.push(pull_number);
    const status = typeof pullStatus === 'function' ? pullStatus(pull_number, checked.length) : pullStatus;
    if (status) throw failure(status);
    const pr = {number: pull_number, state, base: {repo: {full_name: 'owner/repo'}}};
    return {data: prResponse ? prResponse(pr, checked.length) : pr};
  }}},
  paginate: async (endpoint, args) => {
    assert.equal(endpoint, actions.listArtifactsForRepo);
    assert.deepEqual(args, {owner: 'owner', repo: 'repo', per_page: 100});
    listCalls++;
    if (listStatus || (listCalls > 1 && verifyStatus)) throw failure(listStatus || verifyStatus);
    const source = listCalls > 1 && verifyArtifacts ? verifyArtifacts : artifacts.filter(a => !removed.has(a.id));
    // Simulate all pages being collected before callers receive the snapshot.
    const snapshot = [];
    for (let offset = 0; offset < source.length; offset += 100) {
      if (listCalls === 1) assert.deepEqual(deleted, []);
      events.push(`${listCalls === 1 ? '' : 'verify-'}page:${offset / 100 + 1}`);
      snapshot.push(...source.slice(offset, offset + 100));
    }
    return snapshot;
  }};
  return {deleted, checked, events, summary, run: () => execute(github,
    {repo: {owner: 'owner', repo: 'repo'}}, {info() {}, summary})};
}

test('cleanup uses scheduled/default-branch API-only execution with unchanged permissions', () => {
  assert.equal(workflow.split('on:\n')[1].split('\npermissions:')[0],
    "  schedule:\n    # Avoid the start-of-hour peak. Cleanup uses only default-branch code.\n    - cron: '17 * * * *'\n  workflow_dispatch:\n");
  assert.equal(workflow.split('permissions:\n')[1].split('\njobs:')[0],
    '  actions: write\n  pull-requests: read\n');
  assert.match(workflow, /if: github.ref == format\('refs\/heads\/\{0\}', github.event.repository.default_branch\)/);
  assert.deepEqual([...workflow.matchAll(/- uses: (.+)/g)].map(match => match[1]), ['actions/github-script@v9']);
  assert.doesNotMatch(workflow, /pull_request_target|actions\/checkout|download-artifact|context\.issue/);
});

test('deletes exact supported names for multiple closed PRs, including legacy ZIPs and comparison images', async () => {
  const suffixes = ['pdf.pdf', 'print-pdf.pdf', 'pdf', 'print-pdf', 'visual-regression', 'vrt-report.json'];
  const names = [26, 27].flatMap(number => suffixes.map(suffix => `pr-${number}-${suffix}`));
  const f = fixture({artifacts: names.map((name, id) => ({name, id: id + 1}))});
  await f.run();
  assert.deepEqual(f.deleted, Array.from({length: 12}, (_, i) => i + 1));
  assert.deepEqual(f.checked, [26, 26, 26, 26, 26, 26, 27, 27, 27, 27, 27, 27, 26, 27]);
});

test('does not select generic, malformed, prefix/suffix collision or unsafe-number names', async () => {
  const names = ['book.pdf', 'book_print.pdf', 'pr-026-pdf.pdf', 'pr-0-pdf.pdf', 'pr--26-pdf.pdf',
    'pr-26-pdf.pdf.backup', 'pr-26-unknown', 'xpr-26-pdf.pdf', 'pr-26-pdf.pdf\n',
    'pr-26-pdf.pdf\r\n', 'pr-26e1-pdf.pdf', 'pr-9007199254740992-pdf.pdf', 'pr-26-pdfXpdf'];
  const f = fixture({artifacts: names.map((name, id) => ({name, id: id + 1}))});
  await f.run();
  assert.deepEqual(f.deleted, []);
  assert.deepEqual(f.checked, []);
});

test('open PRs and PR-number prefix collisions are retained without stopping later closed PR cleanup', async () => {
  const f = fixture({artifacts: [2, 26, 260, 27].map(number => ({id: number, name: `pr-${number}-pdf.pdf`})),
    prResponse: pr => ({...pr, state: [26, 27].includes(pr.number) ? 'closed' : 'open'})});
  await f.run();
  assert.deepEqual(f.deleted, [26, 27]);
});

test('requires matching repository, PR number and explicitly closed state from the API', async () => {
  for (const mismatch of [
    {number: 27}, {state: 'unknown'}, {state: undefined}, {base: {repo: {full_name: 'other/repo'}}}, {base: null},
  ]) {
    const f = fixture({artifacts: [{id: 1, name: 'pr-26-pdf.pdf'}], prResponse: pr => ({...pr, ...mismatch})});
    await f.run();
    assert.deepEqual(f.deleted, []);
  }
});

test('fork, Dependabot, merged and deleted-head PRs use base-repository state rather than head metadata', async () => {
  for (const metadata of [
    {head: {repo: {full_name: 'contributor/fork'}}},
    {user: {login: 'dependabot[bot]'}}, {merged: true}, {head: {repo: null}},
  ]) {
    const f = fixture({artifacts: [{id: 1, name: 'pr-26-pdf.pdf'}], prResponse: pr => ({...pr, ...metadata})});
    await f.run();
    assert.deepEqual(f.deleted, [1]);
  }
});

test('collects all pages before deletion and rechecks every repeated-build artifact', async () => {
  const f = fixture({artifacts: Array.from({length: 201}, (_, i) => ({id: i + 1, name: 'pr-26-pdf.pdf'}))});
  await f.run();
  assert.equal(f.deleted.length, 201);
  assert.equal(new Set(f.deleted).size, 201);
  assert.deepEqual(f.events.slice(0, 3), ['page:1', 'page:2', 'page:3']);
  for (let i = 3; i < 3 + 201 * 2; i += 2) {
    assert.equal(f.events[i], 'check:26');
    assert.match(f.events[i + 1], /^delete:/);
  }
});

test('reopening between deletions protects remaining artifacts without stopping unrelated cleanup', async () => {
  const f = fixture({artifacts: [
    {id: 1, name: 'pr-26-pdf.pdf'}, {id: 2, name: 'pr-26-print-pdf.pdf'}, {id: 3, name: 'pr-27-pdf.pdf'},
  ], prResponse: (pr, call) => ({...pr, state: pr.number === 26 && call > 1 ? 'open' : 'closed'})});
  await f.run();
  assert.deepEqual(f.deleted, [1, 3]);
});

test('expired artifacts are not looked up or deleted', async () => {
  const f = fixture({artifacts: [{id: 1, name: 'pr-26-pdf.pdf', expired: true}]});
  await f.run();
  assert.deepEqual(f.deleted, []);
  assert.deepEqual(f.checked, []);
});

test('artifacts uploaded after a snapshot are handled by the next run', async () => {
  const artifacts = [{id: 1, name: 'pr-26-pdf.pdf'}];
  const first = fixture({artifacts, prResponse: pr => {
    if (artifacts.length === 1) artifacts.push({id: 2, name: 'pr-26-print-pdf.pdf'});
    return pr;
  }});
  await first.run();
  assert.deepEqual(first.deleted, [1]);
  const next = fixture({artifacts: artifacts.filter(artifact => !first.deleted.includes(artifact.id))});
  await next.run();
  assert.deepEqual(next.deleted, [2]);
});

test('missing PRs and already removed artifacts are harmless', async () => {
  const artifacts = [{id: 1, name: 'pr-26-pdf.pdf'}];
  const missing = fixture({artifacts, pullStatus: 404});
  await missing.run();
  assert.deepEqual(missing.deleted, []);
  await fixture({artifacts, deletionStatus: 404}).run();
});

test('listing, PR lookup and deletion failures surface instead of broadening deletion', async () => {
  for (const status of [403, 429, 500]) {
    for (const stage of ['listStatus', 'pullStatus', 'deletionStatus']) {
      const f = fixture({artifacts: [{id: 1, name: 'pr-26-pdf.pdf'}, {id: 2, name: 'pr-27-pdf.pdf'}], [stage]: status});
      await assert.rejects(f.run(), new RegExp(`API failed: ${status}`));
      assert.deepEqual(f.deleted, stage === 'deletionStatus' ? [1] : []);
    }
  }
});

test('summary separates successful deletion, concurrent absence and protected open PRs', async () => {
  const f = fixture({artifacts: [
    {id: 1, name: 'pr-26-pdf.pdf'}, {id: 2, name: 'pr-26-print-pdf.pdf'},
    {id: 3, name: 'pr-27-pdf.pdf'}, {id: 4, name: 'book.pdf'},
  ], deletionStatus: id => id === 2 ? 404 : 0,
  prResponse: pr => ({...pr, state: pr.number === 27 ? 'open' : 'closed'})});
  await f.run();
  assert.equal(f.summary.written, true);
  assert.deepEqual(f.summary.rows, [
    ['#26', '2', '1', '1', '0', '0', '0', '0', '確認時点で対象なし'],
    ['#27', '1', '0', '0', '1', '0', '0', '1', 'open / reopened のため保持'],
  ]);
  assert.match(f.summary.text, /対象外の名前: 1 件/);
});

test('summary reports new uploads as remaining without deleting them in the same run', async () => {
  const f = fixture({artifacts: [{id: 1, name: 'pr-26-pdf.pdf'}], verifyArtifacts: [
    {id: 2, name: 'pr-26-print-pdf.pdf'}, {id: 3, name: 'pr-27-pdf.pdf'},
  ]});
  await f.run();
  assert.deepEqual(f.deleted, [1]);
  assert.deepEqual(f.summary.rows, [
    ['#26', '1', '1', '0', '0', '0', '0', '1', '残存あり（次回対象）'],
    ['#27', '0', '0', '0', '0', '0', '0', '1', '残存あり（次回対象）'],
  ]);
});

test('partial deletion failure preserves successful counts and fails after verification', async () => {
  const f = fixture({artifacts: [{id: 1, name: 'pr-26-pdf.pdf'}, {id: 2, name: 'pr-26-print-pdf.pdf'}],
    deletionStatus: id => id === 2 ? 403 : 0});
  await assert.rejects(f.run(), /API failed: 403/);
  assert.equal(f.summary.written, true);
  assert.deepEqual(f.summary.rows, [['#26', '2', '1', '0', '0', '0', '1', '1', '残存あり（次回対象）']]);
});

test('failed re-listing reports unknown remaining, never zero or successful verification', async () => {
  const f = fixture({artifacts: [{id: 1, name: 'pr-26-pdf.pdf'}], verifyStatus: 500});
  await assert.rejects(f.run(), /API failed: 500/);
  assert.deepEqual(f.summary.rows, [['#26', '1', '1', '0', '0', '0', '0', '未確認', '未確認']]);
});

test('post-deletion PR-state lookup failure leaves state unknown and fails the run', async () => {
  const f = fixture({artifacts: [{id: 1, name: 'pr-26-pdf.pdf'}], pullStatus: (_, call) => call === 2 ? 500 : 0});
  await assert.rejects(f.run(), /API failed: 500/);
  assert.deepEqual(f.summary.rows, [['#26', '1', '1', '0', '0', '0', '1', '0', 'PR 状態未確認']]);
});

test('a supposedly removed artifact still present in the snapshot is an error', async () => {
  const artifacts = [{id: 1, name: 'pr-26-pdf.pdf'}];
  for (const deletionStatus of [undefined, 404]) {
    const f = fixture({artifacts, deletionStatus, verifyArtifacts: artifacts});
    await assert.rejects(f.run(), /still present/);
    assert.equal(f.summary.rows[0][6], '1');
    assert.equal(f.summary.rows[0][7], '1');
  }
});

test('final state recheck notices a PR reopened after its last deletion', async () => {
  const f = fixture({artifacts: [{id: 1, name: 'pr-26-pdf.pdf'}],
    prResponse: (pr, call) => ({...pr, state: call > 1 ? 'open' : 'closed'})});
  await f.run();
  assert.deepEqual(f.summary.rows, [['#26', '1', '1', '0', '0', '0', '0', '0', '確認時点で対象なし（現在 open / reopened）']]);
});

test('missing PRs are explicitly unconfirmed, not deleted or protected open PRs', async () => {
  const f = fixture({artifacts: [{id: 1, name: 'pr-26-pdf.pdf'}], pullStatus: 404});
  await f.run();
  assert.deepEqual(f.summary.rows, [['#26', '1', '0', '0', '0', '1', '0', '1', 'PR 状態未確認']]);
});

test('an empty snapshot does not invent a deletion history or enumerate all PRs', async () => {
  const f = fixture();
  await f.run();
  assert.deepEqual(f.checked, []);
  assert.deepEqual(f.summary.rows, []);
  assert.match(f.summary.text, /過去の削除・期限切れ・未生成を区別しません/);
});

test('initial list failure reports unknown scope and preserves the original API failure if summary also fails', async () => {
  const f = fixture({listStatus: 403});
  await assert.rejects(f.run(), /API failed: 403/);
  assert.deepEqual(f.deleted, []);
  assert.match(f.summary.text, /初回一覧を取得できず/);
  const failedSummary = fixture({listStatus: 403, summaryStatus: true});
  await assert.rejects(failedSummary.run(), /API failed: 403/);
});

test('upload copies carry the actual PR-specific names and preserve PDF bytes and source names', () => {
  const text = readFileSync('.github/workflows/pr.yml', 'utf8');
  const step = text.split('      - name: Prepare PR-specific PDF filenames\n')[1].split('      - uses:')[0];
  const shell = step.split('        run: |\n')[1].split('\n').map(line => line.replace(/^          /, '')).join('\n');
  const root = mkdtempSync(join(tmpdir(), 'pr-artifacts-test-'));
  try {
    mkdirSync(join(root, 'output/pdf'), {recursive: true});
    mkdirSync(join(root, 'tmp'));
    writeFileSync(join(root, 'output/pdf/book.pdf'), 'normal PDF test bytes');
    writeFileSync(join(root, 'output/pdf/book_print.pdf'), 'print PDF test bytes');
    for (const number of ['26', '27']) {
      execFileSync('bash', ['-eu', '-c', shell], {cwd: root, env: {...process.env, PR_NUMBER: number, RUNNER_TEMP: join(root, 'tmp')}});
      for (const [source, suffix] of [['book.pdf', 'pdf.pdf'], ['book_print.pdf', 'print-pdf.pdf']]) {
        assert.deepEqual(readFileSync(join(root, `tmp/pr-artifacts/pr-${number}-${suffix}`)), readFileSync(join(root, `output/pdf/${source}`)));
      }
    }
    assert.equal((text.match(/retention-days: 7/g) || []).length, 2);
    assert.equal((text.match(/archive: false/g) || []).length, 2);
    assert.match(text, /path: \$\{\{ runner.temp \}\}\/pr-artifacts\/pr-\$\{\{ github.event.pull_request.number \}\}-pdf.pdf/);
    assert.match(text, /path: \$\{\{ runner.temp \}\}\/pr-artifacts\/pr-\$\{\{ github.event.pull_request.number \}\}-print-pdf.pdf/);
  } finally {
    rmSync(root, {recursive: true, force: true});
  }
});
