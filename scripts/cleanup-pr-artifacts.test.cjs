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

function fixture({number = 26, artifacts = [], state = 'closed', deletionStatus} = {}) {
  const deleted = [], searched = [];
  const actions = {
    listArtifactsForRepo: 'listArtifactsForRepo',
    deleteArtifact: async ({artifact_id}) => {
      deleted.push(artifact_id);
      if (deletionStatus) throw Object.assign(new Error('delete failed'), {status: deletionStatus});
    },
  };
  const github = {rest: {actions, pulls: {get: async () => ({data: {state}})}},
    paginate: async (endpoint, args) => {
      assert.equal(endpoint, actions.listArtifactsForRepo);
      assert.equal(args.per_page, 100);
      searched.push(args.name);
      return artifacts; // Deliberately include nonmatching API data: fail closed.
    }};
  return {deleted, searched, run: () => execute(github,
    {repo: {owner: 'owner', repo: 'repo'}, issue: {number}}, {info() {}})};
}

test('deletes only exact PR names, including legacy ZIPs and comparison images', async () => {
  const names = ['pr-26-pdf.pdf', 'pr-26-print-pdf.pdf', 'pr-26-pdf', 'pr-26-print-pdf', 'pr-26-visual-regression'];
  const f = fixture({artifacts: names.map((name, id) => ({name, id}))});
  await f.run();
  assert.deepEqual(f.searched, names);
  assert.deepEqual(f.deleted, [0, 1, 2, 3, 4]);
});

test('does not delete generic files, other PRs, prefix collisions or unrelated files', async () => {
  const names = ['book.pdf', 'book_print.pdf', 'pr-2-pdf.pdf', 'pr-260-pdf.pdf', 'pr-26-pdf.pdf.backup', 'pr-26-unknown'];
  const f = fixture({artifacts: names.map((name, id) => ({name, id}))});
  await f.run();
  assert.deepEqual(f.deleted, []);
});

test('all paginated results/repeated builds are handled without a first-page limit', async () => {
  const f = fixture({artifacts: Array.from({length: 201}, (_, id) => ({id, name: 'pr-26-pdf.pdf'}))});
  await f.run();
  assert.equal(f.deleted.length, 201);
  assert.equal(new Set(f.deleted).size, 201);
});

test('reopened PRs and expired artifacts are not deleted', async () => {
  for (const options of [{state: 'open'}, {artifacts: [{id: 1, name: 'pr-26-pdf.pdf', expired: true}]}]) {
    const f = fixture({artifacts: [{id: 1, name: 'pr-26-pdf.pdf'}], ...options});
    await f.run();
    assert.deepEqual(f.deleted, []);
  }
});

test('already removed 404 is harmless but real API failures surface', async () => {
  const opts = {artifacts: [{id: 1, name: 'pr-26-pdf.pdf'}]};
  await fixture({...opts, deletionStatus: 404}).run();
  await assert.rejects(fixture({...opts, deletionStatus: 403}).run(), /delete failed/);
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
