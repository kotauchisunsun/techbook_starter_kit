import config from './vivliostyle.config.js';

export default {
  ...config,
  cover: undefined,
  entry: config.entry.filter((entry) => entry.rel !== 'cover'),
  output: [{ path: 'output/pdf/book_print.pdf', format: 'pdf', renderMode: 'local' }],
};
