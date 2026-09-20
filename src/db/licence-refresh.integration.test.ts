import { createPrivateKey } from 'node:crypto';

import { afterAll, describe, expect, it } from 'vitest';

import { signRevocation, type RevocationPayload } from '@/domain/licensing/revocation';
import { signPayload } from '@/domain/licensing/sign';
import type { LicencePayload } from '@/domain/licensing/state';
import { DEV_KID } from '@/domain/trust/keys';
import { ensureInstallation } from '@/lib/installation';
import { uuidv7 } from '@/lib/uuid';

import { DEV_PRIVATE_KEY_PKCS8_BASE64URL } from '../../scripts/licence/dev-key';
import { adminQuery } from '../../tests/db-admin';
import { provisionTestTenant, type TestTenant } from '../../tests/fixtures';
import { insertLicence, listLicences, listRevocations } from './licence-queries';
import { refreshLicences } from './licence-refresh';
import { forgetLicenceState, resolveLicence } from './licence-state-queries';
import { tenantSlugById } from './provisioning';

const DATABASE_AVAILABLE = Boolean(process.env.DATABASE_URL);
const suite = DATABASE_AVAILABLE ? describe : describe.skip;

const devKey = createPrivateKey({
  key: Buffer.from(DEV_PRIVATE_KEY_PKCS8_BASE64URL, 'base64url'),
  format: 'der',
  type: 'pkcs8',
});

const MACHINE = '11111111-1111-7111-8111-111111111111';

function licencePayload(
  slug: string,
  licenceId: string,
  over: Partial<LicencePayload> = {},
): LicencePayload {
  return {
    v: 2,
    kid: DEV_KID,
    licenceId,
    tenantSlug: slug,
    customerName: 'Refresh Test Pharmacy',
    plan: 'standard',
    branches: 1,
    issuedAt: '2026-01-01T00:00:00Z',
    ...over,
  };
}

async function seedLicence(tenant: TestTenant, licenceId: string): Promise<void> {
  const slug = (await tenantSlugById(tenant.tenantId)) as string;
  const token = signPayload(licencePayload(slug, licenceId), devKey);
  await insertLicence(tenant.scope, {
    id: uuidv7(),
    token,
    licenceId,
    issuedAt: new Date('2026-01-01T00:00:00Z'),
    installationId: MACHINE,
  });
}

