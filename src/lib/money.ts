/**
 * Money arithmetic — Phase 9 §1: integer paisa, no floats anywhere near money.
 *
 * Every rupee figure the operator sees is a rendering of an integer held here.
 * Rounding happens exactly once, at the boundary where a non-integer paisa
 * value could otherwise appear (percentage discounts, unit-price × quantity for
 * fractional-paisa prices), and it happens through `multiplyPaisa` — never by
 * an ad-hoc `Math.round` at a call site.
 */

import { paisa, ZERO_PAISA, type Paisa } from './branded';

const PAISA_PER_RUPEE = 100;

export function addPaisa(...amounts: Paisa[]): Paisa {
  return paisa(amounts.reduce<number>((sum, amount) => sum + amount, 0));
}

export function subtractPaisa(minuend: Paisa, subtrahend: Paisa): Paisa {
  return paisa(minuend - subtrahend);
}

export function negatePaisa(amount: Paisa): Paisa {
  return paisa(-amount);
}

/**
 * Multiplies money by a count or a rate, rounding half away from zero so that
 * a discount of exactly half a paisa never silently favours one side twice.
 */
export function multiplyPaisa(amount: Paisa, multiplier: number): Paisa {
  if (!Number.isFinite(multiplier)) {
    throw new RangeError(`Cannot multiply money by a non-finite value: ${multiplier}`);
  }
  const product = amount * multiplier;
  const rounded = product < 0 ? -Math.round(-product) : Math.round(product);
  return paisa(rounded);
}

export function sumPaisa(amounts: readonly Paisa[]): Paisa {
  return amounts.length === 0 ? ZERO_PAISA : addPaisa(...amounts);
}

/** Converts rupees (as entered by a human, possibly with decimals) to paisa. */
export function rupeesToPaisa(rupees: number): Paisa {
  if (!Number.isFinite(rupees)) {
    throw new RangeError(`Cannot convert a non-finite rupee value: ${rupees}`);
  }
  const value = rupees * PAISA_PER_RUPEE;
  return paisa(value < 0 ? -Math.round(-value) : Math.round(value));
}

/**
 * Formats paisa for display. Grouping is applied; the currency symbol is
 * omitted by default because Phase 10 §4 stacks totals as bare numerals with
 * the unit implied by context (I6: numbers are the loudest thing on screen).
 */
export function formatPaisa(
  amount: Paisa,
  options: { withSymbol?: boolean; decimals?: boolean } = {},
): string {
  const { withSymbol = false, decimals = false } = options;
  const negative = amount < 0;
  const absolute = Math.abs(amount);
  const rupees = Math.trunc(absolute / PAISA_PER_RUPEE);
  const remainder = absolute % PAISA_PER_RUPEE;

  const grouped = rupees.toLocaleString('en-PK');
  const body = decimals ? `${grouped}.${String(remainder).padStart(2, '0')}` : grouped;
  const prefixed = withSymbol ? `Rs ${body}` : body;

  return negative ? `-${prefixed}` : prefixed;
}
