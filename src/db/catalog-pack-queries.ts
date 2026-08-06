/**
 * Applying a catalogue pack.
 *
 * IDEMPOTENT ON IDENTITY, ALWAYS
 *
 * Every write here keys on `identity_key`, so importing the same pack twice
 * produces the same catalogue as importing it once. That is not a nicety: pack
 * imports happen on pharmacy machines during installation and over remote
 * support calls, and the commonest real failure is a run that is interrupted
 * halfway. "Run it again" has to be safe advice, and the only way to make it
 * safe is to make the operation repeatable rather than to track progress.
 *
 * IDENTITY ONLY — THE LINE PHASE 6 DRAWS
 *
 * This module writes `global_products` and `global_barcodes` and nothing else.
 * It never touches a tenant's products, prices, stock or links. A pack is
 * shared by every pharmacy, so anything it could write into tenant data would
 * be one pharmacy's data arriving in another's (T3).
 *
 * The consequence for the operator is the important half: importing a
 * catalogue **never changes what is on their shelves or what they charge.** It
 * changes what the software knows about medicines in general. A pharmacy's own
 * catalogue is only ever changed by the pharmacy (P8).
 *
 * Outside the tenant chokepoint on purpose — `global_products` has no
 * `tenant_id` and `TenantScope` cannot construct a query against it (ADR-2,
 * enforced at compile time by `scoped.ts`).
 */

import 'server-only';

import { desc, inArray, sql } from 'drizzle-orm';

import { database, type Database } from './client';
import { catalogVersions, globalBarcodes, globalProducts } from './schema';

import { equivalenceKey, identityKey } from '@/domain/catalog/identity';
import type { CatalogPack, PackProduct } from '@/domain/catalog/pack';
import { compareCatalogVersions } from '@/domain/catalog/pack';
import { uuidv7 } from '@/lib/uuid';

export interface AppliedCatalog {
  readonly catalogVersion: string;
  readonly productCount: number;
  readonly appliedAt: Date;
  readonly origin: string;
}

/** The newest catalogue this installation has applied, by version. */
export async function currentCatalog(): Promise<AppliedCatalog | null> {
  const rows = await database()
    .select({
      catalogVersion: catalogVersions.catalogVersion,
      productCount: catalogVersions.productCount,
      appliedAt: catalogVersions.appliedAt,
      origin: catalogVersions.origin,
    })
    .from(catalogVersions)
    .orderBy(desc(catalogVersions.appliedAt));

  if (rows.length === 0) return null;

  // Ordered by *version*, not by when it was applied: re-importing an older
  // pack after a newer one must not make the older one look current.
  return rows.reduce((newest: AppliedCatalog, row: AppliedCatalog) =>
    compareCatalogVersions(row.catalogVersion, newest.catalogVersion) > 0 ? row : newest,
  );
}

export interface ImportSummary {
  readonly catalogVersion: string;
  readonly inserted: number;
  readonly updated: number;
  readonly barcodesLinked: number;
  /** True when a pack older than the one already applied was imported anyway. */
  readonly wentBackwards: boolean;
}

/** Rows a pack turns into, with their keys computed once. */
function toRow(product: PackProduct): {
  identityKey: string;
  equivalenceKey: string | null;
  values: typeof globalProducts.$inferInsert;
} {
  const identity = {
    name: product.name.trim(),
    strength: product.strength ?? null,
    form: product.form ?? null,
    manufacturer: product.manufacturer ?? null,
    formulaText: product.formulaText ?? null,
  };
  const key = identityKey(identity);
  const equivalence = equivalenceKey(identity);

  return {
    identityKey: key,
    equivalenceKey: equivalence,
    values: {
      id: uuidv7(),
      name: identity.name,
      manufacturer: identity.manufacturer,
      formulaText: identity.formulaText,
      form: identity.form,
      strength: identity.strength,
      packLevels: [...(product.packLevels ?? [])],
      referenceMrpPaisa: product.referenceMrpPaisa ?? null,
      quality: product.quality,
      source: product.quality === 'verified' ? 'curated' : 'drap_seed',
      identityKey: key,
      equivalenceKey: equivalence,
    },
  };
}

/**
 * Applies a validated pack.
 *
 * One transaction for the whole pack. A catalogue that is half a version old
 * and half new is a state nobody can reason about, and — unlike a sale — there
 * is no operator standing over this waiting for it to commit, so there is no
 * reason to trade atomicity for responsiveness.
 */
