/**
 * Licence state — the pure half, and the only licensing module a client
 * component may import.
 *
 * This file is to `verify.ts` what `auth/pin-policy.ts` is to `auth/pin.ts`:
 * the half with no `node:crypto`, no `fs`, and nothing that reaches the
 * database, so the banner and the Settings panel can name a state without
 * dragging the verifier into the browser bundle. The dependency direction is
 * `verify.ts -> state.ts` and `token.ts -> state.ts`, **never the reverse**.
 *
 * Decided by PCN-006 (accepted 2026-09-20, supersedes PCN-005): the offline
 * product is **perpetually licensed**. The licence answers *"is this
 * installation authorized?"*, never *"has this customer paid this period?"*
 * There is no expiry, renewal, grace, warn period or paid-through date. A new
 * **unlicensed** installation runs a **30-day evaluation**; after that, without
 * activation, it is **unauthorized (restricted)**. A valid, bound token is
 * **authorized** with full functionality indefinitely — and that decision is
 * reached before the evaluation clock is ever read (see the resolver in
 * `db/licence-state-queries.ts`).
 */

import { businessDayOf, DEFAULT_TIME_ZONE, type BusinessDay } from '@/lib/business-day';

/** PCN-006: an unlicensed installation may operate as an evaluation for 30 days. */
export const EVALUATION_DAYS = 30;

/**
 * The wire format this build understands. v2 is identity-only (PCN-006); the
 * v1 subscription payload (entitlement/grace/warn/expiry) is retired. A newer
 * one is refused whole.
 */
export const LICENCE_FORMAT_VERSION = 2;

/**
 * What a licence token carries — identity only.
 *
 * Nothing time- or payment-oriented lives here any more: a perpetual licence
 * authorizes an installation and does not expire. `issuedAt` remains, because a
 * founder-signed issue date is a useful, unforgeable fact for support and
 * inspection; it drives no capability. `plan` and `branches` are optional
 * future metadata and are unused by V1 logic.
 */
export interface LicencePayload {
  readonly v: number;
  readonly kid: string;
  readonly licenceId: string;
  readonly tenantSlug: string;
  readonly customerName: string;
  /** ISO-8601 issue date. Identity/support metadata; drives no capability. */
  readonly issuedAt: string;
  /** Optional future metadata — no enforcement. */
  readonly plan?: 'standard';
  /** Optional future metadata (multi-branch) — unenforced until a chain exists. */
  readonly branches?: number;
}

/** A payload whose signature has been checked against the trust root. */
export interface VerifiedLicence {
  readonly payload: LicencePayload;
  /** The token verbatim, so it can be re-verified, re-exported and re-written. */
  readonly token: string;
}

export type LicenceStatus =
  /** No valid bound licence, within the 30-day evaluation window. */
  | 'evaluation'
  /** A valid signed token, bound to this installation, not revoked. */
  | 'authorized'
  /** No valid bound licence, past the 30-day evaluation. */
  | 'unauthorized'
  /** A valid token, but bound to a different installation (a copy). */
  | 'unbound'
  /** A token was present but did not verify. */
  | 'invalid'
  /** A valid signed revocation was received for this licence (a security action). */
  | 'revoked';

export type LicenceInvalidReason =
  | 'bad_signature'
  | 'unknown_key'
  | 'malformed'
  | 'wrong_pharmacy'
  | 'format_too_new';

/** Two tiers. `capabilities.ts` says what each one permits. */
export type CapabilityTier = 'full' | 'restricted';

export interface LicenceState {
  readonly status: LicenceStatus;
  readonly tier: CapabilityTier;
  /** Present once a licence has been verified, whatever its state. */
  readonly customerName?: string;
  readonly licenceId?: string;
  /** For `evaluation` — the business day the 30-day evaluation runs through. */
  readonly evaluationEndsOn?: BusinessDay;
  /** For `evaluation` — whole days remaining, never negative. */
  readonly daysRemaining?: number;
  readonly invalidReason?: LicenceInvalidReason;
}

