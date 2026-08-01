/**
 * Sale-path queries.
 *
 * Inside `src/db` because ADR-2 puts every query here. Everything in this file
 * runs inside `commitSale`'s single transaction (Phase 9 §5.3) except where
 * marked, so the functions take a scope rather than opening their own.
 */

import 'server-only';

import { and, asc, eq, inArray, isNotNull, isNull, lt, sql, sum } from 'drizzle-orm';

import type { TenantScope } from './scoped';
import {
  adjustments,
  batches,
  saleLineAllocations,
  saleLines,
  saleReturnLines,
  sales,
} from './schema';

import type { BatchAvailability } from '@/domain/inventory/allocation';
import type { Uuid } from '@/lib/uuid';

/**
 * Batches on hand for the given products, locked for the transaction.
 *
 * `FOR UPDATE` is load-bearing. Two counters selling the last strip at the same
 * moment would otherwise both read the same `qty_remaining`, both allocate it,
 * and leave the batch negative — a silent violation of the CHECK constraint's
 * intent and of Phase 5 invariant 2. Locking the candidate rows makes the second
 * transaction wait and re-read, so the loser allocates a pending row instead
 * (D2), which is the honest outcome.
 *
 * Ordered by FEFO here as well as in the planner: the database does the sort it
 * is good at, and the planner's ordering then costs nothing on an already-sorted
 * list while remaining independently correct.
 */
export async function lockBatchesForProducts(
  scope: TenantScope,
  productIds: readonly Uuid[],
): Promise<Map<string, BatchAvailability[]>> {
  const byProduct = new Map<string, BatchAvailability[]>();
  if (productIds.length === 0) {
    return byProduct;
  }

  const rows = await scope.db
    .select({
      productId: batches.productId,
      batchId: batches.id,
      expiryDate: batches.expiryDate,
      createdAt: batches.createdAt,
      qtyRemainingBase: batches.qtyRemainingBase,
      unitCostPaisa: batches.unitCostPaisa,
      pricePerBaseUnitPaisa: batches.pricePerBaseUnitPaisa,
    })
    .from(batches)
    .where(scope.scopeOf(batches, inArray(batches.productId, [...productIds])))
    .orderBy(asc(batches.expiryDate), asc(batches.createdAt), asc(batches.id))
    .for('update');

  for (const row of rows) {
    const list = byProduct.get(row.productId) ?? [];
    list.push({
      batchId: row.batchId,
      expiryDate: row.expiryDate,
      createdAt: row.createdAt,
      qtyRemainingBase: row.qtyRemainingBase,
      unitCostPaisa: row.unitCostPaisa,
      pricePerBaseUnitPaisa: row.pricePerBaseUnitPaisa,
    });
    byProduct.set(row.productId, list);
  }

  return byProduct;
}

/**
 * Decrements a batch's running quantity — one of the two sanctioned mutations
 * in the entire system (ADR-8).
 *
 * The guard in the WHERE clause is deliberate: the decrement only applies while
 * enough remains, so even a bug upstream cannot drive the cache negative. A zero
 * row count means the plan was stale and the caller must not proceed.
 */
export async function consumeFromBatch(
  scope: TenantScope,
  batchId: Uuid,
  qtyBase: number,
): Promise<boolean> {
  const updated = await scope.db
    .update(batches)
    .set({ qtyRemainingBase: sql`${batches.qtyRemainingBase} - ${qtyBase}` })
    .where(
      scope.scopeOf(
        batches,
        eq(batches.id, batchId),
        sql`${batches.qtyRemainingBase} >= ${qtyBase}`,
      ),
    )
    .returning({ id: batches.id });

  return updated.length > 0;
}

/** Idempotency (ADR-3): a client id already committed is not committed twice. */
export async function findSaleById(
  scope: TenantScope,
  saleId: Uuid,
): Promise<
  | { id: string; receiptNumber: string; totalPaisa: number; customerId: string | null }
  | undefined
