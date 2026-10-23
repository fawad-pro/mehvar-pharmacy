/**
 * `commitSupplierReturn` — [PCN-009]'s writer for goods sent back to a supplier.
 *
 * Same shape as every transactional writer: owns its transaction whole,
 * idempotent on the client id. Online-only and owner-only (enforced by the
 * action).
 *
 * Stock leaves the batch through ADR-8's guarded function, exactly as a
 * distributor-return adjustment did; `batchLedger` counts the return. The
 * supplier is the one on the invoice the batch arrived with — never chosen
 * freely, so a credit cannot be booked against a distributor who never
 * supplied the goods.
 */

import {
  findSupplierReturnById,
  insertSupplierReturn,
  lockBatchForSupplierReturn,
} from '@/db/correction-queries';
import { consumeFromBatch } from '@/db/sales-queries';
import type { TenantScope } from '@/db/scoped';
import type { Uuid } from '@/lib/uuid';

import { validateSupplierReturn, type SupplierReturnRejection } from './supplier-return';

export interface SupplierReturnCommand {
  /** Client-generated. Idempotency key. */
  readonly returnId: Uuid;
  readonly batchId: Uuid;
  readonly qtyBase: number;
  /** What the supplier credits for the goods. */
  readonly creditPaisa: number;
  readonly note: string | null;
}

export type SupplierReturnResult =
  | { ok: true; value: { returnId: Uuid; alreadyCommitted: boolean } }
  | { ok: false; reason: SupplierReturnRejection | 'unknown_batch' };

export async function commitSupplierReturn(
  scope: TenantScope,
  command: SupplierReturnCommand,
): Promise<SupplierReturnResult> {
  const validation = validateSupplierReturn(command);
  if (!validation.ok) {
    return validation;
  }

  return scope.transaction(async (tx) => {
    if (await findSupplierReturnById(tx, command.returnId)) {
      return {
        ok: true,
        value: { returnId: command.returnId, alreadyCommitted: true },
      } satisfies SupplierReturnResult;
    }

    const batch = await lockBatchForSupplierReturn(tx, command.batchId);
    if (!batch) {
      return { ok: false, reason: 'unknown_batch' } satisfies SupplierReturnResult;
    }
    if (batch.supplierId === null) {
      return { ok: false, reason: 'no_supplier' } satisfies SupplierReturnResult;
    }
    if (!(await consumeFromBatch(tx, batch.batchId, command.qtyBase))) {
      return { ok: false, reason: 'more_than_on_hand' } satisfies SupplierReturnResult;
    }

    await insertSupplierReturn(tx, {
      id: command.returnId,
      supplierId: batch.supplierId,
      productId: batch.productId,
      batchId: batch.batchId,
      qtyBase: command.qtyBase,
      creditPaisa: command.creditPaisa,
      note: command.note?.trim() || null,
    });

    return {
      ok: true,
      value: { returnId: command.returnId, alreadyCommitted: false },
    } satisfies SupplierReturnResult;
  });
}
