/**
 * The ADR-8 rebuild verifier, as a callable function.
 *
 * Split out of `verify.ts` so two callers can share it: the `db:verify` CLI,
 * and `ops:restore-drill`, which must verify a *restored scratch database*
 * rather than the live one.
 *
 * The split exists for a specific reason. The drill originally spawned the CLI
 * as a child process with an overridden `DATABASE_URL`; that requires `tsx` and
 * a `node_modules` tree, neither of which exists in a packaged install (the
 * standalone build has no `node_modules`). Calling a function after setting the
 * environment works in both a dev checkout and a shop.
 *
 * Read-only. Repair is a separate, deliberate act (see `repairBatches`).
 */

import { anyUserId, listTenantIds } from '../../src/db/provisioning';
import { tenantScope } from '../../src/db/scoped';
import { verifyBatches } from '../../src/domain/inventory/rebuild';

/** True when every tenant's cache agrees with its records. */
export async function verifyAllTenants(): Promise<boolean> {
  const tenantIds = await listTenantIds();
  if (tenantIds.length === 0) {
    console.log('No tenants to verify.');
    return true;
  }

  let ok = true;

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

    ok = false;
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

  return ok;
}
