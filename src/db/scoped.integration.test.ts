/**
 * Chokepoint enforcement against a real database — the second half of Day 1's
 * required test, and the one that proves the ADR-2 trade-off is honest.
 *
 * Two tenants are provisioned side by side in the same tables, and every
 * assertion here is a question a suspicious owner would want answered: can the
 * other pharmacy's rows reach my screen, can a write land in their account, and
 * can anyone quietly change what already happened?
 *
 * Requires Postgres. Skips itself when DATABASE_URL is absent so `npm test`
 * still runs on a machine without one; the pre-deploy gate (Phase 12 §2.3) runs
 * it against a real database, which is where it counts.
 */

import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { uuidv7 } from '@/lib/uuid';
import { isPermissionDenied, purgeTenant } from '../../tests/db-admin';

import { createTenant } from './provisioning';
import { tenantScope, type TenantScope } from './scoped';
import { cashMovements, customers, products, users, type TenantSettings } from './schema';

const DATABASE_AVAILABLE = Boolean(process.env.DATABASE_URL);
const suite = DATABASE_AVAILABLE ? describe : describe.skip;

const SETTINGS: TenantSettings = {
  receiptHeader: 'Test',
  receiptFooter: 'Test',
  timeZone: 'Asia/Karachi',
  expiryHorizonDays: [30, 60, 90],
};

interface Fixture {
  tenantId: string;
  userId: string;
  scope: TenantScope;
}

async function provision(label: string): Promise<Fixture> {
  const tenantId = uuidv7();
  const userId = uuidv7();

  await createTenant({
    id: tenantId,
    slug: `test-${label}-${tenantId.slice(0, 8)}`,
    name: `Test Pharmacy ${label}`,
    settings: SETTINGS,
  });

  const scope = tenantScope({ tenantId, userId });
  await scope.insert(users, {
    id: userId,
    name: `Owner ${label}`,
    role: 'owner',
    pinHash: 'not-a-real-hash',
    passwordHash: null,
  });

  return { tenantId, userId, scope };
}

suite('tenant isolation, against Postgres', () => {
  let alpha: Fixture;
  let beta: Fixture;

  beforeAll(async () => {
    alpha = await provision('alpha');
    beta = await provision('beta');

    await alpha.scope.insert(products, {
      id: uuidv7(),
      name: 'Alpha Panadol',
      baseUnitName: 'tab',
      packLevels: [{ name: 'strip', factor: 10 }],
      defaultPricePerBaseUnit: 350,
    });
    await beta.scope.insert(products, {
      id: uuidv7(),
      name: 'Beta Panadol',
      baseUnitName: 'tab',
      packLevels: [{ name: 'strip', factor: 10 }],
      defaultPricePerBaseUnit: 400,
    });
  });

  afterAll(async () => {
    // Teardown needs the owner connection: the app role cannot delete event
    // rows, which is exactly the guarantee the suite below asserts.
    await purgeTenant(alpha.tenantId);
    await purgeTenant(beta.tenantId);
  });

  it('reads only its own rows', async () => {
    const mine = await alpha.scope.select(products);
    expect(mine.map((row) => row.name)).toEqual(['Alpha Panadol']);

    const theirs = await beta.scope.select(products);
    expect(theirs.map((row) => row.name)).toEqual(['Beta Panadol']);
  });

  it('cannot read another tenant’s row even when handed its id', async () => {
    const [betaProduct] = await beta.scope.select(products);
    expect(betaProduct).toBeDefined();

    // The realistic leak: an id arrives from a URL or a stale client cache.
    const leaked = await alpha.scope.selectOne(products, eq(products.id, betaProduct!.id));
    expect(leaked).toBeUndefined();
  });

  it('stamps its own tenant on inserts, ignoring anything a caller supplies', async () => {
    const [row] = await alpha.scope.insert(customers, {
      id: uuidv7(),
      name: 'Rashid',
      phone: null,
      // A caller trying to write into another tenant. The scope overwrites it.
      tenantId: beta.tenantId,
    } as never);

    expect(row?.tenantId).toBe(alpha.tenantId);
    expect(await beta.scope.select(customers)).toHaveLength(0);
  });

  it('stamps attribution from the acting user (T1)', async () => {
    const [movement] = await alpha.scope.insert(cashMovements, {
      id: uuidv7(),
      direction: 'in',
      amountPaisa: 100_000,
      reason: 'opening_float',
      note: null,
    });

    expect(movement?.createdBy).toBe(alpha.userId);
  });

  it('cannot update another tenant’s row', async () => {
    const [betaProduct] = await beta.scope.select(products);
    const changed = await alpha.scope.update(
      products,
      { name: 'Hijacked' },
      eq(products.id, betaProduct!.id),
    );

    expect(changed).toHaveLength(0);
    const [stillTheirs] = await beta.scope.select(products, eq(products.id, betaProduct!.id));
    expect(stillTheirs?.name).toBe('Beta Panadol');
  });
});

suite('event records are immutable (ADR-1, Phase 9 §5.1)', () => {
  let alpha: Fixture;

  beforeAll(async () => {
    alpha = await provision('immutable');
    await alpha.scope.insert(cashMovements, {
      id: uuidv7(),
      direction: 'in',
      amountPaisa: 500_000,
      reason: 'opening_float',
      note: 'Morning float',
    });
  });

  afterAll(async () => {
    await purgeTenant(alpha.tenantId);
  });

  const enforced = process.env.APP_DB_ROLE ? it : it.skip;

  enforced('the database refuses UPDATE on an event table', async () => {
    // Not "the code does not do this" — the application role has no privilege
    // to do it. That distinction is the whole of ADR-1.
    const refusal = await alpha.scope
      .update(cashMovements, { amountPaisa: 1 }, eq(cashMovements.reason, 'opening_float'))
      .then(
        () => null,
        (error: unknown) => error,
      );

    expect(refusal).not.toBeNull();
    expect(isPermissionDenied(refusal)).toBe(true);
  });

  enforced('the database refuses DELETE on an event table', async () => {
    const { globalCatalog } = await import('./scoped');
    const refusal = await globalCatalog()
      .delete(cashMovements)
      .where(eq(cashMovements.tenantId, alpha.tenantId))
      .then(
        () => null,
        (error: unknown) => error,
      );

    expect(refusal).not.toBeNull();
    expect(isPermissionDenied(refusal)).toBe(true);
  });

  it('still allows UPDATE on batches — ADR-8’s one sanctioned cache', async () => {
    // The counterpart assertion: if this ever starts failing, FEFO consumption
    // cannot record itself and the product stops working. The grant boundary has
    // to be exactly where Phase 9 §5.1 draws it, not one table wider.
    const { batches } = await import('./schema');
    await expect(
      alpha.scope.update(batches, { qtyRemainingBase: 0 }, eq(batches.tenantId, alpha.tenantId)),
    ).resolves.toEqual([]);
  });
});