export async function applyCatalogPack(
  pack: CatalogPack,
  origin: string,
): Promise<ImportSummary> {
  const current = await currentCatalog();
  const wentBackwards =
    current !== null && compareCatalogVersions(pack.catalogVersion, current.catalogVersion) < 0;

  const rows = pack.products.map(toRow);

  /*
   * Last one wins within a pack.
   *
   * A pack containing the same identity twice is a curation mistake, not a
   * reason to fail the import — but it must not become two rows, and Postgres
   * refuses an ON CONFLICT that touches the same key twice in one statement.
   * Collapsing here makes both problems go away, and the count of what was
   * collapsed is visible in the summary (`inserted + updated` will be short of
   * `productCount`).
   */
  const byIdentity = new Map<string, (typeof rows)[number]>();
  for (const row of rows) byIdentity.set(row.identityKey, row);
  const unique = [...byIdentity.values()];

  return database().transaction(async (tx) => {
    const existing = await tx
      .select({ identityKey: globalProducts.identityKey })
      .from(globalProducts)
      .where(
        inArray(
          globalProducts.identityKey,
          unique.map((row) => row.identityKey),
        ),
      );
    const already = new Set(existing.map((row) => row.identityKey));

    // Chunked because a pack is tens of thousands of rows and one statement
    // with that many parameters exceeds what the driver will bind.
    const CHUNK = 500;
    for (let index = 0; index < unique.length; index += CHUNK) {
      const slice = unique.slice(index, index + CHUNK);
      await tx
        .insert(globalProducts)
        .values(slice.map((row) => row.values))
        .onConflictDoUpdate({
          target: globalProducts.identityKey,
          set: {
            name: sqlExcluded('name'),
            manufacturer: sqlExcluded('manufacturer'),
            formulaText: sqlExcluded('formula_text'),
            form: sqlExcluded('form'),
            strength: sqlExcluded('strength'),
            packLevels: sqlExcluded('pack_levels'),
            referenceMrpPaisa: sqlExcluded('reference_mrp_paisa'),
            quality: sqlExcluded('quality'),
            equivalenceKey: sqlExcluded('equivalence_key'),
            updatedAt: new Date(),
          },
        });
    }

    const barcodesLinked = await linkBarcodes(tx, pack, unique);

    const inserted = unique.filter((row) => !already.has(row.identityKey)).length;
    const updated = unique.length - inserted;

    await tx.insert(catalogVersions).values({
      id: uuidv7(),
      catalogVersion: pack.catalogVersion,
      packFormat: pack.format,
      productCount: pack.productCount,
      insertedCount: inserted,
      updatedCount: updated,
      generatedAt: pack.generatedAt || null,
      origin,
    });

    return {
      catalogVersion: pack.catalogVersion,
      inserted,
      updated,
      barcodesLinked,
      wentBackwards,
    };
  });
}

/**
 * Barcodes are attached after the products exist, and are never reassigned.
 *
 * A barcode already pointing at a different product is left alone rather than
 * repointed: the existing link was made by a pharmacy scanning a real pack
 * (Phase 6 §4), which is stronger evidence than a curated guess, and silently
 * moving it would make a scanner start ringing up the wrong medicine.
 */
type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0];

async function linkBarcodes(
  tx: Transaction,
  pack: CatalogPack,
  rows: readonly { identityKey: string }[],
): Promise<number> {
  const wanted = pack.products.flatMap((product) =>
    (product.barcodes ?? []).map((entry) => ({
      identityKey: identityKey({
        name: product.name.trim(),
        strength: product.strength ?? null,
        form: product.form ?? null,
        manufacturer: product.manufacturer ?? null,
        formulaText: product.formulaText ?? null,
      }),
      barcode: entry.barcode.trim(),
      unitLevelName: entry.unitLevelName,
    })),
  );
  if (wanted.length === 0) return 0;

  const ids = await tx
    .select({ id: globalProducts.id, identityKey: globalProducts.identityKey })
    .from(globalProducts)
    .where(
      inArray(
        globalProducts.identityKey,
        rows.map((row) => row.identityKey),
      ),
    );
  const idByKey = new Map(ids.map((row) => [row.identityKey, row.id]));

  const existing = await tx
    .select({ barcode: globalBarcodes.barcode })
    .from(globalBarcodes)
    .where(
      inArray(
        globalBarcodes.barcode,
        wanted.map((entry) => entry.barcode),
      ),
    );
  const taken = new Set(existing.map((row) => row.barcode));

  const fresh = wanted
    .filter((entry) => !taken.has(entry.barcode) && idByKey.has(entry.identityKey))
    .map((entry) => ({
      id: uuidv7(),
      globalProductId: idByKey.get(entry.identityKey)!,
      barcode: entry.barcode,
      unitLevelName: entry.unitLevelName,
    }));

  if (fresh.length === 0) return 0;

  // A pack may name one barcode twice; the unique index would reject the
  // statement rather than the row, taking the whole import with it.
  const deduped = [...new Map(fresh.map((row) => [row.barcode, row])).values()];
  await tx.insert(globalBarcodes).values(deduped).onConflictDoNothing();
  return deduped.length;
}

/**
 * `excluded.<column>` — the value the conflicting insert would have written.
 *
 * Written as raw SQL because Drizzle's `set` takes values, and what is wanted
 * here is the reference Postgres exposes during an upsert. The column names are
 * literals from this module, never input.
 */
function sqlExcluded(column: string) {
  return sql.raw(`excluded."${column}"`);
}
