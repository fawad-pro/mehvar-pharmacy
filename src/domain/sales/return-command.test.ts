import { describe, expect, it } from 'vitest';

import {
  refundForLine,
  totalRefundPaisa,
  validateReturnCommand,
  type ReturnCommand,
  type ReturnableSaleLine,
} from './return-command';

const LINE: ReturnableSaleLine = {
  saleLineId: 'line-1',
  qtyBase: 10,
  alreadyReturnedBase: 0,
  unitPricePaisa: 350,
  lineDiscountPaisa: 0,
};

function command(overrides: Partial<ReturnCommand> = {}): ReturnCommand {
  return {
    returnId: 'return-1',
    saleId: 'sale-1',
    receiptNumber: 'A-1',
    lines: [{ saleLineId: 'line-1', qtyBase: 3, restockBatchId: 'batch-1' }],
    refundMethod: 'cash',
    reasonNote: null,
    ...overrides,
  };
}

describe('refundForLine', () => {
  it('refunds proportionally to what was actually charged', () => {
    // 10 units at 350 paisa = 3,500 charged; returning 3 refunds 3/10 of that.
    expect(refundForLine(LINE, 3)).toBe(1_050);
  });

  it('nets out the line discount before dividing', () => {
    const discounted: ReturnableSaleLine = { ...LINE, lineDiscountPaisa: 500 };
    // Charged 3,000 total ÷ 10 units × 3 returned = 900.
    expect(refundForLine(discounted, 3)).toBe(900);
  });

  it('floors rather than rounding in the customer’s favour', () => {
    // 7 units charged 100 total (an odd sale, e.g. a bulk discount) ÷ 7 × 2
    // returned = 28.57… → 28, never 29.
    const uneven: ReturnableSaleLine = { ...LINE, qtyBase: 7, unitPricePaisa: 100, lineDiscountPaisa: 600 };
    expect(refundForLine(uneven, 2)).toBe(28);
  });

  it('refunds the whole line when the whole line is returned', () => {
    expect(refundForLine(LINE, 10)).toBe(3_500);
  });
});

describe('totalRefundPaisa', () => {
  it('sums refunds across every returned line', () => {
    const secondLine: ReturnableSaleLine = {
      saleLineId: 'line-2',
      qtyBase: 5,
      alreadyReturnedBase: 0,
      unitPricePaisa: 720,
      lineDiscountPaisa: 0,
    };
    const cmd = command({
      lines: [
        { saleLineId: 'line-1', qtyBase: 3, restockBatchId: 'batch-1' },
        { saleLineId: 'line-2', qtyBase: 2, restockBatchId: null },
      ],
    });
    // line-1: 3,500 charged ÷ 10 × 3 = 1,050. line-2: 3,600 charged ÷ 5 × 2 = 1,440.
    expect(totalRefundPaisa(cmd, [LINE, secondLine])).toBe(1_050 + 1_440);
  });
});

describe('validateReturnCommand', () => {
  it('accepts a return within what was sold', () => {
    const result = validateReturnCommand(command(), { hasCustomer: false }, [LINE]);
    expect(result.ok).toBe(true);
  });

  it('rejects an empty return', () => {
    const result = validateReturnCommand(
      command({ lines: [] }),
      { hasCustomer: false },
      [LINE],
    );
    expect(result).toEqual({ ok: false, reason: 'empty_return' });
  });

  it('rejects a non-positive quantity', () => {
    const result = validateReturnCommand(
      command({ lines: [{ saleLineId: 'line-1', qtyBase: 0, restockBatchId: null }] }),
      { hasCustomer: false },
      [LINE],
    );
    expect(result).toEqual({ ok: false, reason: 'invalid_quantity', saleLineId: 'line-1' });
  });

  it('rejects returning more than was sold', () => {
    const result = validateReturnCommand(
      command({ lines: [{ saleLineId: 'line-1', qtyBase: 11, restockBatchId: null }] }),
      { hasCustomer: false },
      [LINE],
    );
    expect(result).toEqual({
      ok: false,
      reason: 'exceeds_sold_quantity',
      saleLineId: 'line-1',
    });
  });

  it('rejects returning more than what remains after a prior return', () => {
    const partiallyReturned: ReturnableSaleLine = { ...LINE, alreadyReturnedBase: 8 };
    const result = validateReturnCommand(
      command({ lines: [{ saleLineId: 'line-1', qtyBase: 3, restockBatchId: null }] }),
      { hasCustomer: false },
      [partiallyReturned],
    );
    expect(result).toEqual({
      ok: false,
      reason: 'exceeds_sold_quantity',
      saleLineId: 'line-1',
    });
  });

  it('rejects a credit refund against a sale with no customer', () => {
    const result = validateReturnCommand(
      command({ refundMethod: 'credit' }),
      { hasCustomer: false },
      [LINE],
    );
    expect(result).toEqual({ ok: false, reason: 'credit_requires_customer' });
  });

  it('allows a credit refund when the sale has a customer', () => {
    const result = validateReturnCommand(
      command({ refundMethod: 'credit' }),
      { hasCustomer: true },
      [LINE],
    );
    expect(result.ok).toBe(true);
  });
});
