/**
 * `commitSettlement` — W3, the one transaction for a standalone payment.
 *
 * ADR-3 lists settlements among the offline-capturable events ("cash sales,
 * udhaar sales, settlements, and quick-item creation… commit locally,
 * IndexedDB, client-generated IDs"), so this is built idempotent on the client
 * id today, exactly as `commitSale` was on Day 3 — Day 5 ingests it unchanged,
 * the same "one code path" ADR-5 established for sales.
 *
 * A settlement never touches stock or batches; it is the simplest writer in the
 * product. What it must still get right is the receipt: the mini-statement
 * (T4/T5) is derived from the balance *before* the payment, computed inside the
 * same transaction so a concurrent settlement cannot read a stale figure.
 */

import { customerBalance, findPaymentById, insertPayment } from '@/db/udhaar-queries';
import type { TenantScope } from '@/db/scoped';
import type { Uuid } from '@/lib/uuid';

import { miniStatement, validateSettlementDraft, type MiniStatement } from './settlement';

export interface SettlementCommand {
  /** Client-generated (ADR-3). The idempotency key. */
  readonly paymentId: Uuid;
  readonly receiptNumber: string;
  readonly customerId: Uuid;
  readonly amountPaisa: number;
  readonly origin: 'online' | 'offline_sync';
  readonly clientSchemaVersion: number;
  readonly clientCommittedAt: Date;
}

export interface SettlementCommitted {
  readonly paymentId: Uuid;
  readonly receiptNumber: string;
  readonly statement: MiniStatement;
  readonly alreadyCommitted: boolean;
}

export type SettlementResult =
  | { ok: true; value: SettlementCommitted }
  | { ok: false; reason: 'amount_not_positive' | 'customer_required' };

export async function commitSettlement(
  scope: TenantScope,
  command: SettlementCommand,
): Promise<SettlementResult> {
  const validated = validateSettlementDraft({
    customerId: command.customerId,
    amountPaisa: command.amountPaisa,
  });
  if (!validated.ok) {
    const reason = validated.rejections[0]?.reason;
    return {
      ok: false,
      reason: reason === 'customer_required' ? 'customer_required' : 'amount_not_positive',
    };
  }

  return scope.transaction(async (tx) => {
    const existing = await findPaymentById(tx, command.paymentId);
    if (existing) {
      // ADR-3 replay: delivered twice, committed once. The mini-statement on a
      // replay is necessarily stale (the balance has moved since), so it is
      // omitted rather than shown as if freshly true — the receipt already
      // printed the first time.
      return {
        ok: true,
        value: {
          paymentId: command.paymentId,
          receiptNumber: existing.receiptNumber,
          statement: miniStatement(0, 0),
          alreadyCommitted: true,
        },
      } satisfies SettlementResult;
    }

    const previousBalance = await customerBalance(tx, command.customerId);

    await insertPayment(tx, {
      id: command.paymentId,
      customerId: command.customerId,
      amountPaisa: command.amountPaisa,
      method: 'cash',
      saleId: null,
      receiptNumber: command.receiptNumber,
      origin: command.origin,
      clientSchemaVersion: command.clientSchemaVersion,
      clientCommittedAt: command.clientCommittedAt,
    });

    return {
      ok: true,
      value: {
        paymentId: command.paymentId,
        receiptNumber: command.receiptNumber,
        statement: miniStatement(previousBalance, -command.amountPaisa),
        alreadyCommitted: false,
      },
    } satisfies SettlementResult;
  });
}
