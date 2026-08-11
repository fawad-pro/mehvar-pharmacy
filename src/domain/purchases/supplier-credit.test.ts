/**
 * [PCN-006] Pure rules for purchases on supplier credit.
 *
 * The invoice-cost and paid-in-full derivations, and the two new rejections,
 * checked without a database — they are arithmetic and guards, exactly the
 * "pure calculators, trivially testable" Phase 11 §2 wants.
 */

import { describe, expect, it } from 'vitest';

import {
  effectiveCashPaidPaisa,
  invoiceCostPaisa,
  validatePurchaseCommand,
  type PurchaseCommand,
  type PurchaseLineCommand,
} from './purchase-command';
import { uuidv7 } from '@/lib/uuid';

function line(overrides: Partial<PurchaseLineCommand> = {}): PurchaseLineCommand {
  return {
    lineId: uuidv7(),
    productId: uuidv7(),
    qtyBase: 10,
    bonusQtyBase: 0,
    unitCostPaisa: 300,
    expiryDate: '2027-06-30',
    batchNumber: null,
    mrpAtReceivingPaisa: null,
    priceAtReceivingPaisa: 350,
    ...overrides,
  };
}

function command(overrides: Partial<PurchaseCommand> = {}): PurchaseCommand {
  return {
    purchaseId: uuidv7(),
    supplierId: uuidv7(),
    invoiceRef: null,
    invoiceDate: null,
    note: null,
    lines: [line()],
    ...overrides,
  };
}

describe('invoiceCostPaisa', () => {
  it('sums qty × unit cost, and bonus units are free', () => {
    const cmd = command({
      // 10 × 300 + 5 × 200 = 4000, the two bonus units add nothing.
      lines: [line({ qtyBase: 10, unitCostPaisa: 300, bonusQtyBase: 3 }), line({ qtyBase: 5, unitCostPaisa: 200 })],
    });
    expect(invoiceCostPaisa(cmd)).toBe(10 * 300 + 5 * 200);
  });
});

describe('effectiveCashPaidPaisa', () => {
  it('defaults to the whole invoice when unset — "paid in full"', () => {
    const cmd = command();
    expect(cmd.cashPaidPaisa).toBeUndefined();
    expect(effectiveCashPaidPaisa(cmd)).toBe(invoiceCostPaisa(cmd));
  });

  it('is the stated figure when the operator paid less', () => {
    const cmd = command({ cashPaidPaisa: 1000 });
    expect(effectiveCashPaidPaisa(cmd)).toBe(1000);
  });
});

describe('validatePurchaseCommand — supplier credit', () => {
  it('accepts a fully-paid purchase with no supplier (the ordinary cash case)', () => {
    expect(validatePurchaseCommand(command({ supplierId: null })).ok).toBe(true);
  });

  it('accepts partial payment when a supplier is named', () => {
    expect(validatePurchaseCommand(command({ cashPaidPaisa: 1000 })).ok).toBe(true);
  });

  it('rejects credit without a supplier — the mirror of credit_without_customer', () => {
    const result = validatePurchaseCommand(command({ supplierId: null, cashPaidPaisa: 1000 }));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('credit_without_supplier');
    }
  });

  it('rejects a negative amount paid', () => {
    const result = validatePurchaseCommand(command({ cashPaidPaisa: -1 }));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('negative_cash_paid');
    }
  });

  it('allows an overpayment (a supplier advance) without special-casing', () => {
    const cmd = command({ cashPaidPaisa: invoiceCostPaisa(command()) + 500 });
    expect(validatePurchaseCommand(cmd).ok).toBe(true);
  });
});
