import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { PDFDocument, PageSizes } from 'pdf-lib';

const require = createRequire(import.meta.url);
const { size = 'letter' } = require(resolve('vivliostyle.config.js'));
const mmToPoints = (mm) => mm * 72 / 25.4;
const presets = {
  A5: PageSizes.A5,
  A4: PageSizes.A4,
  A3: PageSizes.A3,
  B5: PageSizes.B5,
  B4: PageSizes.B4,
  'JIS-B5': [mmToPoints(182), mmToPoints(257)],
  'JIS-B4': [mmToPoints(257), mmToPoints(364)],
  letter: PageSizes.Letter,
  legal: PageSizes.Legal,
  ledger: [...PageSizes.Tabloid].reverse(),
};
const units = { mm: 72 / 25.4, cm: 72 / 2.54, in: 72, pt: 1, px: 0.75 };

function parseLength(value) {
  const match = value.trim().match(/^(\d+(?:\.\d+)?|\.\d+)(mm|cm|in|pt|px)$/);
  assert(match && Number(match[1]) > 0, `判型の指定が不正です: ${size}`);
  return Number(match[1]) * units[match[2]];
}

function pageSize() {
  if (presets[size]) return presets[size];
  const parts = size.split(',');
  assert(parts.length === 2, `未対応の判型です: ${size}`);
  return parts.map(parseLength);
}

const expected = pageSize();

const files = process.argv.slice(2);
if (files.length === 0) files.push('output/pdf/book.pdf');

for (const file of files) {
  const pdf = await PDFDocument.load(await readFile(file));
  assert(pdf.getPageCount() > 0, `${file}: PDF にページがありません`);
  for (const [index, page] of pdf.getPages().entries()) {
    const { width, height } = page.getSize();
    assert(Math.abs(width - expected[0]) < 0.3 && Math.abs(height - expected[1]) < 0.3,
      `${file} p${index + 1}: 設定された判型 ${size} と異なります (${width} × ${height} pt)`);
  }
  console.log(`${file}: ${pdf.getPageCount()} pages; all pages match ${size}.`);
}
