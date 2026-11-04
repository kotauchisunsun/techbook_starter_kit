import test from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { checkEpub } from './check-epub.js';

function fixture(result = { status: 0 }, env = {}) {
  const calls = [];
  return { calls, options: { env, exists: () => false, run: (...args) => { calls.push(args); return result; } } };
}

test('既定の出力を公式 EPUBCheck で検証する', () => {
  const f = fixture();
  assert.equal(checkEpub([], f.options), 0);
  assert.deepEqual(f.calls, [['epubcheck', [resolve('output/epub/book.epub')], { stdio: 'inherit', env: {}, shell: false }]]);
});

test('明示したパスや空白を含むパスをシェル展開やオプション注入なしで扱う', () => {
  const f = fixture();
  assert.equal(checkEpub(['a book.epub', '-version.epub', 'semi;colon.epub'], f.options), 0);
  assert.deepEqual(f.calls.map(([, args]) => args), ['a book.epub', '-version.epub', 'semi;colon.epub'].map(name => [resolve(name)]));
  assert(f.calls.every(([, , options]) => options.shell === false));
});

test('空白を含む Java JAR のパスに対応する', () => {
  const f = fixture({ status: 0 }, { EPUBCHECK_JAR: 'EPUB Check/epubcheck.jar' });
  assert.equal(checkEpub(['book.epub'], f.options), 0);
  assert.deepEqual(f.calls[0].slice(0, 2), ['java', ['-jar', resolve('EPUB Check/epubcheck.jar'), resolve('book.epub')]]);
});

test('不正な EPUB の検証失敗を伝え、後続ファイルの処理を止める', () => {
  const f = fixture({ status: 1 });
  assert.equal(checkEpub(['invalid.epub', 'later.epub'], f.options), 1);
  assert.equal(f.calls.length, 1);
  assert.equal(checkEpub([], fixture({ status: null }).options), 1);
});

test('検証ツールや Java がない場合は導入手順を案内する', () => {
  for (const env of [{}, { EPUBCHECK_JAR: '/tools/epubcheck.jar' }]) {
    assert.throws(() => checkEpub([], fixture({ error: { code: 'ENOENT' } }, env).options), /EPUBCHECK_JAR/);
  }
});

test('実行失敗やシグナルによる終了を検証成功として報告しない', () => {
  const error = new Error('Access denied');
  assert.throws(() => checkEpub([], fixture({ error }).options), error);
  assert.throws(() => checkEpub([], fixture({ status: null, signal: 'SIGTERM' }).options), /SIGTERM/);
});


test('Debian / Ubuntu の JAR を binfmt_misc に依存せず Java で起動する', () => {
  const f = fixture();
  f.options.exists = path => path === '/usr/share/java/epubcheck.jar';
  assert.equal(checkEpub(['book.epub'], f.options), 0);
  assert.deepEqual(f.calls[0].slice(0, 2), ['java', ['-jar', '/usr/share/java/epubcheck.jar', resolve('book.epub')]]);
});

test('明示した EPUBCHECK_JAR をディストリビューションの JAR より優先する', () => {
  const f = fixture({ status: 0 }, { EPUBCHECK_JAR: 'custom/epubcheck.jar' });
  f.options.exists = () => { throw new Error('System lookup should not run for an explicit JAR'); };
  assert.equal(checkEpub(['book.epub'], f.options), 0);
  assert.deepEqual(f.calls[0].slice(0, 2), ['java', ['-jar', resolve('custom/epubcheck.jar'), resolve('book.epub')]]);
});
