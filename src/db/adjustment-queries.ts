/**
 * Adjustment and stock-view queries — W8, W9, W12.
 *
 * Inside `src/db` because ADR-2 puts every query here.
 */

import 'server-only';

import { and, asc, desc, eq, gt, isNull, lte, sql } from 'drizzle-orm';

import type { TenantScope } from './scoped';
import { adjustments, batches, products, saleLineAllocations, saleLines, users } from './schema';

import type { BatchOnHand } from '@/domain/inventory/adjustment';
import type { Uuid } from '@/lib/uuid';

/* -------------------------------------------------------------------------- */
/* Writing                                                                     */
/* -------------------------------------------------------------------------- */

/** Idempotency: the same adjustment delivered twice is applied once. */
export async function findAdjustmentById(
  scope: TenantScope,
  adjustmentId: Uuid,
): Promise<{ id: string; batchId: string | null } | undefined> {
  const row = await scope.selectOne(adjustments, eq(adjustments.id, adjustmentId));
  return row ? { id: row.id, batchId: row.batchId } : undefined;
}

export async function insertAdjustment(
  scope: TenantScope,
  row: Omit<typeof adjustments.$inferInsert, 'tenantId' | 'createdBy'>,
): Promise<void> {
  await scope.insert(adjustments, row as never);
}

/**
 * Brings a batch into existence from a positive adjustment — Phase 9 §4.
 *
 * Separate from the purchase path's `insertBatches` only in that `source` is
 * fixed here: a batch born of an adjustment can never claim a purchase line as
 * its origin, and the type system says so rather than a comment.
 */
export async function materializeAdjustmentBatch(
  scope: TenantScope,
  row: Omit<typeof batches.$inferInsert, 'tenantId' | 'source'>,
): Promise<void> {
  await scope.insert(batches, { ...row, source: 'adjustment' } as never);
}

/* -------------------------------------------------------------------------- */
/* Batches on hand — what a reducing adjustment picks from                     */
/* -------------------------------------------------------------------------- */

export type { BatchOnHand } from '@/domain/inventory/adjustment';

/** FEFO-ordered, so the batch the operator most likely means is first. */
export async function batchesOnHand(
  scope: TenantScope,
  productId: Uuid,
): Promise<BatchOnHand[]> {
  return scope.db
    .select({
      batchId: batches.id,
      productId: batches.productId,
      productName: products.name,
      batchNumber: batches.batchNumber,
      expiryDate: batches.expiryDate,
      qtyRemainingBase: batches.qtyRemainingBase,
      unitCostPaisa: batches.unitCostPaisa,
      pricePerBaseUnitPaisa: batches.pricePerBaseUnitPaisa,
    })
    .from(batches)
    .innerJoin(products, eq(products.id, batches.productId))
    .where(scope.scopeOf(batches, eq(batches.productId, productId), gt(batches.qtyRemainingBase, 0)))
    .orderBy(sql`${batches.expiryDate} asc nulls last`, asc(batches.createdAt));
}

/* -------------------------------------------------------------------------- */
/* W12 — near expiry and low stock                                             */
/* -------------------------------------------------------------------------- */

export interface NearExpiryRow {
  batchId: string;
  productId: string;
  productName: string;
  baseUnitName: string;
  batchNumber: string | null;
  expiryDate: string;
  qtyRemainingBase: number;
  pricePerBaseUnitPaisa: number;
}

/**
 * Batches expiring within `withinDays` — W12's 30/60/90 horizons.
 *
 * Already-expired batches are included deliberately. They are the most urgent
 * thing on the list, and a horizon that quietly excluded them would hide the
 * exact stock that must come off the shelf today.
 */
export async function nearExpiryBatches(
  scope: TenantScope,
  withinDays: number,
): Promise<NearExpiryRow[]> {
  const horizon = new Date();
  horizon.setDate(horizon.getDate() + withinDays);
  const horizonDate = horizon.toISOString().slice(0, 10);

  const rows = await scope.db
    .select({
      batchId: batches.id,
      productId: batches.productId,
      productName: products.name,
      baseUnitName: products.baseUnitName,
      batchNumber: batches.batchNumber,
      expiryDate: batches.expiryDate,
      qtyRemainingBase: batches.qtyRemainingBase,
      pricePerBaseUnitPaisa: batches.pricePerBaseUnitPaisa,
    })
    .from(batches)
    .innerJoin(products, eq(products.id, batches.productId))
    .where(
      scope.scopeOf(
        batches,
        gt(batches.qtyRemainingBase, 0),
        lte(batches.expiryDate, horizonDate),
      ),
    )
    .orderBy(asc(batches.expiryDate));

  // The NULL expiry of a non-perishable can never be "near", and SQL's
  // three-valued logic already excluded it — this narrows the type.
  return rows.flatMap((row) =>
    row.expiryDate === null ? [] : [{ ...row, expiryDate: row.expiryDate }],
  );
}

