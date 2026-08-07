/**
 * `db:verify` — runs the ADR-8 rebuild verifier against a database.
 *
 * Phase 12 §2.4 makes this a post-deploy step and §4 makes it a nightly one:
 * "a mismatch is sev-1: it means a derived number disagreed with the records,
 * which is precisely the promise the product sells."
 *
 * Read-only. Repair is a separate, deliberate act (see `repairBatches`).
 * Exits non-zero on any mismatch so it can gate a deploy.
 *
 * The verification itself lives in `verify-all.ts` so `ops:restore-drill` can
 * call it against a restored scratch database without spawning this CLI.
 */
import 'dotenv/config';

import { verifyAllTenants } from './verify-all';

async function main(): Promise<void> {
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL is not set.');
  }

  if (!(await verifyAllTenants())) {
    process.exit(1);
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
