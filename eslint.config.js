import js from '@eslint/js';
import globals from 'globals';

export default [
  { ignores: ['scripts/**/*.test.{js,mjs,cjs}', 'scripts/**/*.integration.{js,mjs,cjs}', 'scripts/fixtures/**', 'scripts/**/node_modules/**', 'scripts/**/tmp/**', 'scripts/**/output/**'] },
  {
    files: ['scripts/**/*.{js,mjs,cjs}'],
    languageOptions: { globals: globals.node },
    rules: {
      ...js.configs.recommended.rules,
      'no-unused-vars': ['error', { argsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' }],
    },
  },
  // These functions run inside the EPUB reader rather than Node.
  { files: ['scripts/render-epub.js'], languageOptions: { globals: globals.browser } },
];
