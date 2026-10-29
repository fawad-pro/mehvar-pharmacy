/**
 * [PCN-011] What a supplier balance means — the payable mirror of
 * `domain/udhaar/position.ts`.
 *
 * The supplier balance (PCN-007/009) is signed: positive, the pharmacy owes
 * the supplier; negative, the supplier holds the pharmacy's money — an
 * overpayment, or credit for goods sent back from an invoice already paid.
 * Both are real money, and until PCN-011 only the first was ever shown: the
 * owed list dropped anyone at or below zero and the Day screen floored each
 * balance at zero, so a credit was invisible everywhere.
 *
 * As on the customer side, owed and credit are reported SEPARATELY and never
 * netted (one supplier's credit does not pay another's invoice), and every
 * amount is positive with the direction carried by the words beside it.
 *
 * Pure, and in `domain/` because it is business meaning (Phase 11 §1).
 */

import { paisa } from '@/lib/branded';
import { formatPaisa } from '@/lib/money';

export interface SupplierBook {
  /** Σ of what the pharmacy owes. Never negative. */
  readonly owedPaisa: number;
  /** Σ of credit suppliers hold for the pharmacy. Never negative. */
  readonly creditPaisa: number;
  readonly suppliersOwed: number;
  readonly suppliersInCredit: number;
}

export function summariseSupplierBook(balances: Iterable<number>): SupplierBook {
  let owedPaisa = 0;
  let creditPaisa = 0;
  let suppliersOwed = 0;
  let suppliersInCredit = 0;

  for (const balance of balances) {
    if (balance > 0) {
      owedPaisa += balance;
      suppliersOwed += 1;
    } else if (balance < 0) {
      creditPaisa += -balance;
      suppliersInCredit += 1;
    }
  }

  return { owedPaisa, creditPaisa, suppliersOwed, suppliersInCredit };
}

/**
 * What paying `amountPaisa` to a supplier will do, said BEFORE it is recorded.
 *
 * Paying more than is owed stays legal — distributors take round sums and
 * advances — but it leaves money with the supplier, and the screen must say so
 * rather than let the supplier silently drop off the owed list. A warning,
 * never a block, exactly as `settlementEffect` is for customers.
 */
export interface SupplierPaymentEffect {
  /** The part of the payment that pays down what is owed. */
  readonly clearsPaisa: number;
  /** The part beyond what is owed, which becomes credit with the supplier. */
  readonly leavesCreditPaisa: number;
}

export function supplierPaymentEffect(
  balancePaisa: number,
  amountPaisa: number,
): SupplierPaymentEffect {
  const owed = Math.max(0, balancePaisa);
  const paid = Math.max(0, amountPaisa);
  const clearsPaisa = Math.min(owed, paid);
  return { clearsPaisa, leavesCreditPaisa: paid - clearsPaisa };
}

/**
 * [PCN-016] A supplier balance as one phrase, words first — "You owe
 * Rs 4,500.00", "They owe you Rs 300.00", "Settled up". The mirror of the
 * customer side's `positionPhrase`: never a minus sign, the words carry the
 * direction.
 */
export type SupplierPositionKind = 'you_owe' | 'they_owe' | 'settled';

export function supplierPositionKind(balancePaisa: number): SupplierPositionKind {
  return balancePaisa > 0 ? 'you_owe' : balancePaisa < 0 ? 'they_owe' : 'settled';
}

export function supplierPositionPhrase(balancePaisa: number): string {
  const amount = formatPaisa(paisa(Math.abs(balancePaisa)), { withSymbol: true });
  switch (supplierPositionKind(balancePaisa)) {
    case 'you_owe':
      return `You owe ${amount}`;
    case 'they_owe':
      return `They owe you ${amount}`;
    case 'settled':
      return 'Settled up';
  }
}
