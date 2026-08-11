/**
 * [PCN-006] Pure rules for a supplier payment — the payable mirror of the
 * settlement draft rules.
 */

import { describe, expect, it } from 'vitest';

import { validateSupplierPayment } from './supplier-payment-command';
import { uuidv7 } from '@/lib/uuid';

describe('validateSupplierPayment', () => {
  it('accepts a positive amount against a named supplier', () => {
    expect(validateSupplierPayment({ supplierId: uuidv7(), amountPaisa: 5000 }).ok).toBe(true);
  });

  it('rejects a payment with no supplier', () => {
    const result = validateSupplierPayment({ supplierId: '' as never, amountPaisa: 5000 });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('supplier_required');
    }
  });

  it('rejects a zero or negative amount', () => {
    for (const amountPaisa of [0, -1]) {
      const result = validateSupplierPayment({ supplierId: uuidv7(), amountPaisa });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.reason).toBe('amount_not_positive');
      }
    }
  });
});
