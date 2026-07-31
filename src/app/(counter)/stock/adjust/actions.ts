'use server';

/**
 * Adjustment actions — W8, W9.
 *
 * Deliberately not owner-gated. W8 is explicit: "Salesman may adjust;
 * visibility is the control, not permission friction (P7 balanced with T1)."
 * Every adjustment is attributed and appears in the owner's day view without
 * exception, which is a stronger control than a permission wall the salesman
 * would simply route around by asking someone else to click it.
 */

import { currentSession, scopeFor } from '@/auth/session';
import { batchesOnHand } from '@/db/adjustment-queries';
import {
  commitAdjustment,
  type AdjustmentCommand,
} from '@/domain/inventory/commit-adjustment';
import type {
  AdjustmentRejection,
  BatchOnHand,
} from '@/domain/inventory/adjustment';

export async function batchesOnHandAction(productId: string): Promise<BatchOnHand[]> {
  const session = await currentSession();
  if (!session) {
    return [];
  }
  return batchesOnHand(scopeFor(session), productId);
}

export type AdjustOutcome =
  | { ok: true; resolvedPendingBase: number }
  | { ok: false; message: string };

/** I5 — say what to do next. */
function messageFor(reason: AdjustmentRejection | 'stale_batch_state'): string {
  switch (reason) {
    case 'zero_delta':
      return 'Enter how many units to add or remove.';
    case 'reason_sign_mismatch':
      return 'That reason does not match the direction. Damage and write-offs remove stock; opening stock adds it.';
    case 'batch_required':
      return 'Choose which batch the stock is leaving.';
    case 'batch_not_allowed':
      return 'Stock being added creates its own batch — no batch to choose.';
    case 'stale_batch_state':
      return 'That batch does not have that many left. Check the figure and try again.';
    default:
      return 'That did not save. Try again.';
  }
}

export async function adjustStockAction(command: AdjustmentCommand): Promise<AdjustOutcome> {
  const session = await currentSession();
  if (!session) {
    return { ok: false, message: 'This device needs to sign in again.' };
  }
  if (session.tenantSuspended) {
    return { ok: false, message: 'This pharmacy’s account is on hold. Contact support.' };
  }

  const result = await commitAdjustment(scopeFor(session), command);
  if (!result.ok) {
    return { ok: false, message: messageFor(result.reason) };
  }
  return { ok: true, resolvedPendingBase: result.value.resolvedPendingBase };
}
