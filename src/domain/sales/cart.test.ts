import { describe, expect, it } from 'vitest';

import type { ProductUnit } from '@/domain/catalog/units';
import { paisa } from '@/lib/branded';

import {
  addToCart,
  cartTotals,
  grossSubtotalPaisa,
  isPriceOverridden,
  lineGrossPaisa,
  lineTotal,
  newCartLine,
  paisaFromRupeeInput,
  parseDiscountInput,
  removeLine,
  splitPayment,
  totalLineDiscountPaisa,
  updateLine,
  withQuantity,
  type CartLine,
} from './cart';

/** Panadol: a tablet at Rs 3.50, a strip of 10 at Rs 35, a box of 100 at Rs 330. */
const UNITS: ProductUnit[] = [
  { key: 'u0', name: 'tab', factor: 1, pricePaisa: 350, sell: true },
  { key: 'u1', name: 'strip', factor: 10, pricePaisa: 3_500, sell: true },
  { key: 'u2', name: 'box', factor: 100, pricePaisa: 33_000, sell: true },
];

function line(
  overrides: Partial<Pick<CartLine, 'lineId' | 'productId' | 'lineDiscountPaisa'>> & {
    unit?: string;
    count?: number;
    price?: number;
  } = {},
): CartLine {
  const { unit = 'strip', count = 1, price, ...rest } = overrides;
  const built = {
    ...newCartLine({
      lineId: 'line-1',
      productId: 'panadol',
      name: 'Panadol',
      baseUnitName: 'tab',
      packLevels: [
        { name: 'strip', factor: 10 },
        { name: 'box', factor: 100 },
      ],
      units: UNITS,
      unitName: unit,
      count,
    }),
    ...rest,
  };
  return price === undefined ? built : { ...built, pricePerUnitPaisa: paisa(price) };
}

describe('line totals — count × the price of one unit (PCN-012)', () => {
  it('a strip is the strip price', () => {
    expect(lineTotal(line())).toBe(3_500);
    expect(line().qtyBase).toBe(10);
  });

  it('a box is the box price exactly, not 100 × a tablet price', () => {
    expect(lineTotal(line({ unit: 'box' }))).toBe(33_000);
    expect(line({ unit: 'box' }).qtyBase).toBe(100);
  });

  it('a box of 14 at Rs 250 charges Rs 250.00', () => {
    const box14 = newCartLine({
      lineId: 'x',
      productId: 'p',
      name: 'Capsules',
      baseUnitName: 'cap',
      packLevels: [{ name: 'box', factor: 14 }],
      units: [
        { key: 'u0', name: 'cap', factor: 1, pricePaisa: 1_786, sell: true },
        { key: 'u1', name: 'box', factor: 14, pricePaisa: 25_000, sell: true },
      ],
      unitName: 'box',
      count: 3,
    });
    expect(lineTotal(box14)).toBe(75_000);
    expect(box14.qtyBase).toBe(42);
  });

  it('subtracts the line discount', () => {
    expect(lineTotal(line({ lineDiscountPaisa: paisa(500) }))).toBe(3_000);
  });

  it('never goes negative, however large the discount', () => {
    expect(lineTotal(line({ lineDiscountPaisa: paisa(99_999) }))).toBe(0);
  });

  it('handles loose tablets — the sale that competitors get wrong (W5)', () => {
    expect(lineTotal(line({ unit: 'tab', count: 4 }))).toBe(1_400);
  });

  it('an unknown unit name falls back to the smallest unit rather than failing a sale', () => {
    expect(line({ unit: 'carton' }).enteredUnitLevel).toBe('tab');
  });
});

describe('cart totals — Phase 5 invariant 4', () => {
  it('sums line totals into the subtotal, counting items in the units sold', () => {
    const totals = cartTotals([
      line({ lineId: 'a' }),
      line({ lineId: 'b', unit: 'tab', count: 4, price: 900 }),
    ]);

    expect(totals.subtotalPaisa).toBe(3_500 + 3_600);
    expect(totals.totalPaisa).toBe(7_100);
    expect(totals.lineCount).toBe(2);
    // One strip and four tablets: five items, not fourteen.
    expect(totals.itemCount).toBe(5);
  });

  it('total = subtotal − invoice discount, exactly', () => {
    const totals = cartTotals([line()], paisa(600));
    expect(totals.totalPaisa).toBe(2_900);
    expect(totals.subtotalPaisa).toBe(3_500);
    expect(totals.invoiceDiscountPaisa).toBe(600);
  });

  it('clamps an over-large invoice discount rather than going negative', () => {
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
    expect(split.cashPaisa + split.creditPaisa).toBe(8_500);
  });
});

