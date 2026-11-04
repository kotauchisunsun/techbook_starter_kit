import config from './vivliostyle.config.js';
import './scripts/register-typescript.js';

const { default: epubMath } = await import('./scripts/epub/epub-math.ts');
const { default: epubLayout } = await import('./scripts/epub/epub-layout.ts');
const { epubCoverEntries } = await import('./scripts/epub/epub-assets.ts');

const covers = epubCoverEntries(config);

export default {
  ...config,
  documentProcessor: (options, metadata) => config.documentProcessor(options, metadata).use(epubMath).use(epubLayout),
  cover: covers[0]?.target ?? config.cover,
  entry: config.entry.map((entry, index) => {
    const cover = covers.find(cover => cover.index === index);
    return cover ? { ...entry, imageSrc: cover.target, theme: './epub-cover.css' } : entry;
  }),
  // Reflowable readers do not implement print pagination or page footnotes.
  theme: './assets/epub-generated/epub.css',
  // Do not package themes left behind by a preceding PDF build.
  workspaceDir: '.vivliostyle/epub',
  copyAsset: {
    ...config.copyAsset,
    excludes: [...(config.copyAsset?.excludes ?? []), 'tmp/**', 'scripts/**'],
    includeFileExtensions: [...(config.copyAsset?.includeFileExtensions ?? []), 'xhtml'],
  },
  // Keep source formulas until epubMath replaces them with offline SVG paths.
  vfm: {
    ...config.vfm,
    mathRenderer: 'mathjax',
    footnote: 'pandoc',
    table: { ...config.vfm?.table, cell: 'align-style' },
  },
  output: [{ path: 'output/epub/book.epub', format: 'epub' }],
};
