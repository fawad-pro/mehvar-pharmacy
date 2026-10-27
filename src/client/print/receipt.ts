/**
 * The receipt's data shape — ADR-6, Phase 10 §7.
 *
 * One shape for every receipt-producing event (a sale, an udhaar sale, a
 * settlement), because Phase 10 §7 describes one template with an optional
 * body: "payment = cash/tendered/change or udhaar split; udhaar receipts and
 * settlements print the mini-statement." A settlement simply has no `lines`.
 *
 * The customer keeps this paper. Nothing here speaks to the shop's staff: a
 * shortfall (D2), an expired pack or an unsynced sale is said on the counter's
 * screen and on the owner's exception list, never on the receipt.
 */

export interface ReceiptLine {
  readonly name: string;
  /**
   * How many, as sold: the count of the unit the operator entered (2 strips
   * prints 2). The slip prints the number alone under QTY — the owner's
   * choice; the unit stays on the screen and the receipt detail page.
   */
  readonly quantity: number;
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

  /**
   * A return (W4): money going back to the customer. Amounts stay signed as
   * the record has them (negative); the slip states them as a refund — the
   * customer never reads "Amount Due -530.00", or a credit reduction called
   * "Paid".
   */
  readonly refund?: { readonly againstReceiptNumber: string };

  /**
   * [PCN-013] A payment typed wrong, cancelled: the customer holds a slip for
   * the original, so this one says plainly that it no longer stands. Carries
   * the mini-statement, in which the amount comes back onto the balance.
   */
  readonly cancellation?: { readonly againstReceiptNumber: string };

  /**
   * Test receipts only: two measured bars (50 mm and 72 mm) so the printout
   * itself shows whether the page was scaled or clipped (see `ReceiptView`).
   */
  readonly calibration?: boolean;
}

/** What a test receipt is numbered: never a number from the device's sequence. */
export const TEST_RECEIPT_NUMBER = 'TEST';

/**
 * A receipt that checks the printer, not a sale — Settings' "Print test
 * receipt" (Phase 12 §6 step 2). It carries the shop's own header and footer,
 * so the owner sees what a customer will get, and it is numbered
 * {@link TEST_RECEIPT_NUMBER}, so printing it never consumes a receipt number.
 */
export function testReceipt(input: {
  tenantHeaderLines: readonly string[];
  tenantFooterLine: string;
  salesmanName: string;
  now: Date;
}): ReceiptData {
  return {
    receiptNumber: TEST_RECEIPT_NUMBER,
    dateTime: input.now,
    salesmanName: input.salesmanName,
    tenantHeaderLines: input.tenantHeaderLines,
    tenantFooterLine: input.tenantFooterLine,
    lines: [{ name: 'Test receipt — not a sale', quantity: 1, amountPaisa: 0 }],
    subtotalPaisa: 0,
    totalPaisa: 0,
    calibration: true,
  };
}
