/**
 * Catalog reads and writes.
 *
 * Inside `src/db` because ADR-2 puts every query here. Two consumers: the
 * Products screen (server-paginated lists) and the ADR-4 index endpoint
 * (bulk projections).
 *
 * Both are written for a 2,000–3,000 product catalog rather than the seeded
 * demo. Concretely, that means the list never loads the table into memory to
 * filter it, and the index endpoint ships a lean projection with a watermark so
 * the counter can ask for changes instead of the whole catalog.
 */

import 'server-only';

import { and, asc, count, desc, eq, gt, ilike, inArray, or, sql } from 'drizzle-orm';

import type { PackLevel } from '@/lib/quantity';
import type { Uuid } from '@/lib/uuid';

import { type TenantScope } from './scoped';
import { batches, productBarcodes, products } from './schema';

/* ========================================================================== */
/* The ADR-4 index payload                                                     */
/* ========================================================================== */

export interface IndexProductRow {
  id: string;
  name: string;
  strength: string | null;
  form: string | null;
  manufacturer: string | null;
  formulaText: string | null;
  baseUnitName: string;
  packLevels: PackLevel[];
  pricePaisa: number;
  mrpPaisa: number | null;
  needsCompletion: boolean;
}

export interface IndexBarcodeRow {
  barcode: string;
  productId: string;
  unitLevelName: string;
}

export interface CatalogSnapshot {
  products: IndexProductRow[];
  barcodes: IndexBarcodeRow[];
  /** Products deactivated since the watermark — the client drops them. */
  removedProductIds: string[];
  removedBarcodes: string[];
  stock: Record<string, number>;
  syncedAt: string;
}

/**
 * The index payload, whole or incremental.
 *
 * `since` is the client's previous watermark. Passing it turns a full catalog
 * download into a handful of rows — the difference between a corrected price
 * costing 3,000 rows and costing one.
 *
 * Deactivated products come back through the same `updated_at` clock, because
 * nothing is ever deleted (Phase 9 §1): `is_active = false` is an update, so a
 * removal is just a change the client interprets as a drop.
 */
export async function catalogSnapshot(scope: TenantScope, since?: Date): Promise<CatalogSnapshot> {
  const changed = since
    ? await scope.select(products, gt(products.updatedAt, since))
    : await scope.select(products, eq(products.isActive, true));

  const active = changed.filter((row) => row.isActive);
  const removedProductIds = changed.filter((row) => !row.isActive).map((row) => row.id);

  const changedBarcodes = since
    ? await scope.select(productBarcodes, gt(productBarcodes.updatedAt, since))
    : await scope.select(productBarcodes);

  return {
    products: active.map(toIndexProduct),
    barcodes: changedBarcodes.map((row) => ({
      barcode: row.barcode,
      productId: row.productId,
      unitLevelName: row.unitLevelName,
    })),
    removedProductIds,
    // A barcode row is hard-deleted when unlinked (it is a mapping, not history),
    // so removals are inferred client-side from the product it belonged to. An
    // explicit list is reserved for Day 6, when unlink lands on the UI.
    removedBarcodes: [],
    stock: await stockByProduct(scope),
    syncedAt: new Date().toISOString(),
  };
}

/**
 * Base units on hand per product, from `batches.qty_remaining`.
 *
 * One grouped aggregate rather than a per-product query — at 3,000 products the
 * difference is one round trip against three thousand. Products with no batches
 * are simply absent, which the index reads as "unknown" rather than zero.
 */
export async function stockByProduct(scope: TenantScope): Promise<Record<string, number>> {
  const rows = await scope.db
    .select({
      productId: batches.productId,
      total: sql<string>`sum(${batches.qtyRemainingBase})`,
    })
    .from(batches)
    .where(scope.scopeOf(batches))
    .groupBy(batches.productId);

  const stock: Record<string, number> = {};
  for (const row of rows) {
    stock[row.productId] = Number(row.total);
  }
  return stock;
}

function toIndexProduct(row: typeof products.$inferSelect): IndexProductRow {
  return {
    id: row.id,
    name: row.name,
    strength: row.strength,
    form: row.form,
    manufacturer: row.manufacturer,
    formulaText: row.formulaText,
    baseUnitName: row.baseUnitName,
    packLevels: row.packLevels,
    pricePaisa: row.defaultPricePerBaseUnit,
    mrpPaisa: row.currentMrpPerBaseUnit,
    needsCompletion: row.needsCompletion,
  };
}

