import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { captureSpine, contrastRatio, initializeReader, launchReaderBrowser, locationKey, missingTokenColors, overflowingFragments, parseArguments, reportFailed, serveReader } from './render-epub.js';

test('両ブラウザーエンジンで、自己完結したリソースを使って実際のアーカイブを開く', async () => {
  const previousWindow = globalThis.window;
  let requested;
  globalThis.window = { ePub: (input, options) => {
    requested = { input, options };
    return { ready: Promise.reject(new Error('Stop before DOM setup')) };
  } };
  try {
    await assert.rejects(initializeReader({ width: 600, height: 780 }), /Stop before DOM setup/);
    assert.deepEqual(requested, { input: '/book.epub', options: { replacements: 'base64' } });
  } finally {
    if (previousWindow === undefined) delete globalThis.window;
    else globalThis.window = previousWindow;
  }
});

test('EPUB 描画の既定値はデスクトップ・モバイル向けで、引数を検証する', () => {
  const options = parseArguments(['book.epub', 'output']);
  assert.deepEqual(options.widths, [600, 360]);
  assert.equal(options.height, 780);
  assert.equal(options.browser, 'chromium');
  assert.equal(parseArguments(['book.epub', 'output', '--browser=webkit']).browser, 'webkit');
  assert.equal(parseArguments(['book.epub', 'output', '--browser=chromium']).browser, 'chromium');
  assert.equal(options.baseline, false);
  assert.deepEqual(parseArguments(['book.epub', 'output', '--widths=360,600,360', '--height=900', '--baseline']).widths, [360, 600]);
  assert.equal(parseArguments(['book.epub', 'output', '--baseline']).baseline, true);
  for (const args of [[], ['book.epub'], ['book.epub', 'output', '--unknown'], ['book.epub', 'output', '--height=0'],
    ['book.epub', 'output', '--widths=100'], ['book.epub', 'output', '--max-pages=NaN'], ['book.epub', 'output', '--browser=firefox'],
    ['book.epub', 'output', '--browser='], ['book.epub', 'output', '--browser=WebKit']]) {
    assert.throws(() => parseArguments(args));
  }
});

function location(index, page, total) {
  return { start: { index, cfi: `epubcfi(${index}/${page}/start)`, displayed: { page, total } },
    end: { index, cfi: `epubcfi(${index}/${page}/end)`, displayed: { page, total } } };
}

test('EPUB 描画は非線形の表紙を含む spine の全ページを撮影する', async () => {
  let index;
  let page;
  const spine = [{ index: 0, href: 'cover.xhtml', linear: 'no' }, { index: 1, href: 'chapter.xhtml' }, { index: 2, href: 'back.xhtml' }];
  const totals = [1, 3, 1];
  const screenshots = [];
  const displays = [];
  const pages = await captureSpine({
    display: async href => { index = spine.find(item => item.href === href).index; page = 1; displays.push(href); },
    snapshot: async () => ({ location: location(index, page, totals[index]), diagnostics: [] }),
    next: async () => { page++; },
    screenshot: async file => screenshots.push(file),
  }, spine);
  assert.equal(pages.length, 5);
  assert.deepEqual(displays, spine.map(item => item.href));
  assert.deepEqual(screenshots, ['page-0001.png', 'page-0002.png', 'page-0003.png', 'page-0004.png', 'page-0005.png']);
  assert.deepEqual(pages.map(item => item.spineIndex), [0, 1, 1, 1, 2]);
});

test('EPUB のページ分割は位置の反復・セクションの欠落・上限到達で失敗する', async () => {
  const spine = [{ index: 0, href: 'chapter.xhtml' }];
  const adapter = { display: async () => {}, next: async () => {}, screenshot: async () => {},
    snapshot: async () => ({ location: location(0, 1, 3) }) };
  await assert.rejects(captureSpine(adapter, spine), /stopped advancing/);
  await assert.rejects(captureSpine({ ...adapter, snapshot: async () => ({ location: location(1, 1, 1) }) }, spine), /skipped spine/);
  let page = 0;
  await assert.rejects(captureSpine({ ...adapter, snapshot: async () => ({ location: location(0, ++page, 10) }) }, spine, 2), /Exceeded 2 pages/);
  assert.throws(() => locationKey({}), /did not report/);
});

