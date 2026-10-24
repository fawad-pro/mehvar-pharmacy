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

import type { ProductUnit } from '@/domain/catalog/units';
import { addPaisa, multiplyPaisa, subtractPaisa, sumPaisa } from '@/lib/money';
import { packFactor, paisa, ZERO_PAISA, type BaseQty, type Paisa } from '@/lib/branded';
import { toBaseUnits, type PackLevel } from '@/lib/quantity';

export interface CartLine {
  /** Client-side identity; becomes `sale_lines.id` at commit. */
  readonly lineId: string;
  readonly productId: string;
  readonly name: string;
  readonly baseUnitName: string;
  readonly packLevels: readonly PackLevel[];
  /** [PCN-012] The product's units, smallest first, each with its own price. */
  readonly units: readonly ProductUnit[];
  /** [PCN-012] The unit the line is sold in (`ProductUnit.key`). */
  readonly unitKey: string;
  /** [PCN-012] How many of that unit. */
  readonly unitCount: number;
  /**
   * Base units: `unitCount × the unit's size`. Derived, never set on its own
   * (`withQuantity` keeps it in step); stock checks and FEFO read it.
   */
  readonly qtyBase: BaseQty;
  /** The unit's name, for display and the receipt (W5). */
  readonly enteredUnitLevel: string;
  /** [PCN-012] The price of ONE of the line's unit, as charged. */
  readonly pricePerUnitPaisa: Paisa;
  /** What the catalog said for that unit, so an override is detectable. */
  readonly catalogPricePerUnitPaisa: Paisa;
  readonly lineDiscountPaisa: Paisa;
}

/** The line's unit. A key the product no longer has falls back to its smallest. */
export function lineUnit(line: Pick<CartLine, 'units' | 'unitKey'>): ProductUnit | undefined {
  return line.units.find((unit) => unit.key === line.unitKey) ?? line.units[0];
}

/**
 * [PCN-012] The line sold as `count` of the unit `unitKey`.
 *
 * Changing the unit re-prices the line at that unit's catalog price: an
 * override was a price for the old unit, and carrying it to a box would charge
 * a strip's price for ten strips.
 */
export function withQuantity(line: CartLine, unitKey: string, count: number): CartLine {
  const unit = line.units.find((candidate) => candidate.key === unitKey) ?? lineUnit(line);
  if (!unit) {
    return line;
  }
  const sameUnit = unit.key === line.unitKey;
  return {
    ...line,
    unitKey: unit.key,
    unitCount: count,
    enteredUnitLevel: unit.name,
    qtyBase: toBaseUnits(count, packFactor(unit.factor)),
    pricePerUnitPaisa: sameUnit ? line.pricePerUnitPaisa : paisa(unit.pricePaisa),
    catalogPricePerUnitPaisa: sameUnit ? line.catalogPricePerUnitPaisa : paisa(unit.pricePaisa),
  };
}

export interface CartTotals {
  readonly subtotalPaisa: Paisa;
  readonly invoiceDiscountPaisa: Paisa;
  readonly totalPaisa: Paisa;
  readonly itemCount: number;
  readonly lineCount: number;
}

/**
 * [PCN-012] A new cart line: `count` of the unit named `unitName` (the
 * barcode's unit, or the counter's default), priced at that unit's own price.
 */
export function newCartLine(input: {
  lineId: string;
  productId: string;
  name: string;
  baseUnitName: string;
  packLevels: readonly PackLevel[];
  units: readonly ProductUnit[];
  unitName: string;
  count: number;
}): CartLine {
  const unit = input.units.find((candidate) => candidate.name === input.unitName) ?? input.units[0];
  const start: CartLine = {
    lineId: input.lineId,
    productId: input.productId,
    name: input.name,
    baseUnitName: input.baseUnitName,
    packLevels: input.packLevels,
    units: input.units,
    unitKey: unit?.key ?? 'u0',
    unitCount: input.count,
    qtyBase: toBaseUnits(input.count, packFactor(unit?.factor ?? 1)),
    enteredUnitLevel: unit?.name ?? input.baseUnitName,
    pricePerUnitPaisa: paisa(unit?.pricePaisa ?? 0),
    catalogPricePerUnitPaisa: paisa(unit?.pricePaisa ?? 0),
    lineDiscountPaisa: ZERO_PAISA,
  };
  return start;
}

/** What the line would cost with no discount at all — the discount's basis. */
export function lineGrossPaisa(line: CartLine): Paisa {
  // [PCN-012] Count × the price of one unit: a box at Rs 250 is Rs 250, exactly.
  return multiplyPaisa(line.pricePerUnitPaisa, line.unitCount);
}

/** Line total after its own discount (Phase 5 invariant 4). Never negative. */
export function lineTotal(line: CartLine): Paisa {
  const net = subtractPaisa(lineGrossPaisa(line), line.lineDiscountPaisa);
  return net < 0 ? ZERO_PAISA : net;
}

/**
 * The receipt's pre-discount Subtotal: every line's undiscounted gross,
 * summed. `CartTotals.subtotalPaisa` is deliberately NOT this — it sums
 * `lineTotal`, already net of each line's own discount, because that is the
 * figure `commitSale` persists (Phase 5 invariant 4's "Σ line totals"). A
 * receipt showing that net figure as "Subtotal" made Subtotal and TOTAL read
 * identical whenever a line carried a discount, which is what a customer
 * reads as "no discount was applied" even though one was.
 */
export function grossSubtotalPaisa(lines: readonly CartLine[]): Paisa {
  return sumPaisa(lines.map(lineGrossPaisa));
}

/** Every line's own discount, summed — the receipt's single Discount row. */
export function totalLineDiscountPaisa(lines: readonly CartLine[]): Paisa {
  return sumPaisa(lines.map((line) => line.lineDiscountPaisa));
}

/**
 * T1 — a price the operator changed is visible to the owner as an override.
 * Derived by comparison rather than trusted from a flag the UI sets.
 */
export function isPriceOverridden(line: CartLine): boolean {
  return line.pricePerUnitPaisa !== line.catalogPricePerUnitPaisa;
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
    // Counted in the units sold: two strips are two items, not twenty.
    itemCount: lines.reduce<number>((sum, line) => sum + line.unitCount, 0),
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
      line.unitKey === incoming.unitKey &&
      line.pricePerUnitPaisa === incoming.pricePerUnitPaisa &&
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
    ...withQuantity(existing, existing.unitKey, existing.unitCount + incoming.unitCount),
    lineDiscountPaisa: addPaisa(existing.lineDiscountPaisa, incoming.lineDiscountPaisa),
  };
  return lines.map((line, position) => (position === index ? merged : line));
}

export function updateLine(
  lines: readonly CartLine[],
  lineId: string,
  patch: Partial<
    Pick<CartLine, 'unitKey' | 'unitCount' | 'pricePerUnitPaisa' | 'lineDiscountPaisa'>
  >,
): CartLine[] {
  return lines.map((line) => {
    if (line.lineId !== lineId) {
      return line;
    }
    const { unitKey, unitCount, ...rest } = patch;
    const requantified =
      unitKey !== undefined || unitCount !== undefined
        ? withQuantity(line, unitKey ?? line.unitKey, unitCount ?? line.unitCount)
        : line;
    return { ...requantified, ...rest };
  });
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
