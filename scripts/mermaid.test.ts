import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import config from '../vivliostyle.config.js';
import printConfig from '../vivliostyle.print.config.js';
import documentProcessor from './mermaid.ts';

// Root JavaScript configs and TypeScript callers share the same ESM instance.
test('TypeScript呼び出し側とルート設定で同じプロセッサを共有する', () => {
  assert.equal(config.documentProcessor, documentProcessor);
  assert.equal(printConfig.documentProcessor, documentProcessor);
});

// Vivliostyle loads user configuration itself, without our npm test loader.
// Exercise that public entry point in a separate, ordinary Node process.
for (const entry of ['vivliostyle.config.js', 'vivliostyle.print.config.js', 'vivliostyle.epub.config.js']) {
  test(`追加ローダーなしのNodeで${entry}から共通TSプロセッサを読み込める`, () => {
    const result = spawnSync(process.execPath, ['--no-experimental-strip-types', '--input-type=module', '--eval', `
      import assert from 'node:assert/strict';
      // Match Vivliostyle's cache-busted config import, before loading any TS.
      await import('./${entry}?version=test');
      const { default: config } = await import('./vivliostyle.config.js');
      const { default: printConfig } = await import('./vivliostyle.print.config.js');
      const { default: epubConfig } = await import('./vivliostyle.epub.config.js');
      const { default: documentProcessor } = await import('./scripts/mermaid.ts');
      assert.equal(config.documentProcessor, documentProcessor);
      assert.equal(printConfig.documentProcessor, documentProcessor);
      const html = String(await epubConfig.documentProcessor(epubConfig.vfm).process('$x^2$'));
      assert.match(html, /epub-math/);
      assert.match(html, /<svg[ >]/);
      assert.doesNotMatch(html, /MathJax\\.js/);
    `], { cwd: new URL('../', import.meta.url), encoding: 'utf8', env: {...process.env, NODE_OPTIONS: ''} });
    assert.equal(result.status, 0, result.stderr);
  });
}
