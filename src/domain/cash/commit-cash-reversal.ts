/**
 * [PCN-013] `commitCashReversal` — cancels a cash movement typed wrong (an
 * expense of Rs 5,000 for Rs 500, a float entered twice).
 *
 * A compensating row in `cash_movements` (ADR-1, T2): the same amount and
 * reason in the opposite direction, `reverses_id` pointing at the original.
 * Expected cash is in minus out, so it is right without changing; the
 * exception list names the row as a cancellation (T1).
 *
 * Idempotent on the client id; online and owner only.
 */

import {
  findCashMovementById,
  findCashMovementForReversal,
  findCashMovementReversalOf,
  insertCashMovement,
} from '@/db/cash-queries';
import { isUniqueViolation } from '@/db/errors';
import type { TenantScope } from '@/db/scoped';
import type { Uuid } from '@/lib/uuid';

import { reversalRefusal, type ReversalRefusal } from '../corrections/reversal';

export interface CashReversalCommand {
  readonly reversalId: Uuid;
  readonly movementId: Uuid;
}

export type CashReversalResult =
  | { ok: true; value: { readonly alreadyCommitted: boolean } }
  | { ok: false; reason: ReversalRefusal };

export async function commitCashReversal(
  scope: TenantScope,
  command: CashReversalCommand,
): Promise<CashReversalResult> {
  try {
    return await scope.transaction(async (tx) => {
      if (await findCashMovementById(tx, command.reversalId)) {
        return { ok: true, value: { alreadyCommitted: true } } satisfies CashReversalResult;
      }

      const original = await findCashMovementForReversal(tx, command.movementId);
      const refusal = reversalRefusal(
        original,
        await findCashMovementReversalOf(tx, command.movementId),
      );
      if (refusal || !original) {
        return { ok: false, reason: refusal ?? 'not_found' } satisfies CashReversalResult;
      }

      await insertCashMovement(tx, {
        id: command.reversalId,
        direction: original.direction === 'in' ? 'out' : 'in',
        amountPaisa: original.amountPaisa,
        reason: original.reason,
        note: null,
        reversesId: original.id,
      });
      return { ok: true, value: { alreadyCommitted: false } } satisfies CashReversalResult;
    });
  } catch (error) {
    if (isUniqueViolation(error)) return { ok: false, reason: 'already_reversed' };
    throw error;
  }
}
