/**
 * FEFO allocation planning — D1 and D2, pure.
 *
 *   D1: "Sales consume stock from the earliest-expiry batch first,
 *        automatically. The salesman sees the price, not the batch."
 *   D2: "Stock may go negative; sales are never blocked. Consumption is
 *        recorded against a *pending layer*, and the discrepancy surfaces in the
 *        owner's daily view."
 *   PCN-008: expired batches are consumed only when nothing unexpired is left.
 *        Earliest-expiry-first alone would always reach for an expired batch
 *        first, because an expired batch is always the earliest.
 *
 * Planning is separated from writing on purpose. The rule that decides which
 * batch a tablet came from is the single most consequential piece of arithmetic
 * in the product — it determines expiry discipline, margin, and whether the
 * owner's stock figure can be believed — so it is a pure function over a list,
 * testable exhaustively, with no database in sight. `commitSale` applies the
 * plan inside its transaction (ADR-5).
 */

import { baseQty, type BaseQty } from '@/lib/branded';

export interface BatchAvailability {
  readonly batchId: string;
  /** ISO date, or null for non-perishables (Phase 9 §4). */
  readonly expiryDate: string | null;
  readonly createdAt: Date;
  readonly qtyRemainingBase: number;
  readonly unitCostPaisa: number;
  readonly pricePerBaseUnitPaisa: number;
}

export interface PlannedAllocation {
  /** Null marks the pending layer — stock the system did not have (D2). */
  readonly batchId: string | null;
  readonly qtyBase: BaseQty;
  /** From the batch; null while pending, per Phase 9 §3. */
  readonly unitCostPaisa: number | null;
  /** The batch's own price, for D1's variance display. Null when pending. */
  readonly batchPricePaisa: number | null;
}

export interface AllocationPlan {
  readonly allocations: readonly PlannedAllocation[];
  /** Base units that had no batch to come from. Zero in the normal case. */
  readonly pendingQtyBase: number;
}

/**
 * FEFO order — Phase 9 §4, verbatim: `expiry_date ASC NULLS LAST, created_at ASC`.
 *
 * NULLS LAST is not incidental. A non-perishable with no expiry must not sort
 * ahead of a syrup expiring next month, or the shelf quietly rots while the
 * system sells the wrong thing first.
 */
export function fefoOrder(a: BatchAvailability, b: BatchAvailability): number {
  if (a.expiryDate !== b.expiryDate) {
    if (a.expiryDate === null) return 1;
    if (b.expiryDate === null) return -1;
    return a.expiryDate < b.expiryDate ? -1 : 1;
  }
  const byCreation = a.createdAt.getTime() - b.createdAt.getTime();
  if (byCreation !== 0) {
    return byCreation;
  }
  // Total order, so a plan is reproducible: two batches created in the same
  // millisecond must still allocate in a fixed sequence, or the rebuild
  // verifier could disagree with live values for no real reason.
  return a.batchId < b.batchId ? -1 : a.batchId > b.batchId ? 1 : 0;
}

/**
 * PCN-008: expired when the expiry date is before the business day. A batch
 * with no expiry never expires. Both are ISO dates, so text order is date order.
 */
export function isExpired(batch: Pick<BatchAvailability, 'expiryDate'>, today: string): boolean {
  return batch.expiryDate !== null && batch.expiryDate < today;
}

/**
 * Plans consumption of `qtyBase` from the batches on hand.
 *
 * Unexpired batches first, in FEFO order; then expired ones, in FEFO order
 * (PCN-008); then the pending layer. `today` is the business day (ISO date) and
 * is required, because forgetting it is exactly how expired stock was sold
 * first.
 *
 * Never fails and never returns short: any quantity the batches cannot cover
 * becomes one pending allocation, because P2 says the sale proceeds and D2 says
 * the shortfall is recorded visibly rather than silently.
 */
export function planAllocation(
  available: readonly BatchAvailability[],
  qtyBase: BaseQty,
  today: string,
): AllocationPlan {
  if (qtyBase <= 0) {
    return { allocations: [], pendingQtyBase: 0 };
  }

  const inStock = [...available].filter((batch) => batch.qtyRemainingBase > 0);
  const ordered = [
    ...inStock.filter((batch) => !isExpired(batch, today)).sort(fefoOrder),
    ...inStock.filter((batch) => isExpired(batch, today)).sort(fefoOrder),
  ];

  const allocations: PlannedAllocation[] = [];
  let outstanding: number = qtyBase;

  for (const batch of ordered) {
    if (outstanding === 0) {
      break;
    }
    const take = Math.min(outstanding, batch.qtyRemainingBase);
    allocations.push({
      batchId: batch.batchId,
      qtyBase: baseQty(take),
      unitCostPaisa: batch.unitCostPaisa,
      batchPricePaisa: batch.pricePerBaseUnitPaisa,
    });
    outstanding -= take;
  }

  if (outstanding > 0) {
    // One pending row for the whole shortfall, not one per missing unit. It
    // resolves as a unit when a purchase or count correction arrives (Day 6).
    allocations.push({
      batchId: null,
      qtyBase: baseQty(outstanding),
      unitCostPaisa: null,
      batchPricePaisa: null,
    });
  }

  return { allocations, pendingQtyBase: outstanding };
}

/**
 * The price the consuming batch carries, for D1's "shows it plainly" duty.
 *
 * ADR-5 settles what this is *for*: the customer is charged the client's
 * last-known price, and "final allocation may adjust recorded margin, never the
 * customer's charged price". So a difference here is a variance the owner sees
 * in the daily view — never a repricing at the counter.
 */
export function consumingBatchPrice(plan: AllocationPlan): number | null {
  return (
    plan.allocations.find((allocation) => allocation.batchPricePaisa !== null)?.batchPricePaisa ??
    null
  );
}

export function allocatedQty(plan: AllocationPlan): number {
  return plan.allocations.reduce((sum, allocation) => sum + allocation.qtyBase, 0);
}
