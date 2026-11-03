import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync, readdirSync} from 'node:fs';
import {resolve} from 'node:path';
import config from '../vivliostyle.config.js';
import printConfig from '../vivliostyle.print.config.js';
import documentProcessor from './mermaid.js';

test('all first-party JavaScript uses the explicit ESM package scope and .js extension', () => {
  const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
  assert.equal(pkg.type, 'module');
  const files = [...readdirSync('.'), ...readdirSync('scripts').map(name => `scripts/${name}`)];
  assert.deepEqual(files.filter(name => /\.[cm]js$/.test(name)), []);
});

test('ESM Vivliostyle configs preserve the processor, page size and print-only cover removal', () => {
  assert.equal(config.size, 'A5');
  assert.equal(config.documentProcessor, documentProcessor);
  assert.equal(typeof documentProcessor, 'function');
  assert.equal(printConfig.size, config.size);
  assert.equal(printConfig.documentProcessor, documentProcessor);
  assert.equal(config.entry.filter(entry => entry.rel === 'cover').length, 2);
  assert.equal(printConfig.entry.some(entry => entry.rel === 'cover'), false);
  assert.equal(printConfig.cover, undefined);
  assert.deepEqual(printConfig.entry, config.entry.filter(entry => entry.rel !== 'cover'));
  assert.equal(config.output[0].path, 'output/pdf/book.pdf');
  assert.equal(printConfig.output[0].path, 'output/pdf/book_print.pdf');
});

test('GitHub reporter loads the actual ESM helper in both inline steps', async () => {
  const source = readFileSync('.github/workflows/vrt-report.yml', 'utf8');
  const blocks = source.split('          script: |\n').slice(1).map(block => {
    const lines = block.split('\n');
    const end = lines.findIndex(line => line.trim() && !line.startsWith('            '));
    return lines.slice(0, end < 0 ? lines.length : end).map(line => line.slice(12)).join('\n');
  });
  assert.equal(blocks.length, 2);
  const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
  const outputs = {};
  const run = {id: 7, run_attempt: 1, event: 'push'};
  const github = {rest: {actions: {getWorkflowRun: async () => ({data: run})}}};
  const context = {repo: {owner: 'owner', repo: 'repo'}, payload: {workflow_run: run}};
  const core = {setOutput: (key, value) => {outputs[key] = value;}};
  const processStub = {env: {GITHUB_WORKSPACE: resolve('.'), VRT_PLAN: JSON.stringify({runId: 7, attempt: 1}), REPORT_DIRECTORY: '/unused'}};
  for (const block of blocks) {
    assert.match(block, /await import\(/);
    await new AsyncFunction('github', 'context', 'core', 'process', block)(github, context, core, processStub);
  }
  assert.deepEqual(outputs, {plan: '', report_id: ''});
});

test('EPUB inherits content and metadata without changing either PDF output', async () => {
  const { default: epubConfig } = await import('../vivliostyle.epub.config.js');
  for (const key of ['title', 'author', 'language', 'toc']) {
    assert.deepEqual(epubConfig[key], config[key], key);
  }
  assert.deepEqual(epubConfig.copyAsset.excludes, [...config.copyAsset.excludes, 'tmp/**', 'scripts/**']);
  assert.deepEqual(config.copyAsset.excludes, ['output/**']);
  assert.equal(epubConfig.cover, 'assets/epub-generated/cover-0.png');
  assert.equal(config.cover, 'assets/front-cover.svg');
  assert.equal(epubConfig.entry.length, config.entry.length);
  for (const [index, entry] of config.entry.entries()) {
    assert.deepEqual(epubConfig.entry[index], typeof entry === 'object' && entry.rel === 'cover'
      ? { ...entry, imageSrc: `assets/epub-generated/cover-${index}.png`, theme: './epub-cover.css' }
      : entry);
  }
  assert.deepEqual(config.entry[0], { rel: 'cover' });
  assert.equal(config.entry.at(-1).imageSrc, 'assets/back-cover.svg');
  assert.equal(epubConfig.theme, './assets/epub-generated/epub.css');
  assert.equal(epubConfig.workspaceDir, '.vivliostyle/epub');
  assert.notEqual(epubConfig.workspaceDir, config.workspaceDir ?? '.vivliostyle');
  assert.equal(epubConfig.vfm.table.cell, 'align-style');
  assert.deepEqual(epubConfig.output, [{ path: 'output/epub/book.epub', format: 'epub' }]);
  assert.equal(epubConfig.vfm.mathRenderer, 'mathjax');
  assert.equal(epubConfig.vfm.footnote, 'pandoc');
  assert.equal(config.vfm?.mathRenderer, undefined);
  assert.equal(config.output[0].format, 'pdf');
  assert.equal(printConfig.output[0].format, 'pdf');
});

test('EPUB math and footnotes do not require runtime JavaScript or PDF page margins', async () => {
  const { default: epubConfig } = await import('../vivliostyle.epub.config.js');
  const html = String(await epubConfig.documentProcessor(epubConfig.vfm, { title: 'EPUB test', lang: 'ja' }).process(
    '# テスト\n\n$x^2=1$ と注釈[^1]。\n\n$$\n\\frac{1}{2}\n$$\n\n[^1]: 注釈本文。'
  ));
  assert.match(html, /<svg[ >]/);
  assert.match(html, /data-mml-node="mfrac"/);
  assert.match(html, /aria-label="x\^2=1"/);
  assert.doesNotMatch(html, /<script|MathJax|data-math-typeset/);
  assert.match(html, /href="#fn1"/);
  assert.match(html, /id="fn1"/);
  assert.match(html, /注釈本文/);
  const css = readFileSync('epub.css', 'utf8');
  assert.doesNotMatch(css, /@page|display:\s*none/);
});

test('all-format and Docker builds include EPUB validation with installed tools', () => {
  const { scripts } = JSON.parse(readFileSync('package.json', 'utf8'));
  assert.equal(scripts.build, 'vivliostyle build');
  assert.equal(scripts['build:epub'], 'vivliostyle build --config vivliostyle.epub.config.js');
  assert.equal(scripts['build:all'], 'npm run build && npm run build:print && npm run build:epub');
  assert.equal(scripts['check:epub'], 'node scripts/check-epub.js');
  assert.equal(scripts['check:epub:render'], 'node scripts/render-epub.js');
  assert.match(scripts['build:docker'], /npm run build:all && npm run check:pdf -- output\/pdf\/book\.pdf output\/pdf\/book_print\.pdf && npm run check:epub/);
  assert.match(readFileSync('scripts/setup.sh', 'utf8'), /apt-get install[^\n]+\bepubcheck\b/);
});


test('EPUB tables preserve left, center and right alignment with conforming CSS', async () => {
  const { default: epubConfig } = await import('../vivliostyle.epub.config.js');
  const markdown = '| 左 | 中央 | 右 |\n| :--- | :---: | ---: |\n| a | b | c |';
  const html = String(await epubConfig.documentProcessor(epubConfig.vfm).process(markdown));
  assert.doesNotMatch(html, /\salign=/);
  for (const align of ['left', 'center', 'right']) {
    assert.match(html, new RegExp(`<th style="text-align: ${align}">`));
    assert.match(html, new RegExp(`<td style="text-align: ${align}">`));
  }
  const pdfHtml = String(await config.documentProcessor(config.vfm).process(markdown));
  assert.match(pdfHtml, /align="right"/);
});
