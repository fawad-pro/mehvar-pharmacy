import { describe, expect, it } from 'vitest';

import { summariseSupplierBook, supplierPaymentEffect } from './supplier-position';

describe('summariseSupplierBook (PCN-011)', () => {
  it('reports owed and credit separately, never netted', () => {
    // A owes nothing, holds 5,600 credit; B holds 2,000; C is owed 10,000.
    expect(summariseSupplierBook([-5_600, -2_000, 10_000])).toEqual({
      owedPaisa: 10_000,
      creditPaisa: 7_600,
      suppliersOwed: 1,
      suppliersInCredit: 2,
    });
  });

  it('counts a settled supplier in neither', () => {
    expect(summariseSupplierBook([0, 0])).toEqual({
      owedPaisa: 0,
      creditPaisa: 0,
      suppliersOwed: 0,
      suppliersInCredit: 0,
    });
  });

  it('never lets a credit with one supplier hide a debt to another', () => {
    const book = summariseSupplierBook([30_000, -30_000]);
    expect(book.owedPaisa).toBe(30_000);
    expect(book.creditPaisa).toBe(30_000);
  });
});

describe('supplierPaymentEffect (PCN-011)', () => {
  it('a payment within what is owed leaves no credit', () => {
    expect(supplierPaymentEffect(28_000, 20_000)).toEqual({
      clearsPaisa: 20_000,
      leavesCreditPaisa: 0,
    });
  });

  it('paying exactly what is owed clears it', () => {
    expect(supplierPaymentEffect(28_000, 28_000)).toEqual({
      clearsPaisa: 28_000,
      leavesCreditPaisa: 0,
    });
  });

  it('the part beyond what is owed becomes credit with the supplier', () => {
    expect(supplierPaymentEffect(28_000, 30_000)).toEqual({
      clearsPaisa: 28_000,
      leavesCreditPaisa: 2_000,
    });
  });

  it('paying a supplier already in credit adds wholly to the credit', () => {
    expect(supplierPaymentEffect(-5_600, 1_000)).toEqual({
      clearsPaisa: 0,
      leavesCreditPaisa: 1_000,
    });
  });
});
