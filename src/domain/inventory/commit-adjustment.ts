/**
 * `commitAdjustment` — W8's writer, and W9's.
 *
 * One transaction covering three shapes that share a table:
 *
 *  - **Stock leaving** (damage, expiry, distributor return, a downward count
 *    correction): the named batch is decremented.
 *  - **Stock appearing** (opening stock, an upward count correction): a batch
 *    is materialized, per Phase 9 §4 — "positive opening/count deltas
 *    materialize batches".
 *  - **A count correction that answers the pending layer** (D2): stock the
 *    shelf had all along, which explains sales already made. Same resolution
 *    path a purchase takes, because it is the same fact — real stock arriving
 *    to account for units that already left.
 *
 * Phase 7's rule 2 applies in full: a salesman may adjust. "Visibility is the
 * control, not permission friction" (W8), and the daily view lists every
 * adjustment without exception (T1). Nothing here checks a role.
 */

import {
  findAdjustmentById,
  insertAdjustment,
  materializeAdjustmentBatch,
} from '@/db/adjustment-queries';
import {
  pendingAllocationsForProducts,
  productUnitsFor,
  resolveAllocation,
} from '@/db/purchase-queries';
import { consumeFromBatch } from '@/db/sales-queries';
import type { TenantScope } from '@/db/scoped';
import { uuidv7, type Uuid } from '@/lib/uuid';

import { planResolution } from './resolve-pending';
import {
  materializesBatch,
  validateAdjustment,
  type AdjustmentDraft,
  type AdjustmentRejection,
} from './adjustment';

export interface AdjustmentCommand extends AdjustmentDraft {
  /** Client-generated. Idempotency key, as everywhere else. */
  readonly adjustmentId: Uuid;
  /** Only used when the adjustment materializes a batch. */
  readonly expiryDate?: string | null;
  readonly batchNumber?: string | null;
  readonly unitCostPaisa?: number;
  readonly pricePerBaseUnitPaisa?: number;
  /**
   * [PCN-012] What the new batch's units cost in total, exactly — opening
   * stock counted as boxes, strips and tablets and costed per box. When set,
   * `unitCostPaisa` is derived from it (rounded up, nominal).
   */
  readonly costTotalPaisa?: number;
}

export interface AdjustmentCommitted {
  readonly adjustmentId: Uuid;
  /** Set when the adjustment brought a batch into existence. */
  readonly batchId: Uuid | null;
  readonly resolvedPendingBase: number;
  readonly alreadyCommitted: boolean;
}

export type AdjustmentResult =
  | { ok: true; value: AdjustmentCommitted }
  | { ok: false; reason: AdjustmentRejection | 'stale_batch_state' };

export async function commitAdjustment(
  scope: TenantScope,
  command: AdjustmentCommand,
): Promise<AdjustmentResult> {
  const validation = validateAdjustment(command);
  if (!validation.ok) {
    return validation;
  }
  // [PCN-012] "3 strip" means 3 × the product's strip, never a size the
  // screen guessed: the entered unit must be one the product has, at its size.
  if (command.entered) {
    const unit = (await productUnitsFor(scope, [command.productId]))
      .get(command.productId)
      ?.find((candidate) => candidate.key === command.entered?.unitKey);
    if (!unit || unit.factor * command.entered.unitCount !== Math.abs(command.qtyBaseDelta)) {
      return { ok: false, reason: 'invalid_unit' };
    }
  }

  try {
    return await scope.transaction((tx) => writeAdjustment(tx, command));
  } catch (error) {
    if (error instanceof AdjustmentRefused) {
      return { ok: false, reason: 'stale_batch_state' };
    }
    throw error;
  }
}

/**
 * Thrown, never returned, when a guarded decrement is refused. Returning a
 * rejection from inside `scope.transaction` COMMITS it: the adjustment row
 * written a moment earlier stays, the batch keeps its units, and the records
 * disagree with the shelf (ADR-8 mismatch). Throwing rolls the whole thing
 * back, which is what `commitSale` has always done with the same refusal.
 */
class AdjustmentRefused extends Error {
  constructor(batchId: string) {
    super(`Batch ${batchId} does not have the units this adjustment removes.`);
    this.name = 'AdjustmentRefused';
  }
}

