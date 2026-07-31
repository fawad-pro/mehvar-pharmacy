/**
 * Purchase costing — pure (Phase 11 §2).
 *
 * One idea, and it is the whole reason this file exists separately: **the
 * distributor's "10+1" is not eleven units at the invoiced price.** It is
 * eleven units for the price of ten, and every margin figure the owner ever
 * sees depends on the difference being handled honestly.
 *
 * Phase 9 §3 words the rule precisely: `unit_cost_paisa` is "per base unit;
 * bonus units carry zero cost **by derivation, not by column**". So the
 * purchase line records what the invoice said — ten at Rs 35 — and the batch
 * that materializes from it carries the *effective* cost of eleven units, which
 * is what the goods on the shelf actually cost.
 *
 * Getting this wrong is not a rounding complaint. Recording eleven units at the
 * invoiced Rs 35 overstates cost of goods by a tenth and understates margin by
 * the same, permanently, on every scheme purchase — and scheme purchases are the
 * norm, not the exception, in Pakistani pharmaceutical distribution (Phase 1).
 * An owner who checks our margin against his own arithmetic and finds it
 * flattering would be right to stop believing the rest.
 */

import { paisa, type Paisa } from '@/lib/branded';

export interface PurchasedQuantity {
  /** Units invoiced and paid for. */
  readonly qtyBase: number;
  /** Units received free with the scheme. Zero in an ordinary purchase. */
  readonly bonusQtyBase: number;
  /** Per invoiced base unit, as the distributor billed it. */
  readonly unitCostPaisa: number;
}

/** Units that physically arrived and go on the shelf. */
export function receivedQty(line: PurchasedQuantity): number {
  return line.qtyBase + line.bonusQtyBase;
}

/** What the shop actually paid: bonus units are free, so they are not in here. */
export function invoicedCostPaisa(line: PurchasedQuantity): Paisa {
  return paisa(line.qtyBase * line.unitCostPaisa);
}

/**
 * The cost each received unit really carries.
 *
 * `paid ÷ received`, floored to whole paisa. Ten at Rs 3.50 with one free is
 * 3500 paisa for 11 units — 318 paisa each, not 350.
 *
 * **The floor leaves a remainder, deliberately.** 11 × 318 = 3498, two paisa
 * short of the 3500 actually paid. There is no integer per-unit cost that
 * multiplies back exactly, and inventing a fractional one would put a float in
 * the money path, which Phase 9 §1 forbids outright. Flooring is the honest
 * direction for the residue to fall: it makes cost of goods very slightly
 * conservative, so the margin the owner is shown is never *better* than the
 * truth. `costResidualPaisa` exposes the remainder for anyone who needs the
 * exact figure — margin reporting on Day 7 should sum invoiced cost, not
 * multiply per-unit cost, when the exact number matters.
 */
export function effectiveUnitCostPaisa(line: PurchasedQuantity): Paisa {
  const received = receivedQty(line);
  if (received <= 0) {
    return paisa(0);
  }
  return paisa(Math.floor(invoicedCostPaisa(line) / received));
}

/** Paid, minus what the per-unit cost accounts for. Small, never negative. */
export function costResidualPaisa(line: PurchasedQuantity): Paisa {
  return paisa(invoicedCostPaisa(line) - effectiveUnitCostPaisa(line) * receivedQty(line));
}

/**
 * The margin a sale of these units would show, per base unit.
 *
 * Here so that the bonus arithmetic and the margin arithmetic cannot drift
 * apart in two different files. Negative is legal and worth surfacing — selling
 * below cost happens, and hiding it would be the opposite of T1.
 */
export function unitMarginPaisa(sellingPricePaisa: number, line: PurchasedQuantity): Paisa {
  return paisa(sellingPricePaisa - effectiveUnitCostPaisa(line));
}
