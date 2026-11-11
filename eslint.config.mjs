// From the harness default (core/eslint.config.mjs), with TypeScript rules for the backend, its tests and the web entry.
// Formatting is Prettier's job; these rules look for mistakes.
import { readFileSync } from 'node:fs';
import js from '@eslint/js';
import tseslint from 'typescript-eslint';

// Copied harness tools stay byte-identical to the template, which lints them itself; NERV's own tools are linted here.
const copied = Object.keys(JSON.parse(readFileSync(new URL('./.harness.json', import.meta.url), 'utf8')).copied);

export default tseslint.config(
  // Vendored, generated, data and fixture files are not this project's source.
  {
    ignores: [
      'node_modules/**',
      'dist/**',
      'coverage/**',
      'vendor/**',
      'evals/**',
      'native/NervMenuBar/**',
      'test/fixtures/**',
      '.harness/**',
      '.angular/**',
      // The hand-written static dashboard has four known findings (a misplaced "use strict", two functions nothing
      // calls, one ternary statement). Fixing them changes a shipped page, so they are recorded in F-004, not hidden.
      'web/public/dashboard/**',
      ...copied,
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