export interface EvaluateInput {
  /**
   * `businessNow` from `clock.ts` — already reduced over its anchors.
   *
   * Deliberately an input rather than `new Date()`: the evaluation clock is
   * testable only if the evaluator cannot reach for the wall clock itself. It
   * is consulted ONLY when there is no valid bound licence.
   */
  readonly now: Date;
  readonly timeZone?: string | undefined;
  /** The effective, signature-verified licence, if any is installed. */
  readonly effective?: VerifiedLicence | undefined;
  /** Invariant L3 — whether ANY row for the effective licence carries this
   *  machine's installation id. Never read off a single row. */
  readonly boundHere?: boolean | undefined;
  /** Set when a token was present but did not survive verification. */
  readonly invalidReason?: LicenceInvalidReason | undefined;
  /** A valid signed revocation exists for the effective licence (verified in
   *  the DB layer against the trust root; the evaluator stays pure). */
  readonly revoked?: boolean | undefined;
  /** `min()` over the derived sources — when this installation first ran
   *  unlicensed (see `evaluationAnchor` in `clock.ts`). */
  readonly evaluationStartedAt?: Date | undefined;
}

/** Calendar-day arithmetic on a `YYYY-MM-DD` label. Not an instant. */
export function addBusinessDays(day: BusinessDay, days: number): BusinessDay {
  const [year, month, date] = day.split('-').map(Number);
  const shifted = new Date(Date.UTC(year ?? 1970, (month ?? 1) - 1, (date ?? 1) + days));
  return shifted.toISOString().slice(0, 10);
}

/** Whole days from `from` to `to`, by calendar label. Negative once past. */
export function businessDaysBetween(from: BusinessDay, to: BusinessDay): number {
  const ms = Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`);
  return Math.round(ms / 86_400_000);
}

const TIER_OF: Record<LicenceStatus, CapabilityTier> = {
  evaluation: 'full',
  authorized: 'full',
  unauthorized: 'restricted',
  unbound: 'restricted',
  invalid: 'restricted',
  revoked: 'restricted',
};

/**
 * The evaluator. Pure, total, and never throws.
 *
 * Resolution order matters and is the whole of PCN-006's "the clock dies on
 * activation": a revocation or a valid bound licence is decided **before** the
 * evaluation clock is read, so an authorized installation never consults it.
 * Boundaries are compared as tenant-local business days (decision D12), so the
 * evaluation can only end at local midnight.
 */
export function evaluateLicence(input: EvaluateInput): LicenceState {
  const timeZone = input.timeZone ?? DEFAULT_TIME_ZONE;
  const today = businessDayOf(input.now, timeZone);

  // 1. A valid signed revocation is a deliberate security action, honoured
  //    immediately and independently of time or binding. `restricted` — which
  //    still settles existing udhaar, prints and exports (PCN-006).
  if (input.revoked === true && input.effective !== undefined) {
    const { payload } = input.effective;
    return {
      status: 'revoked',
      tier: TIER_OF.revoked,
      customerName: payload.customerName,
      licenceId: payload.licenceId,
    };
  }

  // 2/3. A verified token present. Binding is the only remaining question, and
  //      neither branch reads the evaluation clock.
  if (input.effective !== undefined) {
    const { payload } = input.effective;
    const common = { customerName: payload.customerName, licenceId: payload.licenceId } as const;
    if (input.boundHere === false) {
      return { status: 'unbound', tier: TIER_OF.unbound, ...common };
    }
    return { status: 'authorized', tier: TIER_OF.authorized, ...common };
  }

  // A token was present but did not verify — a fact about the licence, kept
  // distinct from "no licence yet".
  if (input.invalidReason !== undefined) {
    return { status: 'invalid', tier: TIER_OF.invalid, invalidReason: input.invalidReason };
  }

  // 4. No licence. The 30-day evaluation runs from the derived anchor, not from
  //    a file somebody can delete (see `evaluationAnchor` in `clock.ts`).
  const startedOn = businessDayOf(input.evaluationStartedAt ?? input.now, timeZone);
  const evaluationEndsOn = addBusinessDays(startedOn, EVALUATION_DAYS);
  if (today <= evaluationEndsOn) {
    return {
      status: 'evaluation',
      tier: TIER_OF.evaluation,
      evaluationEndsOn,
      daysRemaining: Math.max(0, businessDaysBetween(today, evaluationEndsOn)),
    };
  }
  return { status: 'unauthorized', tier: TIER_OF.unauthorized, evaluationEndsOn };
}
