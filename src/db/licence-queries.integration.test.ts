import { generateKeyPairSync } from 'node:crypto';

import { eq } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';

import { corroboratedWitness, WITNESS_CORROBORATION } from '@/domain/licensing/clock';
import { signPayload } from '@/domain/licensing/sign';
import type { LicencePayload } from '@/domain/licensing/state';
import { verifyToken } from '@/domain/licensing/verify';
import type { Keyring } from '@/domain/trust/keys';
import { uuidv7, type Uuid } from '@/lib/uuid';

import { adminQuery, isPermissionDenied } from '../../tests/db-admin';
import { provisionTestTenant, type TestTenant } from '../../tests/fixtures';
import {
  insertLicence,
  licenceStanding,
  recentObservations,
  recordObservation,
} from './licence-queries';
import { globalCatalog } from './scoped';
import { clockObservations, licences } from './schema';

const DATABASE_AVAILABLE = Boolean(process.env.DATABASE_URL);
const suite = DATABASE_AVAILABLE ? describe : describe.skip;

const { publicKey, privateKey } = generateKeyPairSync('ed25519');
const KID = 'integration-1';
const keyring: Keyring = {
  [KID]: publicKey.export({ type: 'spki', format: 'der' }).toString('base64url'),
};

const MACHINE_A = '11111111-1111-7111-8111-111111111111';
const MACHINE_B = '22222222-2222-7222-8222-222222222222';

function payload(over: Partial<LicencePayload> = {}): LicencePayload {
  return {
    v: 1,
    kid: KID,
    licenceId: uuidv7(),
    tenantSlug: 'integration',
    customerName: 'Integration Pharmacy',
    plan: 'standard',
    branches: 1,
    issuedAt: '2026-01-01T00:00:00Z',
    entitlementEndsAt: '2027-01-01T00:00:00Z',
    expiresAt: '2027-03-01T00:00:00Z',
    graceDays: 30,
    warnDays: 45,
    ...over,
  };
}

async function store(tenant: TestTenant, p: LicencePayload, installationId: string): Promise<void> {
  const token = signPayload(p, privateKey);
  const verified = verifyToken(token, { keyring });
  expect(verified.ok).toBe(true);
  if (!verified.ok) return;

  await insertLicence(tenant.scope, {
    id: uuidv7(),
    token: verified.licence.token,
    licenceId: p.licenceId,
    issuedAt: new Date(p.issuedAt),
    entitlementEndsAt: new Date(p.entitlementEndsAt),
    tokenExpiresAt: new Date(p.expiresAt),
    graceDays: verified.licence.payload.graceDays,
    warnDays: p.warnDays,
    installationId,
  });
}

