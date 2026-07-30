import { describe, expect, it } from 'vitest';

import { baseQty, paisa } from '@/lib/branded';

import {
  addToCart,
  cartTotals,
  isPriceOverridden,
  lineTotal,
  paisaFromRupeeInput,
  removeLine,
  splitPayment,
  updateLine,
  type CartLine,
} from './cart';

function line(overrides: Partial<CartLine> = {}): CartLine {
  return {
    lineId: 'line-1',
    productId: 'panadol',
    name: 'Panadol',
    baseUnitName: 'tab',
    packLevels: [{ name: 'strip', factor: 10 }],
    qtyBase: baseQty(10),
    enteredUnitLevel: 'strip',
    unitPricePaisa: paisa(350),
    catalogPricePaisa: paisa(350),
    lineDiscountPaisa: paisa(0),
    ...overrides,
  };
}

describe('line totals', () => {
  it('multiplies price by quantity in base units', () => {
    expect(lineTotal(line())).toBe(3_500);
  });

  it('subtracts the line discount', () => {
    expect(lineTotal(line({ lineDiscountPaisa: paisa(500) }))).toBe(3_000);
  });

  it('never goes negative, however large the discount', () => {
    expect(lineTotal(line({ lineDiscountPaisa: paisa(99_999) }))).toBe(0);
  });

  it('handles a sub-strip quantity — the sale that competitors get wrong (W5)', () => {
    // 4 loose tablets at Rs 3.50 each.
    expect(lineTotal(line({ qtyBase: baseQty(4), enteredUnitLevel: 'tab' }))).toBe(1_400);
  });
});

describe('cart totals — Phase 5 invariant 4', () => {
  it('sums line totals into the subtotal', () => {
    const totals = cartTotals([
      line({ lineId: 'a' }),
      line({ lineId: 'b', qtyBase: baseQty(4), unitPricePaisa: paisa(900) }),
    ]);

    expect(totals.subtotalPaisa).toBe(3_500 + 3_600);
    expect(totals.totalPaisa).toBe(7_100);
    expect(totals.lineCount).toBe(2);
    expect(totals.itemCount).toBe(14);
  });

  it('total = subtotal − invoice discount, exactly', () => {
    const totals = cartTotals([line()], paisa(600));
    expect(totals.totalPaisa).toBe(2_900);
    expect(totals.subtotalPaisa).toBe(3_500);
    expect(totals.invoiceDiscountPaisa).toBe(600);
  });

  it('clamps an over-large invoice discount rather than going negative', () => {
    // Rounding a total down to a friendly number is routine (Phase 1 §5); a
    // fat-fingered discount must not produce a total no drawer can honour.
    const totals = cartTotals([line()], paisa(99_999));
    expect(totals.totalPaisa).toBe(0);
    expect(totals.invoiceDiscountPaisa).toBe(3_500);
  });

  it('is zero for an empty cart', () => {
    expect(cartTotals([]).totalPaisa).toBe(0);
  });
});

describe('payment split', () => {
  it('applies cash first and puts the remainder on credit (W2)', () => {
    expect(splitPayment(paisa(10_000), paisa(3_000))).toEqual({
      cashPaisa: 3_000,
      creditPaisa: 7_000,
      changePaisa: 0,
    });
  });

  it('a full cash sale carries no credit', () => {
    expect(splitPayment(paisa(10_000), paisa(10_000))).toEqual({
      cashPaisa: 10_000,
      creditPaisa: 0,
      changePaisa: 0,
    });
  });

  it('a full udhaar sale carries no cash', () => {
    expect(splitPayment(paisa(10_000), paisa(0))).toEqual({
      cashPaisa: 0,
      creditPaisa: 10_000,
      changePaisa: 0,
    });
  });

  it('treats cash beyond the total as change, not overpayment', () => {
    const split = splitPayment(paisa(8_500), paisa(10_000));
    expect(split).toEqual({ cashPaisa: 8_500, creditPaisa: 0, changePaisa: 1_500 });
    // The invariant the schema enforces: cash + credit = total, exactly.
    expect(split.cashPaisa + split.creditPaisa).toBe(8_500);
  });
});

describe('adding to the cart', () => {
  it('merges a repeat scan into the existing line', () => {
    // Three strips of the same thing should read "3 strip", not three rows.
    const first = addToCart([], line({ lineId: 'a' }));
    const second = addToCart(first, line({ lineId: 'b' }));

    expect(second).toHaveLength(1);
    expect(second[0]?.qtyBase).toBe(20);
  });

  it('keeps a different unit level as its own line', () => {
    const cart = addToCart(
      [line({ lineId: 'a', enteredUnitLevel: 'strip' })],
      line({ lineId: 'b', enteredUnitLevel: 'tab', qtyBase: baseQty(4) }),
    );
    expect(cart).toHaveLength(2);
  });

  it('never merges into a line whose price was overridden', () => {
    // Merging would silently reprice the operator's decision.
    const overridden = line({ lineId: 'a', unitPricePaisa: paisa(300) });
    const cart = addToCart([overridden], line({ lineId: 'b' }));

    expect(cart).toHaveLength(2);
    expect(cart[0]?.unitPricePaisa).toBe(300);
  });

  it('keeps a different product separate', () => {
    const cart = addToCart([line({ lineId: 'a' })], line({ lineId: 'b', productId: 'brufen' }));
    expect(cart).toHaveLength(2);
  });
});

describe('editing lines in place (Phase 10 §4)', () => {
  it('changes quantity', () => {
    const cart = updateLine([line()], 'line-1', { qtyBase: baseQty(30) });
    expect(cart[0]?.qtyBase).toBe(30);
  });

  it('changes price, and the change is detectable as an override (T1)', () => {
    const cart = updateLine([line()], 'line-1', { unitPricePaisa: paisa(300) });
    expect(isPriceOverridden(cart[0]!)).toBe(true);
    expect(isPriceOverridden(line())).toBe(false);
  });

  it('leaves other lines alone', () => {
    const cart = updateLine([line({ lineId: 'a' }), line({ lineId: 'b' })], 'a', {
      qtyBase: baseQty(1),
    });
    expect(cart[1]?.qtyBase).toBe(10);
  });

  it('removes a line', () => {
    expect(removeLine([line({ lineId: 'a' }), line({ lineId: 'b' })], 'a')).toHaveLength(1);
  });
});

describe('rupee input', () => {
  it('converts to paisa', () => {
    expect(paisaFromRupeeInput('3.50')).toBe(350);
    expect(paisaFromRupeeInput('  12 ')).toBe(1_200);
  });

  it('treats junk and negatives as zero rather than throwing mid-sale (P2)', () => {
    expect(paisaFromRupeeInput('')).toBe(0);
    expect(paisaFromRupeeInput('abc')).toBe(0);
    expect(paisaFromRupeeInput('-5')).toBe(0);
  });
});
