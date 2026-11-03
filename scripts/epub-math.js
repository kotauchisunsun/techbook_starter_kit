import { mathjax } from '@mathjax/src/js/mathjax.js';
import { TeX } from '@mathjax/src/js/input/tex.js';
import { SVG } from '@mathjax/src/js/output/svg.js';
import { liteAdaptor } from '@mathjax/src/js/adaptors/liteAdaptor.js';
import { RegisterHTMLHandler } from '@mathjax/src/js/handlers/html.js';
import '@mathjax/src/js/input/tex/base/BaseConfiguration.js';
import '@mathjax/src/js/input/tex/ams/AmsConfiguration.js';
import '@mathjax/src/js/input/tex/newcommand/NewcommandConfiguration.js';
import { MathJaxTexFont } from '@mathjax/mathjax-tex-font/js/svg.js';
import { fromHtml } from 'hast-util-from-html';

const adaptor = liteAdaptor({ fontSize: 16 });
RegisterHTMLHandler(adaptor);
const text = node => node.type === 'text' ? node.value : (node.children ?? []).map(text).join('');
const classes = node => Array.isArray(node.properties?.className) ? node.properties.className : String(node.properties?.className ?? '').split(/\s+/u);
const dimension = number => Number(number.toFixed(5));

// MathJax's TeX font is the same family used by the normal PDF. Paths, unlike
// native MathML or embedded math fonts, also work in older EPUB reading engines.
export default function epubMath({ minimumLength = 32 } = {}) {
  if (!Number.isInteger(minimumLength) || minimumLength < 1) throw new Error('minimumLength must be a positive integer.');
  const tex = new TeX({
    packages: ['base', 'ams', 'newcommand'],
    formatError(_jax, error) { throw error; },
  });
  const output = new SVG({
    fontData: MathJaxTexFont,
    fontCache: 'none',
    displayOverflow: 'overflow',
    linebreaks: { inline: true },
  });
  const document = mathjax.document('', { InputJax: tex, OutputJax: output });
  return async tree => {
    const walk = async node => {
      // Remove only VFM's injected runtime: the EPUB must be fully offline.
      if (node.children) node.children = node.children.filter(child => !(child.tagName === 'script'
        && /^https:\/\/cdnjs\.cloudflare\.com\/ajax\/libs\/mathjax\/2\.7\.9\/MathJax\.js(?:\?|$)/u.test(child.properties?.src ?? '')));
      if (node.tagName === 'span' && classes(node).includes('math') && node.properties?.dataMathTypeset) {
        const display = classes(node).includes('display');
        const fenced = text(node);
        const source = fenced.slice(2, -2).trim();
        // Tables retain all their aligned rows in one image. Only long simple
        // displays use inline SVG fragments, letting the reader choose breaks.
        const fragments = !display || (source.length >= minimumLength && !/\\begin\s*\{/u.test(source));
        const result = await document.convertPromise(display && fragments ? `\\displaystyle ${source}` : source,
          { display: display && !fragments, em: 16, ex: 8, containerWidth: 100000 });
        const generated = fromHtml(adaptor.outerHTML(result), { fragment: true }).children[0];
        const children = [];
        for (const part of generated.children ?? []) {
          if (part.tagName === 'mjx-break') {
            // A real space is a reliable reflow opportunity in EPUB+ / MuPDF.
            // Do not carry MathJax's custom tags or zero-width font into EPUB.
            children.push(part.properties?.newline !== undefined
              ? { type: 'element', tagName: 'br', properties: {}, children: [] }
              : { type: 'text', value: ' ' });
          } else if (part.tagName === 'svg') {
            const box = String(part.properties.viewBox).split(/[\s,]+/u).map(Number);
            if (box.length !== 4 || box.some(value => !Number.isFinite(value))) throw new Error('Invalid MathJax SVG viewBox.');
            const [, y, width, height] = box;
            // MuPDF rasterizes inline SVG at its intrinsic dimensions before CSS
            // sizing. Oversample 4x so high-DPI readers retain sharp math.
            part.properties.width = dimension(width / 1000 * 64);
            part.properties.height = dimension(height / 1000 * 64);
            part.properties.style = `width:${dimension(width / 1000)}em;height:auto;vertical-align:${dimension(-(y + height) / 1000)}em;`;
            part.properties.className = ['epub-math-svg'];
            part.properties.ariaHidden = 'true';
            delete part.properties.role;
            children.push(part);
          }
        }
        node.properties = { className: ['epub-math', display ? 'epub-math-display' : 'epub-math-inline'], role: 'math', ariaLabel: source, title: source };
        node.children = children;
        return;
      }
      for (const child of node.children ?? []) await walk(child);
    };
    await walk(tree);
  };
}
