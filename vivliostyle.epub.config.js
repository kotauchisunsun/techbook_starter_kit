import config from './vivliostyle.config.js';
import epubMath from './scripts/epub-math.js';
import epubLayout from './scripts/epub-layout.js';
import { epubCoverEntries } from './scripts/epub-assets.js';

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
