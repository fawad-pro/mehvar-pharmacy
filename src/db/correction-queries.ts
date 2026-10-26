/**
 * [PCN-009] Queries behind purchase corrections and supplier returns.
 *
 * Inside `src/db` because ADR-2 puts every query here. The two writers live in
 * `domain/purchases/commit-purchase-correction.ts` and
 * `domain/suppliers/commit-supplier-return.ts`; this module only reads and
 * inserts, and the one lock it takes is on `batches`, the table the app role
 * may update (an event table cannot be locked FOR UPDATE by a role without
 * UPDATE on it — the Day 6 lesson).
 */

import 'server-only';

import { and, asc, desc, eq, inArray } from 'drizzle-orm';

import type { TenantScope } from './scoped';
import {
  batches,
  products,
  purchaseCorrections,
  purchaseLines,
  purchases,
  supplierReturns,
  suppliers,
  users,
} from './schema';

import type { Uuid } from '@/lib/uuid';

export interface CorrectableLine {
  readonly lineId: string;
  readonly purchaseId: string;
  readonly productId: string;
  readonly qtyBase: number;
  readonly bonusQtyBase: number;
  readonly unitCostPaisa: number;
  /** [PCN-012] Set when the line was bought per pack. */
  readonly unitCount: number | null;
  readonly unitCostPaisaEntered: number | null;
  readonly batchId: string;
  readonly batchRemainingBase: number;
}

/**
 * A purchase line with the batch it created, locking that batch.
 *
 * The lock is what serialises two corrections to one line: each reads the
 * corrections so far and writes a delta against them, so the second must wait
 * for the first to commit.
 */
export async function lockLineForCorrection(
  scope: TenantScope,
  purchaseLineId: Uuid,
): Promise<CorrectableLine | undefined> {
  const [row] = await scope.db
    .select({
      lineId: purchaseLines.id,
      purchaseId: purchaseLines.purchaseId,
      productId: purchaseLines.productId,
      qtyBase: purchaseLines.qtyBase,
      bonusQtyBase: purchaseLines.bonusQtyBase,
      unitCostPaisa: purchaseLines.unitCostPaisa,
      unitCount: purchaseLines.unitCount,
      unitCostPaisaEntered: purchaseLines.unitCostPaisaEntered,
      batchId: batches.id,
      batchRemainingBase: batches.qtyRemainingBase,
    })
    .from(purchaseLines)
    .innerJoin(
      batches,
      and(eq(batches.source, 'purchase_line'), eq(batches.sourceId, purchaseLines.id)),
    )
    .where(scope.scopeOf(purchaseLines, eq(purchaseLines.id, purchaseLineId)))
    .limit(1)
    .for('update', { of: batches });
  return row;
}

export async function correctionsForLine(
  scope: TenantScope,
  purchaseLineId: Uuid,
): Promise<
  Array<{
    qtyDeltaBase: number;
    bonusDeltaBase: number;
    correctedUnitCostPaisa: number | null;
    correctedUnitCostPaisaEntered: number | null;
  }>
> {
  return scope.db
    .select({
      qtyDeltaBase: purchaseCorrections.qtyDeltaBase,
      bonusDeltaBase: purchaseCorrections.bonusDeltaBase,
      correctedUnitCostPaisa: purchaseCorrections.correctedUnitCostPaisa,
      correctedUnitCostPaisaEntered: purchaseCorrections.correctedUnitCostPaisaEntered,
    })
    .from(purchaseCorrections)
    .where(
      scope.scopeOf(purchaseCorrections, eq(purchaseCorrections.purchaseLineId, purchaseLineId)),
    )
    .orderBy(asc(purchaseCorrections.createdAt), asc(purchaseCorrections.id));
}

export async function findCorrectionById(
  scope: TenantScope,
  correctionId: Uuid,
): Promise<{ id: string } | undefined> {
  const row = await scope.selectOne(purchaseCorrections, eq(purchaseCorrections.id, correctionId));
  return row ? { id: row.id } : undefined;
}

export async function insertPurchaseCorrection(
  scope: TenantScope,
  row: Omit<typeof purchaseCorrections.$inferInsert, 'tenantId' | 'createdBy'>,
): Promise<void> {
  await scope.insert(purchaseCorrections, row as never);
}

export interface ReturnableBatch {
  readonly batchId: string;
  readonly productId: string;
  readonly qtyRemainingBase: number;
  readonly supplierId: string | null;
}

/** A batch with the supplier of the invoice it arrived on, locking the batch. */
export async function lockBatchForSupplierReturn(
  scope: TenantScope,
  batchId: Uuid,
): Promise<ReturnableBatch | undefined> {
  const [row] = await scope.db
    .select({
      batchId: batches.id,
      productId: batches.productId,
      qtyRemainingBase: batches.qtyRemainingBase,
      supplierId: purchases.supplierId,
    })
    .from(batches)
    .leftJoin(
      purchaseLines,
      and(eq(batches.source, 'purchase_line'), eq(purchaseLines.id, batches.sourceId)),
    )
    .leftJoin(purchases, eq(purchases.id, purchaseLines.purchaseId))
    .where(scope.scopeOf(batches, eq(batches.id, batchId)))
    .limit(1)
    .for('update', { of: batches });
  return row;
}

export async function findSupplierReturnById(
  scope: TenantScope,
  returnId: Uuid,
): Promise<{ id: string } | undefined> {
  const row = await scope.selectOne(supplierReturns, eq(supplierReturns.id, returnId));
  return row ? { id: row.id } : undefined;
}

