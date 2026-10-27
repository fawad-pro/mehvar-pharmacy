import { describe, expect, it } from 'vitest';

import { baseQty, InvalidUnitError, packFactor, paisa } from './branded';
import {
  addQty,
  costOfBaseUnits,
  decomposeQuantity,
  describeQuantity,
  findLevel,
  levelToBaseUnits,
  subtractQty,
  toBaseUnits,
  unitLevels,
  type PackLevel,
} from './quantity';

// A typical medicine: strip of 10 tablets, box of 10 strips (Phase 9 §2 shape).
const PACK_LEVELS: PackLevel[] = [
  { name: 'strip', factor: 10 },
  { name: 'box', factor: 100 },
];

describe('base-unit conversion', () => {
  it('converts pack counts into base units', () => {
    expect(toBaseUnits(3, packFactor(10))).toBe(30);
    expect(levelToBaseUnits(2, { name: 'box', factor: 100 })).toBe(200);
  });

  it('rejects fractional pack counts', () => {
    expect(() => toBaseUnits(1.5, packFactor(10))).toThrow(RangeError);
  });

  it('rejects non-positive pack factors', () => {
    expect(() => packFactor(0)).toThrow(InvalidUnitError);
  });

  it('sums and subtracts in base units only', () => {
    // "3 strips + 4 tablets" is 34 tablets — Phase 5 §2.
    const quantity = addQty(toBaseUnits(3, packFactor(10)), baseQty(4));
    expect(quantity).toBe(34);
    expect(subtractQty(quantity, baseQty(4))).toBe(30);
  });
});

describe('unit levels', () => {
  it('lists base first, ascending — the order Tab cycles through (Phase 10 §4)', () => {
    expect(unitLevels('tab', PACK_LEVELS).map((level) => level.name)).toEqual([
      'tab',
      'strip',
      'box',
    ]);
  });

  it('resolves a level by name, including the base unit', () => {
    expect(findLevel('tab', 'tab', PACK_LEVELS)?.factor).toBe(1);
    expect(findLevel('strip', 'tab', PACK_LEVELS)?.factor).toBe(10);
    expect(findLevel('carton', 'tab', PACK_LEVELS)).toBeUndefined();
  });
});

describe('natural-language quantity (W5, Phase 10 §4)', () => {
  it('renders the cart string', () => {
    expect(describeQuantity(baseQty(34), 'tab', PACK_LEVELS)).toBe('3 strip, 4 tab');
    expect(describeQuantity(baseQty(1_237), 'tab', PACK_LEVELS)).toBe('12 box, 3 strip, 7 tab');
    expect(describeQuantity(baseQty(100), 'tab', PACK_LEVELS)).toBe('1 box');
    expect(describeQuantity(baseQty(7), 'tab', PACK_LEVELS)).toBe('7 tab');
  });

  it('handles single-level products (general retail goods, Phase 5 §2)', () => {
    expect(describeQuantity(baseQty(3), 'piece')).toBe('3 piece');
  });

  it('renders zero in base units rather than blank', () => {
    expect(describeQuantity(baseQty(0), 'tab', PACK_LEVELS)).toBe('0 tab');
  });

  it('says "Short by" below zero, never a minus sign (PCN-012, D2 exposure)', () => {
    expect(describeQuantity(baseQty(-14), 'tab', PACK_LEVELS)).toBe('Short by 1 strip, 4 tab');
    expect(describeQuantity(baseQty(-20), 'tab', PACK_LEVELS)).toBe('Short by 2 strip');
    expect(decomposeQuantity(baseQty(-14), 'tab', PACK_LEVELS)).toEqual([
      { level: { name: 'strip', factor: 10 }, count: -1 },
      { level: { name: 'tab', factor: 1 }, count: -4 },
    ]);
  });
});

describe('costOfBaseUnits (PCN-012)', () => {
  it('costs whole packs exactly and a remainder once, rounded up', () => {
    // Rs 250 a box of 10 strips × 10 tablets: 2 boxes + 3 strips + 4 tablets
    // = 234 tablets = Rs 585.00 exactly.
    expect(costOfBaseUnits(paisa(25_000), packFactor(100), baseQty(234))).toBe(58_500);
    // A box of 14 at Rs 250, 3 capsules: 5,357.14… → 5,358, never less.
    expect(costOfBaseUnits(paisa(25_000), packFactor(14), baseQty(3))).toBe(5_358);
  });

  it('is zero for nothing, and refuses a negative', () => {
    expect(costOfBaseUnits(paisa(25_000), packFactor(14), baseQty(0))).toBe(0);
    expect(() => costOfBaseUnits(paisa(25_000), packFactor(14), baseQty(-1))).toThrow(RangeError);
  });
});