async function writeAdjustment(
  tx: TenantScope,
  command: AdjustmentCommand,
): Promise<AdjustmentResult> {
  const existing = await findAdjustmentById(tx, command.adjustmentId);
  if (existing) {
    return {
      ok: true,
      value: {
        adjustmentId: command.adjustmentId,
        batchId: existing.batchId,
        resolvedPendingBase: 0,
        alreadyCommitted: true,
      },
    } satisfies AdjustmentResult;
  }

  const creating = materializesBatch(command);
  const batchId = creating ? uuidv7() : null;
  const received = command.qtyBaseDelta;
  const costTotal =
    command.costTotalPaisa !== undefined &&
    Number.isSafeInteger(command.costTotalPaisa) &&
    command.costTotalPaisa >= 0
      ? command.costTotalPaisa
      : null;
  const unitCost =
    costTotal !== null && received > 0
      ? Math.ceil(costTotal / received)
      : (command.unitCostPaisa ?? 0);

  // The batch goes in first when there is one to create. The reference runs
  // both ways but only one of them is enforced: `adjustments.batch_id` is a
  // real foreign key, while `batches.source_id` is polymorphic (Phase 9 §4's
  // `source` + `source_id`) and carries none. So the batch can name an
  // adjustment that does not exist yet; the adjustment cannot name a batch
  // that does not.
  if (creating && batchId) {
    await materializeAdjustmentBatch(tx, {
      id: batchId,
      productId: command.productId,
      sourceId: command.adjustmentId,
      batchNumber: command.batchNumber ?? null,
      expiryDate: command.expiryDate ?? null,
      unitCostPaisa: unitCost,
      pricePerBaseUnitPaisa: command.pricePerBaseUnitPaisa ?? 0,
      qtyReceivedBase: received,
      qtyRemainingBase: received,
      costTotalPaisa: costTotal,
    });
  }

  await insertAdjustment(tx, {
    id: command.adjustmentId,
    productId: command.productId,
    // A materializing adjustment names the batch it created; a reducing one
    // names the batch it took from.
    batchId: creating ? batchId : command.batchId,
    qtyBaseDelta: command.qtyBaseDelta,
    reason: command.reason,
    note: command.note,
    ...(command.entered
      ? {
          unitKey: command.entered.unitKey,
          unitName: command.entered.unitName,
          unitCount: command.entered.unitCount,
        }
      : {}),
  });

  let resolvedPendingBase = 0;

  if (creating && batchId) {
    // D2: stock that turned out to exist can answer for sales already made.
    // A count correction is the canonical case — the shelf had it, the
    // system did not, and someone sold it.
    const pending = await pendingAllocationsForProducts(tx, [command.productId]);
    const plan = planResolution(pending, [
      {
        batchId,
        productId: command.productId,
        qtyAvailableBase: received,
        unitCostPaisa: unitCost,
      },
    ]);

    for (const resolution of plan.resolutions) {
      const moved = await resolveAllocation(tx, {
        allocationId: resolution.allocationId,
        batchId: resolution.batchId,
        unitCostPaisa: resolution.unitCostPaisa,
        purchaseLineId: null,
        adjustmentId: command.adjustmentId,
      });
      if (!moved) {
        // Another delivery or correction answered this shortfall first. The
        // units stay on the shelf; nothing to record. See `commitPurchase`.
        continue;
      }
      const consumed = await consumeFromBatch(tx, resolution.batchId, resolution.qtyBase);
      if (!consumed) {
        throw new AdjustmentRefused(resolution.batchId);
      }
      resolvedPendingBase += resolution.qtyBase;
    }
  } else if (command.batchId) {
    // Stock leaving. Guarded so a batch can never be driven negative —
    // Phase 5 invariant 2 — even if the caller's view was stale.
    const consumed = await consumeFromBatch(tx, command.batchId, -command.qtyBaseDelta);
    if (!consumed) {
      throw new AdjustmentRefused(command.batchId);
    }
  }

  return {
    ok: true,
    value: {
      adjustmentId: command.adjustmentId,
      batchId,
      resolvedPendingBase,
      alreadyCommitted: false,
    },
  } satisfies AdjustmentResult;
}
