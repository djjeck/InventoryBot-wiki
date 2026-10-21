import js from '@eslint/js';
import importPlugin from 'eslint-plugin-import';
import simpleImportSort from 'eslint-plugin-simple-import-sort';
import unusedImports from 'eslint-plugin-unused-imports';
import tseslint from 'typescript-eslint';

const PARENT_IMPORTS = {
  group: ['../*', '../**'],
  message:
    'Use the #src/* alias for cross-directory imports. Keep ./foo for same-directory imports.',
};

export default tseslint.config(
  // The built web app (npm run web:build); real exports (which hold js/script.js) and the
  // output of npm run inspect, git-ignored: the flat config does not read .gitignore.
  { ignores: ['web-dist/', 'inbox/', 'out/'] },
  js.configs.recommended,
  tseslint.configs.recommended,
  {
    plugins: {
      import: importPlugin,
      'simple-import-sort': simpleImportSort,
      'unused-imports': unusedImports,
    },
    rules: {
      // Only dead imports are removed automatically; other unused code is left to review.
      '@typescript-eslint/no-unused-vars': 'off',
      '@typescript-eslint/consistent-type-imports': [
        'error',
        {
          prefer: 'type-imports',
          fixStyle: 'inline-type-imports',
          disallowTypeAnnotations: false,
        },
      ],
      'import/consistent-type-specifier-style': ['error', 'prefer-inline'],
      'import/no-duplicates': ['error', { 'prefer-inline': true }],
      'unused-imports/no-unused-imports': 'error',
      'no-restricted-imports': ['error', { patterns: [PARENT_IMPORTS] }],
      // One group, so autofix never inserts blank lines between categories: packages, then
      // the #src and #test aliases, then relative imports, then side-effect imports.
      'simple-import-sort/imports': [
        'error',
        { groups: [['^@?\\w', '^#src(?:/.*|$)', '^#test(?:/.*|$)', '^\\.', '^\\u0000']] },
      ],
      'simple-import-sort/exports': 'error',
    },
  },
  {
    // Production code never depends on test code, so it can be shipped without it.
    files: ['src/**/*.ts'],
    ignores: ['src/**/*.test.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            PARENT_IMPORTS,
            { regex: '^#test/', message: 'Only tests may import the test helpers.' },
          ],
        },
      ],
    },
  }
);
