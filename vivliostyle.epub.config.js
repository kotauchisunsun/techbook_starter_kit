import config from './vivliostyle.config.js';

export default {
  ...config,
  // Reflowable readers do not implement print pagination or page footnotes.
  theme: './epub.css',
  // EPUB readers should not need JavaScript or an Internet connection for math.
  vfm: { ...config.vfm, mathRenderer: 'mathml', footnote: 'pandoc' },
  output: [{ path: 'output/epub/book.epub', format: 'epub' }],
};
