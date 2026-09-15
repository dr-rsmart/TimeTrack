import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import eslintConfigPrettier from 'eslint-config-prettier';

/**
 * ESLint 9 flat config — TimeTrack API server (Express 5 + Prisma).
 * Warnings are tracked for tightening in the Phase 3 pass.
 */
export default tseslint.config(
  {
    ignores: ['dist/**', 'node_modules/**', 'prisma/generated/**', 'coverage/**'],
  },
  {
    files: ['**/*.ts'],
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    languageOptions: {
      ecmaVersion: 2022,
      globals: { ...globals.node },
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
      // Open-09 ratchet (2026-09-15): modules must stay under 700 lines.
      // Existing offenders are tracked in docs/AUDIT_REGISTER.md (Open-09).
      'max-lines': ['warn', { max: 700, skipBlankLines: true, skipComments: true }],
      // Intentional empty catch blocks are a deliberate pattern here.
      'no-empty': ['error', { allowEmptyCatch: true }],
      // Regex-heavy validation code contains harmless/useful escapes.
      'no-useless-escape': 'off',
      // All server logging goes through the pino logger (src/logger.ts).
      'no-console': 'error',
    },
  },
  {
    files: ['scripts/**/*.ts'],
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    languageOptions: {
      ecmaVersion: 2022,
      globals: { ...globals.node },
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
      // CLI maintenance scripts intentionally print to stdout/stderr.
      'no-console': 'off',
      'no-empty': ['error', { allowEmptyCatch: true }],
      'no-useless-escape': 'off',
    },
  },
  {
    files: ['**/*.{js,mjs,cjs}'],
    extends: [js.configs.recommended],
    languageOptions: {
      ecmaVersion: 2022,
      globals: { ...globals.node },
    },
    rules: {
      'no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
      'no-empty': ['error', { allowEmptyCatch: true }],
      'no-useless-escape': 'off',
    },
  },
  eslintConfigPrettier,
);
