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
 * Decided by PCN-005 (accepted 2026-09-16): an expired licence never stops the
 * counter, never stops a receipt printing and never closes export. What it
 * withholds is everything that is not on the sale path. `capabilities.ts` holds
 * that table; this file decides only which state the installation is in.
 */

import { businessDayOf, DEFAULT_TIME_ZONE, type BusinessDay } from '@/lib/business-day';

/** Phase 3 §3: "14-day full trial, no card." */
export const TRIAL_DAYS = 14;

/** `graceDays` is issued rather than hardcoded, but never outside these bounds. */
export const MIN_GRACE_DAYS = 0;
export const MAX_GRACE_DAYS = 180;

/** The wire format this build understands. A newer one is refused whole. */
export const LICENCE_FORMAT_VERSION = 1;

/**
 * What a licence token carries.
 *
 * Two expiry fields, and the difference is the whole of finding 1:
 * `entitlementEndsAt` is the business fact (what the customer paid through) and
 * drives the capability tier; `expiresAt` is the cryptographic fact (when this
 * token should be replaced) and drives nothing but a notice. A stale token whose
 * entitlement is still live must never degrade capability, or one cloud outage
 * longer than a lease window lapses every paying pharmacy at once.
 */
export interface LicencePayload {
  readonly v: number;
  readonly kid: string;
  readonly licenceId: string;
  readonly tenantSlug: string;
  readonly customerName: string;
  readonly plan: 'standard';
  /** 1 today. The chain lever; unenforced until a chain exists (roadmap Phase 4). */
  readonly branches: number;
  /** ISO-8601. Also a founder-signed, unforgeable clock anchor — see `clock.ts`. */
  readonly issuedAt: string;
  /** ISO-8601. What the customer paid through. Drives the tier. */
  readonly entitlementEndsAt: string;
  /** ISO-8601. When this token should be replaced. Drives only a notice. */
  readonly expiresAt: string;
  readonly graceDays: number;
  readonly warnDays: number;
  /**
   * Optional and normally absent. Clock observations later than this are
   * ignored — the signed repair for a witness poisoned by a persistent clock
   * fault (Invariant L6). Only obtainable from the signing key.
   */
  readonly clockCeiling?: string;
}

/** A payload whose signature has been checked against the trust root. */
export interface VerifiedLicence {
  readonly payload: LicencePayload;
  /** The token verbatim, so it can be re-verified, re-exported and re-written. */
  readonly token: string;
}

export type LicenceStatus =
  /** No licence yet, inside the trial window. */
  | 'trial'
  /** Paid, comfortably inside the term. */
  | 'licensed'
  /** Within `warnDays` of the entitlement ending. */
  | 'expiring'
  /** Past the entitlement, inside `graceDays`. */
  | 'grace'
  /** Token past `expiresAt`, entitlement still live. Never degrades. */
  | 'stale'
  /** A valid signed revocation was received for this licence (Stage 2). */
  | 'revoked'
  /** Past entitlement plus grace — or the trial ran out and nothing was pasted. */
  | 'lapsed'
  /** A valid licence, registered to a different installation. */
  | 'unbound'
  /** Bad signature, wrong slug, unreadable, unknown key, or a newer format. */
  | 'invalid';

export type LicenceInvalidReason =
  'bad_signature' | 'unknown_key' | 'malformed' | 'wrong_pharmacy' | 'format_too_new';

/** Three tiers. `capabilities.ts` says what each one permits. */
export type CapabilityTier = 'full' | 'full_notice' | 'restricted';

export interface LicenceState {
  readonly status: LicenceStatus;
  readonly tier: CapabilityTier;
  /** Present once a licence has been verified, whatever its state. */
  readonly customerName?: string;
  readonly licenceId?: string;
  /** The business day the entitlement runs through, in tenant-local time. */
  readonly entitlementEndsOn?: BusinessDay;
  /** The business day the grace period runs through. */
  readonly graceEndsOn?: BusinessDay;
  /** Negative once the entitlement has passed. Absent during a trial. */
  readonly daysRemaining?: number;
  /** For `trial` — the business day the trial runs through. */
  readonly trialEndsOn?: BusinessDay;
  readonly invalidReason?: LicenceInvalidReason;
  /**
   * True when `lapsed` was reached from an expired trial rather than from an
   * expired licence. The tier is identical; only the words differ.
   */
  readonly neverLicensed?: boolean;
}

