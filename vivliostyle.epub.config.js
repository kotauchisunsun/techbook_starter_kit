import config from './vivliostyle.config.js';

export default {
  ...config,
  // Reflowable readers do not implement print pagination or page footnotes.
  theme: './epub.css',
  // Do not package themes left behind by a preceding PDF build.
  workspaceDir: '.vivliostyle/epub',
  // EPUB readers should not need JavaScript or an Internet connection for math.
  vfm: {
    ...config.vfm,
    mathRenderer: 'mathml',
    footnote: 'pandoc',
    table: { ...config.vfm?.table, cell: 'align-style' },
  },
  output: [{ path: 'output/epub/book.epub', format: 'epub' }],
};