export async function insertSupplierReturn(
  scope: TenantScope,
  row: Omit<typeof supplierReturns.$inferInsert, 'tenantId' | 'createdBy'>,
): Promise<void> {
  await scope.insert(supplierReturns, row as never);
}

/**
 * Each batch's cost per received unit as corrected: the latest correction's
 * effective cost, for every batch that has one. Batches never corrected are
 * absent — their own `unit_cost_paisa` (or an allocation's snapshot of it)
 * stands. A plain query, folded in TypeScript, per the Day 3/Day 9 rule.
 */
export async function correctedBatchCosts(scope: TenantScope): Promise<Map<string, number>> {
  const rows = await scope.db
    .select({
      batchId: purchaseCorrections.batchId,
      effectiveUnitCostPaisa: purchaseCorrections.effectiveUnitCostPaisa,
    })
    .from(purchaseCorrections)
    .where(scope.scopeOf(purchaseCorrections))
    .orderBy(asc(purchaseCorrections.createdAt), asc(purchaseCorrections.id));
  const latest = new Map<string, number>();
  for (const row of rows) latest.set(row.batchId, row.effectiveUnitCostPaisa);
  return latest;
}

export interface CorrectionRow {
  readonly id: string;
  readonly purchaseLineId: string;
  readonly productName: string;
  readonly qtyDeltaBase: number;
  readonly bonusDeltaBase: number;
  readonly correctedUnitCostPaisa: number | null;
  /** [PCN-012] The corrected cost per pack, on a line bought per pack. */
  readonly correctedUnitCostPaisaEntered: number | null;
  readonly invoiceDeltaPaisa: number;
  readonly note: string;
  readonly byName: string;
  readonly createdAt: Date;
}

/** Every correction to one purchase, oldest first — for its review page. */
export async function correctionsForPurchase(
  scope: TenantScope,
  purchaseId: Uuid,
): Promise<CorrectionRow[]> {
  return scope.db
    .select({
      id: purchaseCorrections.id,
      purchaseLineId: purchaseCorrections.purchaseLineId,
      productName: products.name,
      qtyDeltaBase: purchaseCorrections.qtyDeltaBase,
      bonusDeltaBase: purchaseCorrections.bonusDeltaBase,
      correctedUnitCostPaisa: purchaseCorrections.correctedUnitCostPaisa,
      correctedUnitCostPaisaEntered: purchaseCorrections.correctedUnitCostPaisaEntered,
      invoiceDeltaPaisa: purchaseCorrections.invoiceDeltaPaisa,
      note: purchaseCorrections.note,
      byName: users.name,
      createdAt: purchaseCorrections.createdAt,
    })
    .from(purchaseCorrections)
    .innerJoin(purchaseLines, eq(purchaseLines.id, purchaseCorrections.purchaseLineId))
    .innerJoin(products, eq(products.id, purchaseLines.productId))
    .innerJoin(users, eq(users.id, purchaseCorrections.createdBy))
    .where(scope.scopeOf(purchaseCorrections, eq(purchaseLines.purchaseId, purchaseId)))
    .orderBy(asc(purchaseCorrections.createdAt), asc(purchaseCorrections.id));
}

export interface SupplierReturnRow {
  readonly id: string;
  readonly batchId: string;
  readonly productName: string;
  readonly supplierName: string;
  readonly qtyBase: number;
  readonly baseUnitName: string;
  readonly creditPaisa: number;
  readonly note: string | null;
  readonly byName: string;
  readonly createdAt: Date;
}

/** Supplier returns taken from the given batches, newest first. */
export async function supplierReturnsForBatches(
  scope: TenantScope,
  batchIds: readonly string[],
): Promise<SupplierReturnRow[]> {
  if (batchIds.length === 0) return [];
  return scope.db
    .select({
      id: supplierReturns.id,
      batchId: supplierReturns.batchId,
      productName: products.name,
      supplierName: suppliers.name,
      qtyBase: supplierReturns.qtyBase,
      baseUnitName: products.baseUnitName,
      creditPaisa: supplierReturns.creditPaisa,
      note: supplierReturns.note,
      byName: users.name,
      createdAt: supplierReturns.createdAt,
    })
    .from(supplierReturns)
    .innerJoin(products, eq(products.id, supplierReturns.productId))
    .innerJoin(suppliers, eq(suppliers.id, supplierReturns.supplierId))
    .innerJoin(users, eq(users.id, supplierReturns.createdBy))
    .where(scope.scopeOf(supplierReturns, inArray(supplierReturns.batchId, [...batchIds])))
    .orderBy(desc(supplierReturns.createdAt));
}

export interface LineBatch {
  readonly lineId: string;
  readonly batchId: string;
  readonly qtyRemainingBase: number;
  /** As received; `correctedBatchCosts` overrides it once corrected. */
  readonly unitCostPaisa: number;
}

/** The batch each line of one purchase created, with what it holds now. */
export async function batchesForPurchase(
  scope: TenantScope,
  purchaseId: Uuid,
): Promise<LineBatch[]> {
  return scope.db
    .select({
      lineId: purchaseLines.id,
      batchId: batches.id,
      qtyRemainingBase: batches.qtyRemainingBase,
      unitCostPaisa: batches.unitCostPaisa,
    })
    .from(purchaseLines)
    .innerJoin(
      batches,
      and(eq(batches.source, 'purchase_line'), eq(batches.sourceId, purchaseLines.id)),
    )
    .where(scope.scopeOf(purchaseLines, eq(purchaseLines.purchaseId, purchaseId)));
}
