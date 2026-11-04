import type { Root, Element, RootContent } from 'hast';

// Some EPUB engines treat HTML5 section/figure elements as inline containers,
// moving their images before the chapter. Use ordinary XHTML blocks while
// preserving IDs, reading order, captions and semantic roles.
const classes = (node: Root | RootContent) => {
  const value = ('properties' in node ? node.properties?.className : undefined) ?? [];
  return Array.isArray(value) ? value : String(value).split(/\s+/u);
};
const addClass = (node: Element, name: string) => {
  node.properties = { ...node.properties, className: [...new Set([...classes(node), name])] };
};

export default function epubLayout() {
  return (tree: unknown) => {
    const walk = (node: Root | RootContent, inPre = false) => {
      if (node.type !== 'element' && !('children' in node)) return;
      if (node.type === 'element') {
        if (node.tagName === 'section') {
          node.tagName = 'div';
          addClass(node, 'epub-section');
        } else if (node.tagName === 'figure') {
          node.tagName = 'div';
          node.properties = { ...node.properties, role: 'figure' };
          addClass(node, 'epub-figure');
        } else if (node.tagName === 'figcaption') {
          node.tagName = 'p';
          addClass(node, 'epub-caption');
        } else if (node.tagName === 'code' && !inPre) {
          addClass(node, 'epub-inline-code');
        }
      }
      if ('children' in node) node.children = node.children.map(child => {
        walk(child, inPre || (node.type === 'element' && node.tagName === 'pre'));
        if (child.type === 'element' && child.tagName === 'img'
            && !classes(node).includes('epub-diagram')
            && String(child.properties?.alt ?? '').startsWith('Mermaid diagram')) {
          addClass(child, 'epub-mermaid');
          return { type: 'element', tagName: 'div', properties: { className: ['epub-diagram'] }, children: [child] };
        }
        return child;
      });
    };
    // Unified 9 exposes an untyped Node at the plugin boundary.
    walk(tree as Root | Element);
  };
}
