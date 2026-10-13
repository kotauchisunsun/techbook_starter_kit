import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PDFDocument } from 'pdf-lib';

const files = process.argv.slice(2);
if (files.length === 0) files.push('output/pdf/book.pdf');

for (const file of files) {
  const pdf = await PDFDocument.load(await readFile(file));
  assert(pdf.getPageCount() > 0, `${file}: PDF にページがありません`);
  for (const [index, page] of pdf.getPages().entries()) {
    const { width, height } = page.getSize();
    const mm = [width, height].map((points) => points * 25.4 / 72);
    assert(Math.abs(mm[0] - 148) < 0.1 && Math.abs(mm[1] - 210) < 0.1,
      `${file} p${index + 1}: A5 ではありません (${mm.join(' × ')} mm)`);
  }
  console.log(`${file}: ${pdf.getPageCount()} pages; all pages are A5 (148 × 210 mm).`);
}
