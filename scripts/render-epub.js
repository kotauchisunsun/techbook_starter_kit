import { createServer } from 'node:http';
import { readFile, mkdir, writeFile, readdir, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { basename, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const usage = 'Usage: node scripts/render-epub.js INPUT.epub OUTPUT_DIRECTORY [--baseline] [--widths=600,360] [--height=780] [--max-pages=1000]';

export function parseArguments(args) {
  const positional = args.filter(arg => !arg.startsWith('--'));
  if (positional.length !== 2) throw new Error(usage);
  const options = { input: resolve(positional[0]), output: resolve(positional[1]), widths: [600, 360], height: 780, maxPages: 1000, baseline: false };
  for (const arg of args.filter(arg => arg.startsWith('--'))) {
    if (arg === '--baseline') options.baseline = true;
    else if (arg.startsWith('--widths=')) options.widths = arg.slice(9).split(',').map(Number);
    else if (arg.startsWith('--height=')) options.height = Number(arg.slice(9));
    else if (arg.startsWith('--max-pages=')) options.maxPages = Number(arg.slice(12));
    else throw new Error(`Unknown option: ${arg}\n${usage}`);
  }
  if (!options.widths.length || options.widths.some(n => !Number.isInteger(n) || n < 240 || n > 3000)
      || !Number.isInteger(options.height) || options.height < 240 || options.height > 3000
      || !Number.isInteger(options.maxPages) || options.maxPages < 1 || options.maxPages > 10000) {
    throw new Error(`Invalid viewport or page limit.\n${usage}`);
  }
  options.widths = [...new Set(options.widths)];
  return options;
}

export function locationKey(location) {
  if (!location?.start || !location?.end) throw new Error('Reader did not report a page location.');
  return JSON.stringify([location.start.index, location.start.cfi, location.start.displayed?.page,
    location.end.cfi, location.end.displayed?.page]);
}

// Visit each spine item explicitly, including non-linear cover/navigation pages.
// A hard cap and repeated-location detection turn pagination bugs into failures.
export async function captureSpine(adapter, spine, maxPages = 1000) {
  const pages = [];
  for (const section of spine) {
    await adapter.display(section.href);
    const seen = new Set();
    while (true) {
      const page = await adapter.snapshot();
      const { location } = page;
      const key = locationKey(location);
      if (location.start.index !== section.index) throw new Error(`Navigation skipped spine item ${section.href}.`);
      if (seen.has(key)) throw new Error(`Pagination stopped advancing in ${section.href}.`);
      if (pages.length >= maxPages) throw new Error(`Exceeded ${maxPages} pages; possible pagination loop.`);
      seen.add(key);
      page.sequence = pages.length + 1;
      page.spineIndex = section.index;
      page.href = section.href;
      page.file = `page-${String(page.sequence).padStart(4, '0')}.png`;
      await adapter.screenshot(page.file);
      pages.push(page);
      await adapter.record?.(pages);
      const displayed = location.end.displayed;
      if (location.end.index === section.index && displayed?.total > 0 && displayed.page >= displayed.total) break;
      await adapter.next();
    }
  }
  return pages;
}

// Only exact routes are served. EPUB content is loaded from the supplied archive,
// not from an unrestricted working-directory HTTP server.
export async function serveReader(input, dependencies = {}) {
  const resources = new Map([
    ['/book.epub', ['application/epub+zip', await readFile(input)]],
    ['/epub.min.js', ['text/javascript', await readFile(dependencies.epub ?? require.resolve('epubjs/dist/epub.min.js'))]],
    ['/jszip.min.js', ['text/javascript', await readFile(dependencies.jszip ?? require.resolve('jszip/dist/jszip.min.js'))]],
    ['/', ['text/html; charset=utf-8', Buffer.from(`<!doctype html><html><head><meta charset="utf-8"><title>EPUB visual QA</title>
      <style>html,body{margin:0;padding:0;background:white;color:black;}#reader{overflow:hidden;}</style>
      <script src="/jszip.min.js"></script><script src="/epub.min.js"></script></head><body><div id="reader"></div></body></html>`)]],
  ]);
  const server = createServer((request, response) => {
    const resource = resources.get(new URL(request.url, 'http://localhost').pathname);
    if (!resource || !['GET', 'HEAD'].includes(request.method)) {
      response.writeHead(404); response.end(); return;
    }
    response.writeHead(200, { 'Content-Type': resource[0], 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
    response.end(request.method === 'HEAD' ? undefined : resource[1]);
  });
  await new Promise((resolveListen, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolveListen); });
  return {
    url: `http://127.0.0.1:${server.address().port}`,
    close: () => new Promise((resolveClose, reject) => { server.close(error => error ? reject(error) : resolveClose()); server.closeAllConnections(); }),
  };
}

// Runs inside the test browser. No scripts from the EPUB are enabled.
async function initializeReader({ width, height }) {
  const timeout = (promise, label) => new Promise((resolvePromise, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} timed out`)), 30000);
    Promise.resolve(promise).then(value => { clearTimeout(timer); resolvePromise(value); }, error => { clearTimeout(timer); reject(error); });
  });
  const book = window.ePub('/book.epub', { replacements: 'blobUrl' });
  await timeout(book.ready, 'Opening EPUB');
  const reader = document.getElementById('reader');
  reader.style.width = `${width}px`; reader.style.height = `${height}px`;
  const rendition = book.renderTo(reader, {
    width, height, flow: 'paginated', manager: 'default', spread: 'none',
    allowScriptedContent: false, allowPopups: false,
  });
  const settle = async () => {
    for (const contents of rendition.getContents()) {
      const doc = contents.document;
      await timeout(doc.fonts.ready, 'Embedded fonts');
      await Promise.all([...doc.images].map(img => img.complete ? undefined : timeout(new Promise(resolveImage => {
        img.addEventListener('load', resolveImage, { once: true });
        img.addEventListener('error', resolveImage, { once: true });
      }), 'Embedded image')));
    }
    await new Promise(resolveFrame => requestAnimationFrame(() => requestAnimationFrame(resolveFrame)));
  };
  const move = async (method, href) => {
    await timeout(rendition[method](href), `Reader ${method}`);
    await settle();
    // EPUB.js queues location reporting independently of display/next.
    await timeout(new Promise(resolveLocation => {
      const listener = () => { rendition.off('relocated', listener); resolveLocation(); };
      rendition.on('relocated', listener);
      rendition.reportLocation();
    }), 'Reader location');
  };
  window.epubQa = { book, rendition, settle, move };
  return book.spine.spineItems.map(item => ({ index: item.index, href: item.href, linear: item.linear }));
}

// Range fragments are checked against their own column, not against a whole
// chapter's scrollWidth. A multi-page code block is therefore not a false overflow.
export function overflowingFragments(rects, { origin, columnWidth, stride }, tolerance = 3) {
  if (![origin, columnWidth, stride].every(Number.isFinite) || columnWidth <= 0 || stride <= 0) return [];
  return rects.filter(rect => {
    if (rect.width <= 0 || rect.height <= 0) return false;
    const column = Math.max(0, Math.floor((rect.left - origin + tolerance) / stride));
    return rect.left < origin + column * stride - tolerance
      || rect.right > origin + column * stride + columnWidth + tolerance;
  });
}

export function reportFailed(report) {
  return !report.complete || report.errors.length > 0 || (!report.baseline
    && report.viewports.some(viewport => viewport.pages.some(page => page.diagnostics.length > 0)));
}

export function missingTokenColors(tokens) {
  // Only compare token classes with unconditional, known Okaidia colors.
  // Punctuation/operators and numbers/booleans each share a color, so token
  // count alone cannot distinguish missing CSS from valid single-color code.
  // Context-dependent classes such as string are deliberately not inferred.
  const groups = {
    punctuation: 'plain', operator: 'plain',
    keyword: 'keyword', number: 'number', boolean: 'number',
    function: 'function', 'class-name': 'function',
    comment: 'comment', prolog: 'comment', doctype: 'comment', cdata: 'comment',
  };
  const classified = tokens.flatMap(({ classes, color }) => {
    const matches = new Set(classes.filter(name => Object.hasOwn(groups, name)).map(name => groups[name]));
    // A token carrying conflicting color classes is not a reliable probe.
    return matches.size === 1 && color ? [{ group: [...matches][0], color }] : [];
  });
  return new Set(classified.map(token => token.group)).size > 1
    && new Set(classified.map(token => token.color)).size === 1;
}

async function snapshotReader({ overflowSource, highlightSource }) {
  const overflow = (0, eval)(`(${overflowSource})`);
  const unhighlighted = (0, eval)(`(${highlightSource})`);
  const { rendition, settle } = window.epubQa;
  await settle();
  const location = await rendition.currentLocation();
  const readerRect = document.getElementById('reader').getBoundingClientRect();
  const diagnostics = [];
  const documents = [];
  for (const contents of rendition.getContents()) {
    const doc = contents.document;
    const style = contents.window.getComputedStyle(doc.body);
    const bodyRect = doc.body.getBoundingClientRect();
    const gap = parseFloat(style.columnGap) || 0;
    // CSS column-width is a preferred width. EPUB.js also applies border-box
    // padding, so the used column width can be smaller than that CSS value.
    const availableWidth = doc.body.clientWidth - parseFloat(style.paddingLeft || 0) - parseFloat(style.paddingRight || 0);
    const columnWidth = Math.min(parseFloat(style.columnWidth) || availableWidth, availableWidth);
    const geometry = { origin: bodyRect.left + parseFloat(style.paddingLeft || 0), columnWidth, stride: columnWidth + gap };
    const frameRect = contents.window.frameElement.getBoundingClientRect();
    const rectData = rect => ({ left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom, width: rect.width, height: rect.height });
    const visible = element => [...element.getClientRects()].some(rect => rect.right + frameRect.left > readerRect.left
      && rect.left + frameRect.left < readerRect.right && rect.bottom + frameRect.top > readerRect.top && rect.top + frameRect.top < readerRect.bottom);
    const info = { spineIndex: contents.sectionIndex, geometry, headings: [], images: [], code: [], math: [] };
    for (const heading of doc.querySelectorAll('h1,h2,h3')) if (visible(heading)) info.headings.push(heading.textContent.trim());
    for (const [index, img] of [...doc.images].entries()) {
      const image = { index, alt: img.alt, loaded: img.complete && img.naturalWidth > 0, naturalWidth: img.naturalWidth, naturalHeight: img.naturalHeight, visible: visible(img) };
      info.images.push(image);
      if (!image.loaded) diagnostics.push({ type: 'missing-image', spineIndex: contents.sectionIndex, index, alt: img.alt });
    }
    for (const kind of ['code', 'math']) {
      const nodes = kind === 'code' ? doc.querySelectorAll('pre') : doc.querySelectorAll('math');
      for (const [index, node] of [...nodes].entries()) {
        const range = doc.createRange(); range.selectNodeContents(node);
        const fragments = [...range.getClientRects()].map(rectData);
        const oversize = overflow(fragments, geometry);
        const computed = contents.window.getComputedStyle(node);
        const entry = { index, visible: visible(node), fontFamily: computed.fontFamily, fontSize: computed.fontSize,
          color: computed.color, backgroundColor: computed.backgroundColor, text: node.textContent.trim().slice(0, 160), overflow: oversize.slice(0, 5) };
        if (kind === 'code') {
          const tokens = [...node.querySelectorAll('.token')].map(token => ({
            classes: [...token.classList], color: contents.window.getComputedStyle(token).color,
          }));
          entry.tokenColors = [...new Set(tokens.map(token => token.color))];
          if (unhighlighted(tokens)) diagnostics.push({ type: 'unhighlighted-code', spineIndex: contents.sectionIndex, index });
        }
        info[kind].push(entry);
        if (oversize.length) diagnostics.push({ type: `${kind}-overflow`, spineIndex: contents.sectionIndex, index, count: oversize.length, fragments: oversize.slice(0, 5), geometry });
      }
    }
    documents.push(info);
  }
  return { location, documents, diagnostics };
}

export async function renderEpub(options) {
  await mkdir(options.output, { recursive: true });
  const report = { input: basename(options.input), reader: 'EPUB.js 0.3.93', baseline: options.baseline, viewports: [], errors: [], complete: false };
  const saveReport = () => writeFile(join(options.output, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
  let server;
  let browser;
  try {
    server = await serveReader(options.input);
    const { chromium } = await import('playwright');
    browser = await chromium.launch({ headless: true });
    report.browser = browser.version();
    for (const width of options.widths) {
      const directory = join(options.output, `${width}x${options.height}`);
      await mkdir(directory, { recursive: true });
      // Remove only this tool's stale images, never arbitrary user files.
      for (const file of await readdir(directory)) if (/^page-\d+\.png$/.test(file)) await rm(join(directory, file));
      const viewport = { width, height: options.height, spine: [], pages: [], complete: false };
      report.viewports.push(viewport);
      const context = await browser.newContext({ viewport: { width, height: options.height }, deviceScaleFactor: 1 });
      try {
        await context.route('**/*', route => {
          const url = route.request().url();
          if (url.startsWith(`${server.url}/`) || /^(blob:|data:|about:)/.test(url)) return route.continue();
          report.errors.push(`External resource blocked: ${url}`);
          return route.abort();
        });
        const page = await context.newPage();
        page.setDefaultTimeout(45000);
        page.on('pageerror', error => report.errors.push(error.message));
        page.on('requestfailed', request => report.errors.push(`Request failed: ${request.url()} (${request.failure()?.errorText})`));
        await page.goto(server.url, { waitUntil: 'load' });
        viewport.spine = await page.evaluate(initializeReader, { width, height: options.height });
        if (!viewport.spine.length) throw new Error('EPUB spine is empty.');
        await captureSpine({
          display: href => page.evaluate(href => window.epubQa.move('display', href), href),
          next: () => page.evaluate(() => window.epubQa.move('next')),
          snapshot: () => page.evaluate(snapshotReader, {
            overflowSource: overflowingFragments.toString(), highlightSource: missingTokenColors.toString(),
          }),
          screenshot: file => page.locator('#reader').screenshot({ path: join(directory, file), animations: 'disabled' }),
          record: async pages => { viewport.pages = pages; await saveReport(); },
        }, viewport.spine, options.maxPages);
        viewport.complete = true;
      } finally { await context.close(); }
    }
    report.complete = true;
  } catch (error) {
    report.errors.push(error.stack || error.message);
  } finally {
    await browser?.close();
    await server?.close();
    await saveReport();
  }
  const diagnostics = report.viewports.flatMap(viewport => viewport.pages.flatMap(page => page.diagnostics));
  const failed = reportFailed(report);
  console.log(`${report.viewports.reduce((sum, viewport) => sum + viewport.pages.length, 0)} EPUB pages captured; ${diagnostics.length} visual diagnostics. Report: ${join(options.output, 'report.json')}`);
  return { report, failed };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  let options;
  try { options = parseArguments(process.argv.slice(2)); }
  catch (error) { console.error(error.message); process.exitCode = 2; }
  if (options) {
    try { const { failed } = await renderEpub(options); if (failed) process.exitCode = 1; }
    catch (error) { console.error(error.stack || error.message); process.exitCode = 1; }
  }
}
