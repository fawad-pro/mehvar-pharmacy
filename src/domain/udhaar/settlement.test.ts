import { describe, expect, it } from 'vitest';

import { miniStatement, validateSettlementDraft } from './settlement';

describe('settlement validation (W3)', () => {
  it('accepts a positive amount against a named customer', () => {
    const result = validateSettlementDraft({ customerId: 'cust-1', amountPaisa: 50_000 });
    expect(result).toEqual({ ok: true, value: { customerId: 'cust-1', amountPaisa: 50_000 } });
  });

  it('requires a customer', () => {
    expect(validateSettlementDraft({ customerId: null, amountPaisa: 500 })).toEqual({
      ok: false,
      rejections: [{ reason: 'customer_required' }],
    });
  });

  it('requires a positive amount', () => {
    expect(validateSettlementDraft({ customerId: 'c', amountPaisa: 0 }).ok).toBe(false);
    expect(validateSettlementDraft({ customerId: 'c', amountPaisa: -500 }).ok).toBe(false);
    expect(validateSettlementDraft({ customerId: 'c', amountPaisa: Number.NaN }).ok).toBe(false);
  });

  it('places no ceiling on the amount — an overpayment is legal (invariant 3 has no floor)', () => {
    // "500 de do, baqi baad mein" cuts both ways: nothing in the plan says a
    // payment cannot exceed the balance, and refusing it would invent a rule.
    const result = validateSettlementDraft({ customerId: 'c', amountPaisa: 999_999_999 });
    expect(result.ok).toBe(true);
  });

  it('reports every problem at once', () => {
    const result = validateSettlementDraft({ customerId: null, amountPaisa: -1 });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.rejections).toHaveLength(2);
    }
  });
});

describe('the mini-statement — the dispute-ender (T4/T5)', () => {
  it('computes new balance for a payment (negative delta)', () => {
    // Rashid owed 1,000; pays 500 de do.
    expect(miniStatement(100_000, -50_000)).toEqual({
      previousBalancePaisa: 100_000,
      amountPaisa: -50_000,
      newBalancePaisa: 50_000,
    });
  });

  it('computes new balance for udhaar extended on a sale (positive delta)', () => {
    expect(miniStatement(50_000, 35_000)).toEqual({
      previousBalancePaisa: 50_000,
      amountPaisa: 35_000,
      newBalancePaisa: 85_000,
    });
  });

  it('lets a customer go into credit', () => {
    // An overpayment: 300 owed, 500 paid — the shop now owes the customer 200.
    expect(miniStatement(30_000, -50_000).newBalancePaisa).toBe(-20_000);
  });
});
