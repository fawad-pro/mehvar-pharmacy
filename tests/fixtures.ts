/**
 * Integration-test fixtures.
 *
 * Builds real tenants with real batches through the real chokepoint, because a
 * suite that proves stock arithmetic against mocks proves nothing. Teardown uses
 * the owner connection (`tests/db-admin.ts`), since the application role cannot
 * delete event rows — which is the guarantee half these tests exist to check.
 */

import { createTenant } from '@/db/provisioning';
import { tenantScope, type TenantScope } from '@/db/scoped';
import { adjustments, batches, customers, products, users, type TenantSettings } from '@/db/schema';
import { uuidv7, type Uuid } from '@/lib/uuid';

import { purgeTenant } from './db-admin';

const SETTINGS: TenantSettings = {
  receiptHeader: 'Test Pharmacy',
  receiptFooter: 'Test',
  timeZone: 'Asia/Karachi',
  expiryHorizonDays: [30, 60, 90],
};

export interface TestTenant {
  tenantId: Uuid;
  userId: Uuid;
  scope: TenantScope;
  cleanup: () => Promise<void>;
}

export async function provisionTestTenant(label: string): Promise<TestTenant> {
  const tenantId = uuidv7();
  const userId = uuidv7();

  await createTenant({
    id: tenantId,
    slug: `t-${label}-${tenantId.slice(0, 12)}`,
    name: `Test ${label}`,
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

  return {
    tenantId,
    userId,
    scope,
    cleanup: () => purgeTenant(tenantId),
  };
}

export interface TestProduct {
  id: Uuid;
  name: string;
  baseUnitName: string;
  pricePaisa: number;
}

export async function createTestProduct(
  scope: TenantScope,
  name: string,
  pricePaisa = 350,
): Promise<TestProduct> {
  const id = uuidv7();
  await scope.insert(products, {
    id,
    name,
    baseUnitName: 'tab',
    packLevels: [{ name: 'strip', factor: 10 }],
    defaultPricePerBaseUnit: pricePaisa,
    currentMrpPerBaseUnit: pricePaisa,
  });
  return { id, name, baseUnitName: 'tab', pricePaisa };
}

/**
 * Opening stock, the way W9 creates it: a reason-coded adjustment that
 * materializes a batch (Phase 9 §3's "positive opening/count deltas materialize
 * batches"). Using the real shape matters — the rebuild reads adjustments, so a
 * fixture that inserted a bare batch would hide exactly the arithmetic under test.
 */
export async function addOpeningStock(
  scope: TenantScope,
  productId: Uuid,
  qtyBase: number,
  options: { expiryDate?: string | null; unitCostPaisa?: number; pricePaisa?: number } = {},
): Promise<Uuid> {
  const [adjustment] = await scope.insert(adjustments, {
    id: uuidv7(),
    productId,
    batchId: null,
    qtyBaseDelta: qtyBase,
    reason: 'opening_stock',
    note: 'fixture',
  });
  if (!adjustment) {
    throw new Error('Could not create the opening-stock adjustment');
  }

  const batchId = uuidv7();
  await scope.insert(batches, {
    id: batchId,
    productId,
    source: 'adjustment',
    sourceId: adjustment.id,
    batchNumber: null,
    expiryDate: options.expiryDate === undefined ? '2027-12-31' : options.expiryDate,
    unitCostPaisa: options.unitCostPaisa ?? 280,
    pricePerBaseUnitPaisa: options.pricePaisa ?? 350,
    qtyReceivedBase: qtyBase,
    qtyRemainingBase: qtyBase,
  });

  return batchId;
}

export async function createTestCustomer(
  scope: TenantScope,
  name: string,
  phone: string | null = null,
): Promise<Uuid> {
  const id = uuidv7();
  await scope.insert(customers, { id, name, phone });
  return id;
}

/**
 * A small deterministic PRNG (mulberry32).
 *
 * Property-style tests are only useful if a failure can be reproduced, so the
 * seed is printed by the suite and the same seed always replays the same
 * history. `Math.random` would make the crown suite a lottery.
 */
export function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function pick<T>(random: () => number, items: readonly T[]): T {
  const item = items[Math.floor(random() * items.length)];
  if (item === undefined) {
    throw new Error('Cannot pick from an empty list');
  }
  return item;
}

export function between(random: () => number, low: number, high: number): number {
  return low + Math.floor(random() * (high - low + 1));
}
