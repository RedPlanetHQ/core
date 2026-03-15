const eslint = require('@eslint/js');
const tseslint = require('typescript-eslint');
const importPlugin = require('eslint-plugin-import');
const prettierPlugin = require('eslint-plugin-prettier');
const unusedImportsPlugin = require('eslint-plugin-unused-imports');

module.exports = [
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{js,ts}'],
    plugins: {
      import: importPlugin,
      prettier: prettierPlugin,
      'unused-imports': unusedImportsPlugin,
    },
    languageOptions: {
      ecmaVersion: 2020,
      sourceType: 'module',
      parser: tseslint.parser,
    },
    rules: {
      'prettier/prettier': 'warn',
      'unused-imports/no-unused-imports': 'warn',
      'no-unused-vars': 'off',
      '@typescript-eslint/no-unused-vars': 'warn',
      'import/order': [
        'warn',
        {
          'newlines-between': 'always',
          groups: ['type', 'builtin', 'external', 'internal', ['parent', 'sibling'], 'index'],
          alphabetize: { order: 'asc', caseInsensitive: true },
        },
      ],
    },
  },
  {
    files: ['scripts/**/*'],
    rules: {
      '@typescript-eslint/no-var-requires': 'off',
    },
  },
];
