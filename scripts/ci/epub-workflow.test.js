import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync, mkdtempSync, mkdirSync, writeFileSync, readdirSync, rmSync, existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import yaml from 'js-yaml';

const build = yaml.load(readFileSync('.github/workflows/build.yml', 'utf8'));
const pr = yaml.load(readFileSync('.github/workflows/pr.yml', 'utf8'));
const uploads = steps => steps.filter(step => step.uses?.startsWith('actions/upload-artifact@'));
const sourceFiles = [
  ['pdf/book.pdf', '.pdf', Buffer.from('%PDF normal test bytes\n')],
  ['pdf/book_print.pdf', '_print.pdf', Buffer.from('%PDF print test bytes\n')],
  ['epub/book.epub', '.epub', Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x00, 0xff])],
];

function withFixture(callback) {
  const root = mkdtempSync(join(tmpdir(), 'epub-workflow-test-'));
  try {
    for (const directory of ['bin', 'output/pdf', 'output/epub']) mkdirSync(join(root, directory), {recursive: true});
    for (const [path, , bytes] of sourceFiles) writeFileSync(join(root, 'output', path), bytes);
    const env = {...process.env, PATH: `${join(root, 'bin')}:${process.env.PATH}`,
      GITHUB_OUTPUT: join(root, 'github-output'), COMMAND_LOG: join(root, 'commands')};
    callback({root, env, run: (script, extraEnv = {}) => spawnSync('bash', ['-euo', 'pipefail', '-c', script], {
      cwd: root, env: {...env, ...extraEnv}, encoding: 'utf8',
    })});
  } finally {
    rmSync(root, {recursive: true, force: true});
  }
}

test('both build workflows validate PDF and EPUB before exposing artifacts or release assets', () => {
  for (const workflow of [build, pr]) {
    const steps = workflow.jobs.build.steps;
    const checkIndex = steps.findIndex(step => step.run?.includes('npm run build:all'));
    assert.notEqual(checkIndex, -1);
    assert.deepEqual(steps[checkIndex].run.trim().split('\n').filter(line => line.startsWith('npm ')), [
      'npm run build:all',
      'npm run check:pdf -- output/pdf/book.pdf output/pdf/book_print.pdf',
      'npm run check:epub',
    ]);
    assert.ok(steps.every((step, index) => !step.uses?.match(/upload-artifact|upload-release-action/) || index > checkIndex));
    assert.ok(uploads(steps).every(step => !step.if || !/always|failure/.test(step.if)));
    withFixture(({root, run, env}) => {
      writeFileSync(join(root, 'bin/npm'), '#!/bin/sh\nprintf "%s\\n" "$*" >> "$COMMAND_LOG"\n[ "${FAIL_NPM_COMMAND:-}" != "$*" ]\n', {mode: 0o755});
      const result = run(steps[checkIndex].run);
      assert.equal(result.status, 0, result.stderr);
      assert.deepEqual(readFileSync(env.COMMAND_LOG, 'utf8').trim().split('\n'), [
        'run build:all', 'run check:pdf -- output/pdf/book.pdf output/pdf/book_print.pdf', 'run check:epub',
      ]);
      if (workflow === pr) assert.match(readFileSync(env.GITHUB_OUTPUT, 'utf8'), /^built_at=.+ JST\n$/);
    });
    for (const [failedCommand, commandCount] of [
      ['run build:all', 1], ['run check:pdf -- output/pdf/book.pdf output/pdf/book_print.pdf', 2], ['run check:epub', 3],
    ]) withFixture(({root, run, env}) => {
      writeFileSync(join(root, 'bin/npm'), '#!/bin/sh\nprintf "%s\\n" "$*" >> "$COMMAND_LOG"\n[ "${FAIL_NPM_COMMAND:-}" != "$*" ]\n', {mode: 0o755});
      assert.notEqual(run(steps[checkIndex].run, {FAIL_NPM_COMMAND: failedCommand}).status, 0);
      assert.equal(readFileSync(env.COMMAND_LOG, 'utf8').trim().split('\n').length, commandCount);
      assert.equal(existsSync(env.GITHUB_OUTPUT), false);
    });
  }
});

test('release prepares exactly two PDFs and an EPUB with the same JST timestamp and unchanged bytes', () => {
  const prepare = build.jobs.build.steps.find(step => step.id === 'release');
  const publish = build.jobs.build.steps.find(step => step.uses?.startsWith('svenstaro/upload-release-action@'));
  withFixture(({root, run, env}) => {
    const tag = '2026-11-03-193500';
    writeFileSync(join(root, 'bin/date'), `#!/bin/sh\n[ "$TZ" = Asia/Tokyo ] && [ "$1" = '+%Y-%m-%d-%H%M%S' ] || exit 1\nprintf '%s\\n' '${tag}'\n`, {mode: 0o755});
    const result = run(prepare.run);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(readFileSync(env.GITHUB_OUTPUT, 'utf8'), `tag=${tag}\n`);
    assert.deepEqual(readdirSync(join(root, 'release')).sort(), sourceFiles.map(([, suffix]) => `techbook_${tag}${suffix}`).sort());
    for (const [source, suffix, bytes] of sourceFiles) {
      assert.deepEqual(readFileSync(join(root, 'release', `techbook_${tag}${suffix}`)), bytes);
      assert.deepEqual(readFileSync(join(root, 'output', source)), bytes);
    }
    const pattern = publish.with.file.replace('${{ steps.release.outputs.tag }}', tag);
    const matched = run(`printf '%s\\n' ${pattern}`);
    assert.equal(matched.status, 0, matched.stderr);
    assert.deepEqual(matched.stdout.trim().split('\n').sort(), readdirSync(join(root, 'release')).map(name => `release/${name}`).sort());
  });
  withFixture(({root, run}) => {
    rmSync(join(root, 'output/epub/book.epub'));
    assert.notEqual(run(prepare.run).status, 0, 'Missing EPUB must fail the preparation step.');
  });
});

