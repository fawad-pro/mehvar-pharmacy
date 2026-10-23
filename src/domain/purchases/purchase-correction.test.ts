import { describe, expect, it } from 'vitest';

import { correctedLine, planCorrection } from './purchase-correction';

const entered = { qtyBase: 100, bonusQtyBase: 10, unitCostPaisa: 280 };

describe('what a purchase line says now (PCN-009)', () => {
  it('is the line as entered when nothing has corrected it', () => {
    expect(correctedLine(entered, [])).toEqual(entered);
  });

  it('applies every correction in order, the latest cost winning', () => {
    expect(
      correctedLine(entered, [
        { qtyDeltaBase: -10, bonusDeltaBase: 0, correctedUnitCostPaisa: 250 },
        { qtyDeltaBase: 0, bonusDeltaBase: 5, correctedUnitCostPaisa: null },
        { qtyDeltaBase: 2, bonusDeltaBase: 0, correctedUnitCostPaisa: 260 },
      ]),
    ).toEqual({ qtyBase: 92, bonusQtyBase: 15, unitCostPaisa: 260 });
  });
});

describe('planning a correction', () => {
  it('turns a mistyped cost into a cost correction and an invoice delta', () => {
    const result = planCorrection(entered, { ...entered, unitCostPaisa: 250 }, 'typo', 110);
    expect(result).toEqual({
      ok: true,
      plan: {
        qtyDeltaBase: 0,
        bonusDeltaBase: 0,
        correctedUnitCostPaisa: 250,
        // 100 × 250 over 110 received units, floored like every effective cost.
        effectiveUnitCostPaisa: 227,
        invoiceDeltaPaisa: -3_000,
        stockDeltaBase: 0,
      },
    });
  });

  it('moves stock by the quantity and bonus deltas together', () => {
    const result = planCorrection(
      entered,
      { ...entered, qtyBase: 90, bonusQtyBase: 12 },
      'short',
      110,
    );
    expect(result.ok && result.plan).toMatchObject({
      qtyDeltaBase: -10,
      bonusDeltaBase: 2,
      stockDeltaBase: -8,
      correctedUnitCostPaisa: null,
      invoiceDeltaPaisa: -2_800,
    });
  });

  it('refuses to remove units the batch no longer holds', () => {
    expect(planCorrection(entered, { ...entered, qtyBase: 50 }, 'short', 40)).toEqual({
      ok: false,
      reason: 'more_than_on_hand',
    });
  });

  it('allows adding units whatever the batch holds', () => {
    expect(planCorrection(entered, { ...entered, qtyBase: 120 }, 'extra came', 0).ok).toBe(true);
  });

  it('refuses a correction that changes nothing, or gives no reason', () => {
    expect(planCorrection(entered, entered, 'nothing', 110)).toEqual({
      ok: false,
      reason: 'no_change',
    });
    expect(planCorrection(entered, { ...entered, unitCostPaisa: 1 }, '   ', 110)).toEqual({
      ok: false,
      reason: 'note_required',
    });
  });

  it('refuses negative or fractional quantities and a negative cost', () => {
    expect(planCorrection(entered, { ...entered, qtyBase: -1 }, 'x', 110)).toEqual({
      ok: false,
      reason: 'invalid_quantity',
    });
    expect(planCorrection(entered, { ...entered, bonusQtyBase: 1.5 }, 'x', 110)).toEqual({
      ok: false,
      reason: 'invalid_quantity',
    });
    expect(planCorrection(entered, { ...entered, unitCostPaisa: -5 }, 'x', 110)).toEqual({
      ok: false,
      reason: 'negative_cost',
    });
  });
});
