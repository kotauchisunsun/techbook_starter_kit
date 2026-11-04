import type { Root, RootContent, Element } from 'hast';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { VFM } from '@vivliostyle/vfm';
import epubMath from './epub-math.ts';

const collect = (node: Root | RootContent, predicate: (node: Element) => boolean): Element[] => [
  ...(node.type === 'element' && predicate(node) ? [node] : []),
  ...('children' in node ? node.children : []).flatMap(child => collect(child, predicate)),
];
const elements = (tree: Root | RootContent, tag: string) => collect(tree, node => node.tagName === tag);
const wrappers = (tree: Root) => collect(tree, node => Array.isArray(node.properties.className) && node.properties.className.includes('epub-math'));
async function render(markdown: string, options: Parameters<typeof epubMath>[0] = {}, extra: Parameters<typeof VFM>[0] = {}) {
  let tree: Root | undefined;
  const result = await VFM({ mathRenderer: 'mathjax', partial: true, ...extra })
    .use(epubMath, options).use(() => (value: unknown) => { tree = value as Root; }).process(markdown);
  assert(tree);
  return { tree, html: String(result) };
}

test('インラインの上付き文字を、ベースラインに沿う寸法と数式ソースの代替テキストを持つフォント非依存の SVG パスにする', async () => {
  const { tree, html } = await render('二次方程式 $x^2-3x+2=0$ を解きます。');
  const wrapper = wrappers(tree)[0];
  assert.equal(wrapper.properties.ariaLabel, 'x^2-3x+2=0');
  assert.equal(wrapper.properties.role, 'math');
  assert(Array.isArray(wrapper.properties.className));
  assert(wrapper.properties.className.includes('epub-math-inline'));
  assert(elements(wrapper, 'svg').length > 0);
  assert(elements(wrapper, 'path').length > 0);
  for (const svg of elements(wrapper, 'svg')) {
    assert.equal(typeof svg.properties.style, 'string');
    assert.match(String(svg.properties.style), /width:[\d.]+em;height:auto;vertical-align:-?[\d.]+em;/);
    assert.equal(svg.properties.ariaHidden, 'true');
    assert(typeof svg.properties.width === 'number');
    assert(typeof svg.properties.height === 'number');
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

test('整列した数式の4行を1つの SVG 内に保ち、単なるテキストにしない', async () => {
  const { tree, html } = await render(String.raw`$$
\begin{aligned}
x^2-3x+2 &= 0 \\
x^2-x-2x+2 &= 0 \\
x(x-1)-2(x-1) &= 0 \\
(x-1)(x-2) &= 0
\end{aligned}
$$`);
  const wrapper = wrappers(tree)[0];
  assert(Array.isArray(wrapper.properties.className));
  assert(wrapper.properties.className.includes('epub-math-display'));
  assert.equal(elements(wrapper, 'svg').length, 1);
  assert.equal((html.match(/data-mml-node="mtr"/g) ?? []).length, 4);
  assert.match(html, /data-mml-node="mtable"/);
});

test('長い独立行の数式は自己完結した SVG 断片の間でリーダーの折り返しを利用する', async () => {
  const source = 'A+B+C+D+E+F+G+H+I+J+K+L+M+N+O+P+Q+R+S+T=210';
  const { tree, html } = await render(`$$\n${source}\n$$`);
  const wrapper = wrappers(tree)[0];
  assert.equal(wrapper.properties.ariaLabel, source);
  assert.equal(elements(wrapper, 'svg').length, 21);
  assert.equal(wrapper.children.filter(node => node.type === 'text' && node.value === ' ').length, 20);
  assert.doesNotMatch(html, /<mjx-|font-family|letter-spacing|display:flex/);
});

test('分数・根号・括弧で囲んだ式を断片内で崩さず保持する', async () => {
  const { tree, html } = await render(String.raw`$\frac{a+b}{c-d}+\sqrt{x+y}+(u+v)^2=z$`);
  assert.match(html, /data-mml-node="mfrac"/);
  assert.match(html, /data-mml-node="msqrt"/);
  assert.match(html, /data-mml-node="msup"/);
  const fragments = elements(wrappers(tree)[0], 'svg');
  assert(fragments.length > 1);
  assert.equal(fragments.filter(node => collect(node, child => child.properties?.dataMmlNode === 'mfrac').length).length, 1);
});

test('無関係なスクリプトを残して VFM の実行時ローダーを削除する', async () => {
  const { html } = await render('$x^2$\n\n<script src="other.js"></script>', {}, { partial: false });
  assert.doesNotMatch(html, /cdnjs\.cloudflare\.com|MathJax\.js/);
  assert.match(html, /src="other.js"/);
});

test('サンプル原稿を変更せず、すべての数式を描画する', async () => {
  const source = await readFile(new URL('../../manuscript/02_examples.md', import.meta.url), 'utf8');
  const { tree, html } = await render(source);
  assert(wrappers(tree).length >= 8);
  assert.doesNotMatch(html, /<math[ >]|<mjx-|MathJax\.js/);
  assert.equal(await readFile(new URL('../../manuscript/02_examples.md', import.meta.url), 'utf8'), source);
});

test('不正な数式やオプションは数式を黙って単なるテキストにせず失敗させる', async () => {
  await assert.rejects(render('$\\frac{a$'));
  assert.throws(() => epubMath({ minimumLength: 0 }), /positive integer/);
});
