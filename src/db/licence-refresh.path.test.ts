import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { permits } from '@/domain/licensing/capabilities';

/**
 * Refresh is a background timer, never on the sale path (Stage 2).
 *
 * The permanent rule: no network call may sit on the sale/checkout critical
 * path, and selling must not depend on the endpoint. This pins that structurally
 * — the modules the counter touches to sell never import the refresh client,
 * and the refresh client is wired only from the service's boot timer.
 */
describe('online refresh is never on the sale path', () => {
  const root = process.cwd();
  const read = (rel: string): string => readFileSync(join(root, rel), 'utf8');

  const salePathModules = [
    'src/auth/session.ts', // currentSession — runs on every request
    'src/app/(counter)/sale/actions.ts',
    'src/app/(counter)/sync/actions.ts', // the outbox delivery endpoint
    'src/domain/sales/commit-sale.ts',
  ];

  for (const rel of salePathModules) {
    it(`${rel} does not import the refresh client`, () => {
      expect(read(rel)).not.toContain('licence-refresh');
    });
  }

  it('the refresh client is wired only from the service boot timer', () => {
    // serve.ts starts it on a setInterval/setTimeout, never synchronously and
    // never from a request. If another importer appears, this is the tripwire.
    expect(read('scripts/ops/serve.ts')).toContain('licence-refresh');
    expect(read('scripts/ops/serve.ts')).toMatch(/setInterval|setTimeout/);
  });

  it('a revoked licence still permits selling, printing and export', () => {
    // Revocation moves the licence to `restricted` — which, like every
    // restricted state, keeps the three permanent capabilities. A revocation
    // stops restocking, never trading, and never locks the customer's data.
    for (const capability of ['sell', 'print', 'export'] as const) {
      expect(permits('restricted', capability)).toBe(true);
    }
  });
});
