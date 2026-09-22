/**
 * Sessions — ADR-7, Phase 12 §5.
 *
 * Two shapes, one table:
 *
 *   device        — the long-lived session on the counter machine. The device
 *                   logs in once, at setup (Phase 12 §6), and stays logged in.
 *                   Which *person* is acting changes within this session by PIN
 *                   switch; the session row's `user_id` moves and the session
 *                   does not end. That is ADR-7's point: the counter is a shared
 *                   terminal, and the real auth act is "who is acting now".
 *
 *   owner_remote  — a short-lived session for the owner's phone (W11).
 *
 * The cookie carries a high-entropy random token; the database stores only its
 * SHA-256. A leaked database backup therefore yields no usable sessions. Argon2
 * is deliberately not used for the token — it is 256 bits of randomness, so
 * there is nothing to brute-force, and this check runs on every request.
 */

import 'server-only';

import { createHash, randomBytes } from 'node:crypto';

import { cookies } from 'next/headers';

import {
  findSessionByTokenHash,
  insertSession,
  revokeSession,
  setSessionUser,
} from '@/db/auth-queries';
import { resolveLicence } from '@/db/licence-state-queries';
import type { LicenceState } from '@/domain/licensing/state';
import { tenantScope, type TenantScope } from '@/db/scoped';
import { uuidv7, type Uuid } from '@/lib/uuid';

export const SESSION_COOKIE = 'mehvar_session';

/** Phase 12 §5: long-lived on the counter, short-lived for owner remote logins. */
export const DEVICE_SESSION_TTL_MS = 365 * 24 * 60 * 60 * 1000;
export const OWNER_SESSION_TTL_MS = 12 * 60 * 60 * 1000;

export type SessionKind = 'device' | 'owner_remote';

export interface ActiveSession {
  readonly sessionId: Uuid;
  readonly kind: SessionKind;
  readonly tenantId: Uuid;
  readonly tenantName: string;
  readonly tenantSlug: string;
  readonly tenantSuspended: boolean;
  /**
   * [PCN-005] The licence tier this pharmacy is operating under.
   *
   * Carried the same way `tenantSuspended` is, and resolved in the same place,
   * because it answers the same shape of question. It is NOT the same thing:
   * suspension is the founder's deliberate hard stop and blocks login, while a
   * lapsed licence never stops a sale. Nothing may set `tenants.status` from a
   * licence lapse.
   */
  readonly licence: LicenceState;
  readonly deviceId: Uuid | null;
  readonly deviceName: string | null;
  /** The `A` in `A-1042` (Phase 9 §3). Null for owner remote sessions. */
  readonly receiptPrefix: string | null;
  readonly userId: Uuid;
  readonly userName: string;
  readonly userRole: 'owner' | 'salesman';
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function newToken(): string {
  return randomBytes(32).toString('base64url');
}

/** Issues a session and sets the cookie. Called by the two login paths only. */
export async function issueSession(input: {
  tenantId: Uuid;
  userId: Uuid;
  kind: SessionKind;
  deviceId?: Uuid | null;
}): Promise<void> {
  const token = newToken();
  const ttl = input.kind === 'device' ? DEVICE_SESSION_TTL_MS : OWNER_SESSION_TTL_MS;
  const expiresAt = new Date(Date.now() + ttl);

  const scope = tenantScope({ tenantId: input.tenantId, userId: input.userId });
  await insertSession(scope, {
    id: uuidv7(),
    kind: input.kind,
    deviceId: input.deviceId ?? null,
    userId: input.userId,
    tokenHash: hashToken(token),
    expiresAt,
  });

  const jar = await cookies();
  jar.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    expires: expiresAt,
  });
}

/**
 * Resolves the current session, or `undefined` when there is none.
 *
 * Deliberately tolerant: an expired, revoked or unknown cookie is simply "not
 * logged in". Nothing here throws — the login screen is always a valid answer,
 * and nothing about a stale cookie may stop a counter from getting back to work.
 */
export async function currentSession(): Promise<ActiveSession | undefined> {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (!token) {
    return undefined;
  }

  const row = await findSessionByTokenHash(hashToken(token));
  if (!row || row.revokedAt !== null || row.expiresAt.getTime() <= Date.now() || !row.userActive) {
    return undefined;
  }

  // Memoised per tenant for a minute — see `licence-state-queries.ts`.
  //
  // A failure here must never cost a session, and must never RESTRICT either.
  // An unreadable licence is our failure, not the pharmacy's: the table might
  // be missing a grant after a migration (PCN-001's exact shape), or the
  // database might simply have hiccupped. Restricting on that would withhold
  // receiving from a pharmacy that has paid, because of a bug on our side.
  //
  // So the fallback is FULL capability and a loud log. `invalid` is reserved
  // for a token we actually read and refused — a fact about the licence rather
  // than a fact about our luck. Every ambiguity resolves toward the customer.
  const licence = await resolveLicence(row.tenantId, row.userId, row.tenantSlug).catch(
    (error: unknown) => {
      console.error(
        'Licence state could not be read — treating as unrestricted. ' +
          'If this persists, run `npm run db:grants` and send a support bundle.',
        error,
      );
      return undefined;
    },
  );

  return {
    sessionId: row.sessionId,
    kind: row.kind,
    tenantId: row.tenantId,
    tenantName: row.tenantName,
    tenantSlug: row.tenantSlug,
    licence: licence?.state ?? { status: 'authorized', tier: 'full' },
    // Phase 8 §4: a tenant flag gates writes; the export endpoint stays open
    // regardless (T3 — the data is the customer's, in every payment state).
    tenantSuspended: row.tenantStatus === 'suspended',
    deviceId: row.deviceId,
    deviceName: row.deviceName,
    receiptPrefix: row.receiptPrefix,
    userId: row.userId,
    userName: row.userName,
    userRole: row.userRole,
  };
}

/**
 * Moves the acting user within an existing device session — the PIN switch.
 *
 * The session survives; only attribution changes. Every record written from
 * here on carries the new user (T1).
 */
export async function switchActingUser(session: ActiveSession, userId: Uuid): Promise<void> {
  await setSessionUser(
    tenantScope({ tenantId: session.tenantId, userId }),
    session.sessionId,
    userId,
  );
}

export async function endSession(session: ActiveSession): Promise<void> {
  await revokeSession(scopeFor(session), session.sessionId);
  const jar = await cookies();
  jar.delete(SESSION_COOKIE);
}

/** The data-access scope for the acting user of this session. */
export function scopeFor(session: ActiveSession): TenantScope {
  return tenantScope({ tenantId: session.tenantId, userId: session.userId });
}