> {
  const row = await scope.selectOne(sales, eq(sales.id, saleId));
  return row
    ? {
        id: row.id,
        receiptNumber: row.receiptNumber,
        totalPaisa: row.totalPaisa,
        customerId: row.customerId,
      }
    : undefined;
}

export async function insertSale(
  scope: TenantScope,
  row: Omit<typeof sales.$inferInsert, 'tenantId' | 'createdBy'>,
): Promise<void> {
  await scope.insert(sales, row as never);
}

export async function insertSaleLines(
  scope: TenantScope,
  rows: Array<Omit<typeof saleLines.$inferInsert, 'tenantId' | 'createdBy'>>,
): Promise<void> {
  if (rows.length > 0) {
    await scope.insert(saleLines, rows as never);
  }
}

export async function insertAllocations(
  scope: TenantScope,
  rows: Array<Omit<typeof saleLineAllocations.$inferInsert, 'tenantId' | 'createdBy'>>,
): Promise<void> {
  if (rows.length > 0) {
    await scope.insert(saleLineAllocations, rows as never);
  }
}

/**
 * The highest receipt counter this device has used.
 *
 * A hint, not an authority: ADR-3 requires the counter to mint receipt numbers
 * with no server in reach, so the client owns the sequence and this only helps
 * a fresh device pick up where the last one left off. Uniqueness is enforced by
 * the `(tenant_id, receipt_number)` index, and a collision is retried.
 */
export async function highestReceiptCounter(
  scope: TenantScope,
  devicePrefix: string,
): Promise<number> {
  const rows = await scope.db
    .select({ receiptNumber: sales.receiptNumber })
    .from(sales)
    .where(scope.scopeOf(sales, sql`${sales.receiptNumber} LIKE ${`${devicePrefix}-%`}`))
    .orderBy(sql`length(${sales.receiptNumber}) desc, ${sales.receiptNumber} desc`)
    .limit(1);

  const latest = rows[0]?.receiptNumber;
  if (!latest) {
    return 0;
  }
  const counter = Number(latest.slice(devicePrefix.length + 1));
  return Number.isSafeInteger(counter) ? counter : 0;
}

/* ========================================================================== */
/* Rebuild and verify — ADR-8                                                  */
/* ========================================================================== */

export interface BatchLedgerRow {
  batchId: string;
  productId: string;
  qtyReceivedBase: number;
  /** What the transactional cache currently says. */
  qtyRemainingLive: number;
  allocatedBase: number;
  adjustedBase: number;
  restockedBase: number;
}

/**
 * Every batch with the movements that should explain its running quantity.
 *
 * This is Phase 9 §4's derivation contract:
 *
 *   qty_remaining = qty_received − Σ allocations − Σ negative batch adjustments
 *                   + Σ restocked returns
 *
 * Deliberately four plain aggregates stitched together in TypeScript rather than
 * one clever statement. Two reasons, both learned the hard way:
 *
 *  - Joining three one-to-many tables at once multiplies rows and silently
 *    inflates every sum — the classic way a verifier ends up confidently wrong.
 *  - A correlated subquery written with `sql` template interpolation renders the
 *    outer column *unqualified*, so `where a.batch_id = ${batches.id}` compiled
 *    to `where a.batch_id = "id"` and resolved against the inner table. It ran,
 *    returned zero for every batch, and looked like real data.
 *
 * This module is the one place in the product whose whole job is to be
 * trustworthy about arithmetic. It gets the boring implementation on purpose.
 */
