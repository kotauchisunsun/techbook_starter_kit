import {isRecord, requireCondition} from './types.ts';
import type {Difference, DifferenceImages, ComparisonReport} from './types.ts';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Identical renderer installations and fixed viewports are required on both sides.
// AE ignores channel differences <= 4%; at most 100 changed pixels per page pass.
// Normalize sRGB explicitly: grayscale-vs-color images can otherwise compare as equal.
export const configurations = {
  chromium: { widths: [600, 360], height: 780, scale: 1 },
  webkit: { widths: [600, 360], height: 780, scale: 1 },
  mupdf: { widths: [420, 240], height: 595, scale: 2 },
};

function imageDimensions(file: string) {
  // identify decodes the image, rejecting empty, corrupt and non-PNG files.
  const result = spawnSync('identify', ['-regard-warnings', '-format', '%m %w %h', file], { encoding: 'utf8' });
  requireCondition(result.status === 0 && /^PNG \d+ \d+$/.test(result.stdout), `Invalid image ${file}: ${result.error?.message || result.stderr}`);
  return result.stdout.split(' ').slice(1).map(Number);
}

function validateSpine(viewport: Record<string, unknown> & {pages: Record<string, unknown>[]}) {
  requireCondition(Array.isArray(viewport.spine) && viewport.spine.length > 0, 'Empty or missing spine');
  const indices = new Set<number>();
  let offset = 0;
  for (const section of viewport.spine as unknown[]) {
    requireCondition(isRecord(section), 'Invalid spine item');
    requireCondition(typeof section.index === 'number' && Number.isInteger(section.index) && !indices.has(section.index) && typeof section.href === 'string', 'Invalid or duplicated spine item');
    indices.add(section.index);
    let previousEnd = 0;
    let total: number | undefined;
    while (offset < viewport.pages.length && viewport.pages[offset].spineIndex === section.index) {
      const page = viewport.pages[offset++];
      requireCondition(isRecord(page.location), 'Missing page location');
      const start = page.location.start;
      const end = page.location.end;
      requireCondition(isRecord(start) && isRecord(end) && isRecord(start.displayed) && isRecord(end.displayed), 'Missing displayed page location');
      const first = start?.displayed?.page;
      const last = end?.displayed?.page;
      const count = end?.displayed?.total;
      requireCondition(page.href === section.href && start?.index === section.index && end?.index === section.index
        && typeof first === 'number' && typeof last === 'number' && typeof count === 'number'
        && Number.isInteger(first) && Number.isInteger(last) && Number.isInteger(count)
        && first >= 1 && first <= previousEnd + 1 && last > previousEnd && last >= first && last <= count
        && (total === undefined || total === count), `Incomplete pagination for ${section.href}`);
      previousEnd = last;
      total = count;
    }
    requireCondition(typeof total === 'number' && total > 0 && previousEnd === total, `Missing pages for spine item ${section.href}`);
  }
  requireCondition(offset === viewport.pages.length, 'Pages outside the declared spine');
}

export function validateRender(directory: string, engine: string) {
  requireCondition(Object.hasOwn(configurations, engine), `Unsupported renderer ${engine}`);
  const config = configurations[engine as keyof typeof configurations];
  requireCondition(config, `Unsupported renderer ${engine}`);
  const report: unknown = JSON.parse(readFileSync(join(directory, 'report.json'), 'utf8'));
  requireCondition(isRecord(report), 'Invalid render report');
  requireCondition(report.complete === true && Array.isArray(report.errors) && report.errors.length === 0
    && report.failed !== true && (!report.warnings || (Array.isArray(report.warnings) && report.warnings.length === 0)), 'Render incomplete or failed');
  let identity: unknown[];
  if (engine === 'mupdf') {
    requireCondition(report.reader === 'MuPDF EPUB renderer' && report.scale === 2 && report.fontSize === 11
      && report.coordinateUnits === 'points' && report.pymupdfVersion && report.mupdfVersion, 'Invalid MuPDF renderer configuration');
    identity = [report.reader, report.pymupdfVersion, report.mupdfVersion, report.scale, report.fontSize];
  } else {
    requireCondition(report.reader === 'EPUB.js 0.3.93' && report.browserEngine === engine
      && typeof report.browser === 'string' && report.browser.length > 0, 'Invalid browser renderer configuration');
    identity = [report.reader, report.browserEngine, report.browser];
  }
  requireCondition(Array.isArray(report.viewports) && report.viewports.length === config.widths.length, 'Missing or extra viewports');
  const images = new Map<string, string>();
  for (const width of config.widths) {
    const matches = report.viewports.filter((viewport: unknown): viewport is Record<string, unknown> => isRecord(viewport) && viewport.width === width && viewport.height === config.height);
    requireCondition(matches.length === 1, `Missing or duplicate viewport ${width}x${config.height}`);
    const viewport = matches[0];
    requireCondition(viewport.complete === true && Array.isArray(viewport.pages) && viewport.pages.length > 0, 'Incomplete or empty viewport');
    requireCondition(viewport.pages.every(isRecord), 'Invalid page entry');
    const pages: Record<string, unknown>[] = viewport.pages;
    if (engine === 'mupdf') requireCondition(viewport.pageCount === viewport.pages.length, 'Missing MuPDF pages');
    else validateSpine({...viewport, pages});
    const folder = `${width}x${config.height}`;
    const expected = new Set<string>();
    for (const [index, page] of pages.entries()) {
      const filename = `page-${String(index + 1).padStart(4, '0')}.png`;
      requireCondition(page.sequence === index + 1 && page.file === filename, 'Missing or unordered page sequence');
      // Author-dependent layout/highlighting probes remain informational for VRT.
      // Missing resources or unknown diagnostic types cannot silently pass.
      requireCondition((engine === 'mupdf' && page.diagnostics === undefined) || (Array.isArray(page.diagnostics) && page.diagnostics.every(
        (diagnostic: unknown) => isRecord(diagnostic) && typeof diagnostic.type === 'string' && ['code-overflow', 'math-overflow', 'unhighlighted-code'].includes(diagnostic.type))), `Render diagnostics in ${filename}`);
      const path = join(directory, folder, filename);
      const [actualWidth, actualHeight] = imageDimensions(path);
      requireCondition(actualWidth === width * config.scale && actualHeight === config.height * config.scale, `Wrong image dimensions: ${path}`);
      expected.add(filename);
      images.set(`${engine}/${folder}/${filename}`, path);
    }
    const actual = readdirSync(join(directory, folder)).filter(name => name.endsWith('.png'));
    requireCondition(actual.length === expected.size && actual.every(name => expected.has(name)), 'Unreported page images');
  }
  return { identity, images };
}

