const { VFM } = require('@vivliostyle/vfm');

let render;

function mermaidPlugin() {
  return async (tree) => {
    const diagrams = [];
    const walk = (node, parent, position) => {
      if (node.type === 'code' && node.lang === 'mermaid') {
        diagrams.push({ node, parent, position });
      }
      node.children?.forEach((child, index) => walk(child, node, index));
    };
    walk(tree);
    if (!diagrams.length) return;

    const sources = diagrams.map(({ node }) => node.value);
    render ??= import('mermaid-isomorphic').then(({ createMermaidRenderer }) => createMermaidRenderer());
    const results = await (await render)(sources, { screenshot: true });
    results.forEach((result, index) => {
      if (result.status === 'rejected') throw result.reason;
      const { parent, position } = diagrams[index];
      parent.children[position] = {
        type: 'image',
        url: `data:image/png;base64,${result.value.screenshot.toString('base64')}`,
        alt: `Mermaid diagram ${index + 1}`,
      };
    });
  };
}

module.exports = (options, metadata) => VFM({
  ...options,
  editPlugins: (plugins) => ({
    ...plugins,
    mdastPlugins: [...plugins.mdastPlugins, mermaidPlugin],
  }),
}, metadata);
