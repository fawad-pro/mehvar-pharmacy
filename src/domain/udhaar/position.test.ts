/**
 * The udhaar vocabulary, and the netting bug it exists to prevent.
 *
 * The assertion that matters most here is `summariseBook`'s: debts and advances
 * are reported separately and never netted. That is not a style preference —
 * netting is what let one screen say "owed to you −Rs 100" while another said
 * "Rs 20 outstanding" from the same records.
 */

import { describe, expect, it } from 'vitest';

import {
  positionLabel,
  positionOf,
  settlementEffect,
  summariseBook,
} from './position';

describe('reading a balance as a position', () => {
  it('calls a debt what it is, with a positive number', () => {
    expect(positionOf(2_000)).toEqual({ kind: 'owes', amountPaisa: 2_000 });
  });

  it('calls an overpayment an advance, also with a positive number', () => {
    expect(positionOf(-10_000)).toEqual({ kind: 'in_credit', amountPaisa: 10_000 });
  });

  it('has a word for zero, rather than showing "Rs 0.00 owed"', () => {
    expect(positionOf(0)).toEqual({ kind: 'settled', amountPaisa: 0 });
  });

  it('never yields a negative amount, whatever the balance', () => {
    for (const balance of [-999_999, -1, 0, 1, 999_999]) {
      expect(positionOf(balance).amountPaisa).toBeGreaterThanOrEqual(0);
    }
  });

  it('speaks the shop’s language, not an accountant’s', () => {
    expect(positionLabel('owes')).toBe('Owes you');
    expect(positionLabel('in_credit')).toBe('Advance paid');
    expect(positionLabel('settled')).toBe('Settled up');
  });
});

describe('summarising the book', () => {
  it('never nets an advance against someone else’s debt', () => {
    // The exact shape of the reported bug: one customer owing 20, another
    // holding a 100 advance. Netted, this book reads as -80 "owed to you".
    const book = summariseBook([2_000, -10_000]);

    expect(book.owedPaisa).toBe(2_000);
    expect(book.creditPaisa).toBe(10_000);
    expect(book.customersOwing).toBe(1);
    expect(book.customersInCredit).toBe(1);
  });

  it('reports nothing owed when every customer is in credit', () => {
    const book = summariseBook([-500, -1_500]);

    expect(book.owedPaisa).toBe(0);
    expect(book.creditPaisa).toBe(2_000);
  });

  it('ignores settled customers on both counts', () => {
    const book = summariseBook([0, 0, 3_000]);

    expect(book).toEqual({
      owedPaisa: 3_000,
      creditPaisa: 0,
      customersOwing: 1,
      customersInCredit: 0,
    });
  });

  it('is empty for an empty book rather than undefined', () => {
    expect(summariseBook([])).toEqual({
      owedPaisa: 0,
      creditPaisa: 0,
      customersOwing: 0,
      customersInCredit: 0,
    });
  });
});

describe('what a payment will do', () => {
  it('clears the debt exactly when the amount matches', () => {
    const effect = settlementEffect(2_000, 2_000);

    expect(effect.clearsPaisa).toBe(2_000);
    expect(effect.overpaidPaisa).toBe(0);
    expect(effect.resulting.kind).toBe('settled');
  });

  it('splits an overpayment into what it clears and what it leaves', () => {
    // Rs 500 against a Rs 20 debt: legal, allowed, and previously silent.
    const effect = settlementEffect(2_000, 50_000);

    expect(effect.clearsPaisa).toBe(2_000);
    expect(effect.overpaidPaisa).toBe(48_000);
    expect(effect.resulting).toEqual({ kind: 'in_credit', amountPaisa: 48_000 });
  });

  it('treats every rupee as an advance when nothing is owed', () => {
    const effect = settlementEffect(0, 10_000);

    expect(effect.clearsPaisa).toBe(0);
    expect(effect.overpaidPaisa).toBe(10_000);
    expect(effect.resulting).toEqual({ kind: 'in_credit', amountPaisa: 10_000 });
  });

  it('adds to an existing advance rather than clearing anything', () => {
    const effect = settlementEffect(-10_000, 5_000);

    expect(effect.clearsPaisa).toBe(0);
    expect(effect.overpaidPaisa).toBe(5_000);
    expect(effect.resulting).toEqual({ kind: 'in_credit', amountPaisa: 15_000 });
  });

  it('leaves a partial payment still owing — "500 de do" is the norm (W3)', () => {
    const effect = settlementEffect(50_000, 20_000);

    expect(effect.clearsPaisa).toBe(20_000);
    expect(effect.overpaidPaisa).toBe(0);
    expect(effect.resulting).toEqual({ kind: 'owes', amountPaisa: 30_000 });
  });
});
