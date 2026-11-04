import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default [
  { ignores: ['scripts/**/fixtures/**', 'scripts/**/node_modules/**', 'scripts/**/tmp/**', 'scripts/**/output/**'] },
  {
    files: ['scripts/**/*.{js,mjs,cjs}'],
    languageOptions: { globals: globals.node },
    rules: {
      ...js.configs.recommended.rules,
      'no-unused-vars': ['error', { argsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' }],
    },
  },
  ...tseslint.configs.recommended.map(config => ({ ...config, files: ['scripts/**/*.ts'] })),
  {
    files: ['scripts/**/*.ts'],
    languageOptions: { globals: globals.node },
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' }],
    },
  },
  // These functions run inside the EPUB reader rather than Node.
  { files: ['scripts/epub/render-epub.js'], languageOptions: { globals: globals.browser } },
];
