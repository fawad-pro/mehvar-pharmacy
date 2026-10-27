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

import { effectiveUnitCostPaisa } from './costing';

/**
 * A purchase line as it stands, in the unit it was bought in. A line from
 * before PCN-012 was bought per base unit: `factor` 1, `entered` false. A line
 * bought per pack ("10 boxes at Rs 250") keeps its pack: its quantities stay
 * whole boxes and its cost stays per box, because no per-tablet figure holds a
 * box of 14 at Rs 250 exactly.
 */
export interface LineState {
  /** Invoiced units, in base units (always whole `factor`s). */
  readonly qtyBase: number;
  /** Free units, in base units (always whole `factor`s). */
  readonly bonusQtyBase: number;
  /** Base units in ONE of the line's unit. */
  readonly factor: number;
  /** The cost of ONE of the line's unit, as invoiced. */
  readonly unitCostPaisa: number;
  /** [PCN-012] Bought per pack: cost corrections are stated per that pack. */
  readonly entered: boolean;
}

/** A purchase line row's state, as received. */
export function lineStateOf(row: {
  readonly qtyBase: number;
  readonly bonusQtyBase: number;
  readonly unitCostPaisa: number;
  readonly unitCount?: number | null;
  readonly unitCostPaisaEntered?: number | null;
}): LineState {
  if (
    row.unitCount &&
    row.unitCostPaisaEntered !== null &&
    row.unitCostPaisaEntered !== undefined
  ) {
    return {
      qtyBase: row.qtyBase,
      bonusQtyBase: row.bonusQtyBase,
      factor: row.qtyBase / row.unitCount,
      unitCostPaisa: row.unitCostPaisaEntered,
      entered: true,
    };
  }
  return {
    qtyBase: row.qtyBase,
    bonusQtyBase: row.bonusQtyBase,
    factor: 1,
    unitCostPaisa: row.unitCostPaisa,
    entered: false,
  };
}

/** What the line costs: whole units of its own unit × that unit's cost. Exact. */
export function lineStateCostPaisa(state: LineState): number {
  return (state.qtyBase / state.factor) * state.unitCostPaisa;
}

export interface LineCorrection {
  readonly qtyDeltaBase: number;
  readonly bonusDeltaBase: number;
  readonly correctedUnitCostPaisa: number | null;
  readonly correctedUnitCostPaisaEntered?: number | null;
}

/** What a purchase line says now: as entered, then every correction in order. */
export function correctedLine(
  original: LineState,
  corrections: ReadonlyArray<LineCorrection>,
): LineState {
  let { qtyBase, bonusQtyBase, unitCostPaisa } = original;
  for (const correction of corrections) {
    qtyBase += correction.qtyDeltaBase;
    bonusQtyBase += correction.bonusDeltaBase;
    const correctedCost = original.entered
      ? correction.correctedUnitCostPaisaEntered
      : correction.correctedUnitCostPaisa;
    if (correctedCost !== null && correctedCost !== undefined) {
      unitCostPaisa = correctedCost;
    }
  }
  return { ...original, qtyBase, bonusQtyBase, unitCostPaisa };
}

export type CorrectionRejection =
  | 'no_change'
  | 'note_required'
  /** Negative, fractional, or not whole packs of the line's unit. */
  | 'invalid_quantity'
  | 'negative_cost'
  /** Fewer units than the batch still holds: they were sold or moved since. */
  | 'more_than_on_hand';

export interface CorrectionPlan {
  readonly qtyDeltaBase: number;
  readonly bonusDeltaBase: number;
  /** Set only when the cost of a per-base-unit line actually changes. */
  readonly correctedUnitCostPaisa: number | null;
  /** [PCN-012] Set only when the cost of a per-pack line actually changes. */
  readonly correctedUnitCostPaisaEntered: number | null;
  /** The batch's cost per received unit after this correction, nominal (rounded up). */
  readonly effectiveUnitCostPaisa: number;
  /** How much this correction moves the invoice's value, exactly. */
  readonly invoiceDeltaPaisa: number;
  /** Units the batch gains (positive) or loses (negative). */
  readonly stockDeltaBase: number;
}

/**
 * The deltas that take `current` to `target`, or why they cannot. `target`
 * states the line in its own unit: base quantities that are whole packs, and
 * the cost of one pack (of one base unit, for a line from before PCN-012).
 *
 * A reduction larger than the batch still holds is refused rather than driven
 * into the pending layer: the units already left — sold, adjusted or returned —
 * and saying "they never arrived" about units that were sold would be false.
 * The operator is pointed at a count correction instead (the message, not this
 * function, says so).
 */
export function planCorrection(
  current: LineState,
  target: {
    readonly qtyBase: number;
    readonly bonusQtyBase: number;
    readonly unitCostPaisa: number;
  },
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
    target.bonusQtyBase < 0 ||
    target.qtyBase % current.factor !== 0 ||
    target.bonusQtyBase % current.factor !== 0
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

  const next: LineState = { ...current, ...target };
  const nextCost = lineStateCostPaisa(next);
  return {
    ok: true,
    plan: {
      qtyDeltaBase,
      bonusDeltaBase,
      correctedUnitCostPaisa: costChanged && !current.entered ? target.unitCostPaisa : null,
      correctedUnitCostPaisaEntered: costChanged && current.entered ? target.unitCostPaisa : null,
      effectiveUnitCostPaisa: effectiveUnitCostPaisa({
        qtyBase: next.qtyBase,
        bonusQtyBase: next.bonusQtyBase,
        unitCostPaisa: 0,
        lineCostPaisa: nextCost,
      }),
      invoiceDeltaPaisa: nextCost - lineStateCostPaisa(current),
      stockDeltaBase,
    },
  };
}
