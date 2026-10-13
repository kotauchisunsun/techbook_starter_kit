const config = require('./vivliostyle.config.js');

module.exports = {
  ...config,
  cover: undefined,
  entry: config.entry.filter((entry) => entry.rel !== 'cover'),
  output: [{ path: 'output/pdf/book_print.pdf', format: 'pdf', renderMode: 'local' }],
};
