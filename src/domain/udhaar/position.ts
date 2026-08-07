/**
 * What a balance *means* — the vocabulary the udhaar screens speak.
 *
 * Phase 5 invariant 3 defines a customer's balance as a signed derivation:
 *
 *     balance = credit extended − payments − credit reversed by returns
 *
 * That subtraction is correct and stays exactly as it is. The problem it caused
 * is one of language, not arithmetic. Settlement deliberately permits an
 * overpayment (see `settlement.ts` — "500 de do" is the norm and capping it
 * would invent a rule the plan never states), so the signed figure can and does
 * go below zero. Rendered raw, that produced a screen reading
 *
 *     TOTAL OWED TO YOU     -Rs 100.00
 *
 * which is not a number a pharmacist can act on. It looks like the software has
 * lost track of the money. It hasn't — but "negative owed" is an accounting
 * idea, and the shop does not think in accounting ideas. A customer is in
 * exactly one of three states, and each has a word for it in the shop:
 *
 *     owes       they took goods on udhaar and have not paid yet
 *     settled    nothing outstanding either way
 *     in credit  they have paid ahead; the shop owes them goods
 *
 * So every screen states the position and shows a POSITIVE amount beside it.
 * A minus sign never appears on a balance again. This module is the only place
 * that decides which of the three it is, so the customer page, the customer
 * list, the receipt and the day summary cannot drift into three vocabularies.
 *
 * Pure, and in `domain/` because it is business meaning rather than formatting
 * (Phase 11 §1).
 */

/** Always non-negative. The direction lives in `kind`, never in the sign. */
export type BalancePosition =
  | { readonly kind: 'owes'; readonly amountPaisa: number }
  | { readonly kind: 'settled'; readonly amountPaisa: 0 }
  | { readonly kind: 'in_credit'; readonly amountPaisa: number };

/**
 * Reads a signed balance as a position.
 *
 * The signed figure remains the derivation of record — this only decides how to
 * say it out loud.
 */
export function positionOf(balancePaisa: number): BalancePosition {
  if (balancePaisa > 0) return { kind: 'owes', amountPaisa: balancePaisa };
  if (balancePaisa < 0) return { kind: 'in_credit', amountPaisa: -balancePaisa };
  return { kind: 'settled', amountPaisa: 0 };
}

/**
 * The words beside the number, from the shop's point of view.
 *
 * "Advance paid" rather than "credit balance": the pharmacist's mental model is
 * that the customer has handed over money in advance, not that a ledger account
 * has a credit direction.
 */
export function positionLabel(kind: BalancePosition['kind']): string {
  switch (kind) {
    case 'owes':
      return 'Owes you';
    case 'in_credit':
      return 'Advance paid';
    case 'settled':
      return 'Settled up';
  }
}

/**
 * The whole udhaar book, summarised the way the Day screen must state it.
 *
 * Debts and advances are reported SEPARATELY and never netted. Netting was the
 * second half of the same bug: the customers list already floored each balance
 * at zero before summing ("a customer in credit does not offset someone else's
 * debt"), while the day summary netted the entire book into one signed figure.
 * Two screens, two definitions, one label — so a single Rs 100 advance could
 * make the day summary report a negative amount owed while the customers list
 * reported a positive one, and both were "right".
 *
 * `owedPaisa` is the number the owner chases. `creditPaisa` is money already
 * received that has not been drawn against yet — a real obligation, but not a
 * debt, and subtracting it would understate what is out on the street.
 */
export interface UdhaarBook {
  /** Σ of balances that are owed. Never negative. */
  readonly owedPaisa: number;
  /** Σ of advances customers have paid ahead. Never negative. */
  readonly creditPaisa: number;
  readonly customersOwing: number;
  readonly customersInCredit: number;
}

export function summariseBook(balances: Iterable<number>): UdhaarBook {
  let owedPaisa = 0;
  let creditPaisa = 0;
  let customersOwing = 0;
  let customersInCredit = 0;

  for (const balance of balances) {
    const position = positionOf(balance);
    if (position.kind === 'owes') {
      owedPaisa += position.amountPaisa;
      customersOwing += 1;
    } else if (position.kind === 'in_credit') {
      creditPaisa += position.amountPaisa;
      customersInCredit += 1;
    }
  }

  return { owedPaisa, creditPaisa, customersOwing, customersInCredit };
}

/**
 * What a payment of `amountPaisa` will actually do to this balance.
 *
 * The settlement overlay says this out loud BEFORE committing, because the
 * surprise it prevents is the one that made this whole area feel broken: paying
 * Rs 500 against a Rs 20 debt is legal, is recorded exactly as asked, and
 * leaves the customer Rs 480 in credit — but if nobody said so, the next screen
 * simply shows a number going the "wrong" way.
 *
 * It is a warning, never a block. W3's rule stands.
 */
export interface SettlementEffect {
  readonly clearsPaisa: number;
  readonly overpaidPaisa: number;
  readonly resulting: BalancePosition;
}

export function settlementEffect(
  balancePaisa: number,
  amountPaisa: number,
): SettlementEffect {
  const owed = Math.max(0, balancePaisa);
  const clearsPaisa = Math.min(owed, amountPaisa);
  return {
    clearsPaisa,
    overpaidPaisa: Math.max(0, amountPaisa - owed),
    resulting: positionOf(balancePaisa - amountPaisa),
  };
}
