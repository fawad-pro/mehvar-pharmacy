import { describe, expect, it } from 'vitest';

import { refundForLine, type ReturnableSaleLine } from './return-command';
import { invoiceDiscountShares } from './sale-command';

/** [PCN-014] How a bill discount falls on its lines, and what a return gives back. */
describe('invoiceDiscountShares', () => {
  it('the note’s bill: Rs 80 on 450 and 1,630, exact to the paisa', () => {
    const shares = invoiceDiscountShares(
      [
        { id: 'a', totalPaisa: 45_000 },
        { id: 'b', totalPaisa: 163_000 },
      ],
      8_000,
    );
    expect([...shares.values()]).toEqual([1_731, 6_269]);
  });

  it('always sums to exactly the discount', () => {
    // Totals chosen so every share has a remainder.
    const lines = [7, 11, 13, 17, 19].map((total, index) => ({
      id: `l${index}`,
      totalPaisa: total,
    }));
    for (const discount of [1, 2, 3, 10, 66, 67]) {
      const shares = invoiceDiscountShares(lines, discount);
      expect([...shares.values()].reduce((sum, share) => sum + share, 0)).toBe(discount);
    }
  });

  it('equal remainders go to the line whose id sorts first, whatever order they come in', () => {
    const forward = invoiceDiscountShares(
      [
        { id: 'x', totalPaisa: 100 },
        { id: 'y', totalPaisa: 100 },
      ],
      1,
    );
    const backward = invoiceDiscountShares(
      [
        { id: 'y', totalPaisa: 100 },
        { id: 'x', totalPaisa: 100 },
      ],
      1,
    );
    expect(forward.get('x')).toBe(1);
    expect(backward.get('x')).toBe(1);
    expect(backward.get('y')).toBe(0);
  });

  it('no discount, or nothing to share it over, gives every line nothing', () => {
    expect([...invoiceDiscountShares([{ id: 'a', totalPaisa: 500 }], 0).values()]).toEqual([0]);
    expect([...invoiceDiscountShares([{ id: 'a', totalPaisa: 0 }], 100).values()]).toEqual([0]);
  });

  it('a line given away free carries none of it', () => {
    const shares = invoiceDiscountShares(
      [
        { id: 'free', totalPaisa: 0 },
        { id: 'paid', totalPaisa: 1_000 },
      ],
      100,
    );
    expect(shares.get('free')).toBe(0);
    expect(shares.get('paid')).toBe(100);
  });
});

describe('refundForLine, cumulative', () => {
  const line: ReturnableSaleLine = {
    saleLineId: 'line',
    qtyBase: 3,
    alreadyReturnedBase: 0,
    unitPricePaisa: 0,
    lineAmountPaisa: 1_000,
    lineDiscountPaisa: 0,
    invoiceDiscountSharePaisa: 0,
  };

  it('three tablets of a Rs 10.00 line, one at a time, refund exactly Rs 10.00', () => {
    // Rounding each return alone refunded 3.33 three times: Rs 9.99.
    const parts = [0, 1, 2].map((already) =>
      refundForLine({ ...line, alreadyReturnedBase: already }, 1),
    );
    expect(parts).toEqual([333, 333, 334]);
    expect(parts.reduce((sum, part) => sum + part, 0)).toBe(1_000);
  });

  it('a partial return rounds down, never in the customer’s favour', () => {
    expect(refundForLine(line, 1)).toBe(333);
  });

  it('refunds what the line paid, net of its bill-discount share', () => {
    expect(
      refundForLine({ ...line, lineDiscountPaisa: 100, invoiceDiscountSharePaisa: 50 }, 3),
    ).toBe(850);
  });
});
