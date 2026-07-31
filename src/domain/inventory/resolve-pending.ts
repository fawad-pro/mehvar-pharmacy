/**
 * Pending-layer resolution planning — D2, pure.
 *
 *   "When the missing purchase is later entered or a count correction made,
 *    pending consumption resolves against real batches. Negative stock is a
 *    visible exception state, never a silent one."
 *
 * This is the second half of the promise Day 3 made. A sale that outran stock
 * recorded a pending allocation — a row saying "these units left the shelf and
 * we do not know where they came from". Today the missing purchase arrives and
 * those rows get an answer.
 *
 * Planning is separated from writing for the same reason `allocation.ts` is:
 * the rule deciding which shortfall a newly-arrived batch answers determines
 * the owner's stock figure and every margin number downstream, so it is a pure
 * function over a list, exhaustively testable, with no database in sight.
 *
 * ## Why oldest-first, and why it is not FEFO
 *
 * `planAllocation` orders *batches* by expiry, because the question there is
 * "which stock should leave the shelf first". The question here is the reverse:
 * "which already-departed units should this arrival account for", and expiry
 * has nothing to say about it — the units are gone. Oldest pending first is
 * simply chronology: the earliest unexplained sale gets explained first.
 *
 * ## What resolution does to the arithmetic
 *
 * Resolving points a pending row at a real batch, which makes it count toward
 * that batch's `Σ allocations` in the ADR-8 derivation contract. So a delivery
 * of 100 units against 20 pending leaves 80 remaining, immediately and by
 * derivation rather than by a second bookkeeping step. That is why the writer
 * must decrement the batch in the same transaction — see `commitResolution`.
 */

import { baseQty, type BaseQty } from '@/lib/branded';

/** A pending allocation as the resolver needs to see it. */
export interface PendingAllocation {
  readonly allocationId: string;
  readonly saleLineId: string;
  readonly productId: string;
  readonly qtyBase: number;
  /** When the sale happened — the ordering key. */
  readonly createdAt: Date;
}

/** Newly arrived stock available to answer for it. */
export interface ArrivedBatch {
  readonly batchId: string;
  readonly productId: string;
  readonly qtyAvailableBase: number;
  readonly unitCostPaisa: number;
}

export interface PlannedResolution {
  readonly allocationId: string;
  readonly batchId: string;
  readonly qtyBase: BaseQty;
  readonly unitCostPaisa: number;
}

export interface ResolutionPlan {
  readonly resolutions: readonly PlannedResolution[];
  /** Units of the arrival left over after answering what it could. */
  readonly remainingByBatch: Readonly<Record<string, number>>;
  /** Pending units still unexplained — the delivery was smaller than the hole. */
  readonly stillPendingBase: number;
}

/**
 * Chronological, with a total order so the plan is reproducible.
 *
 * The tiebreak matters for the same reason it does in `fefoOrder`: two sales in
 * the same millisecond must resolve in a fixed sequence, or two runs of the
 * rebuild verifier could disagree for no real reason.
 */
export function pendingOrder(a: PendingAllocation, b: PendingAllocation): number {
  const byTime = a.createdAt.getTime() - b.createdAt.getTime();
  if (byTime !== 0) {
    return byTime;
  }
  return a.allocationId < b.allocationId ? -1 : a.allocationId > b.allocationId ? 1 : 0;
}

/**
 * Plans which pending allocations the arrived stock can answer for.
 *
 * **A pending row is resolved whole or not at all.** Splitting one across two
 * batches would mean either mutating its quantity — which ADR-1 forbids on an
 * event row — or inserting a second allocation the original sale never made.
 * A shortfall too large for this delivery simply waits for the next one, which
 * is honest: it stays visible in the exception list until real stock covers it.
 */
export function planResolution(
  pending: readonly PendingAllocation[],
  arrived: readonly ArrivedBatch[],
): ResolutionPlan {
  const remaining: Record<string, number> = {};
  for (const batch of arrived) {
    remaining[batch.batchId] = batch.qtyAvailableBase;
  }

  const byProduct = new Map<string, ArrivedBatch[]>();
  for (const batch of arrived) {
    byProduct.set(batch.productId, [...(byProduct.get(batch.productId) ?? []), batch]);
  }

  const resolutions: PlannedResolution[] = [];
  let stillPending = 0;

  for (const allocation of [...pending].sort(pendingOrder)) {
    const candidates = byProduct.get(allocation.productId) ?? [];
    const batch = candidates.find(
      (candidate) => (remaining[candidate.batchId] ?? 0) >= allocation.qtyBase,
    );

    if (!batch) {
      stillPending += allocation.qtyBase;
      continue;
    }

    resolutions.push({
      allocationId: allocation.allocationId,
      batchId: batch.batchId,
      qtyBase: baseQty(allocation.qtyBase),
      unitCostPaisa: batch.unitCostPaisa,
    });
    remaining[batch.batchId] = (remaining[batch.batchId] ?? 0) - allocation.qtyBase;
  }

  return { resolutions, remainingByBatch: remaining, stillPendingBase: stillPending };
}

/** Units this plan takes out of a given arrival — what the batch must be decremented by. */
export function consumedFromBatch(plan: ResolutionPlan, batchId: string): number {
  return plan.resolutions
    .filter((resolution) => resolution.batchId === batchId)
    .reduce((sum, resolution) => sum + resolution.qtyBase, 0);
}
