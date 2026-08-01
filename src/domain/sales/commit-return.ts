/**
 * `commitReturn` — W4's one transaction.
 *
 *   "select lines/quantities → confirm → stock restores to source batch,
 *    cash-out recorded or credit reduced (compensating record, T2)."
 *
 * A return never edits the sale it responds to (ADR-1): it inserts one
 * `sale_returns` row and its lines, and — for every returned line that names a
 * batch — restores that batch's `qty_remaining` (ADR-8's second sanctioned
 * mutation, symmetric to `consumeFromBatch`). A line with no batch is a
 * write-off: the units are gone, so nothing restocks.
 *
 * ## Online only
 *
 * Same posture as `commitPurchase` and `commitAdjustment`: ADR-3 scopes
 * offline capture to cash sales, udhaar sales, settlements and quick items, and
 * a return needs to look up the sale it responds to and how much of it remains
 * returnable — a lookup a disconnected counter cannot answer honestly. Still
 * idempotent on a client-generated id, for the same reason every other writer
 * is: a flaky submit must not double-refund.
 */

import {
  findReturnById,
  insertSaleReturn,
  insertSaleReturnLines,
  restockToBatch,
  returnableLinesForSale,
} from '@/db/returns-queries';
import { findSaleById } from '@/db/sales-queries';
import { customerBalance } from '@/db/udhaar-queries';
import type { TenantScope } from '@/db/scoped';
import { paisa, type Paisa } from '@/lib/branded';
import { uuidv7, type Uuid } from '@/lib/uuid';

import {
  totalRefundPaisa,
  validateReturnCommand,
  type ReturnCommand,
  type ReturnRejection,
} from './return-command';

export {
  validateReturnCommand,
  refundForLine,
  totalRefundPaisa,
  type ReturnCommand,
  type ReturnLineCommand,
  type ReturnRejection,
  type ReturnableSaleLine,
} from './return-command';

export interface ReturnCommitted {
  readonly returnId: Uuid;
  readonly receiptNumber: string;
  readonly totalRefundPaisa: Paisa;
  readonly cashOutPaisa: Paisa;
  readonly creditReducedPaisa: Paisa;
  readonly alreadyCommitted: boolean;
  /** The customer's balance immediately before this return, for the receipt's
   * mini-statement — same posture as `commitSale`'s figure of the same name:
   * a display value, not an authority, since Phase 5 invariant 3 keeps the
   * real balance always re-derivable regardless of what any slip claims. */
  readonly balanceBeforePaisa?: Paisa;
}

export type ReturnResult =
  | { ok: true; value: ReturnCommitted }
  | { ok: false; reason: ReturnRejection | 'sale_not_found'; saleLineId?: Uuid };

export async function commitReturn(
  scope: TenantScope,
  command: ReturnCommand,
): Promise<ReturnResult> {
  return scope.transaction(async (tx) => {
    const existing = await findReturnById(tx, command.returnId);
    if (existing) {
      return {
        ok: true,
        value: {
          returnId: command.returnId,
          receiptNumber: existing.receiptNumber,
          totalRefundPaisa: paisa(0),
          cashOutPaisa: paisa(0),
          creditReducedPaisa: paisa(0),
          alreadyCommitted: true,
        },
      } satisfies ReturnResult;
    }

    const sale = await findSaleById(tx, command.saleId);
    if (!sale) {
      return { ok: false, reason: 'sale_not_found' };
    }

    const returnableLines = await returnableLinesForSale(tx, command.saleId);
    const validation = validateReturnCommand(
      command,
      { hasCustomer: sale.customerId !== null },
      returnableLines,
    );
    if (!validation.ok) {
      return validation;
    }

    const refund = totalRefundPaisa(command, returnableLines);
    const cashOutPaisa = command.refundMethod === 'cash' ? refund : 0;
    const creditReducedPaisa = command.refundMethod === 'credit' ? refund : 0;

    const balanceBeforePaisa =
      command.refundMethod === 'credit' && sale.customerId !== null
        ? paisa(await customerBalance(tx, sale.customerId))
        : undefined;

    await insertSaleReturn(tx, {
      id: command.returnId,
      saleId: command.saleId,
      receiptNumber: command.receiptNumber,
      cashOutPaisa,
      creditReducedPaisa,
      reasonNote: command.reasonNote,
    });

    await insertSaleReturnLines(
      tx,
      command.lines.map((line) => ({
        id: uuidv7(),
        saleReturnId: command.returnId,
        saleLineId: line.saleLineId,
        qtyBase: line.qtyBase,
        restockBatchId: line.restockBatchId,
      })),
    );

    for (const line of command.lines) {
      if (line.restockBatchId) {
        await restockToBatch(tx, line.restockBatchId, line.qtyBase);
      }
    }

    return {
      ok: true,
      value: {
        returnId: command.returnId,
        receiptNumber: command.receiptNumber,
        totalRefundPaisa: paisa(refund),
        cashOutPaisa: paisa(cashOutPaisa),
        creditReducedPaisa: paisa(creditReducedPaisa),
        alreadyCommitted: false,
        ...(balanceBeforePaisa !== undefined ? { balanceBeforePaisa } : {}),
      },
    } satisfies ReturnResult;
  });
}
