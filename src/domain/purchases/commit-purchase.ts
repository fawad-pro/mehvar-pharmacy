/**
 * `commitPurchase` — W7's one transaction.
 *
 * Receiving stock does three things that must happen together or not at all:
 *
 *  1. records the purchase and its lines (the invoice, as the distributor
 *     billed it);
 *  2. materializes a **batch per line** — the physical stock, at its own
 *     expiry, its own cost and its own selling price (D1 feeds from here);
 *  3. **answers the pending layer** (D2) — the sales that already went out
 *     against stock the system did not have.
 *
 * Step 3 is the one that closes Day 3's loop, and it is why this is a single
 * transaction rather than a purchase followed by a reconciliation job. A
 * delivery of 100 units against 20 already sold leaves 80 on the shelf, and
 * there must be no instant at which the database says otherwise.
 *
 * ## Online only, and that is deliberate
 *
 * ADR-3 scopes offline capture to "cash sales, udhaar sales, settlements, and
 * quick-item creation", and names purchases among the things that "require a
 * connection and say so calmly". This writer is therefore not in the sync
 * outbox — but it *is* idempotent on a client-generated id anyway, because a
 * flaky submit that receives a 20-line invoice twice would double the shop's
 * stock, and that is not a mistake anyone should have to notice to be protected
 * from.
 *
 * ## Bonus units
 *
 * A "10+1" line records qty 10 and bonus 1 on the purchase line — the invoice,
 * verbatim — and materializes a batch of 11 at the blended cost. See
 * `costing.ts` for why the blend is the honest figure and which direction its
 * rounding falls.
 */

import {
  findPurchaseById,
  insertBatches,
  insertPurchase,
  insertPurchaseLines,
  pendingAllocationsForProducts,
  resolveAllocation,
} from '@/db/purchase-queries';
import { consumeFromBatch } from '@/db/sales-queries';
import type { TenantScope } from '@/db/scoped';
import { uuidv7, type Uuid } from '@/lib/uuid';

import { planResolution, type ArrivedBatch } from '../inventory/resolve-pending';
import { effectiveUnitCostPaisa, receivedQty } from './costing';
import {
  effectiveCashPaidPaisa,
  validatePurchaseCommand,
  type PurchaseCommand,
  type PurchaseRejection,
} from './purchase-command';

export {
  validatePurchaseCommand,
  purchaseWarnings,
  invoiceCostPaisa,
  effectiveCashPaidPaisa,
  type PurchaseCommand,
  type PurchaseLineCommand,
  type PurchaseRejection,
  type PurchaseWarning,
} from './purchase-command';

export interface PurchaseCommitted {
  readonly purchaseId: Uuid;
  /** One per line, in line order. */
  readonly batchIds: readonly Uuid[];
  /** Units of already-sold stock this delivery accounted for (D2). */
  readonly resolvedPendingBase: number;
  /** Shortfalls this delivery could not cover — still visible as exceptions. */
  readonly stillPendingBase: number;
  readonly alreadyCommitted: boolean;
}

export type PurchaseResult =
  | { ok: true; value: PurchaseCommitted }
  | { ok: false; reason: PurchaseRejection; lineId?: Uuid };

