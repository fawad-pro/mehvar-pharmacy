/**
 * Purchase, supplier and batch-materialization queries.
 *
 * Inside `src/db` because ADR-2 puts every query here.
 */

import 'server-only';

import { asc, desc, eq, ilike, inArray, isNull, or, sql } from 'drizzle-orm';

import type { TenantScope } from './scoped';
import {
  batches,
  products,
  purchaseLines,
  purchases,
  saleLineAllocations,
  saleLines,
  suppliers,
  users,
} from './schema';
import { purchaseLineCostSql } from './purchase-line-cost';

import { unitsOf, type ProductUnit } from '@/domain/catalog/units';
import type { Uuid } from '@/lib/uuid';

/* -------------------------------------------------------------------------- */
/* Suppliers                                                                   */
/* -------------------------------------------------------------------------- */

export async function searchSuppliers(
  scope: TenantScope,
  term: string,
  limit = 8,
): Promise<Array<{ id: string; name: string; phone: string | null }>> {
  const trimmed = term.trim();
  const where =
    trimmed === ''
      ? scope.scopeOf(suppliers, eq(suppliers.isActive, true))
      : scope.scopeOf(
          suppliers,
          eq(suppliers.isActive, true),
          or(ilike(suppliers.name, `%${trimmed}%`), ilike(suppliers.phone, `%${trimmed}%`)),
        );

  const rows = await scope.db
    .select({ id: suppliers.id, name: suppliers.name, phone: suppliers.phone })
    .from(suppliers)
    .where(where)
    .orderBy(asc(suppliers.name))
    .limit(limit);

  return rows;
}

export async function insertSupplier(
  scope: TenantScope,
  row: { id: Uuid; name: string; phone: string | null },
): Promise<void> {
  await scope.insert(suppliers, row);
}

/* -------------------------------------------------------------------------- */
/* Purchases                                                                   */
/* -------------------------------------------------------------------------- */

/** Idempotency: a purchase already received is not received twice. */
export async function findPurchaseById(
  scope: TenantScope,
  purchaseId: Uuid,
): Promise<{ id: string } | undefined> {
  const row = await scope.selectOne(purchases, eq(purchases.id, purchaseId));
  return row ? { id: row.id } : undefined;
}

export async function insertPurchase(
  scope: TenantScope,
  row: Omit<typeof purchases.$inferInsert, 'tenantId' | 'createdBy'>,
): Promise<void> {
  await scope.insert(purchases, row as never);
}

export async function insertPurchaseLines(
  scope: TenantScope,
  rows: ReadonlyArray<Omit<typeof purchaseLines.$inferInsert, 'tenantId'>>,
): Promise<void> {
  if (rows.length === 0) {
    return;
  }
  await scope.insert(purchaseLines, rows as never);
}

/** [PCN-012] Each product's units, smallest first — what an entered line is checked against. */
export async function productUnitsFor(
  scope: TenantScope,
  productIds: readonly string[],
): Promise<Map<string, ProductUnit[]>> {
  if (productIds.length === 0) {
    return new Map();
  }
  const rows = await scope.select(products, inArray(products.id, [...productIds]));
  return new Map(
    rows.map((row) => [
      row.id,
      unitsOf({
        baseUnitName: row.baseUnitName,
        packLevels: row.packLevels,
        pricePerBasePaisa: row.defaultPricePerBaseUnit,
        units: row.units,
      }),
    ]),
  );
}

/**
 * [PCN-012] The cost this product last arrived at — what opening stock's cost
 * is pre-filled from (decision 5). Per the unit it was bought in when the line
 * was entered per pack (`unitKey`), per base unit otherwise (`unitKey` null).
 * Null when the product has never been bought.
 */
export async function lastPurchaseCost(
  scope: TenantScope,
  productId: string,
): Promise<{ unitKey: string | null; costPaisa: number } | null> {
  const [row] = await scope.db
    .select({
      unitKey: purchaseLines.unitKey,
      unitCostPaisaEntered: purchaseLines.unitCostPaisaEntered,
      unitCostPaisa: purchaseLines.unitCostPaisa,
    })
    .from(purchaseLines)
    .where(scope.scopeOf(purchaseLines, eq(purchaseLines.productId, productId)))
    .orderBy(desc(purchaseLines.createdAt))
    .limit(1);
  if (!row) {
    return null;
  }
  return row.unitKey !== null && row.unitCostPaisaEntered !== null
    ? { unitKey: row.unitKey, costPaisa: row.unitCostPaisaEntered }
    : { unitKey: null, costPaisa: row.unitCostPaisa };
}

export async function insertBatches(
  scope: TenantScope,
  rows: ReadonlyArray<Omit<typeof batches.$inferInsert, 'tenantId'>>,
): Promise<void> {
  if (rows.length === 0) {
    return;
  }
  await scope.insert(batches, rows as never);
}

