/**
 * The receipt's data shape — ADR-6, Phase 10 §7.
 *
 * One shape for every receipt-producing event (a sale, an udhaar sale, a
 * settlement), because Phase 10 §7 describes one template with an optional
 * body: "payment = cash/tendered/change or udhaar split; udhaar receipts and
 * settlements print the mini-statement." A settlement simply has no `lines`.
 */

export interface ReceiptLine {
  readonly name: string;
  /** Natural language, W5: "1 strip + 4 tab" — never the raw base-unit count. */
  readonly quantityLabel: string;
  readonly amountPaisa: number;
}

export interface MiniStatementLine {
  readonly previousBalancePaisa: number;
  /** Signed: positive for udhaar extended, negative for a payment made. */
  readonly amountPaisa: number;
  readonly newBalancePaisa: number;
}

export interface ReceiptData {
  readonly receiptNumber: string;
  readonly dateTime: Date;
  readonly salesmanName: string;
  readonly tenantHeaderLines: readonly string[];
  readonly tenantFooterLine: string;
  readonly customerName?: string;

  /** Absent for a standalone settlement (W3). */
  readonly lines?: readonly ReceiptLine[];
  readonly subtotalPaisa?: number;
  readonly discountPaisa?: number;
  readonly totalPaisa?: number;

  /** Present for a sale: the tendered/change or cash/credit split. */
  readonly cashPaisa?: number;
  readonly tenderedPaisa?: number;
  readonly changePaisa?: number;
  readonly creditPaisa?: number;

  /** Present for an udhaar sale or a settlement (Phase 10 §7). */
  readonly miniStatement?: MiniStatementLine;

  /** D2: sold more than the system had on hand — shown so it is never silent. */
  readonly pendingNote?: string;
}
