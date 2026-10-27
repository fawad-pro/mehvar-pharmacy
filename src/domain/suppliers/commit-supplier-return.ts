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
import { productUnitsFor } from '@/db/purchase-queries';
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
  /** [PCN-012] The amount as entered — "5 box" — for display. */
  readonly entered?: { readonly unitKey: string; readonly unitName: string; readonly unitCount: number };
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
    // [PCN-012] The entered pack must be the product's, at its size.
    if (command.entered) {
      const unit = (await productUnitsFor(tx, [batch.productId]))
        .get(batch.productId)
        ?.find((candidate) => candidate.key === command.entered?.unitKey);
      if (!unit || unit.factor * command.entered.unitCount !== command.qtyBase) {
        return { ok: false, reason: 'invalid_quantity' } satisfies SupplierReturnResult;
      }
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
      ...(command.entered
        ? {
            unitKey: command.entered.unitKey,
            unitName: command.entered.unitName,
            unitCount: command.entered.unitCount,
          }
        : {}),
    });

    return {
      ok: true,
      value: { returnId: command.returnId, alreadyCommitted: false },
    } satisfies SupplierReturnResult;
  });
}
