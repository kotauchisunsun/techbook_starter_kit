import js from '@eslint/js';
import globals from 'globals';

export default [
  { ignores: ['**/node_modules/**', '**/output/**', '**/.vivliostyle/**', '**/assets/**',
    '**/tmp/**', '**/.venv*/**', '**/__pycache__/**', 'manuscript/**', '.github/**'] },
  {
    files: ['*.{js,mjs,cjs}', 'scripts/**/*.{js,mjs,cjs}'],
    ...js.configs.recommended,
    languageOptions: { globals: globals.node },
    rules: {
      ...js.configs.recommended.rules,
      'no-unused-vars': ['error', { argsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' }],
    },
  },
  // These functions are serialized and run inside the EPUB reader, not Node.
  { files: ['scripts/render-epub.js'], languageOptions: { globals: globals.browser } },
];
