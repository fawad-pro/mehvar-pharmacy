import { fileURLToPath } from 'node:url';

import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

/**
 * Unit and invariant suites — Phase 11 §3.
 *
 * The priority order this runner exists to serve:
 *   1. Rebuild equivalence (the crown)  — Session 3 / Day 3
 *   2. Transaction semantics            — Sessions 3, 4, 6
 *   3. Sync idempotency                 — Session 5 / Day 5
 *   4. Search ranking                   — Session 2 / Day 2
 * The single E2E path (§3.5) runs under Playwright, not here.
 *
 * "No unit-test theater around framework glue; no coverage targets."
 */
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.{ts,tsx}', 'tests/**/*.test.{ts,tsx}'],
    exclude: ['node_modules/**', '.next/**', 'e2e/**'],
    // Deterministic dates and money formatting: the suites assert exact strings.
    env: {
      TZ: 'UTC',
    },
  },
});
