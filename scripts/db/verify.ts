/**
 * `db:verify` — runs the ADR-8 rebuild verifier against a database.
 *
 * Phase 12 §2.4 makes this a post-deploy step and §4 makes it a nightly one:
 * "a mismatch is sev-1: it means a derived number disagreed with the records,
 * which is precisely the promise the product sells."
 *
 * Read-only. Repair is a separate, deliberate act (see `repairBatches`).
 * Exits non-zero on any mismatch so it can gate a deploy.
 */
import 'dotenv/config';

import { verifyBatches } from '../../src/domain/inventory/rebuild';
import { tenantScope } from '../../src/db/scoped';
import { listTenantIds, anyUserId } from '../../src/db/provisioning';

async function main(): Promise<void> {
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL is not set.');
  }

  const tenantIds = await listTenantIds();
  if (tenantIds.length === 0) {
    console.log('No tenants to verify.');
    return;
  }

  let failed = false;

  for (const tenantId of tenantIds) {
    // The verifier reads; the acting user only satisfies the chokepoint's
    // contract, which requires attribution even for reads.
    const userId = await anyUserId(tenantId);
    if (!userId) {
      console.log(`${tenantId}: no users yet, skipping`);
      continue;
    }

    const report = await verifyBatches(tenantScope({ tenantId, userId }));
    const pending = Object.values(report.pendingByProduct).reduce((a, b) => a + b, 0);

    if (report.ok) {
      console.log(
        `${tenantId}: ok — ${report.batchesChecked} batches agree with the records` +
          (pending > 0 ? `, ${pending} base units pending (D2)` : ''),
      );
      continue;
    }

    failed = true;
    console.error(`${tenantId}: SEV-1 — the records and the cache disagree`);
    for (const mismatch of report.mismatches) {
      console.error(
        `  batch ${mismatch.batchId}: live ${mismatch.live}, records say ${mismatch.rebuilt}` +
          ` (off by ${mismatch.difference})`,
      );
    }
    for (const batchId of report.negativeBatches) {
      console.error(`  batch ${batchId}: negative quantity — invariant 2 is broken`);
    }
  }

  if (failed) {
    process.exit(1);
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