export interface PurchaseListItem {
  id: string;
  supplierName: string | null;
  invoiceRef: string | null;
  invoiceDate: string | null;
  createdAt: Date;
  lineCount: number;
  totalCostPaisa: number;
}

/** Recent purchases for the Purchases list (Phase 10 §2 surface 4). */
export async function listPurchases(scope: TenantScope, limit = 50): Promise<PurchaseListItem[]> {
  const rows = await scope.db
    .select({
      id: purchases.id,
      supplierName: suppliers.name,
      invoiceRef: purchases.invoiceRef,
      invoiceDate: purchases.invoiceDate,
      createdAt: purchases.createdAt,
      lineCount: sql<number>`count(${purchaseLines.id})`,
      // Invoiced cost, not effective: this is what the shop paid the
      // distributor, which is the figure that reconciles against the invoice
      // in the operator's hand. Bonus units are free and change per-unit cost,
      // never the total paid (see domain/purchases/costing.ts).
      totalCostPaisa: sql<number>`coalesce(sum(${purchaseLineCostSql}), 0)`,
    })
    .from(purchases)
    .leftJoin(suppliers, eq(suppliers.id, purchases.supplierId))
    .leftJoin(purchaseLines, eq(purchaseLines.purchaseId, purchases.id))
    .where(scope.scopeOf(purchases))
    .groupBy(purchases.id, suppliers.name)
    .orderBy(desc(purchases.createdAt))
    .limit(limit);

  return rows.map((row) => ({
    ...row,
    lineCount: Number(row.lineCount ?? 0),
    totalCostPaisa: Number(row.totalCostPaisa ?? 0),
  }));
}

/* -------------------------------------------------------------------------- */
/* Pending-layer resolution (D2)                                               */
/* -------------------------------------------------------------------------- */

export interface PendingAllocationRow {
  allocationId: string;
  saleLineId: string;
  productId: string;
  qtyBase: number;
  createdAt: Date;
}

/**
 * Unresolved pending allocations for the given products, oldest first.
 *
 * **Deliberately not `FOR UPDATE`.** Row locking would require UPDATE privilege
 * on `sale_line_allocations`, and the application role does not have it — that
 * is ADR-1 enforced as a database privilege, and the right response is to work
 * within it rather than widen it.
 *
 * The concurrency story is therefore optimistic, with the SECURITY DEFINER
 * function as the single serialization point: two deliveries of the same
 * product may both plan against the same shortfall, but only one of them can
 * move a given row, because the function refuses anything that is no longer
 * pending. The loser is told so (it returns false) and skips that allocation
 * without decrementing its batch. Nothing is over-resolved and nothing is
 * over-consumed; see `commitPurchase`.
 */
export async function pendingAllocationsForProducts(
  scope: TenantScope,
  productIds: readonly Uuid[],
): Promise<PendingAllocationRow[]> {
  if (productIds.length === 0) {
    return [];
  }

  const rows = await scope.db
    .select({
      allocationId: saleLineAllocations.id,
      saleLineId: saleLineAllocations.saleLineId,
      productId: saleLines.productId,
      qtyBase: saleLineAllocations.qtyBase,
      createdAt: saleLineAllocations.createdAt,
    })
    .from(saleLineAllocations)
    .innerJoin(saleLines, eq(saleLines.id, saleLineAllocations.saleLineId))
    .where(
      scope.scopeOf(
        saleLineAllocations,
        isNull(saleLineAllocations.batchId),
        isNull(saleLineAllocations.resolvedAt),
        inArray(saleLines.productId, [...productIds]),
      ),
    )
    .orderBy(asc(saleLineAllocations.createdAt));

  return rows;
}

/**
 * Moves one pending allocation to resolved — ADR-8's first sanctioned mutation.
 *
 * Routed through the owner's `resolve_sale_line_allocation` function (migration
 * 0003) because the application role has no UPDATE privilege on event tables
 * and must not be given one. The function enforces tenant scope and refuses any
 * row that is not still pending, so a lost race returns false rather than
 * overwriting a settled allocation.
 */
export async function resolveAllocation(
  scope: TenantScope,
  input: {
    allocationId: Uuid;
    batchId: Uuid;
    unitCostPaisa: number;
    purchaseLineId: Uuid | null;
    adjustmentId: Uuid | null;
  },
): Promise<boolean> {
  const result = await scope.db.execute<{ resolve_sale_line_allocation: boolean }>(
    sql`SELECT resolve_sale_line_allocation(
          ${scope.tenantId}::uuid,
          ${input.allocationId}::uuid,
          ${input.batchId}::uuid,
          ${input.unitCostPaisa}::bigint,
          ${input.purchaseLineId}::uuid,
          ${input.adjustmentId}::uuid
        )`,
  );

  const row = (result as unknown as { rows: Array<{ resolve_sale_line_allocation: boolean }> })
    .rows[0];
  return row?.resolve_sale_line_allocation === true;
}

