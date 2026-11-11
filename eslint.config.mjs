// From the harness default (core/eslint.config.mjs), with TypeScript rules for the backend, its tests and the web entry.
// Formatting is Prettier's job; these rules look for mistakes.
import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  // Copied harness tools, vendored, generated and fixture files are not this project's source.
  {
    ignores: [
      'node_modules/**',
      'dist/**',
      'coverage/**',
      'vendor/**',
      'tools/**',
      'evals/**',
      'native/**',
      'web/public/**',
      'test/fixtures/**',
      '.harness/**',
      '.angular/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none' },
      ],
      'no-empty': ['error', { allowEmptyCatch: true }],
      // Input validation matches control characters on purpose.
      'no-control-regex': 'off',
      // Fixed error texts are deliberate where a cause could carry private or untrusted text.
      'preserve-caught-error': 'off',
      // TypeScript resolves names; `no-undef` only misreports Node globals in .mjs files.
      'no-undef': 'off',
    },
  },
);