export function compareEpubPages(before: string, after: string, diff: string): ComparisonReport {
  requireCondition(![before, after].some(directory => resolve(directory) === resolve(diff)), 'Diff directory must differ from input directories');
  const errors: Difference[] = [];
  mkdirSync(diff, { recursive: true });
  for (const engine of Object.keys(configurations)) {
    let oldRender, newRender;
    try {
      oldRender = validateRender(join(before, engine), engine);
      newRender = validateRender(join(after, engine), engine);
      requireCondition(JSON.stringify(oldRender.identity) === JSON.stringify(newRender.identity), 'Renderer versions differ between baseline and current');
    } catch (error) {
      errors.push({ page: `EPUB ${engine}`, reason: (error instanceof Error ? error.message : String(error)) });
      continue;
    }
    for (const key of [...new Set([...oldRender.images.keys(), ...newRender.images.keys()])].sort()) {
      const oldFile = oldRender.images.get(key), newFile = newRender.images.get(key);
      const images: DifferenceImages = { before: oldFile ? `epub/before/${key}` : null, after: newFile ? `epub/after/${key}` : null, diff: null };
      const diffFile = join(diff, key);
      if (existsSync(diffFile)) rmSync(diffFile);
      if (!oldFile || !newFile) {
        errors.push({ page: `EPUB ${key}`, reason: oldFile ? 'Current page missing' : 'Baseline page missing', images });
        continue;
      }
      const comparison = spawnSync('compare', ['-metric', 'AE', '-colorspace', 'sRGB', '-fuzz', '4%', oldFile, newFile, 'null:'], { encoding: 'utf8' });
      const pixels = comparison.stderr?.trim();
      if ((comparison.status !== 0 && comparison.status !== 1) || !/^\d+$/.test(pixels)) {
        errors.push({ page: `EPUB ${key}`, reason: `Image comparison failed: ${comparison.error?.message || pixels}`, images });
        continue;
      }
      if (Number(pixels) <= 100) continue;
      mkdirSync(dirname(diffFile), { recursive: true });
      const rendering = spawnSync('compare', ['-colorspace', 'sRGB', '-fuzz', '4%', oldFile, newFile, diffFile], { encoding: 'utf8' });
      if ((rendering.status !== 0 && rendering.status !== 1) || !existsSync(diffFile)) {
        errors.push({ page: `EPUB ${key}`, reason: `Diff generation failed: ${rendering.error?.message || rendering.stderr}`, images });
        continue;
      }
      images.diff = `epub/diff/${key}`;
      errors.push({ page: `EPUB ${key}`, reason: `${pixels} pixels changed`, images });
    }
  }
  return { errors };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [before, after, diff, report] = process.argv.slice(2);
  if (!before || !after || !diff || !report || process.argv.length !== 6) {
    console.error('Usage: node --import tsx scripts/vrt/compare-epub-pages.ts BEFORE AFTER DIFF REPORT_JSON');
    process.exitCode = 2;
  } else {
    let result: ComparisonReport;
    try { result = compareEpubPages(before, after, diff); }
    catch (error) { result = { errors: [{ reason: (error instanceof Error ? error.message : String(error)) }] }; }
    mkdirSync(dirname(report), { recursive: true });
    writeFileSync(report, `${JSON.stringify(result, null, 2)}\n`);
    for (const error of result.errors) console.error(`${error.page ?? 'EPUB'}: ${error.reason}`);
    if (result.errors.length) process.exitCode = 1;
  }
}
