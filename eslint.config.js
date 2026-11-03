import js from '@eslint/js';
import json from '@eslint/json';
import css from '@eslint/css';
import yaml from 'eslint-plugin-yml';
import globals from 'globals';

export default [
  { ignores: ['**/node_modules/**', '**/output/**', '**/.vivliostyle/**', '**/assets/**',
    '**/tmp/**', '**/.venv*/**', '**/__pycache__/**', 'manuscript/**', '**/*.md',
    'scripts/fixtures/**', '**/package-lock.json', '**/release/**'] },
  {
    files: ['*.{js,mjs,cjs}', 'scripts/**/*.{js,mjs,cjs}', '.github/**/*.{js,mjs,cjs}'],
    ...js.configs.recommended,
    languageOptions: { globals: globals.node },
    rules: {
      ...js.configs.recommended.rules,
      'no-unused-vars': ['error', { argsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' }],
    },
  },
  // These functions are serialized and run inside the EPUB reader, not Node.
  { files: ['scripts/render-epub.js'], languageOptions: { globals: globals.browser } },
  {
    files: ['*.json', 'scripts/**/*.json', '.github/**/*.json'],
    ...json.configs.recommended,
    language: 'json/json',
  },
  ...yaml.configs.recommended.map(config => ({
    ...config, files: ['*.{yml,yaml}', 'scripts/**/*.{yml,yaml}', '.github/**/*.{yml,yaml}'],
  })),
  {
    files: ['*.css', 'scripts/**/*.css', '.github/**/*.css'],
    ...css.configs.recommended,
    language: 'css/css',
    languageOptions: {
      customSyntax: syntax => ({
        atrules: { footnote: { prelude: null, descriptors: syntax.properties } },
        properties: { 'footnote-policy': 'auto | line | block' },
      }),
    },
    rules: {
      ...css.configs.recommended.rules,
      // Print/EPUB readers intentionally use paged-media and legacy fallback CSS.
      'css/use-baseline': 'off',
      'css/no-important': 'off',
    },
  },
];
