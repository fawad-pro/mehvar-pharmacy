import 'server-only';

import { randomBytes } from 'node:crypto';

import { verifyRevocation } from '@/domain/licensing/revocation';
import { verifyToken } from '@/domain/licensing/verify';
import { readInstallation } from '@/lib/installation';
import { writeLicenceFile } from '@/lib/licence-file';
import { uuidv7 } from '@/lib/uuid';

import { listTenantIds, anyUserId, tenantSlugById } from './provisioning';
import { forgetLicenceState } from './licence-state-queries';
import {
  insertLicence,
  insertRevocation,
  installationsForLicence,
  licenceStanding,
} from './licence-queries';
import { tenantScope } from './scoped';

/**
 * Online licence refresh (Stage 2) — the client half of roadmap Phase 3's
 * cloud service, shaped now and dormant until `MEHVAR_LICENCE_URL` is set.
 *
 * WHERE THIS RUNS, AND WHERE IT MUST NOT
 *
 * A timer in the Node (kicked off at boot by `serve.ts`), never a request
 * handler. **No network call sits on the sale/checkout path**, and selling is
 * completely independent of whether this ever succeeds. Offline is the normal
 * case: with no URL configured, or no answer, or a timeout, this does nothing
 * and the pharmacy trades on the licence it already holds.
 *
 * THE CONTRACT (matches the plan verbatim)
 *
 *     POST ${MEHVAR_LICENCE_URL}/v1/refresh
 *       { licenceId, tenantSlug, installationId, currentToken, nonce, activations }
 *     → 200 { token }        a fresh token, later expiresAt  — verified, then stored
 *     → 200 { revocation }   a SIGNED revocation             — verified, then stored
 *     → anything else / timeout / network failure            — ignored, try later
 *
 * TRUST
 *
 * Whatever the server returns is re-verified against the local trust root before
 * it changes anything. A token is checked exactly as a pasted one; a revocation
 * exactly as `computeLicence` checks a stored one. **Silence is never
 * revocation** — only a valid signed revocation moves a licence. A hostile or
 * broken server can, at worst, be ignored: it cannot forge a token this build
 * trusts, and it cannot revoke by saying nothing.
 */

const REFRESH_TIMEOUT_MS = 10_000;

export interface RefreshReport {
  readonly attempted: number;
  readonly tokensAccepted: number;
  readonly revocationsAccepted: number;
  readonly skipped: string;
}

interface RefreshRequest {
  readonly licenceId: string;
  readonly tenantSlug: string;
  readonly installationId: string;
  readonly currentToken: string;
  readonly nonce: string;
  /** The activation signal — how many machines this licence sits on. */
  readonly activations: number;
}

type Poster = (url: string, body: RefreshRequest) => Promise<unknown | undefined>;

/**
 * The default transport. Returns the parsed JSON body on a 200, or `undefined`
 * for anything else — a non-200, a timeout, a network error, unparseable JSON.
 * Everything the caller treats as "ignore and continue" collapses to
 * `undefined` here, so the decision logic never has to know why.
 */
async function postRefresh(url: string, body: RefreshRequest): Promise<unknown | undefined> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REFRESH_TIMEOUT_MS);
  try {
    const response = await fetch(`${url.replace(/\/$/, '')}/v1/refresh`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (!response.ok) return undefined;
    return (await response.json()) as unknown;
  } catch {
    return undefined;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Run one refresh pass over every tenant that holds a licence.
 *
 * `post` is injectable so tests exercise the decision logic — accept a token,
 * accept a revocation, ignore a malformed body, ignore an offline timeout —
 * without a live endpoint.
 */
export async function refreshLicences(
  options: { readonly url?: string | undefined; readonly post?: Poster } = {},
): Promise<RefreshReport> {
  const url = options.url ?? process.env.MEHVAR_LICENCE_URL;
  if (url === undefined || url.trim() === '') {
    // Dormant by design until roadmap Phase 3 configures a URL. This is the
    // whole "shaped now, off at launch" posture.
    return {
      attempted: 0,
      tokensAccepted: 0,
      revocationsAccepted: 0,
      skipped: 'no MEHVAR_LICENCE_URL',
    };
  }

  const installationId = readInstallation()?.installationId;
  if (installationId === undefined) {
    return {
      attempted: 0,
      tokensAccepted: 0,
      revocationsAccepted: 0,
      skipped: 'no installation id',
    };
  }

  const post = options.post ?? postRefresh;
  let attempted = 0;
  let tokensAccepted = 0;
  let revocationsAccepted = 0;

  for (const tenantId of await listTenantIds()) {
    const userId = await anyUserId(tenantId);
    if (userId === undefined) continue;

    const scope = tenantScope({ tenantId, userId });
    const standing = await licenceStanding(scope, installationId, new Date());
    if (standing.effective === undefined) continue;

    const slug = await tenantSlugById(tenantId);
    if (slug === undefined) continue;

    const licenceId = standing.effective.licenceId;
    const activations = (await installationsForLicence(scope, licenceId)).length;

    attempted += 1;
    const body = await post(url, {
      licenceId,
      tenantSlug: slug,
      installationId,
      currentToken: standing.effective.token,
      nonce: randomBytes(16).toString('base64url'),
      activations,
    });

    const outcome = await applyRefreshResponse(scope, slug, licenceId, installationId, body);
    if (outcome === 'token') tokensAccepted += 1;
    if (outcome === 'revocation') revocationsAccepted += 1;
  }

  return { attempted, tokensAccepted, revocationsAccepted, skipped: '' };
}

/**
 * Apply whatever the server returned — a token, a revocation, or nothing. Total
 * and best-effort: an unrecognised or malformed body is simply ignored.
 */
async function applyRefreshResponse(
  scope: ReturnType<typeof tenantScope>,
  slug: string,
  licenceId: string,
  installationId: string,
  body: unknown,
): Promise<'token' | 'revocation' | 'none'> {
  if (body === null || typeof body !== 'object') return 'none';
  const record = body as Record<string, unknown>;

  if (typeof record.token === 'string') {
    const verified = verifyToken(record.token, { expectedTenantSlug: slug });
    if (verified.ok) {
      const { payload } = verified.licence;
      await insertLicence(scope, {
        id: uuidv7(),
        token: verified.licence.token,
        licenceId: payload.licenceId,
        issuedAt: new Date(payload.issuedAt),
        entitlementEndsAt: new Date(payload.entitlementEndsAt),
        tokenExpiresAt: new Date(payload.expiresAt),
        graceDays: payload.graceDays,
        warnDays: payload.warnDays,
        installationId,
      });
      writeLicenceFile(verified.licence.token);
      forgetLicenceState(scope.tenantId);
      return 'token';
    }
    return 'none';
  }

  if (typeof record.revocation === 'string') {
    // Silence is never revocation; only a valid SIGNED statement is. A forged
    // or foreign revocation fails to verify and is ignored.
    const verified = verifyRevocation(record.revocation, {
      expectedTenantSlug: slug,
      expectedLicenceId: licenceId,
    });
    if (verified.ok) {
      await insertRevocation(scope, {
        id: uuidv7(),
        token: verified.revocation.token,
        licenceId: verified.revocation.payload.licenceId,
        revokedAt: new Date(verified.revocation.payload.revokedAt),
        reason: verified.revocation.payload.reason,
      });
      forgetLicenceState(scope.tenantId);
      return 'revocation';
    }
    return 'none';
  }

  return 'none';
}