test('はみ出し検出は段組みの断片を個別に扱い、章全体の幅をはみ出しとみなさない', () => {
  const geometry = { origin: 20, columnWidth: 320, stride: 360 };
  const rect = (left, right) => ({ left, right, width: right - left, height: 20 });
  assert.deepEqual(overflowingFragments([rect(20, 330), rect(380, 690), rect(740, 1060)], geometry), []);
  assert.equal(overflowingFragments([rect(20, 355)], geometry).length, 1);
  assert.equal(overflowingFragments([rect(385, 725)], geometry).length, 1);
  assert.equal(overflowingFragments([rect(15, 100)], geometry).length, 1);
  assert.deepEqual(overflowingFragments([rect(20, 342)], geometry), []);
  assert.deepEqual(overflowingFragments([rect(20, 600)], { origin: 0, columnWidth: NaN, stride: 360 }), []);
});

test('厳格な検証では画像欠落や数式・コードのはみ出しで失敗し、baseline でも実行時エラーは失敗にする', () => {
  const report = { complete: true, baseline: false, errors: [], viewports: [{ pages: [{ diagnostics: [] }] }] };
  assert.equal(reportFailed(report), false);
  for (const type of ['missing-image', 'code-overflow', 'math-overflow', 'unhighlighted-code', 'font-load-error']) {
    report.viewports[0].pages[0].diagnostics = [{ type }];
    assert.equal(reportFailed(report), true, type);
    assert.equal(reportFailed({ ...report, baseline: true }), false, type);
  }
  assert.equal(reportFailed({ ...report, baseline: true, errors: ['Reader failed'] }), true);
  assert.equal(reportFailed({ ...report, baseline: true, complete: false }), true);
});

test('構文強調の検証は妥当な単色の句読記号・演算子や同色のグループを許容する', () => {
  const token = (...classes) => ({ classes: ['token', ...classes], color: 'rgb(248, 248, 242)' });
  // Python foo(bar): only the two punctuation tokens need a color.
  assert.equal(missingTokenColors([token('punctuation'), token('punctuation')]), false);
  // foo = bar + baz: the two operator tokens intentionally share a color.
  assert.equal(missingTokenColors([token('operator'), token('operator')]), false);
  assert.equal(missingTokenColors([token('operator'), token('punctuation')]), false);
  assert.equal(missingTokenColors([token('number'), token('boolean')]), false);
  assert.equal(missingTokenColors([token('function'), token('class-name')]), false);
  assert.equal(missingTokenColors([token('keyword'), token('keyword')]), false);
  assert.equal(missingTokenColors([]), false);
});

test('構文強調の検証は既知の異なる色を持つトークングループを必要とする', () => {
  const token = (type, color = 'rgb(0, 0, 0)') => ({ classes: ['token', type], color });
  assert.equal(missingTokenColors([token('keyword'), token('number')]), true);
  assert.equal(missingTokenColors([token('function'), token('punctuation')]), true);
  assert.equal(missingTokenColors([token('comment'), token('operator')]), true);
  assert.equal(missingTokenColors([token('keyword', 'rgb(102, 217, 239)'), token('number', 'rgb(174, 129, 255)')]), false);
  // Context-dependent strings and unknown/custom classes are not evidence.
  assert.equal(missingTokenColors([token('string'), token('punctuation')]), false);
  assert.equal(missingTokenColors([token('custom-type'), token('keyword')]), false);
  assert.equal(missingTokenColors([{ classes: ['token', 'keyword', 'number'], color: 'black' }, token('punctuation', 'black')]), false);
  // The exact helper sent into the browser remains standalone and testable.
  const browserHelper = (0, eval)(`(${missingTokenColors.toString()})`);
  assert.equal(browserHelper([token('keyword'), token('number')]), true);
});