/* ========================================================================== */
/* The Products screen                                                         */
/* ========================================================================== */

export interface ProductListItem {
  id: string;
  name: string;
  strength: string | null;
  form: string | null;
  manufacturer: string | null;
  formulaText: string | null;
  baseUnitName: string;
  packLevels: PackLevel[];
  pricePaisa: number;
  mrpPaisa: number | null;
  minStockBaseUnits: number | null;
  needsCompletion: boolean;
  isActive: boolean;
  barcodeCount: number;
}

export interface ProductListQuery {
  search?: string | undefined;
  needsCompletion?: boolean | undefined;
  includeInactive?: boolean | undefined;
  page?: number | undefined;
  pageSize?: number | undefined;
}

export interface ProductPage {
  items: ProductListItem[];
  total: number;
  page: number;
  pageSize: number;
  pageCount: number;
}

const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 200;

/**
 * A page of the catalog.
 *
 * Paginated in SQL, deliberately. The counter's search is the client index; this
 * is the admin list, and an admin list that loads 3,000 rows to show 50 is the
 * kind of thing that works until it does not. Matching is a simple substring —
 * the ranking ladder is the sale screen's job, not this screen's.
 */
export async function listProducts(
  scope: TenantScope,
  query: ProductListQuery = {},
): Promise<ProductPage> {
  const page = Math.max(1, Math.trunc(query.page ?? 1));
  const pageSize = Math.min(
    MAX_PAGE_SIZE,
    Math.max(1, Math.trunc(query.pageSize ?? DEFAULT_PAGE_SIZE)),
  );

  const filters = [];
  if (!query.includeInactive) {
    filters.push(eq(products.isActive, true));
  }
  if (query.needsCompletion) {
    filters.push(eq(products.needsCompletion, true));
  }
  const term = query.search?.trim();
  if (term) {
    const pattern = `%${term.replace(/[%_]/g, (match) => `\\${match}`)}%`;
    filters.push(
      or(
        ilike(products.name, pattern),
        ilike(products.formulaText, pattern),
        ilike(products.manufacturer, pattern),
      ),
    );
  }

  const where = scope.scopeOf(products, ...filters);

  const [totals] = await scope.db.select({ value: count() }).from(products).where(where);
  const total = totals?.value ?? 0;

  const rows = await scope.db
    .select()
    .from(products)
    .where(where)
    .orderBy(asc(products.name))
    .limit(pageSize)
    .offset((page - 1) * pageSize);

  // One extra query for the whole page's barcode counts, not one per row.
  const counts = await barcodeCounts(
    scope,
    rows.map((row) => row.id),
  );

  return {
    items: rows.map((row) => ({
      id: row.id,
      name: row.name,
      strength: row.strength,
      form: row.form,
      manufacturer: row.manufacturer,
      formulaText: row.formulaText,
      baseUnitName: row.baseUnitName,
      packLevels: row.packLevels,
      pricePaisa: row.defaultPricePerBaseUnit,
      mrpPaisa: row.currentMrpPerBaseUnit,
      minStockBaseUnits: row.minStockBaseUnits,
      needsCompletion: row.needsCompletion,
      isActive: row.isActive,
      barcodeCount: counts[row.id] ?? 0,
    })),
    total,
    page,
    pageSize,
    pageCount: Math.max(1, Math.ceil(total / pageSize)),
  };
}

async function barcodeCounts(
  scope: TenantScope,
  productIds: string[],
): Promise<Record<string, number>> {
  if (productIds.length === 0) {
    return {};
  }
  const rows = await scope.db
    .select({ productId: productBarcodes.productId, value: count() })
    .from(productBarcodes)
    .where(scope.scopeOf(productBarcodes, inArray(productBarcodes.productId, productIds)))
    .groupBy(productBarcodes.productId);

  const counts: Record<string, number> = {};
  for (const row of rows) {
    counts[row.productId] = row.value;
  }
  return counts;
}

