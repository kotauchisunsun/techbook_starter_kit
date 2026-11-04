import { VFM } from '@vivliostyle/vfm';

import type { Root, Content, Parent, Code } from 'mdast';
import type { createMermaidRenderer } from 'mermaid-isomorphic';

let render: Promise<ReturnType<typeof createMermaidRenderer>> | undefined;

function mermaidPlugin() {
  return async (tree: unknown) => {
    const diagrams: { node: Code; parent: Parent; position: number }[] = [];
    const walk = (node: Root | Content, parent?: Parent, position?: number) => {
      if (node.type === 'code' && node.lang === 'mermaid' && parent && position !== undefined) {
        diagrams.push({ node, parent, position });
      }
      if ('children' in node) node.children.forEach((child, index) => walk(child, node, index));
    };
    // Unified 9 exposes an untyped Node at the plugin boundary.
    walk(tree as Root);
    if (!diagrams.length) return;

    const sources = diagrams.map(({ node }) => node.value);
    render ??= import('mermaid-isomorphic').then(({ createMermaidRenderer }) => createMermaidRenderer());
    const results = await (await render)(sources, { screenshot: true });
    results.forEach((result, index) => {
      if (result.status === 'rejected') throw result.reason;
      const { parent, position } = diagrams[index];
      if (!result.value.screenshot) throw new Error('Mermaid renderer did not return a screenshot.');
      parent.children[position] = {
        type: 'image',
        url: `data:image/png;base64,${result.value.screenshot.toString('base64')}`,
        alt: `Mermaid diagram ${index + 1}`,
      };
    });
  };
}

export default (options?: Parameters<typeof VFM>[0], metadata?: Parameters<typeof VFM>[1]) => VFM({
  ...options,
  editPlugins: (plugins) => ({
    ...plugins,
    mdastPlugins: [...plugins.mdastPlugins, mermaidPlugin],
  }),
}, metadata);
