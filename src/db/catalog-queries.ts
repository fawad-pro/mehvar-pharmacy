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

import { and, asc, count, desc, eq, gt, ilike, inArray, ne, or, sql } from 'drizzle-orm';

import { equivalenceKey, identityKey } from '@/domain/catalog/identity';
import type { CatalogSuggestion } from '@/domain/catalog/product';
import type { PackLevel } from '@/lib/quantity';
import type { Uuid } from '@/lib/uuid';

import { database } from './client';
import { type TenantScope } from './scoped';
import { batches, globalProducts, productBarcodes, products } from './schema';

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
  /** Base units across every batch, or null when the product has never been stocked. */
  stockBase: number | null;
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

  // Two extra queries for the whole page, never one per row.
  const ids = rows.map((row) => row.id);
  const [counts, stock] = await Promise.all([
    barcodeCounts(scope, ids),
    stockForProducts(scope, ids),
  ]);

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
      // Absent means never stocked, which is not the same as zero on hand —
      // the difference is exactly what the counter needs to know before it
      // treats a shortfall as news.
      stockBase: stock[row.id] ?? null,
    })),
    total,
    page,
    pageSize,
    pageCount: Math.max(1, Math.ceil(total / pageSize)),
  };
}

/** On-hand base units for one page of products — one grouped aggregate, not N. */
async function stockForProducts(
  scope: TenantScope,
  productIds: string[],
): Promise<Record<string, number>> {
  if (productIds.length === 0) {
    return {};
  }
  const rows = await scope.db
    .select({
      productId: batches.productId,
      total: sql<string>`sum(${batches.qtyRemainingBase})`,
    })
    .from(batches)
    .where(scope.scopeOf(batches, inArray(batches.productId, productIds)))
    .groupBy(batches.productId);

  const stock: Record<string, number> = {};
  for (const row of rows) {
    stock[row.productId] = Number(row.total);
  }
  return stock;
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
  /** Present when this product came from Mehvar's catalogue (Phase 6 §2). */
  globalProductId: string | null;
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
    globalProductId: row.globalProductId,
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

/* -------------------------------------------------------------------------- */
/* The global catalogue, as the operator meets it                              */
/* -------------------------------------------------------------------------- */

/**
 * Searches the shared catalogue by brand, salt or maker.
 *
 * Deliberately a server query rather than part of the client index (ADR-4).
 * The client index is the counter's, sized to a shop's own catalogue and
 * refreshed on every session; the global catalogue is tens of thousands of
 * identities and is consulted only when somebody is adding a product, which is
 * a moment that tolerates a round trip. Shipping it to every browser would cost
 * every sale to serve an action that happens a few times a week.
 */
export async function searchGlobalCatalog(
  scope: TenantScope,
  term: string,
  limit = 12,
): Promise<CatalogSuggestion[]> {
  const trimmed = term.trim();
  if (trimmed.length < 2) return [];

  const pattern = `%${trimmed}%`;
  const rows = await database()
    .select({
      globalProductId: globalProducts.id,
      name: globalProducts.name,
      manufacturer: globalProducts.manufacturer,
      formulaText: globalProducts.formulaText,
      form: globalProducts.form,
      strength: globalProducts.strength,
      packLevels: globalProducts.packLevels,
      referenceMrpPaisa: globalProducts.referenceMrpPaisa,
      quality: globalProducts.quality,
      identityKey: globalProducts.identityKey,
    })
    .from(globalProducts)
    .where(
      or(
        ilike(globalProducts.name, pattern),
        ilike(globalProducts.formulaText, pattern),
        ilike(globalProducts.manufacturer, pattern),
      ),
    )
    /*
     * Ordered by RELEVANCE, then quality, then name.
     *
     * Alphabetical ordering looks harmless at 53 medicines and is useless at
     * 25,000: a search for "Getz" would return twelve of their products
     * beginning with A, and the one the operator wanted would be on a page
     * that does not exist. The tiers mirror the counter's own ranking ladder
     * (Phase 10 §5) so the two searches behave the same way — a name match
     * beats a salt match beats a company match.
     *
     * Verified before reference within a tier, because a verified entry
     * carries the hand-checked pack structure that makes picking it worth
     * anything.
     */
    .orderBy(
      sql`case
            when ${globalProducts.name} ilike ${`${trimmed}%`} then 0
            when ${globalProducts.name} ilike ${pattern} then 1
            when ${globalProducts.formulaText} ilike ${pattern} then 2
            else 3
          end`,
      desc(globalProducts.quality),
      globalProducts.name,
    )
    .limit(limit);

  if (rows.length === 0) return [];

  /*
   * Which of these the shop already stocks.
   *
   * Matched on identity key rather than on `global_product_id`, because a
   * product typed by hand before the catalogue existed has no link but is
   * still the same medicine. Recognising it is the difference between the
   * picker preventing duplicates and creating them.
   */
  const mine = await scope.db
    .select({
      id: products.id,
      name: products.name,
      strength: products.strength,
      form: products.form,
      manufacturer: products.manufacturer,
      formulaText: products.formulaText,
    })
    .from(products)
    .where(scope.scopeOf(products));

  const stockedByIdentity = new Map(
    mine.map((row) => [
      identityKey({
        name: row.name,
        strength: row.strength,
        form: row.form,
        manufacturer: row.manufacturer,
        formulaText: row.formulaText,
      }),
      row.id,
    ]),
  );

  return rows.map((row) => ({
    globalProductId: row.globalProductId,
    name: row.name,
    manufacturer: row.manufacturer,
    formulaText: row.formulaText,
    form: row.form,
    strength: row.strength,
    packLevels: row.packLevels,
    referenceMrpPaisa: row.referenceMrpPaisa,
    quality: row.quality,
    alreadyStockedId: stockedByIdentity.get(row.identityKey) ?? null,
  }));
}

export interface AlternativeProduct {
  readonly id: string;
  readonly name: string;
  readonly strength: string | null;
  readonly form: string | null;
  readonly manufacturer: string | null;
  readonly stockBase: number | null;
}

/**
 * What else the shop stocks that could be given instead — the substitution
 * question, answered from the shop's OWN shelves.
 *
 * Deliberately not from the global catalogue. "Panadol nahi hai, kya chalega?"
 * is a question about what is behind the counter right now; listing medicines
 * the pharmacy does not stock would answer a question nobody asked and bury the
 * one they did.
 */
export async function alternativesFor(
  scope: TenantScope,
  productId: Uuid,
): Promise<AlternativeProduct[]> {
  const [subject] = await scope.db
    .select({
      id: products.id,
      name: products.name,
      strength: products.strength,
      form: products.form,
      manufacturer: products.manufacturer,
      formulaText: products.formulaText,
    })
    .from(products)
    .where(scope.scopeOf(products, eq(products.id, productId)))
    .limit(1);

  if (!subject) return [];

  const key = equivalenceKey(subject);
  // No formula recorded means nothing can honestly be said about substitution.
  if (key === null) return [];

  const candidates = await scope.db
    .select({
      id: products.id,
      name: products.name,
      strength: products.strength,
      form: products.form,
      manufacturer: products.manufacturer,
      formulaText: products.formulaText,
      baseUnitName: products.baseUnitName,
    })
    .from(products)
    .where(scope.scopeOf(products, eq(products.isActive, true), ne(products.id, productId)));

  const matching = candidates.filter((row) => equivalenceKey(row) === key);
  if (matching.length === 0) return [];

  const stock = await stockForProducts(
    scope,
    matching.map((row) => row.id),
  );

  return matching.map((row) => ({
    id: row.id,
    name: row.name,
    strength: row.strength,
    form: row.form,
    manufacturer: row.manufacturer,
    stockBase: stock[row.id] ?? null,
  }));
}