suite('online licence refresh', () => {
  const provisioned: TestTenant[] = [];

  async function tenantWithLicence(
    label: string,
  ): Promise<{ tenant: TestTenant; licenceId: string; slug: string }> {
    const tenant = await provisionTestTenant(`refresh-${label}`);
    provisioned.push(tenant);
    ensureInstallation('test');
    const licenceId = uuidv7();
    await seedLicence(tenant, licenceId);
    const slug = (await tenantSlugById(tenant.tenantId)) as string;
    return { tenant, licenceId, slug };
  }

  afterAll(async () => {
    for (const tenant of provisioned) {
      await adminQuery('DELETE FROM revocations WHERE tenant_id = $1', [tenant.tenantId]);
      await adminQuery('DELETE FROM licences WHERE tenant_id = $1', [tenant.tenantId]);
      await tenant.cleanup();
    }
  });

  it('does nothing, and reports dormant, when no URL is configured', async () => {
    const report = await refreshLicences({ url: undefined });
    expect(report.attempted).toBe(0);
    expect(report.skipped).toContain('no MEHVAR_LICENCE_URL');
  });

  it('accepts a valid re-issued token and stores it', async () => {
    const { tenant, slug } = await tenantWithLicence('token');
    const reissueId = uuidv7();
    const reissue = signPayload(
      licencePayload(slug, reissueId, { issuedAt: '2026-11-01T00:00:00Z' }),
      devKey,
    );

    const report = await refreshLicences({
      url: 'https://licence.example',
      post: async () => ({ token: reissue }),
    });
    expect(report.tokensAccepted).toBeGreaterThanOrEqual(1);

    const rows = await listLicences(tenant.scope);
    expect(rows.some((r) => r.licenceId === reissueId)).toBe(true);
  });

  it('sends the activation count so the server can spot a spread licence', async () => {
    const { slug } = await tenantWithLicence('activation');
    let seen = -1;
    await refreshLicences({
      url: 'https://licence.example',
      post: async (_url, body) => {
        if (body.tenantSlug === slug) seen = body.activations;
        return undefined;
      },
    });
    // One machine seeded → one activation reported. No fingerprint, just a count.
    expect(seen).toBe(1);
  });

  it('accepts a valid signed revocation and moves the licence to revoked', async () => {
    const { tenant, licenceId, slug } = await tenantWithLicence('revoke');
    const payload: RevocationPayload = {
      v: 1,
      kid: DEV_KID,
      licenceId,
      tenantSlug: slug,
      revokedAt: '2026-06-01T00:00:00Z',
      reason: 'chargeback',
    };
    const revocation = signRevocation(payload, devKey);

    const report = await refreshLicences({
      url: 'https://licence.example',
      post: async () => ({ revocation }),
    });
    expect(report.revocationsAccepted).toBeGreaterThanOrEqual(1);

    forgetLicenceState(tenant.tenantId);
    const resolved = await resolveLicence(tenant.tenantId, tenant.userId, slug);
    expect(resolved.state.status).toBe('revoked');
    expect(resolved.state.tier).toBe('restricted');

    // A revocation never deletes data: the licence rows are still there (the
    // customer can still export), and it is the append-only revocations table
    // that carries the new fact.
    expect((await listLicences(tenant.scope)).length).toBeGreaterThan(0);
    expect((await listRevocations(tenant.scope)).length).toBe(1);
  });

  it('ignores a malformed response — no change, no throw', async () => {
    const { tenant } = await tenantWithLicence('malformed');
    const before = (await listLicences(tenant.scope)).length;
    const report = await refreshLicences({
      url: 'https://licence.example',
      post: async () => ({ nonsense: true, token: 12345 }),
    });
    expect(report.tokensAccepted).toBe(0);
    expect(report.revocationsAccepted).toBe(0);
    expect((await listLicences(tenant.scope)).length).toBe(before);
  });

  it('ignores an offline / timed-out endpoint — the offline case is normal', async () => {
    const { tenant } = await tenantWithLicence('offline');
    const beforeL = (await listLicences(tenant.scope)).length;
    const beforeR = (await listRevocations(tenant.scope)).length;
    // `undefined` is exactly what postRefresh returns on a timeout or network error.
    await refreshLicences({ url: 'https://unreachable.invalid', post: async () => undefined });
    expect((await listLicences(tenant.scope)).length).toBe(beforeL);
    expect((await listRevocations(tenant.scope)).length).toBe(beforeR);
  });

  it('a forged revocation from the server is ignored, never honoured', async () => {
    const { tenant, licenceId, slug } = await tenantWithLicence('forged');
    // Signed by nobody the trust root knows: build a bad envelope by hand.
    const bad = `MEHVARREV1.${Buffer.from(
      JSON.stringify({
        v: 1,
        kid: DEV_KID,
        licenceId,
        tenantSlug: slug,
        revokedAt: '2026-06-01T00:00:00Z',
        reason: 'fraud',
      }),
    ).toString('base64url')}.${Buffer.from('not-a-signature').toString('base64url')}`;

    await refreshLicences({
      url: 'https://licence.example',
      post: async () => ({ revocation: bad }),
    });
    expect((await listRevocations(tenant.scope)).length).toBe(0);
    forgetLicenceState(tenant.tenantId);
    const resolved = await resolveLicence(tenant.tenantId, tenant.userId, slug);
    expect(resolved.state.status).not.toBe('revoked');
  });

  it('one tenant’s revocation never touches another tenant', async () => {
    const a = await tenantWithLicence('iso-a');
    const b = await tenantWithLicence('iso-b');

    // A valid revocation for A's licence, delivered while iterating — B must be
    // untouched because the revocation is pinned to A's licence id and slug, and
    // stored only under A's tenant scope.
    const revA = signRevocation(
      {
        v: 1,
        kid: DEV_KID,
        licenceId: a.licenceId,
        tenantSlug: a.slug,
        revokedAt: '2026-06-01T00:00:00Z',
        reason: 'chargeback',
      },
      devKey,
    );
    await refreshLicences({
      url: 'https://licence.example',
      post: async (_url, body) => (body.tenantSlug === a.slug ? { revocation: revA } : undefined),
    });

    expect((await listRevocations(b.tenant.scope)).length).toBe(0);
    forgetLicenceState(b.tenant.tenantId);
    const resolvedB = await resolveLicence(b.tenant.tenantId, b.tenant.userId, b.slug);
    expect(resolvedB.state.status).not.toBe('revoked');
  });
});
