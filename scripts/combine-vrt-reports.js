import {readFileSync, mkdirSync, writeFileSync} from 'node:fs';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

export function combineReports(directory, outputFile = join(directory, 'report.json')) {
  const errors = [];
  for (const format of ['pdf', 'epub']) {
    try {
      const report = JSON.parse(readFileSync(join(directory, `${format}-report.json`), 'utf8'));
      if (!Array.isArray(report.errors)) throw new Error('Invalid report');
      errors.push(...report.errors.map(error => ({...error, reason: `${format.toUpperCase()}: ${error.reason}`})));
    } catch (error) {
      errors.push({reason: `${format.toUpperCase()} build/render/comparison report unavailable: ${error.message}. Inspect workflow logs.`});
    }
  }
  // The trusted reporter bounds untrusted input to 200 entries and 1 MiB.
  const omitted = Math.max(0, errors.length - 199);
  const summary = {errors: omitted ? [...errors.slice(0, 199), {reason: `${omitted} further differences; see full format reports in the image artifact.`}] : errors};
  mkdirSync(dirname(outputFile), {recursive: true});
  writeFileSync(outputFile, `${JSON.stringify(summary, null, 2)}\n`);
  return summary;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (combineReports(process.argv[2] || 'output/visual', process.argv[3]).errors.length) process.exitCode = 1;
}
