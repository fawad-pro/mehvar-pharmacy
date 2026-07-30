/**
 * Cart arithmetic — pure (Phase 11 §2's "pure calculators … trivially testable").
 *
 * This is Phase 5 invariant 4 expressed as functions:
 *
 *   Sale total = Σ line totals − invoice discount
 *   cash + credit split = total, exactly
 *
 * The same module computes what the screen shows and what `commitSale` writes,
 * so the number the customer is quoted and the number the database records
 * cannot drift. Every value is integer paisa; nothing here touches a float.
 */

import { addPaisa, multiplyPaisa, subtractPaisa, sumPaisa } from '@/lib/money';
import { paisa, ZERO_PAISA, type BaseQty, type Paisa } from '@/lib/branded';
import type { PackLevel } from '@/lib/quantity';

export interface CartLine {
  /** Client-side identity; becomes `sale_lines.id` at commit. */
  readonly lineId: string;
  readonly productId: string;
  readonly name: string;
  readonly baseUnitName: string;
  readonly packLevels: readonly PackLevel[];
  readonly qtyBase: BaseQty;
  /** The level the operator typed in, for display and the receipt (W5). */
  readonly enteredUnitLevel: string;
  /** Per base unit, as charged. */
  readonly unitPricePaisa: Paisa;
  /** What the catalog said, so an override is detectable rather than declared. */
  readonly catalogPricePaisa: Paisa;
  readonly lineDiscountPaisa: Paisa;
}

export interface CartTotals {
  readonly subtotalPaisa: Paisa;
  readonly invoiceDiscountPaisa: Paisa;
  readonly totalPaisa: Paisa;
  readonly itemCount: number;
  readonly lineCount: number;
}

/** Line total before invoice-level discount. Never negative. */
export function lineTotal(line: CartLine): Paisa {
  const gross = multiplyPaisa(line.unitPricePaisa, line.qtyBase);
  const net = subtractPaisa(gross, line.lineDiscountPaisa);
  return net < 0 ? ZERO_PAISA : net;
}

/**
 * T1 — a price the operator changed is visible to the owner as an override.
 * Derived by comparison rather than trusted from a flag the UI sets.
 */
export function isPriceOverridden(line: CartLine): boolean {
  return line.unitPricePaisa !== line.catalogPricePaisa;
}

export function cartTotals(
  lines: readonly CartLine[],
  invoiceDiscountPaisa: Paisa = ZERO_PAISA,
): CartTotals {
  const subtotal = sumPaisa(lines.map(lineTotal));
  // An invoice discount larger than the cart would make the total negative,
  // which no CHECK constraint and no drawer can honour. Clamp rather than
  // reject: the operator is mid-sale and P2 forbids a wall.
  const discount = invoiceDiscountPaisa > subtotal ? subtotal : invoiceDiscountPaisa;

  return {
    subtotalPaisa: subtotal,
    invoiceDiscountPaisa: discount,
    totalPaisa: subtractPaisa(subtotal, discount),
    itemCount: lines.reduce<number>((sum, line) => sum + line.qtyBase, 0),
    lineCount: lines.length,
  };
}

/**
 * Splits a total between cash and credit.
 *
 * The default is what the counter actually does: whatever cash is on the table,
 * the rest on the customer's account (W2's "entered cash with remainder to
 * credit"). Cash beyond the total is change, not an overpayment.
 */
export function splitPayment(
  totalPaisa: Paisa,
  cashOfferedPaisa: Paisa,
): { cashPaisa: Paisa; creditPaisa: Paisa; changePaisa: Paisa } {
  const applied = cashOfferedPaisa > totalPaisa ? totalPaisa : cashOfferedPaisa;
  return {
    cashPaisa: applied,
    creditPaisa: subtractPaisa(totalPaisa, applied),
    changePaisa: subtractPaisa(cashOfferedPaisa, applied),
  };
}

/**
 * Merges a scan or selection into the cart.
 *
 * Adding the same product twice increases the existing line instead of stacking
 * duplicates — scanning three strips of the same thing should read "3 strip",
 * not three rows. A line whose price was overridden is left alone, because
 * merging into it would silently reprice the operator's decision.
 */
export function addToCart(lines: readonly CartLine[], incoming: CartLine): CartLine[] {
  const index = lines.findIndex(
    (line) =>
      line.productId === incoming.productId &&
      line.enteredUnitLevel === incoming.enteredUnitLevel &&
      line.unitPricePaisa === incoming.unitPricePaisa &&
      !isPriceOverridden(line),
  );

  if (index === -1) {
    return [...lines, incoming];
  }

  const existing = lines[index];
  if (!existing) {
    return [...lines, incoming];
  }

  const merged: CartLine = {
    ...existing,
    qtyBase: (existing.qtyBase + incoming.qtyBase) as BaseQty,
    lineDiscountPaisa: addPaisa(existing.lineDiscountPaisa, incoming.lineDiscountPaisa),
  };
  return lines.map((line, position) => (position === index ? merged : line));
}

export function updateLine(
  lines: readonly CartLine[],
  lineId: string,
  patch: Partial<
    Pick<CartLine, 'qtyBase' | 'unitPricePaisa' | 'lineDiscountPaisa' | 'enteredUnitLevel'>
  >,
): CartLine[] {
  return lines.map((line) => (line.lineId === lineId ? { ...line, ...patch } : line));
}

export function removeLine(lines: readonly CartLine[], lineId: string): CartLine[] {
  return lines.filter((line) => line.lineId !== lineId);
}

/** Rupee amounts arrive from a numeric field; this is the one conversion point. */
export function paisaFromRupeeInput(raw: string): Paisa {
  const value = Number(raw.trim());
  if (!Number.isFinite(value) || value < 0) {
    return ZERO_PAISA;
  }
  return paisa(Math.round(value * 100));
}
