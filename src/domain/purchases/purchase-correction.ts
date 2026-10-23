/**
 * [PCN-009] Correcting a received purchase line — the pure half.
 *
 * A mistyped purchase line used to be permanent: `count_correction` could put
 * the stock right, but a wrong unit cost distorted margin on every unit sold
 * from that batch and a wrong quantity or cost misstated what the shop owed the
 * supplier, forever. T2 promises a compensating entry; this is it.
 *
 * The operator states what the line SHOULD have said (quantity, bonus, unit
 * cost), never a delta to work out in their head. The writer turns that into
 * deltas against the line's current corrected state, inside the transaction
 * that holds the batch, so two corrections can never be computed against the
 * same stale picture.
 */

import { effectiveUnitCostPaisa, type PurchasedQuantity } from './costing';

/** What a purchase line says now: as entered, then every correction in order. */
export function correctedLine(
  original: PurchasedQuantity,
  corrections: ReadonlyArray<{
    readonly qtyDeltaBase: number;
    readonly bonusDeltaBase: number;
    readonly correctedUnitCostPaisa: number | null;
  }>,
): PurchasedQuantity {
  let { qtyBase, bonusQtyBase, unitCostPaisa } = original;
  for (const correction of corrections) {
    qtyBase += correction.qtyDeltaBase;
    bonusQtyBase += correction.bonusDeltaBase;
    if (correction.correctedUnitCostPaisa !== null) {
      unitCostPaisa = correction.correctedUnitCostPaisa;
    }
  }
  return { qtyBase, bonusQtyBase, unitCostPaisa };
}

export type CorrectionRejection =
  | 'no_change'
  | 'note_required'
  | 'invalid_quantity'
  | 'negative_cost'
  /** Fewer units than the batch still holds: they were sold or moved since. */
  | 'more_than_on_hand';

export interface CorrectionPlan {
  readonly qtyDeltaBase: number;
  readonly bonusDeltaBase: number;
  /** Set only when the cost actually changes. */
  readonly correctedUnitCostPaisa: number | null;
  /** The batch's cost per received unit after this correction, bonus included. */
  readonly effectiveUnitCostPaisa: number;
  /** How much this correction moves the invoice's value. */
  readonly invoiceDeltaPaisa: number;
  /** Units the batch gains (positive) or loses (negative). */
  readonly stockDeltaBase: number;
}

/**
 * The deltas that take `current` to `target`, or why they cannot.
 *
 * A reduction larger than the batch still holds is refused rather than driven
 * into the pending layer: the units already left — sold, adjusted or returned —
 * and saying "they never arrived" about units that were sold would be false.
 * The operator is pointed at a count correction instead (the message, not this
 * function, says so).
 */
export function planCorrection(
  current: PurchasedQuantity,
  target: PurchasedQuantity,
  note: string,
  batchRemainingBase: number,
): { ok: true; plan: CorrectionPlan } | { ok: false; reason: CorrectionRejection } {
  if (note.trim() === '') {
    return { ok: false, reason: 'note_required' };
  }
  if (
    !Number.isInteger(target.qtyBase) ||
    !Number.isInteger(target.bonusQtyBase) ||
    target.qtyBase < 0 ||
    target.bonusQtyBase < 0
  ) {
    return { ok: false, reason: 'invalid_quantity' };
  }
  if (!Number.isInteger(target.unitCostPaisa) || target.unitCostPaisa < 0) {
    return { ok: false, reason: 'negative_cost' };
  }

  const qtyDeltaBase = target.qtyBase - current.qtyBase;
  const bonusDeltaBase = target.bonusQtyBase - current.bonusQtyBase;
  const costChanged = target.unitCostPaisa !== current.unitCostPaisa;
  if (qtyDeltaBase === 0 && bonusDeltaBase === 0 && !costChanged) {
    return { ok: false, reason: 'no_change' };
  }

  const stockDeltaBase = qtyDeltaBase + bonusDeltaBase;
  if (stockDeltaBase < 0 && -stockDeltaBase > batchRemainingBase) {
    return { ok: false, reason: 'more_than_on_hand' };
  }

  return {
    ok: true,
    plan: {
      qtyDeltaBase,
      bonusDeltaBase,
      correctedUnitCostPaisa: costChanged ? target.unitCostPaisa : null,
      effectiveUnitCostPaisa: effectiveUnitCostPaisa(target),
      invoiceDeltaPaisa:
        target.qtyBase * target.unitCostPaisa - current.qtyBase * current.unitCostPaisa,
      stockDeltaBase,
    },
  };
}
