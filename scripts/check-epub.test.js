import test from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { checkEpub } from './check-epub.js';

function fixture(result = { status: 0 }, env = {}) {
  const calls = [];
  return { calls, options: { env, run: (...args) => { calls.push(args); return result; } } };
}

test('validates the default output with official EPUBCheck', () => {
  const f = fixture();
  assert.equal(checkEpub([], f.options), 0);
  assert.deepEqual(f.calls, [['epubcheck', [resolve('output/epub/book.epub')], { stdio: 'inherit', env: {}, shell: false }]]);
});

test('supports explicit paths and spaces without shell interpolation or option injection', () => {
  const f = fixture();
  assert.equal(checkEpub(['a book.epub', '-version.epub', 'semi;colon.epub'], f.options), 0);
  assert.deepEqual(f.calls.map(([, args]) => args), ['a book.epub', '-version.epub', 'semi;colon.epub'].map(name => [resolve(name)]));
  assert(f.calls.every(([, , options]) => options.shell === false));
});

test('supports a Java JAR path containing spaces', () => {
  const f = fixture({ status: 0 }, { EPUBCHECK_JAR: 'EPUB Check/epubcheck.jar' });
  assert.equal(checkEpub(['book.epub'], f.options), 0);
  assert.deepEqual(f.calls[0].slice(0, 2), ['java', ['-jar', resolve('EPUB Check/epubcheck.jar'), resolve('book.epub')]]);
});

test('invalid EPUBs propagate failure and stop before subsequent files', () => {
  const f = fixture({ status: 1 });
  assert.equal(checkEpub(['invalid.epub', 'later.epub'], f.options), 1);
  assert.equal(f.calls.length, 1);
  assert.equal(checkEpub([], fixture({ status: null }).options), 1);
});

test('missing validator or Java gives actionable installation guidance', () => {
  for (const env of [{}, { EPUBCHECK_JAR: '/tools/epubcheck.jar' }]) {
    assert.throws(() => checkEpub([], fixture({ error: { code: 'ENOENT' } }, env).options), /EPUBCHECK_JAR/);
  }
});

test('execution failures and signals never report validation success', () => {
  const error = new Error('Access denied');
  assert.throws(() => checkEpub([], fixture({ error }).options), error);
  assert.throws(() => checkEpub([], fixture({ status: null, signal: 'SIGTERM' }).options), /SIGTERM/);
});
