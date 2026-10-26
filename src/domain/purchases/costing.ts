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
  /** Per invoiced base unit, as the distributor billed it (nominal on a pack line). */
  readonly unitCostPaisa: number;
  /**
   * [PCN-012] What the line cost exactly, when it was invoiced per pack
   * ("10 boxes at Rs 250"). Absent on a line priced per base unit, whose cost
   * is `qtyBase × unitCostPaisa` exactly.
   */
  readonly lineCostPaisa?: number | null | undefined;
}

/** Units that physically arrived and go on the shelf. */
export function receivedQty(line: PurchasedQuantity): number {
  return line.qtyBase + line.bonusQtyBase;
}

/** What the shop actually paid: bonus units are free, so they are not in here. */
export function invoicedCostPaisa(line: PurchasedQuantity): Paisa {
  return paisa(line.lineCostPaisa ?? line.qtyBase * line.unitCostPaisa);
}

/**
 * The cost each received unit carries, as one figure: `paid ÷ received`,
 * rounded UP to whole paisa. Ten at Rs 3.50 with one free is 3500 paisa for
 * 11 units — 319 paisa each, not 350.
 *
 * **Nominal since PCN-012.** No whole-paisa figure multiplies back to what was
 * paid, so margin no longer multiplies this: reports take each outflow's
 * cumulative share of the batch's exact total (`inventory/batch-cost.ts`),
 * which never understates cost and adds up exactly when the batch is used up.
 * This figure is for display and for the columns older readers expect, and it
 * rounds up for the same reason: a cost shown low reports a margin better
 * than the real one. (Day 6 floored it and claimed the opposite; PCN-012
 * corrected the reasoning.)
 */
export function effectiveUnitCostPaisa(line: PurchasedQuantity): Paisa {
  const received = receivedQty(line);
  if (received <= 0) {
    return paisa(0);
  }
  return paisa(Math.ceil(invoicedCostPaisa(line) / received));
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
