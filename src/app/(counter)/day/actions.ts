'use server';

/**
 * Day-close actions — W10.
 *
 * Not offline-capturable: the drawer-count ritual happens at the counter,
 * online, at shutter-down — same posture as purchases and adjustments.
 */

import { currentSession, scopeFor } from '@/auth/session';
import {
  commitCashMovement,
  type CashMovementCommand,
  type CashMovementRejection,
} from '@/domain/cash/commit-cash-movement';
import { commitCashReversal } from '@/domain/cash/commit-cash-reversal';
import { REVERSAL_REFUSAL_MESSAGES } from '@/domain/corrections/reversal';
import { uuidv7, type Uuid } from '@/lib/uuid';

import { revalidateAfter } from '../revalidate';

export type CashMovementOutcome = { ok: true } | { ok: false; message: string };

/** I5 — name the fix, not the rule. */
function messageFor(reason: CashMovementRejection): string {
  switch (reason) {
    case 'invalid_amount':
      return 'Enter an amount greater than zero.';
    case 'direction_mismatch':
      return 'That direction does not match the reason.';
    default:
      return 'That did not save. Try again.';
  }
}

export async function recordCashMovementAction(
  command: CashMovementCommand,
): Promise<CashMovementOutcome> {
  const session = await currentSession();
  if (!session) {
    return { ok: false, message: 'This device needs to sign in again.' };
  }
  if (session.userRole !== 'owner') {
    return { ok: false, message: 'Only the owner can record this.' };
  }
  if (session.tenantSuspended) {
    return { ok: false, message: 'This pharmacy’s account is on hold. Contact support.' };
  }

  const result = await commitCashMovement(scopeFor(session), command);
  if (!result.ok) {
    return { ok: false, message: messageFor(result.reason) };
  }
  revalidateAfter('money');
  return { ok: true };
}

/**
 * [PCN-013] Cancels a cash movement typed wrong. Owner only, like recording
 * one; it writes the opposite movement, so the drawer's expected cash is right
 * again and the exception list shows both.
 */
export async function cancelCashMovementAction(movementId: Uuid): Promise<CashMovementOutcome> {
  const session = await currentSession();
  if (!session) {
    return { ok: false, message: 'This device needs to sign in again.' };
  }
  if (session.userRole !== 'owner') {
    return { ok: false, message: 'Only the owner can cancel this.' };
  }

  const result = await commitCashReversal(scopeFor(session), {
    reversalId: uuidv7(),
    movementId,
  });
  if (!result.ok) {
    return { ok: false, message: REVERSAL_REFUSAL_MESSAGES[result.reason] };
  }
  revalidateAfter('money');
  return { ok: true };
}