describe('adding to the cart', () => {
  it('merges a repeat scan into the existing line', () => {
    const first = addToCart([], line({ lineId: 'a' }));
    const second = addToCart(first, line({ lineId: 'b' }));

    expect(second).toHaveLength(1);
    expect(second[0]?.unitCount).toBe(2);
    expect(second[0]?.qtyBase).toBe(20);
    expect(lineTotal(second[0]!)).toBe(7_000);
  });

  it('keeps a different unit as its own line', () => {
    const cart = addToCart([line({ lineId: 'a' })], line({ lineId: 'b', unit: 'tab', count: 4 }));
    expect(cart).toHaveLength(2);
  });

  it('never merges into a line whose price was overridden', () => {
    const overridden = line({ lineId: 'a', price: 3_000 });
    const cart = addToCart([overridden], line({ lineId: 'b' }));

    expect(cart).toHaveLength(2);
    expect(cart[0]?.pricePerUnitPaisa).toBe(3_000);
  });

  it('keeps a different product separate', () => {
    const cart = addToCart([line({ lineId: 'a' })], line({ lineId: 'b', productId: 'brufen' }));
    expect(cart).toHaveLength(2);
  });
});

describe('editing lines in place (Phase 10 §4)', () => {
  it('changes the count, keeping base units in step', () => {
    const cart = updateLine([line()], 'line-1', { unitCount: 3 });
    expect(cart[0]?.unitCount).toBe(3);
    expect(cart[0]?.qtyBase).toBe(30);
  });

  it('changing the unit re-prices at that unit’s own price', () => {
    const cart = updateLine([line({ count: 2 })], 'line-1', { unitKey: 'u2' });
    expect(cart[0]?.enteredUnitLevel).toBe('box');
    expect(cart[0]?.qtyBase).toBe(200);
    expect(lineTotal(cart[0]!)).toBe(66_000);
  });

  it('an override does not travel to another unit', () => {
    const overridden = line({ price: 3_000 });
    const asBox = withQuantity(overridden, 'u2', 1);
    expect(asBox.pricePerUnitPaisa).toBe(33_000);
    expect(isPriceOverridden(asBox)).toBe(false);
  });

  it('changes price, and the change is detectable as an override (T1)', () => {
    const cart = updateLine([line()], 'line-1', { pricePerUnitPaisa: paisa(3_000) });
    expect(isPriceOverridden(cart[0]!)).toBe(true);
    expect(isPriceOverridden(line())).toBe(false);
  });

  it('leaves other lines alone', () => {
    const cart = updateLine([line({ lineId: 'a' }), line({ lineId: 'b' })], 'a', {
      unitCount: 5,
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

  it('treats an amount too large to hold exactly as unreadable, never a throw', () => {
    // "12" typed into Unit cost, then a scanned EAN-13 that was not caught.
    expect(paisaFromRupeeInput('122030297825992')).toBe(0);
  });
});

describe('discount input — one field, one underlying amount', () => {
  const basis = paisa(10_000); // Rs 100.00 — a line's undiscounted gross

  it('reads a fixed PKR amount', () => {
    expect(parseDiscountInput('50', basis)).toBe(5_000);
    expect(parseDiscountInput('12.50', basis)).toBe(1_250);
  });

  it('reads a percentage of the basis, not of any other figure', () => {
    expect(parseDiscountInput('10%', basis)).toBe(1_000);
    expect(parseDiscountInput('7%', basis)).toBe(700);
  });

  it('tolerates surrounding whitespace on either mode', () => {
    expect(parseDiscountInput('  50  ', basis)).toBe(5_000);
    expect(parseDiscountInput(' 10 % ', basis)).toBe(1_000);
  });

  it('rereading the same percentage never compounds', () => {
    // The percentage is always of the SAME basis passed in — never of a
    // figure already reduced by a previous read of the same input.
    const first = parseDiscountInput('10%', basis);
    const second = parseDiscountInput('10%', basis);
    expect(first).toBe(second);
  });

  it('is zero for blank, junk, zero or negative input — never a negative discount', () => {
    // A negative discount would be a price ABOVE the catalogue price wearing a
    // discount's clothes, which this must never produce (Phase 5 invariant 4).
    expect(parseDiscountInput('', basis)).toBe(0);
    expect(parseDiscountInput('abc', basis)).toBe(0);
    expect(parseDiscountInput('0', basis)).toBe(0);
    expect(parseDiscountInput('-5', basis)).toBe(0);
    expect(parseDiscountInput('-5%', basis)).toBe(0);
  });

  it('clamps a fixed amount bigger than the line, same posture as cartTotals', () => {
    expect(parseDiscountInput('500', basis)).toBe(10_000);
  });

  it('clamps a percentage over 100 the same way', () => {
    expect(parseDiscountInput('150%', basis)).toBe(10_000);
  });

  it('is zero when there is nothing to discount, whatever is typed', () => {
    expect(parseDiscountInput('50', paisa(0))).toBe(0);
    expect(parseDiscountInput('10%', paisa(0))).toBe(0);
  });
});

describe('a per-line discount, applied through a real cart line', () => {
  it('lineGrossPaisa is the basis a percentage is taken of — not lineTotal', () => {
    // 10 tab at Rs 3.50 = Rs 35.00 gross, with no discount yet.
    const undiscounted = line();
    expect(lineGrossPaisa(undiscounted)).toBe(3_500);
    expect(lineTotal(undiscounted)).toBe(3_500);

    // Apply "10%" once: discount = 350, total = 3_150.
    const discounted = { ...undiscounted, lineDiscountPaisa: parseDiscountInput('10%', lineGrossPaisa(undiscounted)) };
    expect(discounted.lineDiscountPaisa).toBe(350);
    expect(lineTotal(discounted)).toBe(3_150);

    // Re-reading "10%" a second time, from the SAME line, must land on the
    // same 350 — not 10% of 3_150 (315), which would be the compounding bug
    // `lineGrossPaisa` (not `lineTotal`) as the basis exists to prevent.
    const rereadDiscount = parseDiscountInput('10%', lineGrossPaisa(discounted));
    expect(rereadDiscount).toBe(350);
  });

  it('a fixed-amount line discount reduces only that line, via the existing field', () => {
    const lines = [line({ lineId: 'a' }), line({ lineId: 'b', unit: 'tab', count: 4 })];
    const discounted = updateLine(lines, 'a', {
      lineDiscountPaisa: parseDiscountInput('5', lineGrossPaisa(lines[0]!)),
    });

    expect(lineTotal(discounted[0]!)).toBe(3_000); // 3_500 − 500
    expect(lineTotal(discounted[1]!)).toBe(1_400); // untouched

    const totals = cartTotals(discounted);
    expect(totals.subtotalPaisa).toBe(3_000 + 1_400);
    expect(totals.invoiceDiscountPaisa).toBe(0); // no invoice-level discount
  });
});

describe('the receipt figures — gross Subtotal and the summed Discount row', () => {
  it('no-discount sale: gross subtotal equals the total, and there is nothing to discount', () => {
    const lines = [line({ lineId: 'a' }), line({ lineId: 'b', unit: 'tab', count: 4 })];

    expect(grossSubtotalPaisa(lines)).toBe(3_500 + 1_400);
    expect(totalLineDiscountPaisa(lines)).toBe(0);
    expect(grossSubtotalPaisa(lines)).toBe(cartTotals(lines).totalPaisa);
  });

  it('discounted sale: gross subtotal is what the customer would have paid before any discount', () => {
    const lines = [
      line({ lineId: 'a', lineDiscountPaisa: paisa(500) }), // Rs 35.00 gross, Rs 5.00 off
      line({ lineId: 'b', unit: 'tab', count: 4 }), // Rs 14.00 gross, no discount
    ];

    // Subtotal is the GROSS figure — never lowered by a line's own discount,
    // which is exactly the bug this guards: `cartTotals.subtotalPaisa` sums
    // `lineTotal` (already net), so a receipt built from it showed Subtotal
    // and TOTAL as the identical number whenever a line was discounted.
    expect(grossSubtotalPaisa(lines)).toBe(3_500 + 1_400);
    expect(totalLineDiscountPaisa(lines)).toBe(500);

    // Correctness: Amount Due (TOTAL) must equal Subtotal minus the Discount
    // row, exactly — the identity the receipt now depends on.
    const amountDue = cartTotals(lines).totalPaisa;
    expect(grossSubtotalPaisa(lines) - totalLineDiscountPaisa(lines)).toBe(amountDue);
    expect(amountDue).toBe(3_500 - 500 + 1_400);
  });

  it('sums every line’s discount into one Discount row, not per line', () => {
    const lines = [
      line({ lineId: 'a', lineDiscountPaisa: paisa(200) }),
      line({ lineId: 'b', unit: 'tab', count: 4, lineDiscountPaisa: paisa(100) }),
    ];
    expect(totalLineDiscountPaisa(lines)).toBe(300);
  });
});
