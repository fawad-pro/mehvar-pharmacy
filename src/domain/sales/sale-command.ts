/**
 * The sale command and its rules — pure (Phase 11 §2).
 *
 *   "Domain functions are pure or transactional — never half. Pure calculators
 *    (totals, FEFO planning, balance math) take data in, return data out, and
 *    are trivially testable."
 *
 * Split out of `commit-sale.ts` on Day 5, for a reason worth recording: the
 * counter now validates a sale *before* queueing it, because a queue-first
 * commit prints the receipt before any server sees the record (ADR-3, Phase 7
 * rule 3). That makes this validator client code as well as server code — and
 * the moment a client component imported it, it dragged `commit-sale.ts`'s
 * database imports into the browser bundle, where `server-only` correctly
 * refused them.
 *
 * So the pure half lives here with no imports below `lib/`, and the
 * transactional half stays where the database is. That is not a workaround for
 * a bundler; it is the separation Phase 11 §2 asks for, made physical by the
 * one thing that could detect it.
 */

import type { Uuid } from '@/lib/uuid';

export interface SaleLineCommand {
  /** Client-generated; becomes `sale_lines.id`. */
  readonly lineId: Uuid;
  readonly productId: Uuid;
  readonly qtyBase: number;
  readonly enteredUnitLevel: string;
  /** Per base unit, as charged (ADR-5: the client's last-known price). */
  readonly unitPricePaisa: number;
  readonly lineDiscountPaisa: number;
  readonly priceOverridden: boolean;
}

export interface SaleCommand {
  /** Client-generated (ADR-3). The idempotency key. */
  readonly saleId: Uuid;
  readonly receiptNumber: string;
  readonly customerId: Uuid | null;
  readonly lines: readonly SaleLineCommand[];
  readonly invoiceDiscountPaisa: number;
  readonly cashPaisa: number;
  readonly creditPaisa: number;
  readonly changePaisa: number;
  readonly origin: 'online' | 'offline_sync';
  readonly clientSchemaVersion: number;
  readonly clientCommittedAt: Date;
}

export type SaleRejection =
  | 'empty_cart'
  | 'invalid_quantity'
  | 'split_mismatch'
  | 'credit_without_customer'
  | 'negative_amount'
  | 'stale_batch_state';

/**
 * Validates a command against Phase 5 invariant 4 before any row is written.
 *
 * Run in two places, deliberately: on the counter before a sale is queued, so
 * a rejection is seen while the operator can still act on it; and again inside
 * `commitSale`, because the client is not the authority on anything. The
 * schema's CHECK constraints are a third backstop rather than the first line of
 * defence — a CHECK violation reaching a counter is an error message nobody can
 * act on.
 */
export function validateSaleCommand(
  command: SaleCommand,
): { ok: true; subtotalPaisa: number; totalPaisa: number } | { ok: false; reason: SaleRejection } {
  if (command.lines.length === 0) {
    return { ok: false, reason: 'empty_cart' };
  }

  let subtotal = 0;
  for (const line of command.lines) {
    if (!Number.isSafeInteger(line.qtyBase) || line.qtyBase <= 0) {
      return { ok: false, reason: 'invalid_quantity' };
    }
    if (line.unitPricePaisa < 0 || line.lineDiscountPaisa < 0) {
      return { ok: false, reason: 'negative_amount' };
    }
    const gross = line.unitPricePaisa * line.qtyBase;
    subtotal += Math.max(0, gross - line.lineDiscountPaisa);
  }

  if (command.invoiceDiscountPaisa < 0 || command.cashPaisa < 0 || command.creditPaisa < 0) {
    return { ok: false, reason: 'negative_amount' };
  }

  const total = subtotal - command.invoiceDiscountPaisa;
  if (total < 0) {
    return { ok: false, reason: 'negative_amount' };
  }
  if (command.cashPaisa + command.creditPaisa !== total) {
    return { ok: false, reason: 'split_mismatch' };
  }
  if (command.creditPaisa > 0 && command.customerId === null) {
    return { ok: false, reason: 'credit_without_customer' };
  }

  return { ok: true, subtotalPaisa: subtotal, totalPaisa: total };
}
