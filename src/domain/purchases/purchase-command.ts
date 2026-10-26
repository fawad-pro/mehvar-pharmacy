/**
 * The purchase command and its rules — pure (Phase 11 §2).
 *
 * Split from the writer for the reason Day 5 learned the hard way: the entry
 * screen validates a line the moment it is typed, and a client component that
 * imports a module reaching the database drags `server-only` into the browser
 * bundle. Pure calculators live apart from transactional writers, and this file
 * imports nothing below `lib/`.
 *
 * What this deliberately does *not* enforce:
 *
 *  - **A missing expiry is not an error.** W7 says expiry is "always asked",
 *    and asking is the screen's job. Phase 9 §4 makes the column nullable
 *    "only for non-perishables", and a surgical blade genuinely has no expiry.
 *    A domain that refused would put a wall in front of a truthful answer.
 *  - **A price above MRP is not an error.** D4 is explicit: "the product warns
 *    when a price exceeds recorded MRP but does not block (the pack in hand is
 *    authoritative, not our data)". The warning is surfaced, never enforced.
 */

import type { Uuid } from '@/lib/uuid';

/**
 * [PCN-012] A line as the invoice states it, in one of the product's units:
 * "10 boxes + 1 free at Rs 250 a box, selling at Rs 280 a box". The line's
 * cost is exactly `unitCount × unitCostPaisa` — never a per-tablet figure
 * multiplied back, which cannot hold a box of 14 at Rs 250.
 */
export interface EnteredPurchaseUnit {
  /** The product's unit (`ProductUnit.key`); its size turns counts into base units. */
  readonly unitKey: string;
  /** As shown when entered ("box"), kept even if the unit is renamed later. */
  readonly unitName: string;
  readonly unitCount: number;
  /** Free units, in the same unit as the paid ones. */
  readonly bonusUnitCount: number;
  /** The cost of ONE unit, as invoiced. Zero is legal — samples exist. */
  readonly unitCostPaisa: number;
  /** What ONE unit sells for, set at receiving. */
  readonly pricePaisa: number;
}

export interface PurchaseLineCommand {
  /** Client-generated; becomes `purchase_lines.id`. */
  readonly lineId: Uuid;
  readonly productId: Uuid;
  /** Units invoiced, in base units. Must be positive — a zero-quantity line is a typo. */
  readonly qtyBase: number;
  /** Scheme units received free ("10+1"), in base units. Kept distinct (Phase 5 §3). */
  readonly bonusQtyBase: number;
  /**
   * Per invoiced base unit. As billed on a line without `entered`; nominal
   * (rounded up) on one with it, where `entered` is the invoice's truth.
   */
  readonly unitCostPaisa: number;
  /** ISO date, or null for a non-perishable. */
  readonly expiryDate: string | null;
  readonly batchNumber: string | null;
  /**
   * Captured at receiving (Phase 1 §3); null when the pack does not state one.
   * Per the entered unit when the line has `entered`, per base unit otherwise.
   */
  readonly mrpAtReceivingPaisa: number | null;
  /**
   * What this stock will sell for, per base unit. Capture-at-receiving, per
   * batch; nominal (rounded up) when the line has `entered`.
   */
  readonly priceAtReceivingPaisa: number;
  /** [PCN-012] Present when the line was entered in one of the product's units. */
  readonly entered?: EnteredPurchaseUnit;
}

export interface PurchaseCommand {
  /** Client-generated. The idempotency key — a flaky submit must not double-receive. */
  readonly purchaseId: Uuid;
  readonly supplierId: Uuid | null;
  readonly invoiceRef: string | null;
  /** ISO date. */
  readonly invoiceDate: string | null;
  readonly note: string | null;
  /**
   * [PCN-007] Cash paid to the supplier now, in paisa. The remainder of the
   * invoice cost is put on the supplier's account (the mirror of an udhaar
   * sale). Zero is a full-credit delivery; the invoice total is a full-cash
   * one — which is what the entry screen defaults to, so the ordinary case is
   * unchanged.
   *
   * **Absent means "paid in full".** A command that does not mention it owes the
   * supplier nothing, which is exactly the pre-PCN-007 behaviour every purchase
   * had — so existing callers need no change and a cash purchase carries no
   * credit by default.
   */
  readonly cashPaidPaisa?: number;
  readonly lines: readonly PurchaseLineCommand[];
}

export type PurchaseRejection =
  | 'empty_purchase'
  | 'invalid_quantity'
  | 'invalid_bonus'
  | 'negative_cost'
  | 'invalid_price'
  | 'invalid_expiry'
  | 'negative_cash_paid'
  | 'credit_without_supplier'
  /** [PCN-012] The entered unit does not describe the base quantities. */
  | 'invalid_unit';

/**
 * What a line cost — exactly what the invoice says. Bonus units are free
 * (Phase 9 §3). The one place a purchase line's cost is computed.
 */
export function lineCostPaisa(line: PurchaseLineCommand): number {
  return line.entered
    ? line.entered.unitCount * line.entered.unitCostPaisa
    : line.qtyBase * line.unitCostPaisa;
}

/** The invoice's total cost — Σ line cost, bonus units free (Phase 9 §3). */
export function invoiceCostPaisa(command: PurchaseCommand): number {
  return command.lines.reduce((sum, line) => sum + lineCostPaisa(line), 0);
}

/** Cash paid at receiving, defaulting to the whole invoice ("paid in full"). */
export function effectiveCashPaidPaisa(command: PurchaseCommand): number {
  return command.cashPaidPaisa ?? invoiceCostPaisa(command);
}