test('リーダーサーバーは指定どおりのローカル素材だけを公開し、EPUB のバイト列を保つ', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'epub-reader-test-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const input = join(directory, 'book.epub');
  const epub = join(directory, 'epub.js');
  const jszip = join(directory, 'jszip.js');
  await writeFile(input, Buffer.from([0x50, 0x4b, 0, 0xff]));
  await writeFile(epub, 'window.ePub = {};');
  await writeFile(jszip, 'window.JSZip = {};');
  const server = await serveReader(input, { epub, jszip });
  t.after(() => server.close());
  assert.equal((await fetch(server.url)).status, 200);
  assert.match(await (await fetch(server.url)).text(), /\/epub\.min\.js/);
  const archive = await fetch(`${server.url}/book.epub`);
  assert.equal(archive.headers.get('content-type'), 'application/epub+zip');
  assert.deepEqual(Buffer.from(await archive.arrayBuffer()), await readFile(input));
  for (const path of ['/package.json', '/..%2fpackage.json', '/node_modules/epubjs/package.json']) {
    assert.equal((await fetch(server.url + path)).status, 404);
  }
  assert.equal((await fetch(`${server.url}/book.epub`, { method: 'POST' })).status, 404);
});

test('リポジトリ内の QA 用コードは書籍本文にスクリプトを含めず、実際の EPUB.js リーダーを読み込む', async () => {
  const source = await readFile(new URL('./render-epub.js', import.meta.url), 'utf8');
  assert.match(source, /window\.ePub\('\/book\.epub'/);
  assert.match(source, /allowScriptedContent: false/);
  assert.match(source, /launchReaderBrowser\(playwright, options\.browser\)/);
  assert.match(source, /report\.browser = browser\.version\(\)/);
  assert.match(source, /browserEngine: options\.browser \?\? 'chromium'/);
  assert.match(source, /doc\.fonts\.ready/);
  assert.match(source, /math.*overflow|\$\{kind\}-overflow/);
});


test('ブラウザー起動は選択したエンジンを使い、プログラムからの呼び出しでは既定値を保つ', async () => {
  const calls = [];
  const engines = Object.fromEntries(['chromium', 'webkit'].map(engine => [engine, {
    launch: async options => { calls.push({ engine, options }); return engine; },
  }]));
  assert.equal(await launchReaderBrowser(engines), 'chromium');
  assert.equal(await launchReaderBrowser(engines, 'webkit'), 'webkit');
  assert.deepEqual(calls, [{ engine: 'chromium', options: { headless: true } }, { engine: 'webkit', options: { headless: true } }]);
  await assert.rejects(launchReaderBrowser(engines, 'firefox'), /Unsupported browser/);
  assert.equal(calls.length, 2);
});

test('コントラスト検査は不透明な RGB だけを計算し、ブラウザー内で単独動作する', () => {
  assert.equal(contrastRatio('rgb(0, 0, 0)', 'rgb(255, 255, 255)'), 21);
  assert.equal(contrastRatio('rgb(40, 42, 54)', 'rgb(40, 42, 54)'), 1);
  assert.ok(contrastRatio('rgb(248, 248, 242)', 'rgb(39, 40, 34)') > 10);
  assert.equal(contrastRatio('rgba(0, 0, 0, 1)', 'rgb(255, 255, 255)'), 21);
  for (const color of ['transparent', 'rgba(0, 0, 0, 0)', 'rgba(0, 0, 0, 0.5)', 'color(display-p3 1 1 1)', 'rgb(300, 0, 0)']) {
    assert.equal(contrastRatio(color, 'rgb(255, 255, 255)'), null);
    assert.equal(contrastRatio('rgb(0, 0, 0)', color), null);
  }
  const browserHelper = (0, eval)(`(${contrastRatio.toString()})`);
  assert.equal(browserHelper('rgb(0, 0, 0)', 'rgb(255, 255, 255)'), 21);
});


test('数式検査はネイティブ MathML とパスで描く SVG 数式の両方を対象にする', async () => {
  const source = await readFile(new URL('./render-epub.js', import.meta.url), 'utf8');
  assert.ok(source.includes(`doc.querySelectorAll('math, [role="math"], .epub-math')`));
  assert.match(source, /node\.querySelectorAll\('svg'\)/);
  assert.match(source, /concat\(svgBoxes\)/);
  assert.match(source, /entry\.svg = svgBoxes/);
  assert.match(source, /node\.querySelectorAll\('msup,msubsup'\)/);
});