test('main-only release policy, tested build dependency and existing manual PDF artifact are preserved', () => {
  assert.deepEqual(build.on, {push: {branches: ['main']}, workflow_dispatch: null});
  assert.equal(build.jobs.build.needs, 'test');
  assert.deepEqual(build.permissions, {contents: 'read'});
  assert.deepEqual(build.jobs.build.permissions, {contents: 'write'});
  assert.equal(build.jobs.build.steps.find(step => step.uses?.startsWith('actions/checkout@')).with['persist-credentials'], false);
  const prepare = build.jobs.build.steps.find(step => step.id === 'release');
  const publish = build.jobs.build.steps.find(step => step.uses?.startsWith('svenstaro/upload-release-action@'));
  for (const step of [prepare, publish]) {
    assert.equal(step.if, "github.ref == 'refs/heads/main'");
    assert.equal(step['continue-on-error'], undefined);
  }
  assert.equal(publish.with.file, 'release/techbook_${{ steps.release.outputs.tag }}*');
  assert.equal(publish.with.file_glob, true);
  assert.equal(publish.with.tag, '${{ steps.release.outputs.tag }}');
  assert.equal(publish.with.target_commit, '${{ github.sha }}');
  const artifacts = uploads(build.jobs.build.steps);
  assert.deepEqual(artifacts.map(step => [step.with.name, step.with.path]), [
    ['techbook-pdf', 'output/pdf/*.pdf'], ['techbook-epub', 'output/epub/book.epub'],
  ]);
  for (const step of artifacts) {
    assert.equal(step.if, "github.event_name == 'workflow_dispatch'");
    assert.equal(step.with['if-no-files-found'], 'error');
    assert.equal(step.with['retention-days'], undefined);
  }
});

test('PR EPUB retains direct downloads and read-only build permissions without adding release privileges', () => {
  assert.deepEqual(pr.on, {pull_request: null});
  assert.deepEqual(pr.permissions, {contents: 'read'});
  assert.deepEqual(pr.jobs.build.permissions, {contents: 'read', actions: 'read'});
  assert.equal(pr.jobs['docker-build'].permissions, undefined);
  assert.equal(pr.jobs['docker-build'].steps.find(step => step.run).run, 'npm run build:docker');
  const artifacts = uploads(pr.jobs.build.steps);
  assert.deepEqual(artifacts.map(step => [step.id, step.with.name, step.with.path]), [
    ['pdf', 'pr-${{ github.event.pull_request.number }}-pdf.pdf', '${{ runner.temp }}/pr-artifacts/pr-${{ github.event.pull_request.number }}-pdf.pdf'],
    ['print_pdf', 'pr-${{ github.event.pull_request.number }}-print-pdf.pdf', '${{ runner.temp }}/pr-artifacts/pr-${{ github.event.pull_request.number }}-print-pdf.pdf'],
    ['epub', 'pr-${{ github.event.pull_request.number }}-epub.epub', '${{ runner.temp }}/pr-artifacts/pr-${{ github.event.pull_request.number }}-epub.epub'],
  ]);
  for (const step of artifacts) {
    assert.equal(step.with.archive, false);
    assert.equal(step.with['retention-days'], 7);
    assert.equal(step.with['if-no-files-found'], 'error');
  }
  const notice = pr.jobs.build.steps.find(step => step.id === 'artifact_notice');
  for (const [key, id] of [['PDF', 'pdf'], ['PRINT_PDF', 'print_pdf'], ['EPUB', 'epub']]) {
    assert.equal(notice.env[`${key}_ID`], `\${{ steps.${id}.outputs.artifact-id }}`);
    assert.equal(notice.env[`${key}_URL`], `\${{ steps.${id}.outputs.artifact-url }}`);
  }
  assert.equal(pr.jobs.comment.needs, 'build');
  assert.equal(pr.jobs.comment.if, '${{ always() && github.event.pull_request.head.repo.full_name == github.repository }}');
  assert.deepEqual(pr.jobs.comment.permissions, {contents: 'read', 'pull-requests': 'write'});
  assert.ok(pr.jobs.comment.steps.every(step => step.uses?.startsWith('marocchino/sticky-pull-request-comment@')));
  const comments = pr.jobs.comment.steps.filter(step => step.with.header === 'pdf-build');
  assert.equal(comments.length, 2, 'Keep the existing sticky comment header to update prior comments.');
  assert.ok(comments.every(step => step.with.message.includes('EPUB')));
  assert.equal(Object.values(pr.jobs).flatMap(job => job.steps).some(step => step.uses?.includes('upload-release-action')), false);
});