/** Non-blocking observations the screen shows and the owner later reviews (T1). */
export type PurchaseWarning =
  | { readonly kind: 'price_above_mrp'; readonly lineId: Uuid }
  | { readonly kind: 'price_below_cost'; readonly lineId: Uuid }
  | { readonly kind: 'expiry_missing'; readonly lineId: Uuid }
  | { readonly kind: 'expiry_in_past'; readonly lineId: Uuid };

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export function validatePurchaseCommand(
  command: PurchaseCommand,
): { ok: true } | { ok: false; reason: PurchaseRejection; lineId?: Uuid } {
  if (command.lines.length === 0) {
    return { ok: false, reason: 'empty_purchase' };
  }

  for (const line of command.lines) {
    if (!Number.isSafeInteger(line.qtyBase) || line.qtyBase <= 0) {
      return { ok: false, reason: 'invalid_quantity', lineId: line.lineId };
    }
    if (!Number.isSafeInteger(line.bonusQtyBase) || line.bonusQtyBase < 0) {
      return { ok: false, reason: 'invalid_bonus', lineId: line.lineId };
    }
    if (!Number.isSafeInteger(line.unitCostPaisa) || line.unitCostPaisa < 0) {
      return { ok: false, reason: 'negative_cost', lineId: line.lineId };
    }
    if (!Number.isSafeInteger(line.priceAtReceivingPaisa) || line.priceAtReceivingPaisa <= 0) {
      return { ok: false, reason: 'invalid_price', lineId: line.lineId };
    }
    if (line.expiryDate !== null && !ISO_DATE.test(line.expiryDate)) {
      return { ok: false, reason: 'invalid_expiry', lineId: line.lineId };
    }
    if (line.entered && !enteredDescribesLine(line, line.entered)) {
      return { ok: false, reason: 'invalid_unit', lineId: line.lineId };
    }
  }

  if (command.cashPaidPaisa !== undefined) {
    if (!Number.isSafeInteger(command.cashPaidPaisa) || command.cashPaidPaisa < 0) {
      return { ok: false, reason: 'negative_cash_paid' };
    }
  }

  // Credit put on a supplier account must name the supplier, exactly as an
  // udhaar sale must name the customer (the mirror of `sales`'
  // `credit_requires_customer` CHECK). An overpayment (cash > invoice) is a
  // supplier advance and is legal without this guard.
  if (effectiveCashPaidPaisa(command) < invoiceCostPaisa(command) && command.supplierId === null) {
    return { ok: false, reason: 'credit_without_supplier' };
  }

  return { ok: true };
}

/**
 * The entered unit is whole and consistent with the base quantities: both are
 * whole multiples of ONE unit size (the database enforces the same). Whether
 * that size is the product's is the writer's check — it holds the product.
 */
function enteredDescribesLine(line: PurchaseLineCommand, entered: EnteredPurchaseUnit): boolean {
  return (
    entered.unitKey !== '' &&
    entered.unitName.trim() !== '' &&
    Number.isSafeInteger(entered.unitCount) &&
    entered.unitCount > 0 &&
    Number.isSafeInteger(entered.bonusUnitCount) &&
    entered.bonusUnitCount >= 0 &&
    Number.isSafeInteger(entered.unitCostPaisa) &&
    entered.unitCostPaisa >= 0 &&
    Number.isSafeInteger(entered.pricePaisa) &&
    entered.pricePaisa > 0 &&
    line.qtyBase % entered.unitCount === 0 &&
    line.bonusQtyBase * entered.unitCount === entered.bonusUnitCount * line.qtyBase
  );
}

/** The size of the entered unit, in base units, or 1 for a line without one. */
export function enteredUnitFactor(line: PurchaseLineCommand): number {
  return line.entered ? line.qtyBase / line.entered.unitCount : 1;
}

/**
 * Everything worth telling the operator that is not worth stopping them for.
 *
 * All four of these are things a careful person wants to see and a busy person
 * must be able to override — which is the whole shape of T1: sensitive acts are
 * *visible*, not blocked (Phase 7 rule 2).
 */
export function purchaseWarnings(
  command: PurchaseCommand,
  today: string = new Date().toISOString().slice(0, 10),
): PurchaseWarning[] {
  const warnings: PurchaseWarning[] = [];

  for (const line of command.lines) {
    // Compared in the unit the line was entered in, which is the unit the MRP
    // was read off: no per-tablet rounding can raise a false warning.
    const price = line.entered ? line.entered.pricePaisa : line.priceAtReceivingPaisa;
    const cost = line.entered ? line.entered.unitCostPaisa : line.unitCostPaisa;
    if (line.mrpAtReceivingPaisa !== null && price > line.mrpAtReceivingPaisa) {
      // D4: MRP is regulated and printed on the pack. Selling above it is the
      // owner's call and their exposure, but nobody should do it unknowingly.
      warnings.push({ kind: 'price_above_mrp', lineId: line.lineId });
    }

    // Comparison against the *invoiced* unit cost rather than the effective
    // one: a scheme purchase priced under the invoice line but above the
    // blended cost is ordinary trading, not a mistake worth flagging.
    if (price < cost) {
      warnings.push({ kind: 'price_below_cost', lineId: line.lineId });
    }

    if (line.expiryDate === null) {
      warnings.push({ kind: 'expiry_missing', lineId: line.lineId });
    } else if (line.expiryDate < today) {
      // Receiving already-expired stock happens, and recording it truthfully
      // is how it reaches the near-expiry list and gets returned (W12).
      warnings.push({ kind: 'expiry_in_past', lineId: line.lineId });
    }
  }

  return warnings;
}