export async function batchLedger(scope: TenantScope): Promise<BatchLedgerRow[]> {
  const batchRows = await scope.db
    .select({
      batchId: batches.id,
      productId: batches.productId,
      qtyReceivedBase: batches.qtyReceivedBase,
      qtyRemainingLive: batches.qtyRemainingBase,
    })
    .from(batches)
    .where(scope.scopeOf(batches));

  const [allocated, adjusted, restocked] = await Promise.all([
    scope.db
      .select({
        batchId: saleLineAllocations.batchId,
        total: sum(saleLineAllocations.qtyBase).as('total'),
      })
      .from(saleLineAllocations)
      .where(scope.scopeOf(saleLineAllocations, isNotNull(saleLineAllocations.batchId)))
      .groupBy(saleLineAllocations.batchId),

    // Negative adjustments only — Phase 9 §4's contract says "− Σ *negative*
    // batch adjustments", and on Day 6 that word turned out to be load-bearing.
    //
    // A positive adjustment does not add to a batch, it *materializes* one
    // (Phase 9 §4, W9's opening stock and an upward count correction), and
    // `validateAdjustment` refuses to let a positive delta name an existing
    // batch at all. Its quantity is therefore already the new batch's
    // `qty_received`; summing it here as well counted the same stock twice and
    // made the verifier declare every opening-stock batch broken.
    scope.db
      .select({ batchId: adjustments.batchId, total: sum(adjustments.qtyBaseDelta).as('total') })
      .from(adjustments)
      .where(
        scope.scopeOf(
          adjustments,
          isNotNull(adjustments.batchId),
          lt(adjustments.qtyBaseDelta, 0),
        ),
      )
      .groupBy(adjustments.batchId),

    scope.db
      .select({
        batchId: saleReturnLines.restockBatchId,
        total: sum(saleReturnLines.qtyBase).as('total'),
      })
      .from(saleReturnLines)
      .where(scope.scopeOf(saleReturnLines, isNotNull(saleReturnLines.restockBatchId)))
      .groupBy(saleReturnLines.restockBatchId),
  ]);

  const index = (rows: Array<{ batchId: string | null; total: string | null }>) => {
    const map = new Map<string, number>();
    for (const row of rows) {
      if (row.batchId !== null) {
        map.set(row.batchId, Number(row.total ?? 0));
      }
    }
    return map;
  };

  const allocatedBy = index(allocated);
  const adjustedBy = index(adjusted);
  const restockedBy = index(restocked);

  return batchRows.map((row) => ({
    batchId: row.batchId,
    productId: row.productId,
    qtyReceivedBase: row.qtyReceivedBase,
    qtyRemainingLive: row.qtyRemainingLive,
    allocatedBase: allocatedBy.get(row.batchId) ?? 0,
    adjustedBase: adjustedBy.get(row.batchId) ?? 0,
    restockedBase: restockedBy.get(row.batchId) ?? 0,
  }));
}

/** Unresolved pending allocations — the D2 exposure the owner must see. */
export async function pendingExposure(
  scope: TenantScope,
): Promise<Array<{ productId: string; qtyBase: number }>> {
  const rows = await scope.db
    .select({
      productId: saleLines.productId,
      // `sum()` rather than a raw template: both joined tables have a
      // `qty_base` column, and an unqualified reference is a trap.
      qtyBase: sum(saleLineAllocations.qtyBase).as('qty_base_total'),
    })
    .from(saleLineAllocations)
    .innerJoin(saleLines, eq(saleLineAllocations.saleLineId, saleLines.id))
    .where(
      and(
        scope.scopeOf(saleLineAllocations),
        isNull(saleLineAllocations.batchId),
        isNull(saleLineAllocations.resolvedAt),
      ),
    )
    .groupBy(saleLines.productId);

  return rows.map((row) => ({ productId: row.productId, qtyBase: Number(row.qtyBase ?? 0) }));
}

/** Writes a rebuilt quantity back — the repair half of ADR-8's verifier. */
export async function setBatchRemaining(
  scope: TenantScope,
  batchId: Uuid,
  qtyRemainingBase: number,
): Promise<void> {
  await scope.update(batches, { qtyRemainingBase }, eq(batches.id, batchId));
}
