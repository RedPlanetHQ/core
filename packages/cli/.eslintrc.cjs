module.exports = {
  extends: [
    'prettier',
    'eslint:recommended',
    'plugin:prettier/recommended',
    'next/core-web-vitals',
    'turbo',
  ],
  plugins: [
    '@typescript-eslint',
    'prettier',
    'unused-imports',
    'notice',
    'import',
  ],
  parserOptions: {
    ecmaVersion: 2020,
    sourceType: 'module',
    ecmaFeatures: {
      jsx: true,
    },
  },
  rules: {
    curly: 'warn',
    eqeqeq: 'error',
    'prettier/prettier': 'warn',
    'unused-imports/no-unused-imports': 'warn',
    'no-else-return': 'warn',
    'no-lonely-if': 'warn',
    'no-inner-declarations': 'off',
    'no-unused-vars': 'off',
    'no-useless-computed-key': 'warn',
    'no-useless-return': 'warn',
    'no-var': 'warn',
    'object-shorthand': ['warn', 'always'],
    'prefer-arrow-callback': 'warn',
    'prefer-const': 'warn',
    'prefer-destructuring': ['warn', { AssignmentExpression: { array: true } }],
    'prefer-object-spread': 'warn',
    'prefer-template': 'warn',
    'spaced-comment': ['warn', 'always', { markers: ['/'] }],
    yoda: 'warn',
    'import/order': [
      'warn',
      {
        'newlines-between': 'always',
        groups: [
          'type',
          'builtin',
          'external',
          'internal',
          ['parent', 'sibling'],
          'index',
        ],
        pathGroupsExcludedImportTypes: ['builtin'],
        alphabetize: {
          order:
            'asc' /* sort in ascending order. Options: ['ignore', 'asc', 'desc'] */,
          caseInsensitive: true /* ignore case. Options: [true, false] */,
        },
      },
    ],
    '@typescript-eslint/array-type': ['warn', { default: 'array-simple' }],
    '@typescript-eslint/ban-ts-comment': [
      'warn',
      {
        'ts-expect-error': 'allow-with-description',
      },
    ],
    '@typescript-eslint/ban-types': 'warn',
    '@typescript-eslint/consistent-indexed-object-style': ['warn', 'record'],
    '@typescript-eslint/consistent-type-definitions': ['warn', 'interface'],
    '@typescript-eslint/no-unused-vars': 'warn',
  },
  parser: '@typescript-eslint/parser',
  ignorePatterns: ['dist', 'node_modules'],
  overrides: [
    {
      files: ['scripts/**/*'],
      rules: {
        '@typescript-eslint/no-var-requires': 'off',
      },
    },
  ],
};
