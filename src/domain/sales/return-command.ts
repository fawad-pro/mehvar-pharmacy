/**
 * The return command and its rules — pure (Phase 11 §2).
 *
 * W4, verbatim: "select lines/quantities → confirm → stock restores to source
 * batch, cash-out recorded or credit reduced (compensating record, T2)."
 *
 * A return is one compensating record against a sale that already happened
 * (ADR-1) — it never edits the sale row, only adds a new one that references
 * it. The refund owed per line is derived from what that line actually paid
 * (its charge, less its own item discount, less its share of the bill
 * discount — PCN-014), not from the catalog price, so a return of a discounted
 * item refunds the discounted amount.
 *
 * This module imports nothing below `lib/`, for the same reason
 * `purchase-command.ts` does: the return screen validates a quantity the
 * moment it is typed, and a client component that imports a module reaching
 * the database drags `server-only` into the browser bundle.
 */

import type { PackLevel } from '@/lib/quantity';
import type { Uuid } from '@/lib/uuid';

import { linePaidPaisa } from './sale-command';

export interface ReturnLineCommand {
  readonly saleLineId: Uuid;
  readonly qtyBase: number;
  /**
   * The batch these units go back onto the shelf as, or null for a write-off
   * (damaged, expired, or otherwise unsellable) — W4's "source batch", per
   * `sale_return_lines.restock_batch_id`.
   */
  readonly restockBatchId: Uuid | null;
  /** [PCN-012] As counted: "1 strip". The writer checks it against the product. */
  readonly entered?: {
    readonly unitKey: string;
    readonly unitName: string;
    readonly unitCount: number;
  };
}

export interface ReturnCommand {
  /** Client-generated. The idempotency key. */
  readonly returnId: Uuid;
  readonly saleId: Uuid;
  /** Client-minted, device-scoped — same sequence as sales and payments (PCN-003). */
  readonly receiptNumber: string;
  readonly lines: readonly ReturnLineCommand[];
  /** Whichever the operator chose; credit requires the sale had a customer. */
  readonly refundMethod: 'cash' | 'credit';
  readonly reasonNote: string | null;
}

export type ReturnRejection =
  'empty_return' | 'invalid_quantity' | 'exceeds_sold_quantity' | 'credit_requires_customer';

/** What the writer needs to know about the sale and its lines to validate against. */
export interface ReturnableSaleLine {
  readonly saleLineId: Uuid;
  readonly qtyBase: number;
  /** Already returned against this line, from prior (non-idempotent) returns. */
  readonly alreadyReturnedBase: number;
  readonly unitPricePaisa: number;
  /** [PCN-012] The exact amount charged, or null on a line from before it. */
  readonly lineAmountPaisa: number | null;
  readonly lineDiscountPaisa: number;
  /** [PCN-014] This line's share of the sale's bill discount. */
  readonly invoiceDiscountSharePaisa: number;
}

export function validateReturnCommand(
  command: ReturnCommand,
  sale: { readonly hasCustomer: boolean },
  lines: readonly ReturnableSaleLine[],
): { ok: true } | { ok: false; reason: ReturnRejection; saleLineId?: Uuid } {
  if (command.lines.length === 0) {
    return { ok: false, reason: 'empty_return' };
  }
  if (command.refundMethod === 'credit' && !sale.hasCustomer) {
    return { ok: false, reason: 'credit_requires_customer' };
  }

  const byId = new Map(lines.map((line) => [line.saleLineId, line]));
  // A line named twice would be validated twice against the same remainder,
  // and could return — and refund — more than was sold.
  if (new Set(command.lines.map((line) => line.saleLineId)).size !== command.lines.length) {
    return { ok: false, reason: 'invalid_quantity' };
  }
  for (const line of command.lines) {
    if (!Number.isSafeInteger(line.qtyBase) || line.qtyBase <= 0) {
      return { ok: false, reason: 'invalid_quantity', saleLineId: line.saleLineId };
    }
    if (
      line.entered &&
      (!Number.isSafeInteger(line.entered.unitCount) ||
        line.entered.unitCount <= 0 ||
        line.entered.unitName.trim() === '' ||
        line.qtyBase % line.entered.unitCount !== 0)
    ) {
      return { ok: false, reason: 'invalid_quantity', saleLineId: line.saleLineId };
    }
    const original = byId.get(line.saleLineId);
    const remaining = original ? original.qtyBase - original.alreadyReturnedBase : 0;
    if (line.qtyBase > remaining) {
      return { ok: false, reason: 'exceeds_sold_quantity', saleLineId: line.saleLineId };
    }
  }

  return { ok: true };
}

/**
 * The refund owed for returning `qtyBase` more units of a line.
 *
 * [PCN-014] Cumulative, the way stock is costed (Session 2): with `R(k) =
 * ⌊paid × k ÷ sold⌋`, returning n units after `alreadyReturnedBase` refunds
 * `R(already + n) − R(already)`. Every partial return rounds down, never in
 * the customer's favour, and the parts always end at exactly what the line
 * paid — rounding each return alone would leave the customer a paisa short.
 * `paid` is what the line actually paid ([PCN-012] a box refunds as a share
 * of the box price), net of its item discount and its bill-discount share.
 */
export function refundForLine(line: ReturnableSaleLine, qtyBase: number): number {
  if (line.qtyBase <= 0) {
    return 0;
  }
  const paid = linePaidPaisa(line);
  const refunded = (units: number) =>
    Math.floor((paid * Math.min(units, line.qtyBase)) / line.qtyBase);
  return refunded(line.alreadyReturnedBase + qtyBase) - refunded(line.alreadyReturnedBase);
}

export function totalRefundPaisa(
  command: ReturnCommand,
  lines: readonly ReturnableSaleLine[],
): number {
  const byId = new Map(lines.map((line) => [line.saleLineId, line]));
  let total = 0;
  for (const returned of command.lines) {
    const original = byId.get(returned.saleLineId);
    if (original) {
      total += refundForLine(original, returned.qtyBase);
    }
  }
  return total;
}

/**
 * The screen's shapes for W4's two lookups. Declared here — not beside the
 * query that fills them in `db/returns-queries.ts` — because a client
 * component must never import from a module that reaches the database, even
 * for a type (Day 5's rule): the return screen needs these to render the
 * "find sale" and "select lines" steps before any command exists to validate.
 */
export interface FoundSale {
  readonly saleId: Uuid;
  readonly receiptNumber: string;
  readonly customerId: Uuid | null;
  readonly customerName: string | null;
  readonly totalPaisa: number;
  readonly createdAt: Date;
}

export interface ReturnableLineRow extends ReturnableSaleLine {
  readonly productId: Uuid;
  readonly productName: string;
  readonly baseUnitName: string;
  readonly enteredUnitLevel: string;
  readonly packLevels: readonly PackLevel[];
  /** [PCN-012] What a return may be counted in: the units sold, smallest first. */
  readonly units: readonly { key: string; name: string; factor: number }[];
  /** The unit this line was sold in — the return starts there. */
  readonly soldUnitKey: string;
  readonly sourceBatches: readonly { batchId: Uuid; expiryDate: string | null }[];
}
