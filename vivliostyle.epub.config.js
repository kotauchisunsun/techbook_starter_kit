import config from './vivliostyle.config.js';
import epubMath from './scripts/epub-math.js';
import { epubCoverEntries } from './scripts/epub-assets.js';

const covers = epubCoverEntries(config);

export default {
  ...config,
  documentProcessor: (options, metadata) => config.documentProcessor(options, metadata).use(epubMath),
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
  // EPUB readers should not need JavaScript or an Internet connection for math.
  vfm: {
    ...config.vfm,
    mathRenderer: 'mathml',
    footnote: 'pandoc',
    table: { ...config.vfm?.table, cell: 'align-style' },
  },
  output: [{ path: 'output/epub/book.epub', format: 'epub' }],
};