export interface EvaluateInput {
  /**
   * `businessNow` from `clock.ts` — already reduced over its five anchors.
   *
   * Deliberately an input rather than `new Date()`: the whole clock model is
   * testable only if the evaluator cannot reach for the wall clock itself.
   */
  readonly now: Date;
  readonly timeZone?: string | undefined;
  /** The effective licence per Invariant L2, if any has ever been installed. */
  readonly effective?: VerifiedLicence | undefined;
  /** Invariant L3 — computed by asking whether ANY row for the effective
   *  licence id carries this machine's installation id. Never read off a row. */
  readonly boundHere?: boolean | undefined;
  /** Set when a token was present but did not survive verification. */
  readonly invalidReason?: LicenceInvalidReason | undefined;
  /** [Stage 2] A valid signed revocation exists for the effective licence.
   *  Verified in the DB layer against the trust root; the evaluator stays pure. */
  readonly revoked?: boolean | undefined;
  /** `min()` over the derived sources — see `trialAnchor` in `clock.ts`. */
  readonly trialStartedAt?: Date | undefined;
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

export function clampGraceDays(days: number): number {
  if (!Number.isFinite(days)) return MIN_GRACE_DAYS;
  return Math.min(MAX_GRACE_DAYS, Math.max(MIN_GRACE_DAYS, Math.trunc(days)));
}

const TIER_OF: Record<LicenceStatus, CapabilityTier> = {
  trial: 'full',
  licensed: 'full',
  expiring: 'full_notice',
  grace: 'full_notice',
  stale: 'full_notice',
  revoked: 'restricted',
  lapsed: 'restricted',
  unbound: 'restricted',
  invalid: 'restricted',
};

/**
 * The evaluator. Pure, total, and never throws.
 *
 * Boundaries are compared as tenant-local business days rather than instants
 * (decision D12), so a tier can only ever change at local midnight — never
 * mid-trading-day, and never because a comparison landed on the wrong side of
 * a UTC boundary at five in the morning.
 */
export function evaluateLicence(input: EvaluateInput): LicenceState {
  const timeZone = input.timeZone ?? DEFAULT_TIME_ZONE;
  const today = businessDayOf(input.now, timeZone);

  if (input.invalidReason !== undefined) {
    return { status: 'invalid', tier: 'restricted', invalidReason: input.invalidReason };
  }

  // A valid signed revocation is honoured immediately, regardless of dates or
  // binding. `restricted` — which still sells, prints and exports (PCN-005);
  // revocation stops restocking, never trading, and never deletes data.
  if (input.revoked === true && input.effective !== undefined) {
    const { payload } = input.effective;
    return {
      status: 'revoked',
      tier: 'restricted',
      customerName: payload.customerName,
      licenceId: payload.licenceId,
    };
  }

  if (input.effective === undefined) {
    // Never licensed. The trial runs from the derived anchor, not from a file
    // somebody can delete — see `trialAnchor` in `clock.ts`.
    const startedOn = businessDayOf(input.trialStartedAt ?? input.now, timeZone);
    const trialEndsOn = addBusinessDays(startedOn, TRIAL_DAYS);
    if (today <= trialEndsOn) {
      return {
        status: 'trial',
        tier: 'full',
        trialEndsOn,
        daysRemaining: businessDaysBetween(today, trialEndsOn),
      };
    }
    return { status: 'lapsed', tier: 'restricted', trialEndsOn, neverLicensed: true };
  }

  const { payload, token } = input.effective;
  void token;

  const entitlementEndsOn = businessDayOf(new Date(payload.entitlementEndsAt), timeZone);
  const graceEndsOn = addBusinessDays(entitlementEndsOn, clampGraceDays(payload.graceDays));
  const daysRemaining = businessDaysBetween(today, entitlementEndsOn);

  const common = {
    customerName: payload.customerName,
    licenceId: payload.licenceId,
    entitlementEndsOn,
    graceEndsOn,
    daysRemaining,
  } as const;

  // Binding is asked first, deliberately. It is the machine-identity question
  // and the cheaper fix, and the Settings panel shows the entitlement date
  // beside it — so an owner whose licence is BOTH unbound and lapsed learns
  // both facts at once rather than on two separate trips.
  if (input.boundHere === false) {
    return { status: 'unbound', tier: TIER_OF.unbound, ...common };
  }

  if (today > graceEndsOn) {
    return { status: 'lapsed', tier: TIER_OF.lapsed, ...common };
  }
  if (today > entitlementEndsOn) {
    return { status: 'grace', tier: TIER_OF.grace, ...common };
  }

  // Entitlement is live from here down, so nothing below may reach `restricted`.
  const tokenExpiresOn = businessDayOf(new Date(payload.expiresAt), timeZone);
  if (today > tokenExpiresOn) {
    return { status: 'stale', tier: TIER_OF.stale, ...common };
  }

  const warnFrom = addBusinessDays(entitlementEndsOn, -Math.max(0, Math.trunc(payload.warnDays)));
  if (today >= warnFrom) {
    return { status: 'expiring', tier: TIER_OF.expiring, ...common };
  }

  return { status: 'licensed', tier: TIER_OF.licensed, ...common };
}
