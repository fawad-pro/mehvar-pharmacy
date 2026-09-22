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

/** What the line would cost with no discount at all — the discount's basis. */
export function lineGrossPaisa(line: CartLine): Paisa {
  return multiplyPaisa(line.unitPricePaisa, line.qtyBase);
}

/** Line total after its own discount (Phase 5 invariant 4). Never negative. */
export function lineTotal(line: CartLine): Paisa {
  const net = subtractPaisa(lineGrossPaisa(line), line.lineDiscountPaisa);
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

/**
 * A discount entered as either a flat PKR amount ("50") or a percentage
 * ("10%") — one entry field, one underlying amount (`CartLine.lineDiscountPaisa`
 * for a per-line discount), never two parallel discount models.
 *
 * `basisPaisa` is what the discount is a percentage OF, and it must be the
 * line's undiscounted gross (`lineGrossPaisa`) — never `lineTotal`, which is
 * already net of any EXISTING discount. Basing the percentage on the gross is
 * what makes re-reading the same "10%" idempotent rather than compounding: a
 * line re-priced from the SAME catalogue amount every time it is parsed.
 *
 * Clamped to `[0, basisPaisa]`: a discount only ever lowers the price, never
 * raises it. Blank, garbage, zero or negative input is zero — never a
 * negative discount, which would be a price ABOVE the catalogue price wearing
 * a discount's clothes — and a fixed amount bigger than the line clamps to
 * the line, the same posture `cartTotals` already takes for an invoice
 * discount bigger than the cart.
 */
export function parseDiscountInput(raw: string, basisPaisa: Paisa): Paisa {
  const trimmed = raw.trim();
  if (trimmed === '') {
    return ZERO_PAISA;
  }

  const isPercent = trimmed.endsWith('%');
  const numeric = Number((isPercent ? trimmed.slice(0, -1) : trimmed).trim());
  if (!Number.isFinite(numeric) || numeric <= 0) {
    return ZERO_PAISA;
  }

  const amount = isPercent
    ? Math.round((basisPaisa * numeric) / 100)
    : Math.round(numeric * 100);

  return paisa(Math.max(0, Math.min(amount, basisPaisa)));
}
