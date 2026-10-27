/**
 * Return-path queries — W4.
 *
 * Inside `src/db` because ADR-2 puts every query here. Everything here runs
 * inside `commitReturn`'s transaction except the search/lookup helpers a
 * screen calls before a return is even started.
 */

import 'server-only';

import { asc, desc, eq, ilike, inArray, or, sql, sum } from 'drizzle-orm';

import type { TenantScope } from './scoped';
import {
  batches,
  customers,
  products,
  saleLineAllocations,
  saleLines,
  saleReturnLines,
  saleReturns,
  sales,
} from './schema';

import { unitsOf } from '@/domain/catalog/units';
import type { FoundSale, ReturnableLineRow } from '@/domain/sales/return-command';
import type { Uuid } from '@/lib/uuid';

/** W4: "scan receipt number, or search recent sales" — one lookup for both. */
export async function findSaleForReturn(scope: TenantScope, query: string): Promise<FoundSale[]> {
  const trimmed = query.trim();
  const rows = await scope.db
    .select({
      saleId: sales.id,
      receiptNumber: sales.receiptNumber,
      customerId: sales.customerId,
      customerName: customers.name,
      totalPaisa: sales.totalPaisa,
      createdAt: sales.createdAt,
    })
    .from(sales)
    .leftJoin(customers, eq(sales.customerId, customers.id))
    .where(
      trimmed === ''
        ? scope.scopeOf(sales)
        : scope.scopeOf(
            sales,
            or(ilike(sales.receiptNumber, `%${trimmed}%`), ilike(customers.name, `%${trimmed}%`)),
          ),
    )
    .orderBy(desc(sales.createdAt))
    .limit(20);

  return rows;
}

/**
 * A sale's lines, each with what has already been returned against it
 * (`alreadyReturnedBase`, for `validateReturnCommand`) and the batch(es) it
 * was originally allocated from — so the screen can pre-fill "source batch"
 * and the writer can refuse an over-return in the same pass.
 */
export async function returnableLinesForSale(
  scope: TenantScope,
  saleId: Uuid,
): Promise<ReturnableLineRow[]> {
  const lines = await scope.db
    .select({
      saleLineId: saleLines.id,
      productId: saleLines.productId,
      productName: products.name,
      baseUnitName: products.baseUnitName,
      enteredUnitLevel: saleLines.enteredUnitLevel,
      qtyBase: saleLines.qtyBase,
      unitPricePaisa: saleLines.unitPricePaisa,
      lineAmountPaisa: saleLines.lineAmountPaisa,
      lineDiscountPaisa: saleLines.lineDiscountPaisa,
      soldUnitKey: saleLines.unitKey,
      packLevels: products.packLevels,
      pricePerBasePaisa: products.defaultPricePerBaseUnit,
      storedUnits: products.units,
    })
    .from(saleLines)
    .innerJoin(products, eq(saleLines.productId, products.id))
    .where(scope.scopeOf(saleLines, eq(saleLines.saleId, saleId)))
    .orderBy(asc(saleLines.createdAt));

  if (lines.length === 0) {
    return [];
  }
  const lineIds = lines.map((line) => line.saleLineId);

  const [returned, allocations] = await Promise.all([
    scope.db
      .select({
        saleLineId: saleReturnLines.saleLineId,
        total: sum(saleReturnLines.qtyBase).as('total'),
      })
      .from(saleReturnLines)
      .where(scope.scopeOf(saleReturnLines, inArray(saleReturnLines.saleLineId, lineIds)))
      .groupBy(saleReturnLines.saleLineId),
    scope.db
      .select({
        saleLineId: saleLineAllocations.saleLineId,
        batchId: saleLineAllocations.batchId,
        expiryDate: batches.expiryDate,
      })
      .from(saleLineAllocations)
      .innerJoin(batches, eq(saleLineAllocations.batchId, batches.id))
      .where(scope.scopeOf(saleLineAllocations, inArray(saleLineAllocations.saleLineId, lineIds)))
      .orderBy(asc(batches.expiryDate)),
  ]);

  const returnedByLine = new Map(returned.map((row) => [row.saleLineId, Number(row.total ?? 0)]));
  const batchesByLine = new Map<string, { batchId: string; expiryDate: string | null }[]>();
  for (const row of allocations) {
    // The inner join to `batches` already excludes the pending layer's
    // batch-less rows (D2) at the SQL level; drizzle's column type just
    // doesn't know that.
    if (row.batchId === null) {
      continue;
    }
    const list = batchesByLine.get(row.saleLineId) ?? [];
    list.push({ batchId: row.batchId, expiryDate: row.expiryDate });
    batchesByLine.set(row.saleLineId, list);
  }

  return lines.map(({ pricePerBasePaisa, storedUnits, soldUnitKey, ...line }) => {
    const all = unitsOf({
      baseUnitName: line.baseUnitName,
      packLevels: line.packLevels,
      pricePerBasePaisa,
      units: storedUnits,
    });
    // [PCN-012] "As sale": the units the counter sells in, and always the unit
    // this line was sold in, even if it has stopped being offered since.
    // A line from before units names its unit only by `enteredUnitLevel`.
    const sold =
      all.find((unit) => unit.key === soldUnitKey) ??
      all.find((unit) => unit.name === line.enteredUnitLevel) ??
      all[0]!;
    return {
      ...line,
      units: all
        .filter((unit) => unit.sell || unit.key === sold.key)
        .map(({ key, name, factor }) => ({ key, name, factor })),
      soldUnitKey: sold.key,
      alreadyReturnedBase: returnedByLine.get(line.saleLineId) ?? 0,
      sourceBatches: batchesByLine.get(line.saleLineId) ?? [],
    };
  });
}

/** Idempotency (a flaky submit must not double-return). */
export async function findReturnById(
  scope: TenantScope,
  returnId: Uuid,
): Promise<{ id: string; receiptNumber: string } | undefined> {
  const row = await scope.selectOne(saleReturns, eq(saleReturns.id, returnId));
  return row ? { id: row.id, receiptNumber: row.receiptNumber } : undefined;
}

export async function insertSaleReturn(
  scope: TenantScope,
  row: Omit<typeof saleReturns.$inferInsert, 'tenantId' | 'createdBy'>,
): Promise<void> {
  await scope.insert(saleReturns, row as never);
}

export async function insertSaleReturnLines(
  scope: TenantScope,
  rows: Array<Omit<typeof saleReturnLines.$inferInsert, 'tenantId' | 'createdBy'>>,
): Promise<void> {
  if (rows.length > 0) {
    await scope.insert(saleReturnLines, rows as never);
  }
}

/**
 * Restores stock to a batch — the second of ADR-8's two sanctioned
 * `qty_remaining` mutations, symmetric to `consumeFromBatch`. Unguarded on the
 * way up (there is no upper bound a return could violate the way a sale could
 * violate a lower one).
 */
export async function restockToBatch(
  scope: TenantScope,
  batchId: Uuid,
  qtyBase: number,
): Promise<void> {
  await scope.db
    .update(batches)
    .set({ qtyRemainingBase: sql`${batches.qtyRemainingBase} + ${qtyBase}` })
    .where(scope.scopeOf(batches, eq(batches.id, batchId)));
}