export async function commitPurchase(
  scope: TenantScope,
  command: PurchaseCommand,
): Promise<PurchaseResult> {
  const validation = validatePurchaseCommand(command);
  if (!validation.ok) {
    return validation;
  }

  return scope.transaction(async (tx) => {
    const existing = await findPurchaseById(tx, command.purchaseId);
    if (existing) {
      // Delivered twice, received once. Same posture as `commitSale`.
      return {
        ok: true,
        value: {
          purchaseId: command.purchaseId,
          batchIds: [],
          resolvedPendingBase: 0,
          stillPendingBase: 0,
          alreadyCommitted: true,
        },
      } satisfies PurchaseResult;
    }

    await insertPurchase(tx, {
      id: command.purchaseId,
      supplierId: command.supplierId,
      invoiceRef: command.invoiceRef,
      invoiceDate: command.invoiceDate,
      note: command.note,
      cashPaidPaisa: effectiveCashPaidPaisa(command),
    });

    await insertPurchaseLines(
      tx,
      command.lines.map((line) => ({
        id: line.lineId,
        purchaseId: command.purchaseId,
        productId: line.productId,
        qtyBase: line.qtyBase,
        bonusQtyBase: line.bonusQtyBase,
        unitCostPaisa: line.unitCostPaisa,
        expiryDate: line.expiryDate,
        batchNumber: line.batchNumber,
        mrpAtReceivingPaisa: line.mrpAtReceivingPaisa,
        priceAtReceivingPaisa: line.priceAtReceivingPaisa,
      })),
    );

    // One batch per line: same product from two lines of one invoice can carry
    // different expiries and different costs, and merging them would destroy
    // exactly the distinction FEFO exists to act on.
    const batchIds: Uuid[] = [];
    const arrived: ArrivedBatch[] = [];
    const batchRows = command.lines.map((line) => {
      const batchId = uuidv7();
      batchIds.push(batchId);
      const received = receivedQty(line);
      const unitCost = effectiveUnitCostPaisa(line);

      arrived.push({
        batchId,
        productId: line.productId,
        qtyAvailableBase: received,
        unitCostPaisa: unitCost,
      });

      return {
        id: batchId,
        productId: line.productId,
        source: 'purchase_line' as const,
        sourceId: line.lineId,
        batchNumber: line.batchNumber,
        expiryDate: line.expiryDate,
        unitCostPaisa: unitCost,
        pricePerBaseUnitPaisa: line.priceAtReceivingPaisa,
        qtyReceivedBase: received,
        qtyRemainingBase: received,
      };
    });

    await insertBatches(tx, batchRows);

    // D2's other half.
    const productIds = [...new Set(command.lines.map((line) => line.productId))];
    const pending = await pendingAllocationsForProducts(tx, productIds);
    const plan = planResolution(pending, arrived);

    let resolvedPendingBase = 0;

    for (const resolution of plan.resolutions) {
      const moved = await resolveAllocation(tx, {
        allocationId: resolution.allocationId,
        batchId: resolution.batchId,
        unitCostPaisa: resolution.unitCostPaisa,
        purchaseLineId:
          batchRows.find((row) => row.id === resolution.batchId)?.sourceId ?? null,
        adjustmentId: null,
      });

      if (!moved) {
        // A concurrent delivery answered this shortfall first. The function
        // refuses anything no longer pending, so nothing was written — and the
        // batch must therefore *not* be decremented, since these units were
        // never owed to this sale. Skipping is the whole of the correction:
        // the stock simply stays on the shelf, which is the truth.
        continue;
      }

      // The resolved units are spoken for and never reached the shelf. This
      // keeps `qty_remaining` equal to what the ADR-8 contract derives, since
      // the allocation now counts against this batch.
      const consumed = await consumeFromBatch(tx, resolution.batchId, resolution.qtyBase);
      if (!consumed) {
        // Impossible unless something else consumed a batch this transaction
        // created moments ago and has not committed. Abort rather than leave a
        // resolved allocation whose stock was never taken.
        throw new StaleAllocationError(resolution.allocationId);
      }

      resolvedPendingBase += resolution.qtyBase;
    }

    return {
      ok: true,
      value: {
        purchaseId: command.purchaseId,
        batchIds,
        resolvedPendingBase,
        stillPendingBase: plan.stillPendingBase,
        alreadyCommitted: false,
      },
    } satisfies PurchaseResult;
  });
}

export class StaleAllocationError extends Error {
  constructor(allocationId: string) {
    super(`Pending allocation ${allocationId} changed under a locked read; the purchase was not received.`);
    this.name = 'StaleAllocationError';
  }
}
