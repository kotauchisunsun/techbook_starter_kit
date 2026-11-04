import test from 'node:test';
import assert from 'node:assert/strict';
import epubLayout from './epub-layout.js';

const element = (tagName, children = [], properties = {}) => ({ type: 'element', tagName, children, properties });
const text = value => ({ type: 'text', value });

test('EPUB 対応のブロックを使い、図やキャプションを見出しの前へ移動しない', () => {
  const first = element('h2', [text('Flowchart')], { id: 'flowchart' });
  const description = element('p', [text('The following diagram')]);
  const image = element('img', [], { src: 'diagram.png', alt: 'Mermaid diagram 1' });
  const caption = element('figcaption', [text('Apple')], { ariaHidden: 'true' });
  const figure = element('figure', [element('img', [], { src: 'apple.png', alt: 'Apple' }), caption]);
  const section = element('section', [first, description, image, figure], { id: 'chapter' });
  epubLayout()({ type: 'root', children: [section] });
  assert.equal(section.tagName, 'div');
  assert.equal(section.properties.id, 'chapter');
  assert.deepEqual(section.children.slice(0, 2), [first, description]);
  assert.equal(section.children[2].tagName, 'div');
  assert.deepEqual(section.children[2].children, [image]);
  assert(image.properties.className.includes('epub-mermaid'));
  assert.equal(figure.tagName, 'div');
  assert.equal(figure.properties.role, 'figure');
  assert.equal(caption.tagName, 'p');
  assert(caption.properties.className.includes('epub-caption'));
  assert.equal(caption.children[0].value, 'Apple');
  assert.equal(caption.properties.ariaHidden, 'true');
});

test('インラインコードのスタイルを構文強調付きコードブロックに適用しない', () => {
  const inline = element('code', [text('path/')], { className: 'existing' });
  const block = element('code', [element('span', [text('return')], { className: ['token', 'keyword'] })]);
  const tree = element('section', [element('p', [inline]), element('pre', [block])]);
  epubLayout()(tree);
  assert.deepEqual(inline.properties.className, ['existing', 'epub-inline-code']);
  assert(!block.properties.className?.includes('epub-inline-code'));
  assert.deepEqual(block.children[0].properties.className, ['token', 'keyword']);
});
