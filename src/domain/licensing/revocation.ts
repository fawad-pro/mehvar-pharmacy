/**
 * Signed revocations (Stage 2).
 *
 * A revocation is a founder-signed statement that a specific licence is no
 * longer valid, delivered by the refresh endpoint (`licence-refresh.ts`) and
 * honoured immediately. It verifies against the SAME trust root as the licence
 * token, in the SAME envelope shape:
 *
 *     MEHVARREV1.<base64url(payload JSON)>.<base64url(ed25519 signature)>
 *
 * The permanent rules this obeys (PCN-005, and the Stage 2 brief):
 *
 *   - **Silence is never revocation.** Only a valid signed statement revokes.
 *     A failed refresh, a timeout, an unreachable endpoint — none of these are
 *     revocations. That lives in the refresh client, not here; here we only
 *     verify a statement that actually arrived.
 *   - **A revocation never deletes data and never locks export.** It moves the
 *     licence to the `restricted` tier — which, like `lapsed`, still sells,
 *     prints and exports. Revocation stops restocking, not trading.
 *   - Re-verified at read time against the trust root, never trusted from a
 *     stored column — the same belt-and-braces the licence token gets.
 */

import { signEnvelope, verifyEnvelope } from '@/domain/trust/envelope';
import type { Keyring } from '@/domain/trust/keys';
import type { KeyObject } from 'node:crypto';

export const REVOCATION_PREFIX = 'MEHVARREV1';

/** The wire format version this build understands for a revocation. */
export const REVOCATION_FORMAT_VERSION = 1;

export interface RevocationPayload {
  readonly v: number;
  readonly kid: string;
  /** The licence this revokes — matched against the effective licence's id. */
  readonly licenceId: string;
  /** Bound to a pharmacy, so one tenant's revocation cannot touch another's. */
  readonly tenantSlug: string;
  /** ISO-8601. When the founder revoked it. Informational; a valid revocation
   *  is honoured immediately regardless of this. */
  readonly revokedAt: string;
  /** A short machine-readable reason, e.g. 'superseded' | 'chargeback' | 'fraud'. */
  readonly reason: string;
}

export type RevocationInvalidReason =
  | 'malformed'
  | 'unknown_key'
  | 'bad_signature'
  | 'wrong_pharmacy'
  | 'wrong_licence'
  | 'format_too_new';

export interface VerifiedRevocation {
  readonly payload: RevocationPayload;
  readonly token: string;
}

export type RevocationVerifyResult =
  | { readonly ok: true; readonly revocation: VerifiedRevocation }
  | { readonly ok: false; readonly reason: RevocationInvalidReason };

function readKid(json: string): string | undefined {
  try {
    const parsed = JSON.parse(json) as Record<string, unknown>;
    return typeof parsed.kid === 'string' ? parsed.kid : undefined;
  } catch {
    return undefined;
  }
}

function isRevocationPayload(value: unknown): value is RevocationPayload {
  if (typeof value !== 'object' || value === null) return false;
  const c = value as Record<string, unknown>;
  return (
    typeof c.v === 'number' &&
    typeof c.kid === 'string' &&
    typeof c.licenceId === 'string' &&
    typeof c.tenantSlug === 'string' &&
    typeof c.revokedAt === 'string' &&
    typeof c.reason === 'string' &&
    !Number.isNaN(Date.parse(c.revokedAt))
  );
}

/**
 * Verify a revocation token. Total — never throws.
 *
 * Optionally pins the expected pharmacy and licence, so a validly signed
 * revocation for licence A cannot be replayed against licence B, and one
 * tenant's revocation cannot be applied to another tenant.
 */
export function verifyRevocation(
  token: string,
  options: {
    readonly expectedTenantSlug?: string | undefined;
    readonly expectedLicenceId?: string | undefined;
    readonly keyring?: Keyring | undefined;
  } = {},
): RevocationVerifyResult {
  const verified = verifyEnvelope(REVOCATION_PREFIX, token, readKid, options.keyring);
  if (!verified.ok) return { ok: false, reason: verified.reason };

  let payload: unknown;
  try {
    payload = JSON.parse(verified.json);
  } catch {
    return { ok: false, reason: 'malformed' };
  }
  if (!isRevocationPayload(payload)) return { ok: false, reason: 'malformed' };
  if (payload.v > REVOCATION_FORMAT_VERSION) return { ok: false, reason: 'format_too_new' };

  if (
    options.expectedTenantSlug !== undefined &&
    payload.tenantSlug !== options.expectedTenantSlug
  ) {
    return { ok: false, reason: 'wrong_pharmacy' };
  }
  if (options.expectedLicenceId !== undefined && payload.licenceId !== options.expectedLicenceId) {
    return { ok: false, reason: 'wrong_licence' };
  }

  return { ok: true, revocation: { payload, token: token.trim() } };
}

/** Sign a revocation. The founder's half, used by `licence:revoke` and tests. */
export function signRevocation(payload: RevocationPayload, privateKey: KeyObject): string {
  return signEnvelope(REVOCATION_PREFIX, JSON.stringify(payload), privateKey);
}
