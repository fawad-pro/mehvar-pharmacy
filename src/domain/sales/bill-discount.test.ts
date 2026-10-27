import { describe, expect, it } from 'vitest';

import { paisa } from '@/lib/branded';

import { billDiscountFromCollect, billDiscountNeedsApproval } from './cart';

/** [PCN-014] The amount to collect, and the cap on all discounts together. */
describe('billDiscountFromCollect', () => {
  it('Rs 2,080 collected as Rs 2,000 is a Rs 80 discount', () => {
    expect(billDiscountFromCollect(paisa(208_000), '2000')).toEqual({
      ok: true,
      discountPaisa: 8_000,
    });
  });

  it('is a final figure: the same amount typed again is the same discount', () => {
    const once = billDiscountFromCollect(paisa(208_000), '2000');
    const twice = billDiscountFromCollect(paisa(208_000), '2000');
    expect(twice).toEqual(once);
  });

  it('collecting the whole bill clears the discount', () => {
    expect(billDiscountFromCollect(paisa(208_000), '2080')).toEqual({ ok: true, discountPaisa: 0 });
  });

  it('refuses more than the bill, and junk — never reading it as Rs 0', () => {
    expect(billDiscountFromCollect(paisa(208_000), '2100')).toEqual({
      ok: false,
      reason: 'above_bill',
    });
    expect(billDiscountFromCollect(paisa(208_000), 'abc')).toEqual({
      ok: false,
      reason: 'not_an_amount',
    });
    expect(billDiscountFromCollect(paisa(208_000), '')).toEqual({
      ok: false,
      reason: 'not_an_amount',
    });
  });
});

describe('billDiscountNeedsApproval', () => {
  const bill = { grossPaisa: paisa(213_000), capPercent: 10 };

  it('the note’s bill: Rs 50 item + Rs 80 bill on Rs 2,130 is within 10%', () => {
    expect(
      billDiscountNeedsApproval({
        ...bill,
        itemDiscountPaisa: paisa(5_000),
        billDiscountPaisa: paisa(8_000),
      }),
    ).toBe(false);
  });

  it('item and bill discounts are capped together, so they cannot be stacked', () => {
    // Rs 200 off items and Rs 100 off the bill: each under 10%, together 14%.
    expect(
      billDiscountNeedsApproval({
        ...bill,
        itemDiscountPaisa: paisa(20_000),
        billDiscountPaisa: paisa(10_000),
      }),
    ).toBe(true);
  });

  it('exactly at the cap needs no one; a paisa over it does', () => {
    const at = { ...bill, itemDiscountPaisa: paisa(0), billDiscountPaisa: paisa(21_300) };
    expect(billDiscountNeedsApproval(at)).toBe(false);
    expect(billDiscountNeedsApproval({ ...at, billDiscountPaisa: paisa(21_301) })).toBe(true);
  });

  it('a cap of 0 means every bill discount needs the owner', () => {
    expect(
      billDiscountNeedsApproval({
        grossPaisa: paisa(100_000),
        capPercent: 0,
        itemDiscountPaisa: paisa(0),
        billDiscountPaisa: paisa(1),
      }),
    ).toBe(true);
  });

  it('no bill discount needs no approval, whatever the item discounts', () => {
    expect(
      billDiscountNeedsApproval({
        ...bill,
        itemDiscountPaisa: paisa(100_000),
        billDiscountPaisa: paisa(0),
      }),
    ).toBe(false);
  });
});
