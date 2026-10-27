/**
 * Quantity grammar — Phase 10 §4, I3.
 *
 *   "`3*pana` in search = quantity 3 of the selected result; bare selection =
 *    qty 1; Tab on the qty cell cycles unit levels (tab/strip/box) where the
 *    product defines them."
 *
 * The point is that the salesman never leaves the search box to say "three of
 * these". I3 asks for input that "accepts '2 strips' thinking, not database
 * thinking", so the separator is forgiving — `3*`, `3x`, `3 ` all mean three —
 * and anything unparseable is simply treated as part of the search text rather
 * than as an error.
 */

import { levelToBaseUnits, unitLevels, type PackLevel } from '@/lib/quantity';
import type { BaseQty } from '@/lib/branded';

export interface ParsedQuery {
  /** Units at the chosen level. Defaults to 1 when the operator typed no count. */
  readonly count: number;
  /** What to search for, with the quantity prefix stripped. */
  readonly query: string;
  /** True when a count was written explicitly, so the UI can show it. */
  readonly hasExplicitCount: boolean;
}

const QUANTITY_PREFIX = /^(\d{1,4})\s*(?:[*x×]\s*|\s+)(.*)$/i;

/**
 * Splits a leading quantity off the search text.
 *
 * A bare number is left alone: "500" is far more likely to be part of a strength
 * or a barcode than a request for five hundred of something not yet chosen.
 */
export function parseQuantityQuery(raw: string): ParsedQuery {
  const input = raw.trimStart();
  const match = QUANTITY_PREFIX.exec(input);

  if (!match) {
    return { count: 1, query: raw.trim(), hasExplicitCount: false };
  }

  const [, digits = '', rest = ''] = match;
  const count = Number(digits);
  const query = rest.trim();

  // "3*" with nothing after it is a half-typed intention, not a search.
  if (query === '' || !Number.isSafeInteger(count) || count <= 0) {
    return { count: 1, query: raw.trim(), hasExplicitCount: false };
  }

  return { count, query, hasExplicitCount: true };
}

/**
 * Resolves a count and a unit level into base units.
 *
 * The one place the counter's "3 strips" becomes the 30 tablets the ledger
 * records — and it delegates the multiplication to `lib/quantity`, which Phase 11
 * §2 makes the only place pack factors may be applied.
 */
export function resolveQuantity(
  count: number,
  levelName: string,
  baseUnitName: string,
  packLevels: readonly PackLevel[],
): BaseQty {
  const levels = unitLevels(baseUnitName, packLevels);
  const level = levels.find((candidate) => candidate.name === levelName) ?? levels[0];
  if (!level) {
    // A product with no levels at all cannot happen (base is always present),
    // but a sale must never fail on a lookup: treat it as base units.
    return levelToBaseUnits(count, { name: baseUnitName, factor: 1 });
  }
  return levelToBaseUnits(count, level);
}

/**
 * The next unit level in the cycle — what Tab does on the quantity cell.
 *
 * Wraps, so repeated presses always get somewhere rather than dead-ending at
 * the largest pack.
 */
export function nextUnitLevel(
  current: string,
  baseUnitName: string,
  packLevels: readonly PackLevel[],
): string {
  const levels = unitLevels(baseUnitName, packLevels);
  const index = levels.findIndex((level) => level.name === current);
  const next = levels[(index + 1) % levels.length];
  return next?.name ?? baseUnitName;
}
