import { describe, expect, it } from 'vitest';

import {
  creditAgainstStockCost,
  defaultReturnCreditPaisa,
  validateSupplierReturn,
} from './supplier-return';

describe('a return to the supplier (PCN-009)', () => {
  it('needs a whole, positive quantity and a credit of zero or more', () => {
    expect(validateSupplierReturn({ qtyBase: 5, creditPaisa: 0 })).toEqual({ ok: true });
    expect(validateSupplierReturn({ qtyBase: 0, creditPaisa: 100 })).toEqual({
      ok: false,
      reason: 'invalid_quantity',
    });
    expect(validateSupplierReturn({ qtyBase: 2.5, creditPaisa: 100 })).toEqual({
      ok: false,
      reason: 'invalid_quantity',
    });
    expect(validateSupplierReturn({ qtyBase: 5, creditPaisa: -1 })).toEqual({
      ok: false,
      reason: 'negative_credit',
    });
  });

  it('suggests a credit at what the returned units cost the shop', () => {
    // 2 boxes of 100 tablets at Rs 640 a box: 3 strips of 10 cost Rs 192.00.
    expect(defaultReturnCreditPaisa({ totalPaisa: 128_000, receivedBase: 200 }, 0, 30)).toBe(
      19_200,
    );
  });

  it('is exact where a per-unit cost is not (PCN-012)', () => {
    // A box of 14 capsules at Rs 250: a strip of 7 is Rs 125.00. The rounded
    // per-capsule cost (Rs 17.86) would have suggested Rs 125.02.
    const box = { totalPaisa: 25_000, receivedBase: 14 };
    expect(defaultReturnCreditPaisa(box, 0, 7)).toBe(12_500);
    // The second strip is the rest of the box, exactly.
    expect(defaultReturnCreditPaisa(box, 7, 7)).toBe(12_500);
    // After 3 capsules sold, a strip takes its cumulative share: the two
    // movements still add up to the box.
    const sold = defaultReturnCreditPaisa(box, 0, 3);
    expect(sold + defaultReturnCreditPaisa(box, 3, 7) + defaultReturnCreditPaisa(box, 10, 4)).toBe(
      25_000,
    );
  });

  it('spreads the cost over bonus units, as PCN-009’s effective cost does', () => {
    // 10 boxes bought at Rs 640 with 1 free: 11 boxes received for Rs 6,400.
    // One box back is ⌈6,400 × 1 ÷ 11⌉ = Rs 581.82, not the invoice Rs 640.
    expect(defaultReturnCreditPaisa({ totalPaisa: 640_000, receivedBase: 1_100 }, 0, 100)).toBe(
      58_182,
    );
  });

  it('says how the credit compares with the stock cost, and nothing when they match', () => {
    expect(creditAgainstStockCost(19_200, 19_200)).toBe('');
    expect(creditAgainstStockCost(18_000, 19_200)).toBe('12.00 below stock cost');
    expect(creditAgainstStockCost(20_000, 19_200)).toBe('8.00 above stock cost');
  });
});
