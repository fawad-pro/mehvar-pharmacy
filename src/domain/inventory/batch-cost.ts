/**
 * [PCN-012] What the units leaving a batch cost — pure (Phase 11 §2).
 *
 * A batch cost an exact total (what was paid for its purchase line, bonus units
 * free; or its opening units at their entered cost). Its units leave by sale,
 * write-off or return to the supplier, and some come back (a customer return
 * restocked). Each movement's cost is its share of the total, counted
 * **cumulatively**:
 *
 *     C(n) = ⌈ total × n ÷ received ⌉      the cost of the first n units out
 *     cost of a movement = C(after) − C(before)
 *
 * where n is the running count of units out (back is negative). Two properties
 * follow, and both are tested:
 *
 *  - at every point, recognised cost C(n) is at least the exact proportional
 *    cost, so a reported margin is never better than the real one;
 *  - when the batch is used up (n = received), the movements add up to exactly
 *    the total. No paisa is lost or invented.
 *
 * A per-unit cost (floored or rounded) has neither: floored, cost is
 * understated; rounded up, a used-up batch costs more than was paid.
 *
 * **Derived on read, never frozen (D1).** The total and the units received are
 * the batch's current ones, corrections included, so correcting an invoice
 * restates the cost of what already left. **Every outflow takes its share
 * (D2)** — a write-off or a supplier return is a movement like a sale — so a
 * batch reconciles to what was paid whichever way its units left.
 *
 * Integer arithmetic in BigInt: `total × n` can pass 2^53 for a large batch.
 */

/** One movement of units out of (positive) or back into (negative) a batch. */
export interface BatchMovement {
  readonly id: string;
  /** Base units out; negative for units restocked into the batch. */
  readonly qtyBase: number;
}

export interface BatchCostBasis {
  /** What the batch's units cost in total, as currently corrected. */
  readonly totalPaisa: number;
  /** Units the batch received, as currently corrected (bonus included). */
  readonly receivedBase: number;
}

/** ⌈a ÷ b⌉ for b > 0, exact for any sign of a. */
function ceilDiv(a: bigint, b: bigint): bigint {
  const quotient = a / b;
  return a % b !== 0n && a > 0n ? quotient + 1n : quotient;
}

/** C(n): what the first `takenBase` units out of the batch cost, rounded up. */
export function cumulativeCostPaisa(basis: BatchCostBasis, takenBase: number): number {
  if (basis.receivedBase <= 0) {
    return 0;
  }
  return Number(ceilDiv(BigInt(basis.totalPaisa) * BigInt(takenBase), BigInt(basis.receivedBase)));
}

/**
 * Each movement's cost, in the order given (the order they happened).
 * Restocks come back negative: the cost those units are taken to have left
 * with, at the batch's current position.
 */
export function costMovements(
  basis: BatchCostBasis,
  movements: readonly BatchMovement[],
): Map<string, number> {
  const costs = new Map<string, number>();
  let taken = 0;
  let recognised = 0;
  for (const movement of movements) {
    taken += movement.qtyBase;
    const next = cumulativeCostPaisa(basis, taken);
    costs.set(movement.id, (costs.get(movement.id) ?? 0) + next - recognised);
    recognised = next;
  }
  return costs;
}
