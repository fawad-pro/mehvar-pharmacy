/**
 * [PCN-013] `commitPaymentReversal` — cancels an udhaar payment typed wrong.
 *
 * A compensating row in `payments` (ADR-1, T2): the same customer, the amount
 * negated, its own receipt number, `reverses_id` pointing at the original.
 * `customerBalance`, its ledger and expected cash all sum `amount_paisa`, so
 * every one of them is right without learning about reversals. The customer
 * was handed a slip for the original, so the reversal prints one too, with
 * the mini-statement computed inside the transaction as a settlement's is.
 *
 * Idempotent on the client id. Online only and owner only: it is not an outbox
 * record (ADR-3 scopes those to selling), because whether a payment has
 * already been cancelled is a question only the server can answer.
 */

import { isUniqueViolation } from '@/db/errors';
import type { TenantScope } from '@/db/scoped';
import {
  customerBalance,
  findPaymentById,
  findPaymentForReversal,
  findPaymentReversalOf,
  insertPayment,
} from '@/db/udhaar-queries';
import type { Uuid } from '@/lib/uuid';

import { reversalRefusal, type ReversalRefusal } from '../corrections/reversal';
import { miniStatement, type MiniStatement } from './settlement';

export interface PaymentReversalCommand {
  /** Client-generated; the idempotency key. */
  readonly reversalId: Uuid;
  readonly paymentId: Uuid;
  /** Minted by the counter, as a settlement's is: the slip prints from local state. */
  readonly receiptNumber: string;
  readonly clientCommittedAt: Date;
}

export interface PaymentReversed {
  readonly reversalId: Uuid;
  readonly receiptNumber: string;
  readonly againstReceiptNumber: string;
  readonly customerId: string;
  /** The amount cancelled, positive. */
  readonly amountPaisa: number;
  readonly statement: MiniStatement;
  readonly alreadyCommitted: boolean;
}

export type PaymentReversalResult =
  { ok: true; value: PaymentReversed } | { ok: false; reason: ReversalRefusal | 'part_of_sale' };

export async function commitPaymentReversal(
  scope: TenantScope,
  command: PaymentReversalCommand,
): Promise<PaymentReversalResult> {
  try {
    return await scope.transaction(async (tx) => {
      const original = await findPaymentForReversal(tx, command.paymentId);
      const replay = await findPaymentById(tx, command.reversalId);
      if (replay && original) {
        return {
          ok: true,
          value: {
            reversalId: command.reversalId,
            receiptNumber: replay.receiptNumber,
            againstReceiptNumber: original.receiptNumber,
            customerId: original.customerId,
            amountPaisa: original.amountPaisa,
            statement: miniStatement(0, 0),
            alreadyCommitted: true,
          },
        } satisfies PaymentReversalResult;
      }

      const refusal = reversalRefusal(original, await findPaymentReversalOf(tx, command.paymentId));
      if (refusal || !original) {
        return { ok: false, reason: refusal ?? 'not_found' } satisfies PaymentReversalResult;
      }
      // Cash taken as part of a sale is the sale's; it is undone by a return.
      if (original.saleId !== null) {
        return { ok: false, reason: 'part_of_sale' } satisfies PaymentReversalResult;
      }

      const previousBalance = await customerBalance(tx, original.customerId as Uuid);
      await insertPayment(tx, {
        id: command.reversalId,
        customerId: original.customerId,
        amountPaisa: -original.amountPaisa,
        method: original.method,
        saleId: null,
        receiptNumber: command.receiptNumber,
        origin: 'online',
        clientSchemaVersion: 1,
        clientCommittedAt: command.clientCommittedAt,
        reversesId: original.id,
      });

      return {
        ok: true,
        value: {
          reversalId: command.reversalId,
          receiptNumber: command.receiptNumber,
          againstReceiptNumber: original.receiptNumber,
          customerId: original.customerId,
          amountPaisa: original.amountPaisa,
          statement: miniStatement(previousBalance, original.amountPaisa),
          alreadyCommitted: false,
        },
      } satisfies PaymentReversalResult;
    });
  } catch (error) {
    // Two cancellations racing: the unique index on `reverses_id` lets one
    // through. A receipt number already taken is the same SQLSTATE, so check
    // which happened before saying so.
    if (isUniqueViolation(error) && (await findPaymentReversalOf(scope, command.paymentId))) {
      return { ok: false, reason: 'already_reversed' };
    }
    throw error;
  }
}
