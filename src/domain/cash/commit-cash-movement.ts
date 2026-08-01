/**
 * `commitCashMovement` — the one writer for cash movements (W10).
 *
 * A single insert, but idempotent on a client-generated id like every other
 * writer: the drawer-count ritual is exactly the moment a slow connection or a
 * double tap is likeliest, and an over/short entry recorded twice would make
 * the drawer lie about itself.
 *
 * Online only, same posture as purchases and adjustments — W10 happens at
 * shutter-down, at the counter, not offline.
 */

import { findCashMovementById, insertCashMovement } from '@/db/cash-queries';
import type { TenantScope } from '@/db/scoped';
import type { Uuid } from '@/lib/uuid';

import {
  validateCashMovementCommand,
  type CashMovementCommand,
  type CashMovementRejection,
} from './cash-command';

export {
  CASH_REASONS,
  CASH_REASON_LABELS,
  directionFor,
  validateCashMovementCommand,
  type CashDirection,
  type CashMovementCommand,
  type CashMovementRejection,
  type CashReason,
} from './cash-command';

export interface CashMovementCommitted {
  readonly movementId: Uuid;
  readonly alreadyCommitted: boolean;
}

export type CashMovementResult =
  | { ok: true; value: CashMovementCommitted }
  | { ok: false; reason: CashMovementRejection };

export async function commitCashMovement(
  scope: TenantScope,
  command: CashMovementCommand,
): Promise<CashMovementResult> {
  const validation = validateCashMovementCommand(command);
  if (!validation.ok) {
    return validation;
  }

  return scope.transaction(async (tx) => {
    const existing = await findCashMovementById(tx, command.movementId);
    if (existing) {
      return {
        ok: true,
        value: { movementId: command.movementId, alreadyCommitted: true },
      } satisfies CashMovementResult;
    }

    await insertCashMovement(tx, {
      id: command.movementId,
      direction: command.direction,
      amountPaisa: command.amountPaisa,
      reason: command.reason,
      note: command.note,
    });

    return {
      ok: true,
      value: { movementId: command.movementId, alreadyCommitted: false },
    } satisfies CashMovementResult;
  });
}
