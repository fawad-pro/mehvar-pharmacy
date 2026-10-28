/**
 * [PCN-013] `commitSupplierPaymentReversal` — cancels a supplier payment typed
 * wrong. The payable mirror of `commitPaymentReversal`: a compensating row in
 * `supplier_payments`, amount negated, `reverses_id` pointing at the original,
 * so `supplierBalance` and `supplierLedger` are right without changing. No
 * receipt: a supplier payment never printed one.
 *
 * Idempotent on the client id; online and owner only.
 */

import { isUniqueViolation } from '@/db/errors';
import type { TenantScope } from '@/db/scoped';
import {
  findSupplierPaymentById,
  findSupplierPaymentForReversal,
  findSupplierPaymentReversalOf,
  insertSupplierPayment,
  supplierBalance,
} from '@/db/supplier-queries';
import type { Uuid } from '@/lib/uuid';

import { reversalRefusal, type ReversalRefusal } from '../corrections/reversal';

export interface SupplierPaymentReversalCommand {
  readonly reversalId: Uuid;
  readonly paymentId: Uuid;
}

export type SupplierPaymentReversalResult =
  | {
      ok: true;
      value: {
        readonly supplierId: string;
        readonly amountPaisa: number;
        readonly newBalancePaisa: number;
        readonly alreadyCommitted: boolean;
      };
    }
  | { ok: false; reason: ReversalRefusal };

export async function commitSupplierPaymentReversal(
  scope: TenantScope,
  command: SupplierPaymentReversalCommand,
): Promise<SupplierPaymentReversalResult> {
  try {
    return await scope.transaction(async (tx) => {
      const original = await findSupplierPaymentForReversal(tx, command.paymentId);
      if (original && (await findSupplierPaymentById(tx, command.reversalId))) {
        return {
          ok: true,
          value: {
            supplierId: original.supplierId,
            amountPaisa: original.amountPaisa,
            newBalancePaisa: await supplierBalance(tx, original.supplierId as Uuid),
            alreadyCommitted: true,
          },
        } satisfies SupplierPaymentReversalResult;
      }

      const refusal = reversalRefusal(
        original,
        await findSupplierPaymentReversalOf(tx, command.paymentId),
      );
      if (refusal || !original) {
        return {
          ok: false,
          reason: refusal ?? 'not_found',
        } satisfies SupplierPaymentReversalResult;
      }

      await insertSupplierPayment(tx, {
        id: command.reversalId,
        supplierId: original.supplierId,
        amountPaisa: -original.amountPaisa,
        method: 'cash',
        purchaseId: null,
        note: null,
        reversesId: original.id,
      });

      return {
        ok: true,
        value: {
          supplierId: original.supplierId,
          amountPaisa: original.amountPaisa,
          newBalancePaisa: await supplierBalance(tx, original.supplierId as Uuid),
          alreadyCommitted: false,
        },
      } satisfies SupplierPaymentReversalResult;
    });
  } catch (error) {
    if (isUniqueViolation(error)) return { ok: false, reason: 'already_reversed' };
    throw error;
  }
}