suite('licence persistence', () => {
  const provisioned: TestTenant[] = [];

  /**
   * A tenant per test. The effective licence is a comparison ACROSS every
   * licence a tenant holds, so sharing one tenant would let an earlier test's
   * licence win a later test's comparison — which is a test writing a bug
   * report about itself.
   */
  async function freshTenant(label: string): Promise<TestTenant> {
    const tenant = await provisionTestTenant(`lic-${label}`);
    provisioned.push(tenant);
    return tenant;
  }

  afterAll(async () => {
    for (const tenant of provisioned) {
      await adminQuery('DELETE FROM licences WHERE tenant_id = $1', [tenant.tenantId]);
      await tenant.cleanup();
    }
  });

  it('is idempotent on one machine — re-pasting the same token changes nothing', async () => {
    const tenant = await freshTenant('idempotent');
    const p = payload();
    await store(tenant, p, MACHINE_A);
    await store(tenant, p, MACHINE_A);

    const standing = await licenceStanding(
      tenant.scope,
      MACHINE_A,
      new Date('2026-06-01T00:00:00Z'),
    );
    expect(standing.rows.filter((r) => r.licenceId === p.licenceId)).toHaveLength(1);
    expect(standing.boundHere).toBe(true);
    expect(standing.rebindsUsed).toBe(0);
  });

  it('records a rebind as a new row and reads bound on BOTH machines (L3)', async () => {
    const tenant = await freshTenant('rebind');
    const p = payload();
    await store(tenant, p, MACHINE_A);
    await store(tenant, p, MACHINE_B);

    const now = new Date('2026-06-01T00:00:00Z');
    const onB = await licenceStanding(tenant.scope, MACHINE_B, now);
    expect(onB.boundHere).toBe(true);
    expect(onB.rebindsUsed).toBe(1);

    // The original machine is still bound. A restore that comes back to the old
    // hardware must not read as someone else's licence.
    const onA = await licenceStanding(tenant.scope, MACHINE_A, now);
    expect(onA.boundHere).toBe(true);
  });

  it('a renewal supersedes by issuedAt, and the old row stays as the audit trail', async () => {
    const tenant = await freshTenant('renewal');
    const licenceId = uuidv7();
    await store(tenant, payload({ licenceId }), MACHINE_A);
    await store(
      tenant,
      payload({
        licenceId,
        issuedAt: '2027-01-01T00:00:00Z',
        entitlementEndsAt: '2028-01-01T00:00:00Z',
        expiresAt: '2028-03-01T00:00:00Z',
      }),
      MACHINE_A,
    );

    const standing = await licenceStanding(
      tenant.scope,
      MACHINE_A,
      new Date('2027-06-01T00:00:00Z'),
    );
    expect(standing.effective?.entitlementEndsAt.toISOString()).toBe('2028-01-01T00:00:00.000Z');
    expect(standing.rows.filter((r) => r.licenceId === licenceId)).toHaveLength(2);
  });

  const enforced = process.env.APP_DB_ROLE ? it : it.skip;

  enforced('the database refuses UPDATE on licences', async () => {
    const tenant = await freshTenant('update');
    // Not "no code path does this" — the role has no privilege. That is the
    // difference between a promise and a guarantee.
    const refusal = await globalCatalog()
      .update(licences)
      .set({ graceDays: 9999 })
      .where(eq(licences.tenantId, tenant.tenantId))
      .then(
        () => null,
        (error: unknown) => error,
      );
    expect(refusal).not.toBeNull();
    expect(isPermissionDenied(refusal)).toBe(true);
  });

  enforced('the database refuses DELETE on licences', async () => {
    const tenant = await freshTenant('delete');
    const refusal = await globalCatalog()
      .delete(licences)
      .where(eq(licences.tenantId, tenant.tenantId))
      .then(
        () => null,
        (error: unknown) => error,
      );
    expect(refusal).not.toBeNull();
    expect(isPermissionDenied(refusal)).toBe(true);
  });
});

suite('the clock witness, against a real table', () => {
  const written: Uuid[] = [];

  afterAll(async () => {
    for (const id of written) {
      await adminQuery('DELETE FROM clock_observations WHERE id = $1', [id]);
    }
  });

  async function observe(iso: string): Promise<void> {
    const id = uuidv7();
    written.push(id);
    await recordObservation(id, new Date(iso), 'interval');
  }

  it('survives a poisoning round-trip WITHOUT deleting the bad rows (L5, L6)', async () => {
    const base = Date.parse('2026-09-16T00:00:00Z');
    for (let i = 0; i < 20; i += 1) {
      await observe(new Date(base - i * 6 * 3600_000).toISOString());
    }
    await observe('2099-03-12T00:00:00Z');

    const rows = await recentObservations();
    const witness = corroboratedWitness(rows);

    // One stray reading never becomes the witness. Under `max()` this table
    // would now say 2099 forever, and append-only means nobody could take it
    // back.
    expect(witness?.getUTCFullYear()).toBe(2026);

    // And a signed ceiling repairs the corroborated case while the evidence
    // stays exactly where it is.
    for (let i = 0; i < WITNESS_CORROBORATION + 2; i += 1) {
      await observe(new Date(Date.parse('2099-03-12T00:00:00Z') - i * 6 * 3600_000).toISOString());
    }
    const poisoned = await recentObservations();
    expect(corroboratedWitness(poisoned)?.getUTCFullYear()).toBe(2099);

    const repaired = corroboratedWitness(poisoned, { ceiling: new Date('2026-09-17T00:00:00Z') });
    expect(repaired?.getUTCFullYear()).toBe(2026);

    const stillThere = await globalCatalog().select().from(clockObservations);
    expect(stillThere.filter((r) => r.observedAt.getUTCFullYear() === 2099).length).toBeGreaterThan(
      0,
    );
  });

  const enforced = process.env.APP_DB_ROLE ? it : it.skip;

  enforced('the database refuses UPDATE and DELETE on clock_observations', async () => {
    const update = await globalCatalog()
      .update(clockObservations)
      .set({ source: 'tampered' })
      .then(
        () => null,
        (error: unknown) => error,
      );
    const remove = await globalCatalog()
      .delete(clockObservations)
      .then(
        () => null,
        (error: unknown) => error,
      );

    expect(isPermissionDenied(update)).toBe(true);
    expect(isPermissionDenied(remove)).toBe(true);
  });
});