export async function countNeedingCompletion(scope: TenantScope): Promise<number> {
  const [row] = await scope.db
    .select({ value: count() })
    .from(products)
    .where(
      scope.scopeOf(products, eq(products.needsCompletion, true), eq(products.isActive, true)),
    );
  return row?.value ?? 0;
}

export interface ProductDetail extends ProductListItem {
  barcodes: Array<{ id: string; barcode: string; unitLevelName: string }>;
  stockBase: number | null;
}

export async function findProduct(
  scope: TenantScope,
  productId: Uuid,
): Promise<ProductDetail | undefined> {
  const row = await scope.selectOne(products, eq(products.id, productId));
  if (!row) {
    return undefined;
  }

  const codes = await scope.select(productBarcodes, eq(productBarcodes.productId, productId));
  const [stockRow] = await scope.db
    .select({ total: sql<string>`sum(${batches.qtyRemainingBase})` })
    .from(batches)
    .where(scope.scopeOf(batches, eq(batches.productId, productId)));

  return {
    id: row.id,
    name: row.name,
    strength: row.strength,
    form: row.form,
    manufacturer: row.manufacturer,
    formulaText: row.formulaText,
    baseUnitName: row.baseUnitName,
    packLevels: row.packLevels,
    pricePaisa: row.defaultPricePerBaseUnit,
    mrpPaisa: row.currentMrpPerBaseUnit,
    minStockBaseUnits: row.minStockBaseUnits,
    needsCompletion: row.needsCompletion,
    isActive: row.isActive,
    barcodeCount: codes.length,
    barcodes: codes
      .map((code) => ({
        id: code.id,
        barcode: code.barcode,
        unitLevelName: code.unitLevelName,
      }))
      .sort((a, b) => a.barcode.localeCompare(b.barcode)),
    stockBase: stockRow?.total === null || stockRow === undefined ? null : Number(stockRow.total),
  };
}

/** Is this barcode already taken within the tenant? Unique (tenant_id, barcode). */
export async function findBarcodeOwner(
  scope: TenantScope,
  barcode: string,
): Promise<{ productId: string; productName: string } | undefined> {
  const rows = await scope.db
    .select({ productId: productBarcodes.productId, productName: products.name })
    .from(productBarcodes)
    .innerJoin(products, eq(productBarcodes.productId, products.id))
    .where(scope.scopeOf(productBarcodes, eq(productBarcodes.barcode, barcode)))
    .limit(1);
  return rows[0];
}

/* ========================================================================== */
/* Writes                                                                      */
/* ========================================================================== */

export async function insertProduct(
  scope: TenantScope,
  row: typeof products.$inferInsert,
): Promise<void> {
  await scope.insert(products, row as never);
}

export async function updateProduct(
  scope: TenantScope,
  productId: Uuid,
  patch: Partial<typeof products.$inferInsert>,
): Promise<void> {
  await scope.update(products, patch, eq(products.id, productId));
}

export async function insertBarcode(
  scope: TenantScope,
  row: typeof productBarcodes.$inferInsert,
): Promise<void> {
  await scope.insert(productBarcodes, row as never);
}

/**
 * Unlinks a barcode.
 *
 * A hard delete, unlike everything else in the system. A barcode row is a
 * mapping between a printed code and a product, not a record of something that
 * happened — no history references it, and Phase 9 §1's soft-archive rule exists
 * so "referenced history must resolve". Nothing resolves through this row.
 *
 * The product's `updated_at` is touched alongside, so the client index notices.
 */
export async function deleteBarcode(
  scope: TenantScope,
  productId: Uuid,
  barcodeId: Uuid,
): Promise<void> {
  await scope.db
    .delete(productBarcodes)
    .where(scope.scopeOf(productBarcodes, eq(productBarcodes.id, barcodeId)));
  await scope.update(products, {}, eq(products.id, productId));
}

/** Most recently touched products — the Products screen's default view. */
export async function recentlyUpdated(
  scope: TenantScope,
  limit = 10,
): Promise<Array<{ id: string; name: string }>> {
  return scope.db
    .select({ id: products.id, name: products.name })
    .from(products)
    .where(scope.scopeOf(products, eq(products.isActive, true)))
    .orderBy(desc(products.updatedAt))
    .limit(limit);
}

export const CATALOG_FILTERS = { and, eq };
