/**
 * Token in, verified licence out — the only place the two halves meet.
 *
 * Reaches `node:crypto` through `trust/signature.ts`, so **no client component
 * may import this file, and `state.ts` must never import it either.** The
 * direction is `verify.ts -> state.ts`, never the reverse.
 */

import { verifyDetached } from '@/domain/trust/signature';
import type { Keyring } from '@/domain/trust/keys';

import { type LicenceInvalidReason, type VerifiedLicence } from './state';
import { parseToken } from './token';

export type VerifyResult =
  | { readonly ok: true; readonly licence: VerifiedLicence }
  | { readonly ok: false; readonly reason: LicenceInvalidReason };

/**
 * Verify a token, optionally against an expected pharmacy.
 *
 * A v2 payload is identity-only (PCN-006); there are no time/payment fields left
 * to clamp. The token either verifies against the trust root and names this
 * pharmacy, or it does not.
 */
export function verifyToken(
  token: string,
  options: {
    readonly expectedTenantSlug?: string | undefined;
    readonly keyring?: Keyring | undefined;
  } = {},
): VerifyResult {
  const parsed = parseToken(token);
  if (!parsed.ok) {
    return {
      ok: false,
      reason: parsed.reason === 'format_too_new' ? 'format_too_new' : 'malformed',
    };
  }

  const { payload, signedBytes, signature } = parsed;

  if (!verifyDetached(signedBytes, signature, payload.kid, options.keyring)) {
    // Unknown key and wrong signature are deliberately reported apart: one
    // means "update Mehvar", the other means "this token is not ours".
    const known = options.keyring !== undefined ? payload.kid in options.keyring : undefined;
    return { ok: false, reason: known === false ? 'unknown_key' : 'bad_signature' };
  }

  if (
    options.expectedTenantSlug !== undefined &&
    payload.tenantSlug !== options.expectedTenantSlug
  ) {
    return { ok: false, reason: 'wrong_pharmacy' };
  }

  return {
    ok: true,
    licence: {
      token: token.trim(),
      payload,
    },
  };
}

/**
 * Invariant L2 — the effective licence.
 *
 * Group by `licenceId`; within a group take the greatest `issuedAt`, tie-broken
 * by greatest `installedAt`. Across groups, take the most recently issued.
 *
 * "Newest row wins" is what this replaces, and it was wrong: every rebind writes
 * a second row carrying the SAME token and therefore the same `issuedAt`, so the
 * comparison tied — and the tie decided whether the machine read as bound.
 *
 * Two rules, and they answer every case that matters. A re-issue shares its
 * `licenceId` and supersedes by `issuedAt`; re-pasting an old token is a no-op.
 * A licence is perpetual, so there is no entitlement duration to compare — when
 * two UNRELATED licence ids are present (unusual), the most recently issued
 * wins, deterministically.
 */
export interface LicenceRow {
  readonly licenceId: string;
  readonly token: string;
  readonly issuedAt: Date;
  readonly installationId: string;
  readonly installedAt: Date;
}

export function effectiveLicenceRow<T extends LicenceRow>(rows: readonly T[]): T | undefined {
  const winnerPerLicence = new Map<string, T>();
  for (const row of rows) {
    const held = winnerPerLicence.get(row.licenceId);
    if (
      held === undefined ||
      row.issuedAt.getTime() > held.issuedAt.getTime() ||
      (row.issuedAt.getTime() === held.issuedAt.getTime() &&
        row.installedAt.getTime() > held.installedAt.getTime())
    ) {
      winnerPerLicence.set(row.licenceId, row);
    }
  }

  // Across groups: greatest issue, then greatest install. The tiebreak exists so
  // the answer is DETERMINISTIC when two unrelated licences were issued at the
  // same instant — an arbitrary winner decided by map iteration order is a bug
  // waiting for a support call.
  let best: T | undefined;
  for (const row of winnerPerLicence.values()) {
    if (best === undefined || isPreferred(row, best)) best = row;
  }
  return best;
}

function isPreferred(candidate: LicenceRow, held: LicenceRow): boolean {
  const byIssue = candidate.issuedAt.getTime() - held.issuedAt.getTime();
  if (byIssue !== 0) return byIssue > 0;
  return candidate.installedAt.getTime() > held.installedAt.getTime();
}

/**
 * Invariant L3 — binding is a separate question.
 *
 * Asked as "does ANY row for the effective licence carry this machine's
 * installation id", never read off the effective row. That removes the rebind
 * tie entirely, and it is the semantically correct question: a licence that has
 * ever been bound here is bound here.
 */
export function isBoundHere(
  rows: readonly LicenceRow[],
  licenceId: string,
  installationId: string,
): boolean {
  return rows.some((row) => row.licenceId === licenceId && row.installationId === installationId);
}

/** Distinct machines this licence has been bound to within the window. */
export function rebindsUsed(rows: readonly LicenceRow[], licenceId: string, since: Date): number {
  const machines = new Set(
    rows
      .filter((row) => row.licenceId === licenceId && row.installedAt.getTime() >= since.getTime())
      .map((row) => row.installationId),
  );
  return Math.max(0, machines.size - 1);
}

/** Three a year, self-service. The limit message never accuses (decision D10). */
export const REBIND_ALLOWANCE = 3;
export const REBIND_WINDOW_DAYS = 365;
