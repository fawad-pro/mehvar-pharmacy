import { describe, expect, it } from 'vitest';

import { packFactor, paisa } from '@/lib/branded';
import { scalePriceBetweenUnits } from '@/lib/quantity';

import { defaultSaleUnit, legacyPricePerBase, unitsFromEnteredPrices, unitsOf } from './units';

const panadol = [
  { name: 'tab', factor: 1 },
  { name: 'strip', factor: 10 },
  { name: 'box', factor: 100 },
];

describe('scalePriceBetweenUnits (PCN-012)', () => {
  it('a larger unit from a smaller one is exact when packs nest', () => {
    expect(scalePriceBetweenUnits(paisa(2_760), packFactor(10), packFactor(100))).toBe(27_600);
  });

  it('a smaller unit rounds UP, never undercutting the pack it came from', () => {
    // Rs 250 for 14: 1,785.71… paisa a tablet, suggested as 1,786.
    expect(scalePriceBetweenUnits(paisa(25_000), packFactor(14), packFactor(1))).toBe(1_786);
  });

  it('refuses a negative or fractional price', () => {
    expect(() => scalePriceBetweenUnits(paisa(-1), packFactor(1), packFactor(10))).toThrow();
    expect(() => scalePriceBetweenUnits(2.5 as never, packFactor(1), packFactor(10))).toThrow();
  });
});

describe('unitsOf — stored units, or derived from the legacy columns', () => {
  it('a product from before PCN-012 prices each pack at per-base × size', () => {
    const units = unitsOf({
      baseUnitName: 'tab',
      packLevels: [
        { name: 'strip', factor: 10 },
        { name: 'box', factor: 100 },
      ],
      pricePerBasePaisa: 350,
      units: null,
    });
    expect(units).toEqual([
      { key: 'u0', name: 'tab', factor: 1, pricePaisa: 350, sell: true },
      { key: 'u1', name: 'strip', factor: 10, pricePaisa: 3_500, sell: true },
      { key: 'u2', name: 'box', factor: 100, pricePaisa: 35_000, sell: true },
    ]);
  });

  it('stored units win when they describe the current structure', () => {
    const stored = [
      { key: 'u0', name: 'cap', factor: 1, pricePaisa: 1_786, sell: false },
      { key: 'u1', name: 'box', factor: 14, pricePaisa: 25_000, sell: true },
    ];
    expect(
      unitsOf({
        baseUnitName: 'cap',
        packLevels: [{ name: 'box', factor: 14 }],
        pricePerBasePaisa: 1_786,
        units: stored,
      }),
    ).toEqual(stored);
  });

  it('stored units that no longer match the structure are not trusted', () => {
    // Written by a path that changed the structure without units (an older
    // caller): the legacy columns are the truth.
    const units = unitsOf({
      baseUnitName: 'tab',
      packLevels: [
        { name: 'strip', factor: 10 },
        { name: 'carton', factor: 1_000 },
      ],
      pricePerBasePaisa: 350,
      units: [
        { key: 'u0', name: 'tab', factor: 1, pricePaisa: 350, sell: true },
        { key: 'u1', name: 'strip', factor: 10, pricePaisa: 3_000, sell: true },
      ],
    });
    expect(units.map((unit) => unit.name)).toEqual(['tab', 'strip', 'carton']);
    expect(units[1]?.pricePaisa).toBe(3_500);
  });
});

describe('unitsFromEnteredPrices — the owner types the price they know', () => {
  it('a typed strip price gives an exact box price and a loose price that rounds up', () => {
    const units = unitsFromEnteredPrices(panadol, [null, 2_760, null]);
    expect(units?.map((unit) => unit.pricePaisa)).toEqual([276, 2_760, 27_600]);
  });

  it('every typed price is kept exactly, including a box cheaper than its strips', () => {
    const units = unitsFromEnteredPrices(panadol, [300, 2_760, 25_000]);
    expect(units?.map((unit) => unit.pricePaisa)).toEqual([300, 2_760, 25_000]);
  });

  it('a box of 14 at Rs 250 stays Rs 250 — the case per-base storage could not hold', () => {
    const units = unitsFromEnteredPrices(
      [
        { name: 'cap', factor: 1 },
        { name: 'box', factor: 14 },
      ],
      [null, 25_000],
    );
    expect(units?.[1]?.pricePaisa).toBe(25_000);
    expect(units?.[0]?.pricePaisa).toBe(1_786);
  });

  it('a blank is suggested from the nearest typed unit below it, exactly', () => {
    // Tablet and box typed: the strip comes from the tablet below it.
    expect(unitsFromEnteredPrices(panadol, [300, null, 25_000])?.[1]?.pricePaisa).toBe(3_000);
    // Only the box typed: strip and tablet come from above, rounded up.
    expect(
      unitsFromEnteredPrices(panadol, [null, null, 25_000])?.map((unit) => unit.pricePaisa),
    ).toEqual([250, 2_500, 25_000]);
  });

  it('keys follow position and sell flags carry over', () => {
    const units = unitsFromEnteredPrices(panadol, [null, 2_760, null], [false, true, true]);
    expect(units?.map((unit) => [unit.key, unit.sell])).toEqual([
      ['u0', false],
      ['u1', true],
      ['u2', true],
    ]);
  });

  it('nothing typed means nothing to price from', () => {
    expect(unitsFromEnteredPrices(panadol, [null, null, null])).toBeNull();
  });

  it('the legacy per-base price is the base unit’s own price', () => {
    const units = unitsFromEnteredPrices(panadol, [null, 2_760, null]) ?? [];
    expect(legacyPricePerBase(units)).toBe(276);
  });
});

describe('the unit a new sale line starts in (PCN-012, amended)', () => {
  const units = unitsFromEnteredPrices(panadol, [300, null, null]) ?? [];
  const syrup = unitsFromEnteredPrices([{ name: 'bottle', factor: 1 }], [12_000]) ?? [];

  it('is the strip by default, or the tablet for a shop that starts sales loose', () => {
    expect(defaultSaleUnit(units, null, false)?.name).toBe('strip');
    expect(defaultSaleUnit(units, null, true)?.name).toBe('tab');
  });

  it('is the unit this counter last sold the product in, whatever the shop setting', () => {
    expect(defaultSaleUnit(units, 'u2', false)?.name).toBe('box');
    expect(defaultSaleUnit(units, 'u0', false)?.name).toBe('tab');
    expect(defaultSaleUnit(units, 'u1', true)?.name).toBe('strip');
  });

  it('ignores a remembered unit the product no longer has', () => {
    expect(defaultSaleUnit(units, 'u7', false)?.name).toBe('strip');
  });

  it('is the one unit of a product without packs', () => {
    expect(defaultSaleUnit(syrup, null, false)?.name).toBe('bottle');
    expect(defaultSaleUnit(syrup, null, true)?.name).toBe('bottle');
  });
});
