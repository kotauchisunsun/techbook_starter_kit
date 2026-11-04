import { createServer } from 'node:http';
import { readFile, mkdir, writeFile, readdir, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { basename, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';


type BrowserName = 'chromium' | 'webkit';
export interface RenderOptions {
  input: string; output: string; widths: number[]; height: number; maxPages: number;
  baseline: boolean; browser?: BrowserName;
}
export interface ReaderLocation {
  start: { index: number; cfi: string; displayed?: { page: number; total: number } };
  end: { index: number; cfi: string; displayed?: { page: number; total: number } };
}
export interface SpineItem { index: number; href: string; linear?: string }
interface Rect { left: number; right: number; width: number; height: number }
interface Box extends Rect { top: number; bottom: number }
interface Geometry { origin: number; columnWidth: number; stride: number }
interface Token { classes: string[]; color: string }
interface FontInfo { family: string; status: string; weight: string }
export interface Diagnostic {
  type: string; spineIndex?: number; index?: number; alt?: string;
  fonts?: FontInfo[]; count?: number; fragments?: Box[]; geometry?: Geometry;
}
interface ContentEntry {
  index: number; visible: boolean; fontFamily: string; fontSize: string;
  color: string; backgroundColor: string; text: string; overflow: Box[];
  tokenColors?: string[]; textContrast?: number | null;
  tokenContrasts?: { color: string; ratio: number | null }[];
  svg?: Box[]; superscripts?: { base: Box | null; exponent: Box | null }[];
  tables?: { rows: { rect: Box; cells: Box[] }[] }[]; fragments?: Box[];
}
interface DocumentInfo {
  spineIndex: number; geometry: Geometry; headings: string[];
  images: { index: number; alt: string; loaded: boolean; naturalWidth: number; naturalHeight: number; visible: boolean }[];
  captions: { text: string; visible: boolean; caption: Box; image: Box | null }[];
  code: ContentEntry[]; math: ContentEntry[];
  bodyFont: { computedFamily: string; size: string; faces: FontInfo[]; glyphFontVerified: boolean };
}
interface Snapshot { location: ReaderLocation; documents: DocumentInfo[]; diagnostics: Diagnostic[] }
type Captured<T> = T & { sequence: number; spineIndex: number; href: string; file: string };
interface ViewportReport { width: number; height: number; spine: SpineItem[]; pages: Captured<Snapshot>[]; complete: boolean }
export interface ReportStatus {
  complete: boolean; baseline: boolean; errors: string[];
  viewports: { pages: { diagnostics: Diagnostic[] }[] }[];
}
interface RenderReport extends ReportStatus {
  input: string; reader: string; browserEngine: BrowserName; browser?: string; viewports: ViewportReport[];
}
// EPUB.js exposes additional browser APIs not described by its bundled declarations.
interface ReaderRendition {
  getContents(): { document: Document; window: Window; sectionIndex: number }[];
  display(href?: string): Promise<unknown>; next(): Promise<unknown>;
  currentLocation(): ReaderLocation | Promise<ReaderLocation>;
  on(event: 'relocated', listener: () => void): void;
  off(event: 'relocated', listener: () => void): void;
  reportLocation(): void;
}
interface ReaderBook {
  ready: Promise<unknown>; spine: { spineItems: SpineItem[] };
  renderTo(element: HTMLElement, options: {
    width: number; height: number; flow: string; manager: string; spread: string;
    allowScriptedContent: boolean; allowPopups: boolean;
  }): ReaderRendition;
}
declare global {
  interface Window {
    ePub(input: string, options: { replacements: string }): ReaderBook;
    epubQa: { book: ReaderBook; rendition: ReaderRendition; settle(): Promise<void>; move(method: 'display' | 'next', href?: string): Promise<void> };
  }
}

const require = createRequire(import.meta.url);
const usage = 'Usage: node --import tsx scripts/epub/render-epub.ts INPUT.epub OUTPUT_DIRECTORY [--baseline] [--browser=chromium|webkit] [--widths=600,360] [--height=780] [--max-pages=1000]';

export function parseArguments(args: string[]): RenderOptions {
  const positional = args.filter(arg => !arg.startsWith('--'));
  if (positional.length !== 2) throw new Error(usage);
  const options = { input: resolve(positional[0]), output: resolve(positional[1]), widths: [600, 360], height: 780, maxPages: 1000, baseline: false, browser: 'chromium' };
  for (const arg of args.filter(arg => arg.startsWith('--'))) {
    if (arg === '--baseline') options.baseline = true;
    else if (arg.startsWith('--browser=')) options.browser = arg.slice(10);
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
  validateBrowser(options.browser);
  options.widths = [...new Set(options.widths)];
  return { ...options, browser: validateBrowser(options.browser) };
}

export function validateBrowser(name = 'chromium'): BrowserName {
  if (name !== 'chromium' && name !== 'webkit') throw new Error(`Unsupported browser: ${name}. Use chromium or webkit.`);
  return name;
}

export async function launchReaderBrowser<T>(playwright: Record<BrowserName, { launch(options: { headless: boolean }): Promise<T> }>, name = 'chromium') {
  return playwright[validateBrowser(name)].launch({ headless: true });
}

// Conservative contrast probe: unknown color spaces/translucency are reported
// as unavailable rather than guessed. This is informational, not a QA gate.
export function contrastRatio(foreground: string, background: string) {
  const { luminance } = { luminance(color: string) {
    const match = /^rgba?\(\s*(\d+(?:\.\d+)?)\s*,\s*(\d+(?:\.\d+)?)\s*,\s*(\d+(?:\.\d+)?)(?:\s*,\s*([\d.]+))?\s*\)$/.exec(color);
    if (!match || (match[4] !== undefined && Number(match[4]) !== 1)) return null;
    const rgb = match.slice(1, 4).map(Number);
    if (rgb.some(value => value > 255)) return null;
    return rgb.map(value => value / 255).map(value => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4)
      .reduce((sum, value, index) => sum + value * [0.2126, 0.7152, 0.0722][index], 0);
  } };
  const a = luminance(foreground), b = luminance(background);
  return a === null || b === null ? null : (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

export function locationKey(location: Partial<ReaderLocation> | null | undefined) {
  if (!location?.start || !location?.end) throw new Error('Reader did not report a page location.');
  return JSON.stringify([location.start.index, location.start.cfi, location.start.displayed?.page,
    location.end.cfi, location.end.displayed?.page]);
}

// Visit each spine item explicitly, including non-linear cover/navigation pages.
// A hard cap and repeated-location detection turn pagination bugs into failures.
export async function captureSpine<T extends { location: ReaderLocation }>(adapter: {
  display(href: string): Promise<unknown>; next(): Promise<unknown>; snapshot(): Promise<T>;
  screenshot(file: string): Promise<unknown>; record?(pages: Captured<T>[]): Promise<unknown>;
}, spine: SpineItem[], maxPages = 1000) {
  const pages: Captured<T>[] = [];
  for (const section of spine) {
    await adapter.display(section.href);
    const seen = new Set();
    while (true) {
      const snapshot = await adapter.snapshot();
      const { location } = snapshot;
      const key = locationKey(location);
      if (location.start.index !== section.index) throw new Error(`Navigation skipped spine item ${section.href}.`);
      if (seen.has(key)) throw new Error(`Pagination stopped advancing in ${section.href}.`);
      if (pages.length >= maxPages) throw new Error(`Exceeded ${maxPages} pages; possible pagination loop.`);
      seen.add(key);
      const sequence = pages.length + 1;
      const page = Object.assign(snapshot, {
        sequence, spineIndex: section.index, href: section.href,
        file: `page-${String(sequence).padStart(4, '0')}.png`,
      });
      await adapter.screenshot(page.file);
      pages.push(page);
      await adapter.record?.(pages);
      const displayed = location.end.displayed;
      if (location.end.index === section.index && displayed && displayed.total > 0 && displayed.page >= displayed.total) break;
      await adapter.next();
    }
  }
  return pages;
}

// Only exact routes are served. EPUB content is loaded from the supplied archive,
// not from an unrestricted working-directory HTTP server.
export async function serveReader(input: string, dependencies: { epub?: string; jszip?: string } = {}) {
  const resources = new Map<string, [string, Buffer]>([
    ['/book.epub', ['application/epub+zip', await readFile(input)]],
    ['/epub.min.js', ['text/javascript', await readFile(dependencies.epub ?? require.resolve('epubjs/dist/epub.min.js'))]],
    ['/jszip.min.js', ['text/javascript', await readFile(dependencies.jszip ?? require.resolve('jszip/dist/jszip.min.js'))]],
    ['/', ['text/html; charset=utf-8', Buffer.from(`<!doctype html><html><head><meta charset="utf-8"><title>EPUB visual QA</title>
      <style>html,body{margin:0;padding:0;background:white;color:black;}#reader{overflow:hidden;}</style>
      <script src="/jszip.min.js"></script><script src="/epub.min.js"></script></head><body><div id="reader"></div></body></html>`)]],
  ]);
  const server = createServer((request, response) => {
    const resource = resources.get(new URL(request.url ?? '/', 'http://localhost').pathname);
    if (!resource || !['GET', 'HEAD'].includes(request.method ?? '')) {
      response.writeHead(404); response.end(); return;
    }
    response.writeHead(200, { 'Content-Type': resource[0], 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
    response.end(request.method === 'HEAD' ? undefined : resource[1]);
  });
  await new Promise<void>((resolveListen, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolveListen); });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Reader server has no TCP address.');
  return {
    url: `http://127.0.0.1:${address.port}`,
    close: () => new Promise<void>((resolveClose, reject) => { server.close(error => error ? reject(error) : resolveClose()); server.closeAllConnections(); }),
  };
}

// Object-method helpers avoid tsx injecting closure-bound function-name helpers.
// Runs inside the test browser. No scripts from the EPUB are enabled.
export async function initializeReader({ width, height }: { width: number; height: number }) {
  const { timeout } = { timeout<T>(promise: PromiseLike<T>, label: string) { return new Promise<T>((resolvePromise, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} timed out`)), 30000);
    Promise.resolve(promise).then(value => { clearTimeout(timer); resolvePromise(value); }, error => { clearTimeout(timer); reject(error); });
  }); } };
  // Use EPUB.js's supported data-URL replacements so each archived resource
  // remains self-contained across both Chromium and WebKit.
  const book = window.ePub('/book.epub', { replacements: 'base64' });
  await timeout(book.ready, 'Opening EPUB');
  const reader = document.getElementById('reader')!;
  reader.style.width = `${width}px`; reader.style.height = `${height}px`;
  const rendition = book.renderTo(reader, {
    width, height, flow: 'paginated', manager: 'default', spread: 'none',
    allowScriptedContent: false, allowPopups: false,
  });
  const { settle } = { async settle() {
    for (const contents of rendition.getContents()) {
      const doc = contents.document;
      await timeout(doc.fonts.ready, 'Embedded fonts');
      await Promise.all([...doc.images].map(img => img.complete ? undefined : timeout(new Promise(resolveImage => {
        img.addEventListener('load', resolveImage, { once: true });
        img.addEventListener('error', resolveImage, { once: true });
      }), 'Embedded image')));
    }
    await new Promise(resolveFrame => requestAnimationFrame(() => requestAnimationFrame(resolveFrame)));
  } };
  const { move } = { async move(method: 'display' | 'next', href?: string) {
    await timeout(rendition[method](href), `Reader ${method}`);
    await settle();
    // EPUB.js queues location reporting independently of display/next.
    await timeout(new Promise<void>(resolveLocation => {
      const { listener } = { listener() { rendition.off('relocated', listener); resolveLocation(); } };
      rendition.on('relocated', listener);
      rendition.reportLocation();
    }), 'Reader location');
  } };
  window.epubQa = { book, rendition, settle, move };
  return book.spine.spineItems.map(item => ({ index: item.index, href: item.href, linear: item.linear }));
}

// Range fragments are checked against their own column, not against a whole
// chapter's scrollWidth. A multi-page code block is therefore not a false overflow.
export function overflowingFragments<T extends Rect>(rects: T[], { origin, columnWidth, stride }: Geometry, tolerance = 3) {
  if (![origin, columnWidth, stride].every(Number.isFinite) || columnWidth <= 0 || stride <= 0) return [];
  return rects.filter(rect => {
    if (rect.width <= 0 || rect.height <= 0) return false;
    const column = Math.max(0, Math.floor((rect.left - origin + tolerance) / stride));
    return rect.left < origin + column * stride - tolerance
      || rect.right > origin + column * stride + columnWidth + tolerance;
  });
}

export function reportFailed(report: ReportStatus) {
  return !report.complete || report.errors.length > 0 || (!report.baseline
    && report.viewports.some(viewport => viewport.pages.some(page => page.diagnostics.length > 0)));
}

export function missingTokenColors(tokens: Token[]) {
  // Only compare token classes with unconditional, known Okaidia colors.
  // Punctuation/operators and numbers/booleans each share a color, so token
  // count alone cannot distinguish missing CSS from valid single-color code.
  // Context-dependent classes such as string are deliberately not inferred.
  const groups: Record<string, string> = {
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

export async function snapshotReader({ overflowSource, highlightSource, contrastSource }: { overflowSource: string; highlightSource: string; contrastSource: string }): Promise<Snapshot> {
  const overflow: typeof overflowingFragments = (0, eval)(`(${overflowSource})`);
  const unhighlighted: typeof missingTokenColors = (0, eval)(`(${highlightSource})`);
  const contrast: typeof contrastRatio = (0, eval)(`(${contrastSource})`);
  const { rendition, settle } = window.epubQa;
  await settle();
  const location = await rendition.currentLocation();
  const readerRect = document.getElementById('reader')!.getBoundingClientRect();
  const diagnostics: Diagnostic[] = [];
  const documents: DocumentInfo[] = [];
  for (const contents of rendition.getContents()) {
    const doc = contents.document;
    const style = contents.window.getComputedStyle(doc.body);
    const bodyRect = doc.body.getBoundingClientRect();
    const gap = parseFloat(style.columnGap) || 0;
    // CSS column-width is a preferred width. EPUB.js also applies border-box
    // padding, so the used column width can be smaller than that CSS value.
    const availableWidth = doc.body.clientWidth - parseFloat(style.paddingLeft || '0') - parseFloat(style.paddingRight || '0');
    const columnWidth = Math.min(parseFloat(style.columnWidth) || availableWidth, availableWidth);
    const geometry = { origin: bodyRect.left + parseFloat(style.paddingLeft || '0'), columnWidth, stride: columnWidth + gap };
    const frameRect = contents.window.frameElement!.getBoundingClientRect();
    const { rectData } = { rectData(rect: DOMRect) { return { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom, width: rect.width, height: rect.height }; } };
    const { visible } = { visible(element: Element) { return [...element.getClientRects()].some(rect => rect.right + frameRect.left > readerRect.left
      && rect.left + frameRect.left < readerRect.right && rect.bottom + frameRect.top > readerRect.top && rect.top + frameRect.top < readerRect.bottom); } };
    const info: DocumentInfo = { spineIndex: contents.sectionIndex, geometry, headings: [], images: [], captions: [], code: [], math: [],
      // Computed CSS and loaded font faces do not prove which font rendered each
      // glyph. Keep this limitation explicit across Chromium and WebKit.
      bodyFont: { computedFamily: style.fontFamily, size: style.fontSize,
        faces: [...doc.fonts].map(face => ({ family: face.family, status: face.status, weight: face.weight })),
        glyphFontVerified: false } };
    const failedFonts = info.bodyFont.faces.filter(face => face.status === 'error');
    if (failedFonts.length) diagnostics.push({ type: 'font-load-error', spineIndex: contents.sectionIndex, fonts: failedFonts });
    for (const caption of doc.querySelectorAll('figcaption, .epub-caption')) {
      const figure = caption.closest('figure, .epub-figure');
      const image = figure?.querySelector('img,svg');
      info.captions.push({ text: (caption.textContent ?? '').trim().slice(0, 160), visible: visible(caption),
        caption: rectData(caption.getBoundingClientRect()), image: image ? rectData(image.getBoundingClientRect()) : null });
    }
    for (const heading of doc.querySelectorAll('h1,h2,h3')) if (visible(heading)) info.headings.push((heading.textContent ?? '').trim());
    for (const [index, img] of [...doc.images].entries()) {
      const image = { index, alt: img.alt, loaded: img.complete && img.naturalWidth > 0, naturalWidth: img.naturalWidth, naturalHeight: img.naturalHeight, visible: visible(img) };
      info.images.push(image);
      if (!image.loaded) diagnostics.push({ type: 'missing-image', spineIndex: contents.sectionIndex, index, alt: img.alt });
    }
    for (const kind of ['code', 'math'] as const) {
      const nodes = kind === 'code' ? doc.querySelectorAll('pre') : doc.querySelectorAll('math, [role="math"], .epub-math');
      for (const [index, node] of [...nodes].entries()) {
        const range = doc.createRange(); range.selectNodeContents(node);
        const svgBoxes = kind === 'math' ? [...node.querySelectorAll('svg')].flatMap(svg => [...svg.getClientRects()].map(rectData)) : [];
        const fragments = [...range.getClientRects()].map(rectData).concat(svgBoxes);
        const oversize = overflow(fragments, geometry);
        const computed = contents.window.getComputedStyle(node);
        const entry: ContentEntry = { index, visible: visible(node), fontFamily: computed.fontFamily, fontSize: computed.fontSize,
          color: computed.color, backgroundColor: computed.backgroundColor, text: (node.getAttribute('aria-label') || node.textContent || '').trim().slice(0, 160), overflow: oversize.slice(0, 5) };
        if (kind === 'code') {
          const tokens = [...node.querySelectorAll('.token')].map(token => ({
            classes: [...token.classList], color: contents.window.getComputedStyle(token).color,
          }));
          entry.tokenColors = [...new Set(tokens.map(token => token.color))];
          entry.textContrast = contrast(computed.color, computed.backgroundColor);
          entry.tokenContrasts = entry.tokenColors.map(color => ({ color, ratio: contrast(color, computed.backgroundColor) }));
          if (unhighlighted(tokens)) diagnostics.push({ type: 'unhighlighted-code', spineIndex: contents.sectionIndex, index });
        }
        if (kind === 'math') {
          // Record actual MathML boxes without assuming every author-intended
          // equation should wrap, or that nested/column-fragmented math is flat.
          entry.svg = svgBoxes;
          entry.superscripts = [...node.querySelectorAll('msup,msubsup')].map(script => {
            const base = script.children[0];
            const exponent = script.children[script.localName === 'msubsup' ? 2 : 1];
            return { base: base ? rectData(base.getBoundingClientRect()) : null,
              exponent: exponent ? rectData(exponent.getBoundingClientRect()) : null };
          });
          entry.tables = [...node.querySelectorAll('mtable')].map(table => ({
            rows: [...table.children].filter(row => ['mtr', 'mlabeledtr'].includes(row.localName))
              .map(row => ({ rect: rectData(row.getBoundingClientRect()),
                cells: [...row.children].map(cell => rectData(cell.getBoundingClientRect())) })),
          }));
          entry.fragments = fragments.slice(0, 80);
        }
        info[kind].push(entry);
        if (oversize.length) diagnostics.push({ type: `${kind}-overflow`, spineIndex: contents.sectionIndex, index, count: oversize.length, fragments: oversize.slice(0, 5), geometry });
      }
    }
    documents.push(info);
  }
  return { location, documents, diagnostics };
}

export async function renderEpub(options: RenderOptions) {
  await mkdir(options.output, { recursive: true });
  const report: RenderReport = { input: basename(options.input), reader: 'EPUB.js 0.3.93', browserEngine: options.browser ?? 'chromium', baseline: options.baseline, viewports: [], errors: [], complete: false };
  const saveReport = () => writeFile(join(options.output, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
  let server;
  let browser;
  try {
    server = await serveReader(options.input);
    const playwright = await import('playwright');
    browser = await launchReaderBrowser(playwright, options.browser);
    report.browser = browser.version();
    for (const width of options.widths) {
      const directory = join(options.output, `${width}x${options.height}`);
      await mkdir(directory, { recursive: true });
      // Remove only this tool's stale images, never arbitrary user files.
      for (const file of await readdir(directory)) if (/^page-\d+\.png$/.test(file)) await rm(join(directory, file));
      const viewport: ViewportReport = { width, height: options.height, spine: [], pages: [], complete: false };
      report.viewports.push(viewport);
      const context = await browser.newContext({ viewport: { width, height: options.height }, deviceScaleFactor: 1 });
      try {
        await context.route('**/*', route => {
          const url = route.request().url();
          if (url.startsWith(`${server!.url}/`) || /^(blob:|data:|about:)/.test(url)) return route.continue();
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
            overflowSource: overflowingFragments.toString(), highlightSource: missingTokenColors.toString(), contrastSource: contrastRatio.toString(),
          }),
          screenshot: file => page.locator('#reader').screenshot({ path: join(directory, file), animations: 'disabled' }),
          record: async pages => { viewport.pages = pages; await saveReport(); },
        }, viewport.spine, options.maxPages);
        viewport.complete = true;
      } finally { await context.close(); }
    }
    report.complete = true;
  } catch (error) {
    report.errors.push(error instanceof Error ? error.stack || error.message : String(error));
  } finally {
    await browser?.close();
    await server?.close();
    await saveReport();
  }
  const diagnostics = report.viewports.flatMap(viewport => viewport.pages.flatMap(page => page.diagnostics));
  const failed = reportFailed(report);
  console.log(`${report.viewports.reduce((sum, viewport) => sum + viewport.pages.length, 0)} EPUB pages captured with ${report.browserEngine} ${report.browser ?? '(not launched)'}; ${diagnostics.length} visual diagnostics. Report: ${join(options.output, 'report.json')}`);
  return { report, failed };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  let options;
  try { options = parseArguments(process.argv.slice(2)); }
  catch (error) { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 2; }
  if (options) {
    try { const { failed } = await renderEpub(options); if (failed) process.exitCode = 1; }
    catch (error) { console.error(error instanceof Error ? error.stack || error.message : String(error)); process.exitCode = 1; }
  }
}
