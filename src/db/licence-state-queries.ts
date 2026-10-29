import 'server-only';

import {
  businessNow,
  clockDisagreement,
  corroboratedWitness,
  evaluationAnchor,
  type ClockDisagreement,
} from '@/domain/licensing/clock';
import { evaluateEntitlement } from '@/domain/licensing/entitlement';
import { evaluateLicence, type LicenceState } from '@/domain/licensing/state';
import { serverEnv } from '@/env';
import { verifyRevocation } from '@/domain/licensing/revocation';
import { verifyToken } from '@/domain/licensing/verify';
import { readInstallation } from '@/lib/installation';
import type { Uuid } from '@/lib/uuid';

import {
  earliestEventAt,
  earliestObservation,
  ledgerHighWaterMark,
  licenceStanding,
  listRevocations,
  recentObservations,
  tenantCreatedAt,
} from './licence-queries';
import { listEntitlements } from './entitlement-queries';
import { findInstallation } from './installation-queries';
import { tenantScope } from './scoped';

/**
 * Resolving a tenant's licence state — the one place the pure evaluator meets
 * the database.
 *
 * Memoised per tenant with a short TTL, because `currentSession()` runs on every
 * page and every server action, and this reads a dozen aggregates. The cache is
 * **explicitly invalidated when a licence is installed**: without that, an owner
 * pastes a valid licence, the banner stays up for a minute, and they reasonably
 * conclude it did not work — which is the support call this whole design exists
 * to avoid.
 */

const TTL_MS = 60_000;

export interface ResolvedLicence {
  readonly state: LicenceState;
  readonly installationId: string | undefined;
  readonly clock: ClockDisagreement;
  readonly rebindsUsed: number;
  /** For the banner's honest two-date sentence when the clock disagrees. */
  readonly systemNow: Date;
  readonly businessNow: Date;
}

interface CacheEntry {
  readonly at: number;
  readonly value: ResolvedLicence;
}

const cache = new Map<string, CacheEntry>();

/** Called by the licence writer. A stale banner reads as "it did not work". */
export function forgetLicenceState(tenantId: Uuid): void {
  cache.delete(tenantId);
}

export async function resolveLicence(
  tenantId: Uuid,
  userId: Uuid,
  tenantSlug: string,
  timeZone?: string,
): Promise<ResolvedLicence> {
  const hit = cache.get(tenantId);
  if (hit !== undefined && Date.now() - hit.at < TTL_MS) return hit.value;

  const value = await computeLicence(tenantId, userId, tenantSlug, timeZone);
  cache.set(tenantId, { at: Date.now(), value });
  return value;
}

async function computeLicence(
  tenantId: Uuid,
  userId: Uuid,
  tenantSlug: string,
  timeZone?: string,
): Promise<ResolvedLicence> {
  const systemNow = new Date();
  const scope = tenantScope({ tenantId, userId });

  /*
   * THE ENTITLEMENT SEAM (PCN-019 decision 10). "May this tenant use the
   * product, and until when" has one answer per run mode: a local install
   * reads its PCN-006 licence file below; a cloud-hosted tenant has no machine
   * to bind a file to, so it reads its own entitlement record. Everything
   * downstream sees the same `LicenceState`. A subscription later is another
   * source behind this branch, not a new check somewhere else.
   */
  if (serverEnv().MEHVAR_DEPLOYMENT === 'cloud') {
    const rows = await listEntitlements(scope);
    return {
      state: evaluateEntitlement({ now: systemNow, customerName: tenantSlug, rows }),
      installationId: undefined,
      clock: 'none',
      rebindsUsed: 0,
      systemNow,
      businessNow: systemNow,
    };
  }

  const installationId = readInstallation()?.installationId;

  const standing = await licenceStanding(scope, installationId ?? '', systemNow);

  // Verified here rather than trusted from the row: the columns are a
  // convenience for querying, and the signature is the actual authority.
  const verified =
    standing.effective === undefined
      ? undefined
      : verifyToken(standing.effective.token, { expectedTenantSlug: tenantSlug });

  const licence = verified?.ok === true ? verified.licence : undefined;
  const invalidReason = verified !== undefined && !verified.ok ? verified.reason : undefined;

  // PCN-006: the authorized path never reads the evaluation clock. A verified
  // token — or a token that was present but did not verify — decides the state
  // before any anchor is gathered. The clock exists only to end the evaluation
  // of an installation that has *no* licence at all, so when one is present we
  // skip the dozen aggregates entirely and there is no `businessNow` to report.
  if (licence !== undefined || invalidReason !== undefined) {
    // A licence is revoked iff a stored revocation for its licence id RE-VERIFIES
    // against the trust root and is pinned to this tenant. Verified here, not
    // trusted from the column — the same posture as the licence token. A tampered
    // or foreign-tenant revocation simply fails to verify and is ignored, so a
    // bad revocation can never restrict a paying pharmacy.
    const revocationRows = licence === undefined ? [] : await listRevocations(scope);
    const revoked =
      licence !== undefined &&
      revocationRows.some(
        (row) =>
          row.licenceId === licence.payload.licenceId &&
          verifyRevocation(row.token, {
            expectedTenantSlug: tenantSlug,
            expectedLicenceId: licence.payload.licenceId,
          }).ok,
      );

    const state = evaluateLicence({
      now: systemNow,
      timeZone,
      effective: licence,
      boundHere: licence === undefined ? undefined : standing.boundHere,
      invalidReason,
      revoked,
    });

    return {
      state,
      installationId,
      clock: 'none',
      rebindsUsed: standing.rebindsUsed,
      systemNow,
      businessNow: systemNow,
    };
  }

  // No licence at all — the only path that consults the evaluation clock.
  const [observations, highWater, earliestEvent, firstObservation, tenantBirth, installRow] =
    await Promise.all([
      recentObservations(),
      ledgerHighWaterMark(scope),
      earliestEventAt(scope),
      earliestObservation(),
      tenantCreatedAt(tenantId),
      installationId === undefined ? Promise.resolve(undefined) : findInstallation(installationId),
    ]);

  const anchors = {
    systemNow,
    witness: corroboratedWitness(observations),
    ledgerHighWater: highWater,
    installationFirstSeenAt: installRow?.firstSeenAt,
  };

  const now = businessNow(anchors);

  const state = evaluateLicence({
    now,
    timeZone,
    evaluationStartedAt: evaluationAnchor({
      tenantCreatedAt: tenantBirth,
      installationFirstSeenAt: installRow?.firstSeenAt,
      earliestEvent,
      earliestObservation: firstObservation,
      fallback: systemNow,
    }),
  });

  return {
    state,
    installationId,
    clock: clockDisagreement(anchors),
    rebindsUsed: standing.rebindsUsed,
    systemNow,
    businessNow: now,
  };
}
