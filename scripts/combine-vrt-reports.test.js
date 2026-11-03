import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, writeFileSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {combineReports} from './combine-vrt-reports.js';

test('both formats must have reports, and differences remain failures', () => {
  const dir = mkdtempSync(join(tmpdir(), 'combine-vrt-'));
  try {
    assert.equal(combineReports(dir).errors.length, 2);
    writeFileSync(join(dir, 'pdf-report.json'), JSON.stringify({errors: []}));
    assert.equal(combineReports(dir).errors.length, 1);
    writeFileSync(join(dir, 'epub-report.json'), JSON.stringify({errors: []}));
    assert.equal(combineReports(dir).errors.length, 0);
    writeFileSync(join(dir, 'epub-report.json'), JSON.stringify({errors: [{reason: 'missing page'}]}));
    assert.match(combineReports(dir).errors[0].reason, /EPUB: missing page/);
    writeFileSync(join(dir, 'epub-report.json'), '{');
    assert.match(combineReports(dir).errors[0].reason, /unavailable/);
  } finally { rmSync(dir, {recursive: true, force: true}); }
});
