/**
 * Bonus-cost honesty — Phase 13's named test for Day 6.
 *
 * The scheme purchase ("10+1") is the normal case in Pakistani pharmaceutical
 * distribution, not an edge case, so these are the arithmetic the owner's
 * margin figures rest on.
 */

import { describe, expect, it } from 'vitest';

import { effectiveUnitCostPaisa, invoicedCostPaisa, receivedQty, unitMarginPaisa } from './costing';

/** Ten strips at Rs 35.00, one free — the canonical distributor scheme. */
const TEN_PLUS_ONE = { qtyBase: 10, bonusQtyBase: 1, unitCostPaisa: 3_500 };

describe('receivedQty', () => {
  it('counts the bonus units, because they are on the shelf', () => {
    expect(receivedQty(TEN_PLUS_ONE)).toBe(11);
  });
});

describe('invoicedCostPaisa', () => {
  it('charges for the invoiced units only', () => {
    // The eleventh unit is free; billing for it would invent an expense.
    expect(invoicedCostPaisa(TEN_PLUS_ONE)).toBe(35_000);
  });

  it('is the plain product when there is no scheme', () => {
    expect(invoicedCostPaisa({ qtyBase: 10, bonusQtyBase: 0, unitCostPaisa: 3_500 })).toBe(35_000);
  });

  it('is exactly the invoice for a line bought per pack (PCN-012)', () => {
    // 10 boxes of 14 at Rs 250: Rs 2,500.00, not 140 × a rounded capsule cost.
    expect(
      invoicedCostPaisa({
        qtyBase: 140,
        bonusQtyBase: 0,
        unitCostPaisa: 1_786,
        lineCostPaisa: 250_000,
      }),
    ).toBe(250_000);
  });
});

describe('effectiveUnitCostPaisa', () => {
  it('spreads the paid amount across every unit received', () => {
    // 35,000 paisa ÷ 11 units = 3,181.8… → 3,182. Not 3,500.
    expect(effectiveUnitCostPaisa(TEN_PLUS_ONE)).toBe(3_182);
  });

  it('equals the invoiced cost when nothing came free', () => {
    expect(effectiveUnitCostPaisa({ qtyBase: 10, bonusQtyBase: 0, unitCostPaisa: 3_500 })).toBe(
      3_500,
    );
  });

  it('divides evenly when the scheme happens to divide evenly', () => {
    // 9 paid + 1 free at 100 = 900 ÷ 10 = 90 exactly.
    expect(effectiveUnitCostPaisa({ qtyBase: 9, bonusQtyBase: 1, unitCostPaisa: 100 })).toBe(90);
  });

  it('handles a wholly free consignment without dividing by zero', () => {
    // A sample or a replacement shipment: nothing paid, units received.
    expect(effectiveUnitCostPaisa({ qtyBase: 0, bonusQtyBase: 5, unitCostPaisa: 0 })).toBe(0);
    expect(effectiveUnitCostPaisa({ qtyBase: 0, bonusQtyBase: 0, unitCostPaisa: 0 })).toBe(0);
  });

  it('never understates cost — a low cost would report a margin better than the real one (PCN-012)', () => {
    // Day 6 floored this and claimed it kept margin honest; it did the
    // opposite. Rounded up, the per-unit figure covers what was paid, by less
    // than one paisa a unit.
    for (let qty = 1; qty <= 40; qty += 1) {
      for (let bonus = 0; bonus <= 5; bonus += 1) {
        const line = { qtyBase: qty, bonusQtyBase: bonus, unitCostPaisa: 977 };
        const covered = effectiveUnitCostPaisa(line) * receivedQty(line);
        expect(covered, `qty ${qty} bonus ${bonus}`).toBeGreaterThanOrEqual(
          invoicedCostPaisa(line),
        );
        expect(covered - invoicedCostPaisa(line)).toBeLessThan(receivedQty(line));
      }
    }
  });
});

describe('unitMarginPaisa', () => {
  it('is larger on a scheme purchase than the invoice price suggests', () => {
    // Selling at Rs 40 against an invoiced Rs 35 looks like Rs 5 of margin.
    // The free unit makes it Rs 8.18 — the difference the owner is entitled to.
    expect(unitMarginPaisa(4_000, TEN_PLUS_ONE)).toBe(818);
    expect(unitMarginPaisa(4_000, { qtyBase: 10, bonusQtyBase: 0, unitCostPaisa: 3_500 })).toBe(500);
  });

  it('goes negative rather than hiding a loss', () => {
    expect(unitMarginPaisa(3_000, { qtyBase: 10, bonusQtyBase: 0, unitCostPaisa: 3_500 })).toBe(-500);
  });
});
