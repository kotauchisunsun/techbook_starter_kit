import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { VFM } from '@vivliostyle/vfm';
import epubMath from './epub-math.js';

const collect = (node, predicate) => [...(predicate(node) ? [node] : []), ...(node.children ?? []).flatMap(child => collect(child, predicate))];
const elements = (tree, tag) => collect(tree, node => node.tagName === tag);
const wrappers = tree => collect(tree, node => node.properties?.className?.includes('epub-math'));
async function render(markdown, options = {}, extra = {}) {
  let tree;
  const result = await VFM({ mathRenderer: 'mathjax', partial: true, ...extra })
    .use(epubMath, options).use(() => value => { tree = value; }).process(markdown);
  return { tree, html: String(result) };
}

test('inline superscripts become font-independent SVG paths with baseline dimensions and source alternative', async () => {
  const { tree, html } = await render('二次方程式 $x^2-3x+2=0$ を解きます。');
  const wrapper = wrappers(tree)[0];
  assert.equal(wrapper.properties.ariaLabel, 'x^2-3x+2=0');
  assert.equal(wrapper.properties.role, 'math');
  assert(wrapper.properties.className.includes('epub-math-inline'));
  assert(elements(wrapper, 'svg').length > 0);
  assert(elements(wrapper, 'path').length > 0);
  for (const svg of elements(wrapper, 'svg')) {
    assert.match(svg.properties.style, /width:[\d.]+em;height:auto;vertical-align:-?[\d.]+em;/);
    assert.equal(svg.properties.ariaHidden, 'true');
    assert(svg.properties.width > 0);
    const [, , width, height] = String(svg.properties.viewBox).split(' ').map(Number);
    assert(Math.abs(svg.properties.width - width / 1000 * 64) < 0.00001);
    assert(Math.abs(svg.properties.height - height / 1000 * 64) < 0.00001);
    assert(Math.abs(svg.properties.width / svg.properties.height - width / height) < 0.00001);
  }
  assert.match(html, /data-mml-node="msup"/);
  assert.doesNotMatch(html, /<math[ >]|<mjx-|<use[ >]|<text[ >]|Temml|MJX-ZERO/);
  assert.match(html, /二次方程式/);
});

test('aligned equations keep four rows in one SVG and do not flatten into text', async () => {
  const { tree, html } = await render(String.raw`$$
\begin{aligned}
x^2-3x+2 &= 0 \\
x^2-x-2x+2 &= 0 \\
x(x-1)-2(x-1) &= 0 \\
(x-1)(x-2) &= 0
\end{aligned}
$$`);
  const wrapper = wrappers(tree)[0];
  assert(wrapper.properties.className.includes('epub-math-display'));
  assert.equal(elements(wrapper, 'svg').length, 1);
  assert.equal((html.match(/data-mml-node="mtr"/g) ?? []).length, 4);
  assert.match(html, /data-mml-node="mtable"/);
});

test('long display equations use native reflow opportunities between self-contained SVG fragments', async () => {
  const source = 'A+B+C+D+E+F+G+H+I+J+K+L+M+N+O+P+Q+R+S+T=210';
  const { tree, html } = await render(`$$\n${source}\n$$`);
  const wrapper = wrappers(tree)[0];
  assert.equal(wrapper.properties.ariaLabel, source);
  assert.equal(elements(wrapper, 'svg').length, 21);
  assert.equal(wrapper.children.filter(node => node.type === 'text' && node.value === ' ').length, 20);
  assert.doesNotMatch(html, /<mjx-|font-family|letter-spacing|display:flex/);
});

test('fractions, roots and fenced groups stay intact within a fragment', async () => {
  const { tree, html } = await render(String.raw`$\frac{a+b}{c-d}+\sqrt{x+y}+(u+v)^2=z$`);
  assert.match(html, /data-mml-node="mfrac"/);
  assert.match(html, /data-mml-node="msqrt"/);
  assert.match(html, /data-mml-node="msup"/);
  const fragments = elements(wrappers(tree)[0], 'svg');
  assert(fragments.length > 1);
  assert.equal(fragments.filter(node => collect(node, child => child.properties?.dataMmlNode === 'mfrac').length).length, 1);
});

test('removes VFM runtime loader while preserving unrelated scripts', async () => {
  const { html } = await render('$x^2$\n\n<script src="other.js"></script>', {}, { partial: false });
  assert.doesNotMatch(html, /cdnjs\.cloudflare\.com|MathJax\.js/);
  assert.match(html, /src="other.js"/);
});

test('sample manuscript renders all formulas without changing its source', async () => {
  const source = await readFile(new URL('../../manuscript/02_examples.md', import.meta.url), 'utf8');
  const { tree, html } = await render(source);
  assert(wrappers(tree).length >= 8);
  assert.doesNotMatch(html, /<math[ >]|<mjx-|MathJax\.js/);
  assert.equal(await readFile(new URL('../../manuscript/02_examples.md', import.meta.url), 'utf8'), source);
});

test('invalid formula and invalid options fail instead of silently flattening mathematics', async () => {
  await assert.rejects(render('$\\frac{a$'));
  assert.throws(() => epubMath({ minimumLength: 0 }), /positive integer/);
});
