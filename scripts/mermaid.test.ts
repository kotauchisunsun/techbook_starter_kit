import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import config from '../vivliostyle.config.js';
import printConfig from '../vivliostyle.print.config.js';
import documentProcessor from './mermaid.js';

// tsx resolves this TypeScript caller's .js import to the .ts implementation.
// Root JavaScript configs must still receive that exact same function.
test('TypeScript callers and root configs share the processor identity', () => {
  assert.equal(config.documentProcessor, documentProcessor);
  assert.equal(printConfig.documentProcessor, documentProcessor);
});

// Vivliostyle loads user configuration itself, without our npm test loader.
// Exercise that public entry point in a separate, ordinary Node process.
test('追加フラグなしのNodeで既存Vivliostyle設定と共通TSプロセッサを読み込める', () => {
  const result = spawnSync(process.execPath, ['--input-type=module', '--eval', `
    import assert from 'node:assert/strict';
    import config from './vivliostyle.config.js';
    import printConfig from './vivliostyle.print.config.js';
    import epubConfig from './vivliostyle.epub.config.js';
    import documentProcessor from './scripts/mermaid.js';
    assert.equal(config.documentProcessor, documentProcessor);
    assert.equal(printConfig.documentProcessor, documentProcessor);
    for (const [path, exports] of [
      ['./scripts/mermaid', ['default']],
      ['./scripts/epub/epub-layout', ['default']],
      ['./scripts/epub/epub-math', ['default']],
      ['./scripts/epub/epub-assets', ['epubAssetDirectory', 'epubCoverEntries']],
    ]) {
      const bridge = await import(path + '.js');
      const implementation = await import(path + '.ts');
      for (const name of exports) assert.equal(bridge[name], implementation[name], path + ':' + name);
    }
    const html = String(await epubConfig.documentProcessor(epubConfig.vfm).process('$x^2$'));
    assert.match(html, /epub-math/);
    assert.match(html, /<svg[ >]/);
    assert.doesNotMatch(html, /MathJax\\.js/);
  `], { cwd: new URL('../', import.meta.url), encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
});
