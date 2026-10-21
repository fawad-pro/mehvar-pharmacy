/**
 * [PCN-007] `commitSupplierPayment` — the one transaction for paying a
 * supplier, the payable mirror of `commitSettlement`.
 *
 * Online-only and idempotent on the client id, exactly like `commitPurchase`:
 * purchases and their payments are not in the sync outbox (ADR-3), but a flaky
 * submit that pays a distributor twice is not a mistake anyone should have to
 * notice to be protected from.
 *
 * It touches no stock and no batches — it only records that money left the
 * drawer toward a supplier account. The balance it reduces is derived from
 * records at any time (the mirror of Phase 5 invariant 3), so this reads the
 * before-figure once inside the transaction for a confirmation line rather than
 * locking anything.
 */

import {
  findSupplierPaymentById,
  insertSupplierPayment,
  supplierBalance,
} from '@/db/supplier-queries';
import type { TenantScope } from '@/db/scoped';
import type { Uuid } from '@/lib/uuid';

import {
  validateSupplierPayment,
  type SupplierPaymentCommand,
  type SupplierPaymentRejection,
} from './supplier-payment-command';

export {
  validateSupplierPayment,
  type SupplierPaymentCommand,
  type SupplierPaymentRejection,
} from './supplier-payment-command';

export interface SupplierPaymentCommitted {
  readonly paymentId: Uuid;
  readonly previousBalancePaisa: number;
  readonly newBalancePaisa: number;
  readonly alreadyCommitted: boolean;
}

export type SupplierPaymentResult =
  | { ok: true; value: SupplierPaymentCommitted }
  | { ok: false; reason: SupplierPaymentRejection };

export async function commitSupplierPayment(
  scope: TenantScope,
  command: SupplierPaymentCommand,
): Promise<SupplierPaymentResult> {
  const validated = validateSupplierPayment(command);
  if (!validated.ok) {
    return validated;
  }

  return scope.transaction(async (tx) => {
    const existing = await findSupplierPaymentById(tx, command.paymentId);
    if (existing) {
      // Delivered twice, paid once — same posture as every other writer.
      const current = await supplierBalance(tx, command.supplierId);
      return {
        ok: true,
        value: {
          paymentId: command.paymentId,
          previousBalancePaisa: current,
          newBalancePaisa: current,
          alreadyCommitted: true,
        },
      } satisfies SupplierPaymentResult;
    }

    const previousBalancePaisa = await supplierBalance(tx, command.supplierId);

    await insertSupplierPayment(tx, {
      id: command.paymentId,
      supplierId: command.supplierId,
      amountPaisa: command.amountPaisa,
      method: 'cash',
      purchaseId: command.purchaseId,
      note: command.note,
    });

    return {
      ok: true,
      value: {
        paymentId: command.paymentId,
        previousBalancePaisa,
        newBalancePaisa: previousBalancePaisa - command.amountPaisa,
        alreadyCommitted: false,
      },
    } satisfies SupplierPaymentResult;
  });
}
