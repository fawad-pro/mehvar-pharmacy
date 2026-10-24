/**
 * [PCN-012] A product's units — the words a pharmacist sells and buys in.
 *
 * "1 strip = 10 tablets, 1 box = 10 strips", each with its own price. Stock
 * arithmetic stays in base units (Phase 5 §2); this module is how a unit the
 * owner names becomes the base-unit count and the exact price Mehvar records,
 * so nobody at the counter converts anything (P9).
 *
 * Stored as `products.units`, smallest first. A product written before PCN-012
 * has no `units`; its units are derived from the legacy columns (base unit,
 * pack levels, price per base unit), which is exactly what it charged then.
 * Nothing is backfilled, so a fixture or an old row reads the same either way.
 *
 * Pure (Phase 11 §2); every multiplication by a pack factor goes through
 * `lib/quantity`.
 */

import { packFactor, paisa, type Paisa } from '@/lib/branded';
import { scalePriceBetweenUnits, type PackLevel } from '@/lib/quantity';

export interface ProductUnit {
  /**
   * Stable identity: `u0` for the base unit, then `u1`, `u2`… by position.
   * Units are only ever added on top (step 1's lock), so a key never moves.
   */
  readonly key: string;
  readonly name: string;
  /** Base units in one of this unit. 1 for the base unit. */
  readonly factor: number;
  /** The price of ONE of this unit, in paisa, exactly as the owner set it. */
  readonly pricePaisa: number;
  /** Offered at the counter. */
  readonly sell: boolean;
}

export interface UnitSource {
  readonly baseUnitName: string;
  readonly packLevels: readonly PackLevel[];
  /** The legacy per-base-unit price (`default_price_per_base_unit`). */
  readonly pricePerBasePaisa: number;
  readonly units: readonly ProductUnit[] | null | undefined;
}

export function unitKey(position: number): string {
  return `u${position}`;
}

/**
 * The product's units, smallest first.
 *
 * Stored units are used when they describe the product's current structure;
 * otherwise (a product from before PCN-012, or a row written by code that
 * predates `units`) they are derived from the legacy columns, each pack priced
 * at per-base price × size — what the counter charged before PCN-012.
 */
export function unitsOf(source: UnitSource): ProductUnit[] {
  const structure = [
    { name: source.baseUnitName, factor: 1 },
    ...source.packLevels.map((level) => ({ name: level.name, factor: level.factor })),
  ];

  const stored = source.units ?? [];
  const matches =
    stored.length === structure.length &&
    stored.every(
      (unit, index) =>
        unit.name === structure[index]?.name && unit.factor === structure[index]?.factor,
    );
  if (matches) {
    return stored.map((unit) => ({ ...unit }));
  }

  return structure.map((unit, index) => ({
    key: unitKey(index),
    name: unit.name,
    factor: unit.factor,
    pricePaisa: scalePriceBetweenUnits(
      paisa(source.pricePerBasePaisa),
      packFactor(1),
      packFactor(unit.factor),
    ),
    sell: true,
  }));
}

export function findUnit(units: readonly ProductUnit[], name: string): ProductUnit | undefined {
  return units.find((unit) => unit.name === name);
}

/**
 * Builds a product's units from the prices the owner typed, filling the rest.
 *
 * `entered[i]` is the price typed for unit `i` (smallest first), or null for a
 * blank. A typed price is stored exactly as typed. A blank is suggested from
 * the nearest typed unit BELOW it when there is one — packs nest, so a carton
 * from its box is exact — and otherwise from the nearest typed unit above it,
 * rounded up (`scalePriceBetweenUnits`), so a loose price never undercuts the
 * strip it is cut from.
 *
 * Returns null when nothing at all was typed: there is no price to start from.
 */
export function unitsFromEnteredPrices(
  structure: readonly { name: string; factor: number }[],
  entered: readonly (number | null)[],
  sell: readonly boolean[] = [],
): ProductUnit[] | null {
  const typed = structure.flatMap((unit, index) => {
    const price = entered[index];
    return price === null || price === undefined ? [] : [{ index, factor: unit.factor, price }];
  });
  if (typed.length === 0) {
    return null;
  }

  return structure.map((unit, index) => {
    const own = entered[index];
    let pricePaisa: Paisa;
    if (own !== null && own !== undefined) {
      pricePaisa = paisa(own);
    } else {
      const below = typed.filter((candidate) => candidate.index < index).at(-1);
      const source = below ?? typed.find((candidate) => candidate.index > index) ?? typed[0];
      pricePaisa = scalePriceBetweenUnits(
        paisa(source?.price ?? 0),
        packFactor(source?.factor ?? 1),
        packFactor(unit.factor),
      );
    }
    return {
      key: unitKey(index),
      name: unit.name,
      factor: unit.factor,
      pricePaisa,
      sell: sell[index] ?? true,
    };
  });
}

/**
 * The legacy per-base-unit price kept in step with `units` for one release
 * (PCN-012 data model): the base unit's own price.
 */
export function legacyPricePerBase(units: readonly ProductUnit[]): number {
  return units[0]?.pricePaisa ?? 0;
}
