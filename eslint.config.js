import js from '@eslint/js';
import importPlugin from 'eslint-plugin-import';
import simpleImportSort from 'eslint-plugin-simple-import-sort';
import unusedImports from 'eslint-plugin-unused-imports';
import tseslint from 'typescript-eslint';

export default tseslint.config(js.configs.recommended, tseslint.configs.recommended, {
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
    'no-restricted-imports': [
      'error',
      {
        patterns: [
          {
            group: ['../*', '../**'],
            message:
              'Use the #src/* alias for cross-directory imports. Keep ./foo for same-directory imports.',
          },
        ],
      },
    ],
    // One group, so autofix never inserts blank lines between categories:
    // packages, then the #src alias, then relative imports, then side-effect imports.
    'simple-import-sort/imports': [
      'error',
      { groups: [['^(?!#src(?:/|$))@?\\w', '^#src(?:/.*|$)', '^\\.', '^\\u0000']] },
    ],
    'simple-import-sort/exports': 'error',
  },
});
