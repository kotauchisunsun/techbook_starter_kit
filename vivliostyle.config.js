module.exports = {
  title: '本のタイトル',
  author: '著者名',
  language: 'ja',
  size: 'A5',
  theme: [
    '@vivliostyle/theme-base@2.1.0',
    '@vivliostyle/theme-techbook@2.0.1',
    '@mitsuharu/vivliostyle-theme-noto-sans-jp@0.1.4',
    './custom.css',
  ],
  entry: [
    { rel: 'contents', title: '目次' },
    'manuscript/01.md',
    'manuscript/oss.md',
  ],
  output: [{ path: 'output/pdf/book.pdf', format: 'pdf', renderMode: 'local' }],
  copyAsset: { excludes: ['output/**'] },
  toc: { title: '目次', sectionDepth: 2 },
};
