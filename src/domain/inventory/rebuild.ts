/**
 * Rebuild and verify — ADR-8.
 *
 *   "A rebuild routine recomputes all running quantities from records; an
 *    automated verifier runs it against live values on schedule and after sync
 *    ingestion… any verifier mismatch is a sev-1 signal (it means the trust
 *    promise broke)."
 *
 * This module is where "numbers that can't lie" stops being a slogan. The
 * product keeps exactly one cached figure — `batches.qty_remaining` — and the
 * entire justification for keeping it is that this routine can prove it right
 * from the records at any moment.
 *
 * Phase 9 §4's derivation contract, verbatim:
 *
 *   qty_remaining = qty_received − Σ allocations − Σ negative batch adjustments
 *                   + Σ restocked returns
 *
 * The two sanctioned mutations in the system live in this directory (ADR-8), and
 * `repairBatches` is the second of them. It exists because a verifier that can
 * only report is a verifier someone eventually ignores — but it is deliberately
 * a separate, explicit call, never something the nightly check does on its own.
 */

import {
  batchLedger,
  pendingExposure,
  setBatchRemaining,
  type BatchLedgerRow,
} from '@/db/sales-queries';
import type { TenantScope } from '@/db/scoped';

export interface BatchMismatch {
  readonly batchId: string;
  readonly productId: string;
  readonly live: number;
  readonly rebuilt: number;
  readonly difference: number;
}

export interface VerificationReport {
  readonly batchesChecked: number;
  readonly mismatches: readonly BatchMismatch[];
  /** Batches whose cached quantity is negative — invariant 2 is broken. */
  readonly negativeBatches: readonly string[];
  /** Unresolved pending allocations per product (D2 exposure). */
  readonly pendingByProduct: Readonly<Record<string, number>>;
  readonly ok: boolean;
}

/** The quantity the records say a batch should have. */
export function rebuildQuantity(row: BatchLedgerRow): number {
  // `adjustedBase` carries *negative* adjustments only, so adding it subtracts
  // — see `batchLedger` for why the word "negative" in Phase 9 §4's contract is
  // load-bearing rather than incidental. In short: a positive adjustment
  // materializes a batch rather than adding to one, so its quantity arrives as
  // `qtyReceivedBase` and must not be counted a second time here.
  return row.qtyReceivedBase - row.allocatedBase + row.adjustedBase + row.restockedBase;
}

/**
 * Recomputes every batch from records and compares against the live cache.
 *
 * Read-only. Nothing is repaired here — a mismatch is a signal to investigate
 * before anything else ships (Phase 12 §4), and silently correcting it would
 * destroy the evidence of whatever caused it.
 */
export async function verifyBatches(scope: TenantScope): Promise<VerificationReport> {
  const ledger = await batchLedger(scope);
  const mismatches: BatchMismatch[] = [];
  const negativeBatches: string[] = [];

  for (const row of ledger) {
    const rebuilt = rebuildQuantity(row);
    if (rebuilt !== row.qtyRemainingLive) {
      mismatches.push({
        batchId: row.batchId,
        productId: row.productId,
        live: row.qtyRemainingLive,
        rebuilt,
        difference: row.qtyRemainingLive - rebuilt,
      });
    }
    if (row.qtyRemainingLive < 0) {
      negativeBatches.push(row.batchId);
    }
  }

  const pending = await pendingExposure(scope);
  const pendingByProduct: Record<string, number> = {};
  for (const row of pending) {
    pendingByProduct[row.productId] = row.qtyBase;
  }

  return {
    batchesChecked: ledger.length,
    mismatches,
    negativeBatches,
    pendingByProduct,
    ok: mismatches.length === 0 && negativeBatches.length === 0,
  };
}

/**
 * Writes rebuilt quantities over live ones.
 *
 * The second sanctioned mutation (ADR-8). Explicit and separate: an operator or
 * a recovery procedure invokes it deliberately, after the cause of a mismatch is
 * understood. Returns what it changed, so the repair itself leaves a record in
 * the operator's hands even though the batch rows carry no history of their own.
 */
export async function repairBatches(scope: TenantScope): Promise<BatchMismatch[]> {
  const report = await verifyBatches(scope);
  for (const mismatch of report.mismatches) {
    await setBatchRemaining(scope, mismatch.batchId, mismatch.rebuilt);
  }
  return [...report.mismatches];
}

/**
 * Stock per product, derived — Phase 5 invariant 1.
 *
 * "Always derivable, never stored as authority." Sums rebuilt quantities rather
 * than live ones on purpose: this is the figure that answers "what does the
 * ledger say", and asking the cache would make the answer circular.
 */
export async function derivedStock(scope: TenantScope): Promise<Map<string, number>> {
  const ledger = await batchLedger(scope);
  const stock = new Map<string, number>();

  for (const row of ledger) {
    stock.set(row.productId, (stock.get(row.productId) ?? 0) + rebuildQuantity(row));
  }

  // Pending consumption is stock the shop sold and did not have. It reduces the
  // honest figure, which is exactly what makes negative stock visible (D2)
  // rather than a batch quietly sitting at zero.
  for (const row of await pendingExposure(scope)) {
    stock.set(row.productId, (stock.get(row.productId) ?? 0) - row.qtyBase);
  }

  return stock;
}
