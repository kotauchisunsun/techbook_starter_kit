import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { PDFDocument, PageSizes } from 'pdf-lib';

const checker = fileURLToPath(new URL('./check-pdf.mjs', import.meta.url));

test('PDF size follows Vivliostyle config', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'check-pdf-'));
  const pdfPath = join(dir, 'book.pdf');
  try {
    for (const [size, dimensions] of [
      ['A4', PageSizes.A4],
      ['JIS-B5', [182 * 72 / 25.4, 257 * 72 / 25.4]],
      ['letter', PageSizes.Letter],
      [null, PageSizes.Letter],
      ['180mm,250mm', [180 * 72 / 25.4, 250 * 72 / 25.4]],
    ]) {
      await writeFile(join(dir, 'vivliostyle.config.js'),
        size ? `module.exports = { size: '${size}' };` : 'module.exports = {};');
      const pdf = await PDFDocument.create();
      pdf.addPage(dimensions);
      await writeFile(pdfPath, await pdf.save());
      const result = spawnSync(process.execPath, [checker, pdfPath], { cwd: dir, encoding: 'utf8' });
      assert.equal(result.status, 0, result.stderr);
    }

    await writeFile(join(dir, 'vivliostyle.config.js'), "module.exports = { size: 'A5' };");
    const result = spawnSync(process.execPath, [checker, pdfPath], { cwd: dir, encoding: 'utf8' });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /設定された判型 A5 と異なります/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
