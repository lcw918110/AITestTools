import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';

export default tseslint.config(
  {
    ignores: [
      'dist/**',
      'coverage/**',
      'node_modules/**',
      'examples/**',
      'tests/fixtures/**',
      'eslint.config.js',
      'src/contract/verify/**',
      'src/drivers/cassette/**/*.mjs',
      'scripts/**',
      'apps/console/public/**',
      '.diagnostics/**',
      '_审视/**',
      'wanxiangshu/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      parserOptions: {
        projectService: {
          allowDefaultProject: ['eslint.config.js'],
        },
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
      'no-console': ['error', { allow: ['error'] }],
      eqeqeq: ['error', 'always'],
    },
  },
  {
    files: ['src/cli/**/*.ts', 'src/report/**/*.ts', 'apps/console/**/*.ts'],
    rules: { 'no-console': 'off' },
  },
  prettier,
);
