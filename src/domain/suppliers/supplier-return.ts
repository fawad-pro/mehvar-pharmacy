/**
 * [PCN-009] Goods sent back to the distributor — the pure half.
 *
 * A distributor return used to be an adjustment: stock left the batch, and the
 * supplier balance PCN-007 introduced stayed as if the goods were still here.
 * A supplier return records the credit too, so what the shop owes the supplier
 * falls by the value the supplier gives back.
 */

import { cumulativeCostPaisa, type BatchCostBasis } from '@/domain/inventory/batch-cost';
import { paisa } from '@/lib/branded';
import { formatPaisa } from '@/lib/money';

export type SupplierReturnRejection =
  | 'invalid_quantity'
  | 'negative_credit'
  /** The batch does not hold that many units now. */
  | 'more_than_on_hand'
  /** The batch came from an invoice with no supplier, so there is no one to credit. */
  | 'no_supplier';

export function validateSupplierReturn(input: {
  readonly qtyBase: number;
  readonly creditPaisa: number;
  readonly entered?: {
    readonly unitKey: string;
    readonly unitName: string;
    readonly unitCount: number;
  };
}): { ok: true } | { ok: false; reason: SupplierReturnRejection } {
  if (!Number.isInteger(input.qtyBase) || input.qtyBase <= 0) {
    return { ok: false, reason: 'invalid_quantity' };
  }
  // [PCN-012] "5 box" is whole boxes: the base quantity must be a whole number of them.
  if (
    input.entered &&
    (!Number.isSafeInteger(input.entered.unitCount) ||
      input.entered.unitCount <= 0 ||
      input.entered.unitName.trim() === '' ||
      input.qtyBase % input.entered.unitCount !== 0)
  ) {
    return { ok: false, reason: 'invalid_quantity' };
  }
  if (!Number.isInteger(input.creditPaisa) || input.creditPaisa < 0) {
    return { ok: false, reason: 'negative_credit' };
  }
  return { ok: true };
}

/**
 * The credit to offer by default (PCN-009: "quantity × that batch's effective
 * unit cost") — stated exactly. [PCN-012] The returned units are offered at
 * the cost they carry out of the batch: their cumulative share of the batch's
 * CURRENT total, bonus units included in what was received and corrections
 * applied, `C(taken + returned) − C(taken)`. That is the same figure the cost
 * ledger books for the movement, so a credit left as suggested matches the
 * stock cost removed to the paisa; no rounded per-unit cost is multiplied.
 *
 * Editable: the distributor decides the real credit, and any difference from
 * the stock cost is shown beside the return wherever it is listed.
 */
export function defaultReturnCreditPaisa(
  basis: BatchCostBasis,
  takenBase: number,
  qtyBase: number,
): number {
  return cumulativeCostPaisa(basis, takenBase + qtyBase) - cumulativeCostPaisa(basis, takenBase);
}

/**
 * [PCN-012] How a supplier's credit compares with the stock cost the return
 * took out of its batch, in words for a history row: "" when they match.
 * The difference is not hidden in the supplier balance — it is said here.
 */
export function creditAgainstStockCost(creditPaisa: number, stockCostPaisa: number): string {
  if (creditPaisa === stockCostPaisa) return '';
  const difference = formatPaisa(paisa(Math.abs(creditPaisa - stockCostPaisa)));
  return creditPaisa < stockCostPaisa
    ? `${difference} below stock cost`
    : `${difference} above stock cost`;
}
