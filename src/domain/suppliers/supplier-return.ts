/**
 * [PCN-009] Goods sent back to the distributor — the pure half.
 *
 * A distributor return used to be an adjustment: stock left the batch, and the
 * supplier balance PCN-007 introduced stayed as if the goods were still here.
 * A supplier return records the credit too, so what the shop owes the supplier
 * falls by the value the supplier gives back.
 */

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
}): { ok: true } | { ok: false; reason: SupplierReturnRejection } {
  if (!Number.isInteger(input.qtyBase) || input.qtyBase <= 0) {
    return { ok: false, reason: 'invalid_quantity' };
  }
  if (!Number.isInteger(input.creditPaisa) || input.creditPaisa < 0) {
    return { ok: false, reason: 'negative_credit' };
  }
  return { ok: true };
}

/**
 * The credit to offer by default: what the returned units cost the shop, at the
 * batch's effective cost (bonus included, corrections applied). Editable — the
 * distributor decides the real credit, and the operator types what they gave.
 */
export function defaultReturnCreditPaisa(qtyBase: number, effectiveUnitCostPaisa: number): number {
  return qtyBase * effectiveUnitCostPaisa;
}
