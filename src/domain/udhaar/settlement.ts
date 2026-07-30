/**
 * Settlement validation — W3, pure (Phase 11 §2).
 *
 *   "Trigger: customer pays down debt, usually without buying. Path:
 *    settlement key → customer → amount → commit → receipt (mini-statement:
 *    previous balance, paid, new balance)."
 *
 * The rules are almost nothing — an amount greater than zero, a real customer —
 * because W3's whole point is speed ("under 10 seconds") and "partial amounts
 * are the norm ('500 de do')". There is deliberately no rule capping a payment
 * at the customer's current balance: Phase 5 invariant 3 defines balance as a
 * derived subtraction with no floor, so an overpayment is legal and simply
 * leaves the customer in credit — refusing it would be inventing a business
 * rule the plan never states.
 */

export type SettlementRejection =
  | { reason: 'amount_required' }
  | { reason: 'amount_not_positive' }
  | { reason: 'customer_required' };

export type Validated<T> =
  | { ok: true; value: T }
  | { ok: false; rejections: SettlementRejection[] };

export interface SettlementDraft {
  customerId: string | null;
  amountPaisa: number;
}

export function validateSettlementDraft(
  draft: SettlementDraft,
): Validated<{ customerId: string; amountPaisa: number }> {
  const rejections: SettlementRejection[] = [];

  if (draft.customerId === null || draft.customerId === '') {
    rejections.push({ reason: 'customer_required' });
  }
  if (!Number.isFinite(draft.amountPaisa) || !Number.isSafeInteger(draft.amountPaisa)) {
    rejections.push({ reason: 'amount_required' });
  } else if (draft.amountPaisa <= 0) {
    rejections.push({ reason: 'amount_not_positive' });
  }

  if (rejections.length > 0) {
    return { ok: false, rejections };
  }

  return {
    ok: true,
    // Non-null asserted only after the check above confirms it.
    value: { customerId: draft.customerId as string, amountPaisa: draft.amountPaisa },
  };
}

export interface MiniStatement {
  readonly previousBalancePaisa: number;
  readonly amountPaisa: number;
  readonly newBalancePaisa: number;
}

/**
 * The dispute-ender (T4/T5): "previous balance → this transaction → new
 * balance." `delta` is positive for udhaar extended on a sale (W2) and negative
 * for money paid in (W3) — one function serves both receipt kinds because both
 * print the identical three-line shape.
 */
export function miniStatement(previousBalancePaisa: number, deltaPaisa: number): MiniStatement {
  return {
    previousBalancePaisa,
    amountPaisa: deltaPaisa,
    newBalancePaisa: previousBalancePaisa + deltaPaisa,
  };
}
