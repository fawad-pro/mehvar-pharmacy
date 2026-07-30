'use server';

/**
 * The two login paths and the PIN switch — ADR-7.
 *
 * Errors follow Phase 11 §2: these return typed results rather than throwing,
 * and the UI maps them to I5 messages ("say what to do next, in plain words,
 * without jargon or blame"). No message text is composed here.
 */

import { redirect } from 'next/navigation';

import {
  findDeviceForLogin,
  findOwnerUserId,
  findUser,
  listSwitchableUsers,
  recordPinAttempt,
} from '@/db/auth-queries';
import { tenantScope } from '@/db/scoped';
import type { Uuid } from '@/lib/uuid';

import {
  afterFailedAttempt,
  afterSuccessfulAttempt,
  isLockedOut,
  remainingLockoutMs,
} from './pin-policy';
import { verifyPassword, verifyPin } from './pin';
import { currentSession, issueSession, switchActingUser } from './session';

export type AuthResult =
  | { ok: true }
  | {
      ok: false;
      reason:
        | 'unknown_device'
        | 'bad_pairing_key'
        | 'device_inactive'
        | 'tenant_suspended'
        | 'no_owner'
        | 'unknown_user'
        | 'bad_pin'
        | 'locked_out'
        | 'no_session';
      /** Present on `locked_out` so the UI can say when to try again. */
      retryAfterMs?: number;
    };

/**
 * Device login (Phase 12 §6 step 5). Performed once per counter machine during
 * assisted setup, then effectively never again — the session is long-lived
 * precisely so the shop opens without a login ritual every morning (P8).
 */
export async function loginDevice(input: {
  tenantSlug: string;
  deviceName: string;
  pairingKey: string;
}): Promise<AuthResult> {
  const device = await findDeviceForLogin(input.tenantSlug.trim(), input.deviceName.trim());
  if (!device) {
    return { ok: false, reason: 'unknown_device' };
  }
  if (!device.deviceActive) {
    return { ok: false, reason: 'device_inactive' };
  }
  if (device.tenantStatus === 'suspended') {
    return { ok: false, reason: 'tenant_suspended' };
  }
  if (!(await verifyPassword(device.pairingKeyHash, input.pairingKey))) {
    return { ok: false, reason: 'bad_pairing_key' };
  }

  const ownerId = await findOwnerUserId(device.tenantId);
  if (!ownerId) {
    return { ok: false, reason: 'no_owner' };
  }

  // The device starts as the owner; the first PIN switch moves it to whoever is
  // actually at the counter.
  await issueSession({
    tenantId: device.tenantId,
    userId: ownerId,
    kind: 'device',
    deviceId: device.deviceId,
  });
  return { ok: true };
}

/**
 * PIN switch (F10, Phase 10 §3) — the interaction ADR-7 exists for.
 *
 * Rate limiting and lockout per Phase 12 §5. A failed attempt is recorded even
 * when the user is already locked out, so hammering does not reset the clock.
 */
export async function switchUser(input: { userId: Uuid; pin: string }): Promise<AuthResult> {
  const session = await currentSession();
  if (!session) {
    return { ok: false, reason: 'no_session' };
  }

  const scope = tenantScope({ tenantId: session.tenantId, userId: session.userId });
  const user = await findUser(scope, input.userId);
  if (!user) {
    return { ok: false, reason: 'unknown_user' };
  }

  const state = { failedPinAttempts: user.failedPinAttempts, pinLockedUntil: user.pinLockedUntil };
  if (isLockedOut(state)) {
    return { ok: false, reason: 'locked_out', retryAfterMs: remainingLockoutMs(state) };
  }

  if (!(await verifyPin(user.pinHash, input.pin))) {
    const next = afterFailedAttempt(state);
    await recordPinAttempt(scope, user.id, next);
    return isLockedOut(next)
      ? { ok: false, reason: 'locked_out', retryAfterMs: remainingLockoutMs(next) }
      : { ok: false, reason: 'bad_pin' };
  }

  await recordPinAttempt(scope, user.id, afterSuccessfulAttempt());
  await switchActingUser(session, user.id);
  return { ok: true };
}

/** Names and roles for the PIN-switch overlay. Never returns hashes. */
export async function switchableUsers(): Promise<Array<{ id: Uuid; name: string; role: string }>> {
  const session = await currentSession();
  if (!session) {
    return [];
  }
  const scope = tenantScope({ tenantId: session.tenantId, userId: session.userId });
  const users = await listSwitchableUsers(scope);
  return users.map((user) => ({ id: user.id, name: user.name, role: user.role }));
}

export async function loginDeviceAction(formData: FormData): Promise<void> {
  const result = await loginDevice({
    tenantSlug: String(formData.get('tenantSlug') ?? ''),
    deviceName: String(formData.get('deviceName') ?? ''),
    pairingKey: String(formData.get('pairingKey') ?? ''),
  });

  redirect(result.ok ? '/sale' : `/login?error=${result.reason}`);
}
