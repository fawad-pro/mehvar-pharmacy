import next from 'eslint-config-next';
import nextCoreWebVitals from 'eslint-config-next/core-web-vitals';
import nextTypescript from 'eslint-config-next/typescript';
import prettier from 'eslint-config-prettier';
import tseslint from 'typescript-eslint';

/**
 * Lint rules here are not style preferences — each one enforces a clause of the
 * planning package that a reviewer would otherwise have to catch by eye.
 *
 *   Phase 11 §1  — layering: domain/ never imports app/ or components/;
 *                  every DB touch goes through db/scoped.ts.
 *   Phase 11 §2  — TypeScript strict; `any` forbidden.
 *   Phase 10 §9  — tokens enforced by lint (no raw hex in components).
 */

/** Matches a CSS hex colour literal: #abc, #abcd, #aabbcc, #aabbccdd. */
const HEX_COLOUR = String.raw`#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})\b`;

/** ADR-2: the database is reachable from exactly one place. */
const CHOKEPOINT_IMPORTS = {
  group: ['drizzle-orm', 'drizzle-orm/*', 'pg', '@/db/client', '@/db/client/*'],
  message:
    'ADR-2: every database touch goes through the tenant chokepoint in src/db/scoped.ts. No raw queries outside src/db.',
};

/** Phase 11 §1: domain/ is pure business logic. */
const LAYERING_IMPORTS = {
  group: ['@/app/*', '@/components/*', 'next', 'next/*', 'react', 'react-dom', 'server-only'],
  message:
    'Phase 11 §1: domain/ is pure business logic. It never imports app/, components/, or framework code.',
};

export default tseslint.config(
  {
    ignores: [
      '.next/**',
      'node_modules/**',
      'coverage/**',
      'dist/**',
      'playwright-report/**',
      'test-results/**',
      'next-env.d.ts',
      'src/db/migrations/**',
    ],
  },

  ...next,
  ...nextCoreWebVitals,
  ...nextTypescript,

  {
    files: ['**/*.{ts,tsx,mts,cts}'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports', fixStyle: 'inline-type-imports' },
      ],
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      eqeqeq: ['error', 'always', { null: 'ignore' }],
      'no-console': ['warn', { allow: ['warn', 'error'] }],
    },
  },

  // ADR-2 / Phase 9 §5.2 — one data-access module owns every query.
  //
  // Both restricted-import blocks below configure the same rule name, and in
  // flat config the last matching block wins outright rather than merging. The
  // domain block therefore comes second and restates CHOKEPOINT_IMPORTS; adding
  // a pattern to one without the other silently disables it for domain files.
  {
    files: ['src/**/*.{ts,tsx}'],
    ignores: ['src/db/**'],
    rules: {
      'no-restricted-imports': ['error', { patterns: [CHOKEPOINT_IMPORTS] }],
    },
  },

  // Phase 11 §1 — the core must not depend on the shell around it.
  {
    files: ['src/domain/**/*.ts'],
    rules: {
      'no-restricted-imports': ['error', { patterns: [CHOKEPOINT_IMPORTS, LAYERING_IMPORTS] }],
    },
  },

  // Phase 10 §6/§9 — tokens ship as CSS variables; components reference them,
  // never raw colour values. globals.css is where the hex values legitimately live.
  {
    files: ['src/components/**/*.{ts,tsx}', 'src/app/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: `Literal[value=/${HEX_COLOUR}/]`,
          message:
            'Phase 10 §6: no raw hex. Use a design token (var(--green-600), the Tailwind theme colours) — semantic colour must carry meaning.',
        },
        {
          selector: `TemplateElement[value.raw=/${HEX_COLOUR}/]`,
          message:
            'Phase 10 §6: no raw hex. Use a design token (var(--green-600), the Tailwind theme colours) — semantic colour must carry meaning.',
        },
      ],
    },
  },

  {
    files: ['scripts/**/*.ts', 'e2e/**/*.ts', '*.config.{ts,mts,mjs}'],
    rules: {
      'no-console': 'off',
    },
  },

  prettier,
);
