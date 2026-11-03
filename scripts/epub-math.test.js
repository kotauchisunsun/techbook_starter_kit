import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { VFM } from '@vivliostyle/vfm';
import baseProcessor from './mermaid.js';
import epubMath from './epub-math.js';

const text = node => node.type === 'text' ? node.value : (node.children ?? []).map(text).join('');
const elements = node => (node.children ?? []).filter(child => child.type === 'element');
const collect = (node, tag) => [...(node.tagName === tag ? [node] : []), ...(node.children ?? []).flatMap(child => collect(child, tag))];
const value = node => text(node).replace(/\s/gu, '');
const leaf = (tagName, value, properties = {}) => ({ type: 'element', tagName, properties, children: [{ type: 'text', value }] });
const math = children => ({ type: 'element', tagName: 'math', properties: { display: 'block', className: ['tml-display'], style: 'display:block math;' },
  children: [{ type: 'text', value: '\n  ' }, { type: 'element', tagName: 'mrow', properties: {}, children }, { type: 'text', value: '\n' }] });

async function render(markdown, options, processor = VFM) {
  let before;
  let after;
  const result = await processor({ mathRenderer: 'mathml', partial: true })
    .use(() => tree => { before = structuredClone(tree); })
    .use(epubMath, options)
    .use(() => tree => { after = tree; })
    .process(markdown);
  return { before, after, html: String(result) };
}

test('actual formatted VFM stress math gains safe break fragments without changing text order', async () => {
  const fixture = await readFile(new URL('./fixtures/epub-stress.md', import.meta.url), 'utf8');
  const { before, after, html } = await render(fixture, undefined, baseProcessor);
  assert.equal(text(after), text(before), 'Includes preservation of all pretty-print whitespace.');
  const changed = collect(after, 'math').filter(node => node.properties.className?.includes('epub-math-wrap'));
  assert.equal(changed.length, 1);
  assert.deepEqual(elements(changed[0]).map(value), 'ABCDEFGHIJKLMNOPQRS'.split('').map(letter => `${letter}+`).concat(['T=', '210']));
  assert.match(html, /class="tml-display epub-math-wrap"/);
  assert.equal(changed[0].properties.style, 'display:block math;');
  for (const row of elements(changed[0]).slice(0, -1)) assert.equal(elements(row).at(-1).properties.form, 'infix');
  assert.deepEqual(collect(after, 'mtable'), collect(before, 'mtable'));
});

test('short equations, inline math and already-grouped display math remain unchanged', async () => {
  for (const markdown of ['$$\nx^2-3x+2=0\n$$', '$A+B+C+D+E+F+G+H+I+J+K+L+M+N+O+P=100$', '$$\n\\begin{aligned}a+b&=c\\\\d+e&=f\\end{aligned}\n$$']) {
    const { before, after } = await render(markdown);
    assert.deepEqual(after, before);
  }
  const node = math([leaf('mi', 'a'), leaf('mo', '+'), leaf('mi', 'b')]);
  node.children.push({ type: 'element', tagName: 'mrow', properties: {}, children: [leaf('mi', 'c')] });
  const before = structuredClone(node);
  epubMath({ minimumLength: 1 })(node);
  assert.deepEqual(node, before);
});

test('fractions, radicals, superscripts and nested parentheses remain intact', async () => {
  const { before, after } = await render('$$\n\\frac{a+b}{c-d}+\\sqrt{x+y}+(u+v)^2=z\n$$', { minimumLength: 1 });
  assert.equal(text(after), text(before));
  for (const tag of ['mfrac', 'msqrt', 'msup']) assert.deepEqual(collect(after, tag), collect(before, tag), tag);
  const rows = elements(collect(after, 'math')[0]);
  assert.equal(rows.length, 4);
  assert.deepEqual(rows.map(value), ['a+bc−d+', 'x+y+', '(u+v)2=', 'z']);
});

test('direct outer fences protect their contents and unary signs are never break points', () => {
  const node = math([
    leaf('mo', '−', { form: 'prefix' }), leaf('mi', 'a'), leaf('mo', '+'),
    leaf('mo', '('), leaf('mi', 'b'), leaf('mo', '+'), leaf('mi', 'c'), leaf('mo', ')'), leaf('mo', '='),
    leaf('mo', '−', { form: 'prefix' }), leaf('mi', 'd'),
  ]);
  const before = text(node);
  epubMath({ minimumLength: 1 })(node);
  assert.equal(text(node), before);
  assert.deepEqual(elements(node).map(value), ['−a+', '(b+c)=', '−d']);
  const inferred = math([leaf('mo', '−'), leaf('mi', 'x'), leaf('mo', '+'), leaf('mo', '−'), leaf('mi', 'y'), leaf('mo', '='), leaf('mi', 'z')]);
  epubMath({ minimumLength: 1 })(inferred);
  assert.deepEqual(elements(inferred).map(value), ['−x+', '−y=', 'z']);
});

test('ambiguous fences, scoped rows and nested aligned tables are untouched', () => {
  const nodes = [
    math([leaf('mo', '('), leaf('mi', 'a'), leaf('mo', '+'), leaf('mi', 'b')]),
    math([leaf('mo', '('), leaf('mi', 'a'), leaf('mo', ']'), leaf('mo', '+'), leaf('mi', 'b')]),
    math([leaf('mo', '|'), leaf('mi', 'a'), leaf('mo', '+'), leaf('mi', 'b')]),
    math([leaf('mi', 'a'), leaf('mo', '+'), { type: 'element', tagName: 'mtable', properties: {}, children: [] }]),
  ];
  const scoped = math([leaf('mi', 'a'), leaf('mo', '+'), leaf('mi', 'b')]);
  elements(scoped)[0].properties.id = 'preserve-me';
  nodes.push(scoped);
  for (const node of nodes) {
    const before = structuredClone(node);
    epubMath({ minimumLength: 1 })(node);
    assert.deepEqual(node, before);
  }
});

test('post-operator glue is retained and explicit no-break glue is respected', () => {
  const space = { type: 'element', tagName: 'mspace', properties: { width: '0.3em' }, children: [] };
  const node = math([leaf('mi', 'a'), leaf('mo', '+'), { type: 'text', value: '\n  ' }, space, leaf('mi', 'b'), leaf('mo', '='), leaf('mi', 'c')]);
  const before = text(node);
  epubMath({ minimumLength: 1 })(node);
  assert.equal(text(node), before);
  assert.equal(elements(elements(node)[0]).at(-1), space);
  const noBreak = math([leaf('mi', 'a'), leaf('mo', '+'), { ...space, properties: { linebreak: 'nobreak' } }, leaf('mi', 'b'), leaf('mo', '='), leaf('mi', 'c')]);
  epubMath({ minimumLength: 1 })(noBreak);
  assert.deepEqual(elements(noBreak).map(value), ['a+b=', 'c']);
});

test('transformation is idempotent and option validation is explicit', async () => {
  const { after } = await render('$$\nA+B+C+D+E+F+G+H+I+J+K+L+M+N+O+P+Q+R+S+T=210\n$$');
  const before = structuredClone(after);
  epubMath()(after);
  assert.deepEqual(after, before);
  assert.throws(() => epubMath({ minimumLength: 0 }), /positive integer/);
  assert.throws(() => epubMath({ minimumLength: 1.5 }), /positive integer/);
});
