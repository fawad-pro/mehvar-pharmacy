/**
 * Quantity arithmetic — Phase 5 §2: all stock arithmetic happens in base units.
 *
 * "3 strips + 4 tablets" is stored and computed as 34 tablets; presentation
 * converts back. Phase 11 §2 makes this module the ONLY place multiplication by
 * pack factors is permitted — the single rule that eliminates the classic
 * sub-unit corruption bug.
 */

import { baseQty, packFactor, paisa, type BaseQty, type PackFactor, type Paisa } from './branded';

/**
 * One grouping level above the base unit, as stored in `products.pack_levels`
 * (Phase 9 §2). Factors are expressed in base units, not in the level below.
 */
export interface PackLevel {
  readonly name: string;
  readonly factor: number;
}

/** The base unit itself, expressed as a level so callers can treat levels uniformly. */
export function baseLevel(baseUnitName: string): PackLevel {
  return { name: baseUnitName, factor: 1 };
}

/**
 * Every level a product can be entered in, base first, ascending by factor.
 * Phase 10 §4's Tab-cycles-unit-levels affordance walks exactly this list.
 */
export function unitLevels(baseUnitName: string, packLevels: readonly PackLevel[]): PackLevel[] {
  return [baseLevel(baseUnitName), ...packLevels].sort((a, b) => a.factor - b.factor);
}

export function findLevel(
  levelName: string,
  baseUnitName: string,
  packLevels: readonly PackLevel[],
): PackLevel | undefined {
  return unitLevels(baseUnitName, packLevels).find((level) => level.name === levelName);
}

/** Converts a count entered at some unit level into base units. */
export function toBaseUnits(count: number, factor: PackFactor): BaseQty {
  if (!Number.isSafeInteger(count)) {
    throw new RangeError(`Quantity must be a whole number of units, received: ${count}`);
  }
  return baseQty(count * factor);
}

/** Convenience wrapper for converting against a named pack level. */
export function levelToBaseUnits(count: number, level: PackLevel): BaseQty {
  return toBaseUnits(count, packFactor(level.factor));
}

export function addQty(...quantities: BaseQty[]): BaseQty {
  return baseQty(quantities.reduce<number>((sum, quantity) => sum + quantity, 0));
}

export function subtractQty(minuend: BaseQty, subtrahend: BaseQty): BaseQty {
  return baseQty(minuend - subtrahend);
}

/**
 * Decomposes a base-unit quantity into the largest whole pack levels that fit,
 * greedily, largest first. 34 base units against strip=10 yields
 * `[{level: strip, count: 3}, {level: tab, count: 4}]`.
 */
export function decomposeQuantity(
  quantity: BaseQty,
  baseUnitName: string,
  packLevels: readonly PackLevel[],
): Array<{ level: PackLevel; count: number }> {
  const negative = quantity < 0;
  let remaining = Math.abs(quantity);
  const parts: Array<{ level: PackLevel; count: number }> = [];

  const descending = unitLevels(baseUnitName, packLevels).reverse();
  for (const level of descending) {
    const count = Math.trunc(remaining / level.factor);
    if (count > 0) {
      parts.push({ level, count: negative ? -count : count });
      remaining -= count * level.factor;
    }
  }

  return parts;
}

/**
 * Natural-language quantity for the cart, receipts and reports — Phase 10 §4's
 * "1 strip + 4 tab" (W5). Zero renders in base units so a line never reads blank.
 */
export function describeQuantity(
  quantity: BaseQty,
  baseUnitName: string,
  packLevels: readonly PackLevel[] = [],
): string {
  const parts = decomposeQuantity(quantity, baseUnitName, packLevels);
  if (parts.length === 0) {
    return `0 ${baseUnitName}`;
  }
  return parts.map(({ level, count }) => `${count} ${level.name}`).join(' + ');
}

/**
 * [PCN-012] A price for one unit, worked out from the price of another unit
 * of the same product: `price × toFactor ÷ fromFactor`, rounded UP to the paisa.
 *
 * Used only to SUGGEST a price the owner did not type (a box price from a strip
 * price). Pack sizes nest, so a larger unit comes out exact; a smaller one
 * (a loose tablet from a strip) rounds up, because a suggestion that undercuts
 * the pack it came from is the one direction a pharmacy never wants. A price
 * the owner typed is stored as typed and never passes through here.
 *
 * Lives here because it multiplies by pack factors (Phase 11 §2).
 */
export function scalePriceBetweenUnits(
  price: Paisa,
  fromFactor: PackFactor,
  toFactor: PackFactor,
): Paisa {
  if (!Number.isSafeInteger(price) || price < 0) {
    throw new RangeError(`A unit price must be a non-negative whole number of paisa: ${price}`);
  }
  const numerator = price * toFactor;
  return paisa(Math.ceil(numerator / fromFactor));
}

/**
 * [PCN-012] The nominal per-base price of a unit: its price ÷ its size,
 * rounded DOWN. Written only to `sale_lines.unit_price_paisa`, a NOT NULL
 * column kept for rows read by code from before PCN-012; money is always read
 * from the exact line amount, never multiplied back from this.
 */
export function nominalPricePerBase(pricePerUnit: Paisa, factor: PackFactor): Paisa {
  return paisa(Math.floor(pricePerUnit / factor));
}

/**
 * [PCN-012] What `qty` base units cost at `costPerUnit` for a unit of size
 * `unitFactor`: `cost × qty ÷ factor`, rounded UP to the paisa, once.
 *
 * Opening stock is counted as the shelf holds it ("2 boxes, 3 strips, 4
 * tablets") and costed per box; the batch's exact total is this figure.
 * Rounded once over the whole quantity rather than per unit, and upwards, so
 * the cost on record is never understated (a low cost reports a margin better
 * than the real one). BigInt, because `cost × qty` can pass 2^53.
 */
export function costOfBaseUnits(costPerUnit: Paisa, unitFactor: PackFactor, qty: BaseQty): Paisa {
  if (!Number.isSafeInteger(costPerUnit) || costPerUnit < 0 || qty < 0) {
    throw new RangeError(`A cost and a quantity must be non-negative: ${costPerUnit}, ${qty}`);
  }
  const numerator = BigInt(costPerUnit) * BigInt(qty);
  const factor = BigInt(unitFactor);
  return paisa(Number(numerator / factor + (numerator % factor === 0n ? 0n : 1n)));
}
