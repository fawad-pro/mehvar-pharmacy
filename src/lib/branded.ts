/**
 * Branded primitives — Phase 11 §2.
 *
 * "Branded types for the two sacred units: `Paisa` and `BaseQty` — raw `number`
 * never crosses a domain boundary for money or stock."
 *
 * The brand is a compile-time-only phantom property. At runtime these are plain
 * integers; the type system is what stops a rupee figure, a per-strip count, or
 * an untrusted input from being spent as if it were already normalized.
 */

declare const brand: unique symbol;

type Brand<T, B extends string> = T & { readonly [brand]: B };

/**
 * Money, always as integer paisa (Phase 9 §1). No floats anywhere near money.
 * 100 paisa = 1 rupee.
 */
export type Paisa = Brand<number, 'Paisa'>;

/**
 * Stock quantity, always in base units (Phase 5 §2). "3 strips + 4 tablets" is
 * stored and computed as 34 tablets; presentation converts back.
 */
export type BaseQty = Brand<number, 'BaseQty'>;

/**
 * The factor of a pack level expressed in base units — the `factor` in a
 * product's `pack_levels` JSONB (Phase 9 §2), e.g. strip = 10, box = 100.
 */
export type PackFactor = Brand<number, 'PackFactor'>;

export class InvalidUnitError extends Error {
  constructor(unit: string, value: number, requirement: string) {
    super(`Invalid ${unit}: ${value} — ${requirement}`);
    this.name = 'InvalidUnitError';
  }
}

function assertSafeInteger(unit: string, value: number, requirement: string): void {
  if (!Number.isSafeInteger(value)) {
    throw new InvalidUnitError(unit, value, requirement);
  }
}

/** Constructs a Paisa value. Negative amounts are legal (change, deltas, over/short). */
export function paisa(value: number): Paisa {
  assertSafeInteger('Paisa', value, 'must be a safe integer number of paisa');
  return value as Paisa;
}

/** Constructs a BaseQty. Negative quantities are legal (signed adjustment deltas). */
export function baseQty(value: number): BaseQty {
  assertSafeInteger('BaseQty', value, 'must be a safe integer count of base units');
  return value as BaseQty;
}

/** Constructs a PackFactor. Factors are strictly positive. */
export function packFactor(value: number): PackFactor {
  assertSafeInteger('PackFactor', value, 'must be a safe integer');
  if (value <= 0) {
    throw new InvalidUnitError('PackFactor', value, 'must be greater than zero');
  }
  return value as PackFactor;
}

export const ZERO_PAISA: Paisa = 0 as Paisa;
export const ZERO_QTY: BaseQty = 0 as BaseQty;
