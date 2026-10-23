import { describe, expect, it } from 'vitest';

import { defaultReturnCreditPaisa, validateSupplierReturn } from './supplier-return';

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
    expect(defaultReturnCreditPaisa(12, 227)).toBe(2_724);
  });
});