/* -------------------------------------------------------------------------- */
/* One purchase, in full — the review half (W8)                                */
/* -------------------------------------------------------------------------- */

export interface PurchaseDetailLine {
  readonly lineId: string;
  readonly productId: string;
  readonly productName: string;
  readonly baseUnitName: string;
  readonly packLevels: readonly { name: string; factor: number }[];
  readonly qtyBase: number;
  readonly bonusQtyBase: number;
  readonly unitCostPaisa: number;
  readonly priceAtReceivingPaisa: number;
  readonly mrpAtReceivingPaisa: number | null;
  readonly expiryDate: string | null;
  readonly batchNumber: string | null;
  /** [PCN-012] The line as invoiced per pack; all null on a line priced per base unit. */
  readonly unitName: string | null;
  readonly unitCount: number | null;
  readonly bonusUnitCount: number | null;
  readonly unitCostPaisaEntered: number | null;
  readonly lineCostPaisa: number | null;
  readonly pricePaisaEntered: number | null;
}

export interface PurchaseDetail {
  readonly id: string;
  readonly supplierId: string | null;
  readonly supplierName: string | null;
  readonly invoiceRef: string | null;
  readonly invoiceDate: string | null;
  readonly note: string | null;
  readonly receivedByName: string;
  /** [PCN-007] What was paid to the supplier at receiving; the rest was credit. */
  readonly cashPaidPaisa: number;
  /** False for a purchase entered before supplier credit: payment not recorded. */
  readonly creditTracked: boolean;
  readonly createdAt: Date;
  readonly lines: readonly PurchaseDetailLine[];
}

/**
 * A received invoice, expanded into what actually arrived.
 *
 * The "Received recently" list was a dead end — a supplier name, a date and a
 * total with nothing behind them, so the one question an owner asks of a
 * delivery ("what came in, and at what cost?") had no answer in the product.
 * Same gap as receipts, same fix: the record is a place you can open.
 *
 * A purchase is deliberately NOT a receipt and does not appear on `/receipts`.
 * It has no receipt number, nothing was handed to a customer, and folding
 * supplier invoices into the customer-facing receipt sequence would blur two
 * different things that happen to both be "documents".
 */
export async function findPurchase(
  scope: TenantScope,
  purchaseId: string,
): Promise<PurchaseDetail | null> {
  const [head] = await scope.db
    .select({
      id: purchases.id,
      supplierId: purchases.supplierId,
      supplierName: suppliers.name,
      invoiceRef: purchases.invoiceRef,
      invoiceDate: purchases.invoiceDate,
      note: purchases.note,
      receivedByName: users.name,
      cashPaidPaisa: purchases.cashPaidPaisa,
      creditTracked: purchases.creditTracked,
      createdAt: purchases.createdAt,
    })
    .from(purchases)
    .leftJoin(suppliers, eq(suppliers.id, purchases.supplierId))
    .leftJoin(users, eq(users.id, purchases.createdBy))
    .where(scope.scopeOf(purchases, eq(purchases.id, purchaseId)))
    .limit(1);

  if (!head) return null;

  const lines = await scope.db
    .select({
      lineId: purchaseLines.id,
      productId: purchaseLines.productId,
      productName: products.name,
      baseUnitName: products.baseUnitName,
      packLevels: products.packLevels,
      qtyBase: purchaseLines.qtyBase,
      bonusQtyBase: purchaseLines.bonusQtyBase,
      unitCostPaisa: purchaseLines.unitCostPaisa,
      priceAtReceivingPaisa: purchaseLines.priceAtReceivingPaisa,
      mrpAtReceivingPaisa: purchaseLines.mrpAtReceivingPaisa,
      expiryDate: purchaseLines.expiryDate,
      batchNumber: purchaseLines.batchNumber,
      unitName: purchaseLines.unitName,
      unitCount: purchaseLines.unitCount,
      bonusUnitCount: purchaseLines.bonusUnitCount,
      unitCostPaisaEntered: purchaseLines.unitCostPaisaEntered,
      lineCostPaisa: purchaseLines.lineCostPaisa,
      pricePaisaEntered: purchaseLines.pricePaisaEntered,
    })
    .from(purchaseLines)
    .innerJoin(products, eq(products.id, purchaseLines.productId))
    .where(scope.scopeOf(purchaseLines, eq(purchaseLines.purchaseId, purchaseId)))
    .orderBy(purchaseLines.createdAt);

  return {
    ...head,
    receivedByName: head.receivedByName ?? 'Unknown',
    lines,
  };
}
