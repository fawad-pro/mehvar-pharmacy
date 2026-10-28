/**
 * [PCN-014] The owner's PIN, asked for at the counter to approve one act —
 * today, a bill discount over the shop's limit — without switching who is
 * signed in. The salesperson stays the seller of record; the sale records who
 * approved.
 *
 * The same lockout as the PIN switch (Phase 12 §5): a wrong PIN counts against
 * every active owner it was tried on, and a locked-out owner is not tried.
 * Server-only, so approval needs a connection to the shop's computer; offline
 * the counter says so and the sale goes ahead without the discount (P2).
 */

import 'server-only';

import { listSwitchableUsers, recordPinAttempt } from '@/db/auth-queries';
import type { TenantScope } from '@/db/scoped';
import type { Uuid } from '@/lib/uuid';

import { verifyPin } from './pin';
import {
  afterFailedAttempt,
  afterSuccessfulAttempt,
  isLockedOut,
  remainingLockoutMs,
} from './pin-policy';

export type OwnerApproval =
  | { ok: true; ownerId: Uuid; ownerName: string }
  | { ok: false; reason: 'bad_pin' }
  | { ok: false; reason: 'locked_out'; retryAfterMs: number };

export async function approveAsOwner(scope: TenantScope, pin: string): Promise<OwnerApproval> {
  const owners = (await listSwitchableUsers(scope)).filter((user) => user.role === 'owner');
  let soonest: number | null = null;
  const tried: typeof owners = [];

  for (const owner of owners) {
    const state = {
      failedPinAttempts: owner.failedPinAttempts,
      pinLockedUntil: owner.pinLockedUntil,
    };
    if (isLockedOut(state)) {
      const wait = remainingLockoutMs(state);
      soonest = soonest === null ? wait : Math.min(soonest, wait);
      continue;
    }
    if (await verifyPin(owner.pinHash, pin)) {
      await recordPinAttempt(scope, owner.id as Uuid, afterSuccessfulAttempt());
      return { ok: true, ownerId: owner.id as Uuid, ownerName: owner.name };
    }
    tried.push(owner);
  }

  for (const owner of tried) {
    await recordPinAttempt(
      scope,
      owner.id as Uuid,
      afterFailedAttempt({
        failedPinAttempts: owner.failedPinAttempts,
        pinLockedUntil: owner.pinLockedUntil,
      }),
    );
  }
  if (tried.length === 0 && soonest !== null) {
    return { ok: false, reason: 'locked_out', retryAfterMs: soonest };
  }
  return { ok: false, reason: 'bad_pin' };
}