export interface LowStockRow {
  productId: string;
  productName: string;
  baseUnitName: string;
  packLevels: unknown;
  onHandBase: number;
  minStockBaseUnits: number;
}

/**
 * Products at or below their minimum level — W12's low-stock list.
 *
 * Only products where a minimum is actually set. A default threshold would
 * invent an opinion about a shop's reorder policy that Phase 5 §6 puts outside
 * the boundary ("we produce the list, not the order").
 */
export async function lowStockProducts(scope: TenantScope): Promise<LowStockRow[]> {
  const rows = await scope.db
    .select({
      productId: products.id,
      productName: products.name,
      baseUnitName: products.baseUnitName,
      packLevels: products.packLevels,
      minStockBaseUnits: products.minStockBaseUnits,
      onHandBase: sql<number>`coalesce(sum(${batches.qtyRemainingBase}), 0)`,
    })
    .from(products)
    .leftJoin(batches, and(eq(batches.productId, products.id), eq(batches.tenantId, scope.tenantId)))
    .where(
      scope.scopeOf(products, eq(products.isActive, true), sql`${products.minStockBaseUnits} is not null`),
    )
    .groupBy(products.id)
    .having(sql`coalesce(sum(${batches.qtyRemainingBase}), 0) <= ${products.minStockBaseUnits}`)
    .orderBy(asc(products.name));

  return rows.map((row) => ({
    productId: row.productId,
    productName: row.productName,
    baseUnitName: row.baseUnitName,
    packLevels: row.packLevels,
    onHandBase: Number(row.onHandBase ?? 0),
    minStockBaseUnits: row.minStockBaseUnits ?? 0,
  }));
}

/* -------------------------------------------------------------------------- */
/* D2 — unresolved pending exposure, per product                               */
/* -------------------------------------------------------------------------- */

export interface PendingIncidentRow {
  productId: string;
  productName: string;
  baseUnitName: string;
  pendingBase: number;
  oldestAt: Date;
}

/**
 * Sales that outran stock and are still unexplained.
 *
 * This is the list D2 promises is "never silent" — the negative-stock incidents
 * the owner's daily view surfaces and a purchase or count correction clears.
 */
export async function pendingIncidents(scope: TenantScope): Promise<PendingIncidentRow[]> {
  const rows = await scope.db
    .select({
      productId: saleLines.productId,
      productName: products.name,
      baseUnitName: products.baseUnitName,
      pendingBase: sql<number>`sum(${saleLineAllocations.qtyBase})`,
      oldestAt: sql<Date>`min(${saleLineAllocations.createdAt})`,
    })
    .from(saleLineAllocations)
    .innerJoin(saleLines, eq(saleLines.id, saleLineAllocations.saleLineId))
    .innerJoin(products, eq(products.id, saleLines.productId))
    .where(
      scope.scopeOf(
        saleLineAllocations,
        isNull(saleLineAllocations.batchId),
        isNull(saleLineAllocations.resolvedAt),
      ),
    )
    .groupBy(saleLines.productId, products.name, products.baseUnitName)
    .orderBy(desc(sql`sum(${saleLineAllocations.qtyBase})`));

  return rows.map((row) => ({
    ...row,
    pendingBase: Number(row.pendingBase ?? 0),
    oldestAt: new Date(row.oldestAt),
  }));
}

/* -------------------------------------------------------------------------- */
/* Recent adjustments — the exception list's raw material (T1)                 */
/* -------------------------------------------------------------------------- */

export interface AdjustmentListRow {
  id: string;
  productName: string;
  baseUnitName: string;
  qtyBaseDelta: number;
  reason: string;
  note: string | null;
  byName: string;
  createdAt: Date;
}

export async function recentAdjustments(
  scope: TenantScope,
  limit = 50,
): Promise<AdjustmentListRow[]> {
  return scope.db
    .select({
      id: adjustments.id,
      productName: products.name,
      baseUnitName: products.baseUnitName,
      qtyBaseDelta: adjustments.qtyBaseDelta,
      reason: adjustments.reason,
      note: adjustments.note,
      byName: users.name,
      createdAt: adjustments.createdAt,
    })
    .from(adjustments)
    .innerJoin(products, eq(products.id, adjustments.productId))
    .innerJoin(users, eq(users.id, adjustments.createdBy))
    .where(scope.scopeOf(adjustments))
    .orderBy(desc(adjustments.createdAt))
    .limit(limit);
}
