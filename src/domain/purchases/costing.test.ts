/**
 * Bonus-cost honesty — Phase 13's named test for Day 6.
 *
 * The scheme purchase ("10+1") is the normal case in Pakistani pharmaceutical
 * distribution, not an edge case, so these are the arithmetic the owner's
 * margin figures rest on.
 */

import { describe, expect, it } from 'vitest';

import {
  costResidualPaisa,
  effectiveUnitCostPaisa,
  invoicedCostPaisa,
  receivedQty,
  unitMarginPaisa,
} from './costing';

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
});

describe('effectiveUnitCostPaisa', () => {
  it('spreads the paid amount across every unit received', () => {
    // 35,000 paisa ÷ 11 units = 3,181.8… → 3,181. Not 3,500.
    expect(effectiveUnitCostPaisa(TEN_PLUS_ONE)).toBe(3_181);
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

  it('never rounds in the shop’s favour', () => {
    // Flooring is deliberate: cost lands slightly low, so reported margin is
    // never better than reality. The reverse would flatter the owner, which is
    // the one direction a trust-first product cannot err in.
    const line = { qtyBase: 7, bonusQtyBase: 1, unitCostPaisa: 333 };
    const perUnit = effectiveUnitCostPaisa(line);
    expect(perUnit * receivedQty(line)).toBeLessThanOrEqual(invoicedCostPaisa(line));
  });
});

describe('costResidualPaisa', () => {
  it('exposes what the per-unit figure could not represent', () => {
    // 35,000 − (3,181 × 11) = 35,000 − 34,991 = 9 paisa.
    expect(costResidualPaisa(TEN_PLUS_ONE)).toBe(9);
  });

  it('is zero when the division is exact', () => {
    expect(costResidualPaisa({ qtyBase: 9, bonusQtyBase: 1, unitCostPaisa: 100 })).toBe(0);
  });

  it('is never negative, so cost is never overstated', () => {
    for (let qty = 1; qty <= 40; qty += 1) {
      for (let bonus = 0; bonus <= 5; bonus += 1) {
        const residual = costResidualPaisa({ qtyBase: qty, bonusQtyBase: bonus, unitCostPaisa: 977 });
        expect(residual, `qty ${qty} bonus ${bonus}`).toBeGreaterThanOrEqual(0);
        // And it is always smaller than one unit's worth, or the per-unit
        // figure would simply be wrong rather than rounded.
        expect(residual).toBeLessThan(qty + bonus);
      }
    }
  });
});

describe('unitMarginPaisa', () => {
  it('is larger on a scheme purchase than the invoice price suggests', () => {
    // Selling at Rs 40 against an invoiced Rs 35 looks like Rs 5 of margin.
    // The free unit makes it Rs 8.19 — the difference the owner is entitled to.
    expect(unitMarginPaisa(4_000, TEN_PLUS_ONE)).toBe(819);
    expect(unitMarginPaisa(4_000, { qtyBase: 10, bonusQtyBase: 0, unitCostPaisa: 3_500 })).toBe(500);
  });

  it('goes negative rather than hiding a loss', () => {
    expect(unitMarginPaisa(3_000, { qtyBase: 10, bonusQtyBase: 0, unitCostPaisa: 3_500 })).toBe(-500);
  });
});
