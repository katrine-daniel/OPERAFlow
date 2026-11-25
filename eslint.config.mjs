import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import globals from 'globals';
import nextPlugin from '@next/eslint-plugin-next';

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/.next/**',
      '**/.next-e2e/**',
      'playwright-report/**',
      'test-results/**',
      'e2e/.auth/**',
      '**/coverage/**',
      '**/next-env.d.ts',
      '.data/**',
      '.local/**',
      'storage/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: { globals: { ...globals.node } },
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      '@typescript-eslint/consistent-type-imports': 'off',
      'no-console': ['warn', { allow: ['warn', 'error'] }],
    },
  },
  {
    files: ['apps/web/**/*.{ts,tsx}'],
    plugins: { '@next/next': nextPlugin },
    languageOptions: { globals: { ...globals.browser } },
    rules: { ...nextPlugin.configs.recommended.rules, ...nextPlugin.configs['core-web-vitals'].rules },
    settings: { next: { rootDir: 'apps/web' } },
  },
  {
    // GitHub Pages interactive demo: plain browser scripts sharing globals across two files.
    files: ['demo/**/*.js'],
    languageOptions: {
      sourceType: 'script',
      globals: {
        ...globals.browser,
        OF_TZ: 'readonly', OF_ROLES: 'readonly', OF_SOURCES: 'readonly', OF_LABEL: 'readonly', OF_FIELD: 'readonly',
        ofDayISO: 'readonly', ofAddDays: 'readonly', ofNights: 'readonly', ofNormalizeName: 'readonly', ofDedupeKey: 'readonly',
        ofMissing: 'readonly', ofMargin: 'readonly', ofSeed: 'readonly',
      },
    },
    rules: { '@typescript-eslint/no-unused-vars': 'off', 'no-redeclare': 'off' },
  },
  {
    files: ['scripts/**/*.mjs', 'packages/db/prisma/**/*.ts'],
    rules: { 'no-console': 'off' },
  },
);
