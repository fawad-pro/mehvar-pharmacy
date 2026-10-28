import { describe, expect, it } from 'vitest';

import { paisa } from '@/lib/branded';

import { billDiscountFromInput, billDiscountNeedsApproval } from './cart';

/** [PCN-014, PCN-015] What comes off the bill, and the cap on all discounts together. */
describe('billDiscountFromInput', () => {
  it('Rs 80 off a Rs 2,080 bill is a Rs 80 discount', () => {
    expect(billDiscountFromInput(paisa(208_000), '80')).toEqual({
      ok: true,
      discountPaisa: 8_000,
    });
  });

  it('takes a share of the bill, as a line discount does', () => {
    expect(billDiscountFromInput(paisa(208_000), '10%')).toEqual({
      ok: true,
      discountPaisa: 20_800,
    });
    // Rounded to the paisa: 2.5% of Rs 705.00 is Rs 17.625.
    expect(billDiscountFromInput(paisa(70_500), '2.5%')).toEqual({
      ok: true,
      discountPaisa: 1_763,
    });
  });

  it('replaces, never adds: the same text typed again is the same discount', () => {
    expect(billDiscountFromInput(paisa(208_000), '80')).toEqual(
      billDiscountFromInput(paisa(208_000), '80'),
    );
  });

  it('blank or 0 is no discount; the whole bill is allowed', () => {
    expect(billDiscountFromInput(paisa(208_000), '')).toEqual({ ok: true, discountPaisa: 0 });
    expect(billDiscountFromInput(paisa(208_000), ' 0 ')).toEqual({ ok: true, discountPaisa: 0 });
    expect(billDiscountFromInput(paisa(208_000), '100%')).toEqual({
      ok: true,
      discountPaisa: 208_000,
    });
  });

  it('refuses more than the bill, and junk — never reading it as Rs 0', () => {
    expect(billDiscountFromInput(paisa(208_000), '2100')).toEqual({
      ok: false,
      reason: 'above_bill',
    });
    expect(billDiscountFromInput(paisa(208_000), '101%')).toEqual({
      ok: false,
      reason: 'above_bill',
    });
    for (const junk of ['abc', '%', '-5', '10%%']) {
      expect(billDiscountFromInput(paisa(208_000), junk), junk).toEqual({
        ok: false,
        reason: 'not_an_amount',
      });
    }
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
