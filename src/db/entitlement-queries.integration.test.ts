import { eq } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';

import { tenantEntitlements, users, devices } from '@/db/schema';
import { uuidv7 } from '@/lib/uuid';

import { isPermissionDenied, purgeTenant } from '../../tests/db-admin';
import { provisionTestTenant } from '../../tests/fixtures';

// The seam reads this once, at first use; set it before anything resolves a licence.
process.env.MEHVAR_DEPLOYMENT = 'cloud';

import { grantEntitlement, listEntitlements } from './entitlement-queries';
import { forgetLicenceState, resolveLicence } from './licence-state-queries';
import { findTenantBySlug, provisionTenant } from './provisioning';
import { tenantScope } from './scoped';

const suite = process.env.DATABASE_URL ? describe : describe.skip;

/**
 * PCN-019: a cloud tenant's entitlement is the licence source in cloud mode,
 * read through the same seam the local licence file uses.
 */
suite('cloud entitlement (PCN-019)', () => {
  const tenantIds: string[] = [];

  afterAll(async () => {
    for (const id of tenantIds) await purgeTenant(id);
  });

  async function provision(label: string, endsAt: Date | null = null) {
    const slug = `cloud-${label}-${uuidv7().slice(-12)}`;
    const result = await provisionTenant({
      slug,
      name: `Cloud ${label}`,
      settings: {
        receiptHeader: 'Cloud test',
        receiptFooter: 'Test',
        timeZone: 'Asia/Karachi',
        expiryHorizonDays: [30, 60, 90],
      },
      ownerName: 'Owner',
      ownerPin: '4821',
      deviceName: 'Counter 1',
      devicePrefix: 'A',
      plan: 'pilot',
      entitlementEndsAt: endsAt,
    });
    tenantIds.push(result.tenantId);
    const [owner] = await tenantScope({ tenantId: result.tenantId, userId: result.tenantId })
      .db.select({ id: users.id })
      .from(users)
      .where(eq(users.tenantId, result.tenantId));
    if (!owner) throw new Error('no owner');
    return {
      ...result,
      slug,
      ownerId: owner.id,
      scope: tenantScope({ tenantId: result.tenantId, userId: owner.id }),
    };
  }

  it('provisioning creates tenant, owner, counter and entitlement, and hands back the secrets once', async () => {
    const t = await provision('whole');

    expect(await findTenantBySlug(t.slug)).toBeDefined();
    expect(t.pairingKey).toMatch(/^[a-z0-9]{4}-[a-z0-9]{4}-[a-z0-9]{4}$/);
    expect(t.ownerPassword.length).toBeGreaterThan(10);

    const counters = await t.scope.select(devices);
    expect(counters).toHaveLength(1);
    // Stored as a hash, never the key itself.
    expect(counters[0]?.pairingKeyHash).not.toContain(t.pairingKey);

    const entitlements = await listEntitlements(t.scope);
    expect(entitlements).toHaveLength(1);
    expect(entitlements[0]).toMatchObject({ plan: 'pilot', endsAt: null });
  });

  it('a provisioned tenant resolves authorized, with no licence file and no installation', async () => {
    const t = await provision('authorized');
    forgetLicenceState(t.tenantId);
    const resolved = await resolveLicence(t.tenantId, t.ownerId, t.slug);
    expect(resolved.state).toMatchObject({ status: 'authorized', tier: 'full' });
    expect(resolved.installationId).toBeUndefined();
  });

  it('a tenant whose entitlement has ended is restricted — and an extension is a new row that restores it', async () => {
    const t = await provision('lapsed', new Date(Date.now() - 86_400_000));
    forgetLicenceState(t.tenantId);
    expect((await resolveLicence(t.tenantId, t.ownerId, t.slug)).state).toMatchObject({
      status: 'unauthorized',
      tier: 'restricted',
    });

    await grantEntitlement(t.scope, { plan: 'pilot', endsAt: null, note: 'extended' });
    forgetLicenceState(t.tenantId);
    expect((await resolveLicence(t.tenantId, t.ownerId, t.slug)).state.tier).toBe('full');
    expect(await listEntitlements(t.scope)).toHaveLength(2);
  });

  it('a tenant with no entitlement is restricted while another tenant is entitled', async () => {
    await provision('neighbour');
    // The test fixture provisions a tenant WITHOUT an entitlement row.
    const bare = await provisionTestTenant('noentitlement');
    tenantIds.push(bare.tenantId);
    forgetLicenceState(bare.tenantId);
    const resolved = await resolveLicence(bare.tenantId, bare.userId, 'any-slug');
    expect(resolved.state).toMatchObject({ status: 'unauthorized', tier: 'restricted' });
  });

  const enforced = process.env.APP_DB_ROLE ? it : it.skip;

  enforced('the database refuses UPDATE and DELETE on entitlements — append-only', async () => {
    const t = await provision('immutable');
    const update = await t.scope
      .update(tenantEntitlements, { plan: 'forever' }, eq(tenantEntitlements.plan, 'pilot'))
      .then(
        () => null,
        (error: unknown) => error,
      );
    expect(isPermissionDenied(update)).toBe(true);

    const { globalCatalog } = await import('./scoped');
    const del = await globalCatalog()
      .delete(tenantEntitlements)
      .where(eq(tenantEntitlements.tenantId, t.tenantId))
      .then(
        () => null,
        (error: unknown) => error,
      );
    expect(isPermissionDenied(del)).toBe(true);
  });
});
