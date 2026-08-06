/**
 * Applying a catalogue pack, against a real database.
 *
 * Two properties matter more than the rest, and neither can be checked without
 * Postgres because both are about what the unique index and the upsert actually
 * do:
 *
 *   1. **Re-importing is safe.** Pack imports happen during installation and on
 *      support calls, and the commonest failure is an interrupted run. "Run it
 *      again" has to be true.
 *   2. **A pack never touches tenant data.** A catalogue is shared by every
 *      pharmacy; anything it could write into a tenant's products, prices or
 *      stock would be a breach of the line Phase 6 §2 draws (T3).
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { applyCatalogPack, currentCatalog } from '@/db/catalog-pack-queries';
import {
  compareCatalogVersions,
  PACK_FORMAT,
  readPack,
  type CatalogPack,
} from '@/domain/catalog/pack';
import { uuidv7 } from '@/lib/uuid';

import { createTestProduct, provisionTestTenant, type TestTenant } from '../../tests/fixtures';

const suite = process.env.DATABASE_URL ? describe : describe.skip;

/**
 * A brand name unique to this run — the global catalogue has no tenant column
 * and is shared by every run of the suite on a given database.
 *
 * The obvious `uuidv7().slice(0, 8)` does NOT work here, which cost a debugging
 * detour worth recording: a v7 UUID opens with a 48-bit millisecond timestamp,
 * so its first 8 hex characters are the TOP 32 bits of that — a value which
 * only changes about once a minute. Two runs seconds apart produced identical
 * "unique" names, the importer correctly recognised them as the same medicine,
 * and four tests failed asserting an insert that had rightly become an update.
 *
 * The tail of a v7 is the random part, so that is what is used.
 */
function brand(label: string): string {
  return `${label} ${uuidv7().slice(-12)}`;
}

function pack(products: CatalogPack['products'], catalogVersion = '2099.01.1'): CatalogPack {
  const result = readPack({
    format: PACK_FORMAT,
    catalogVersion,
    generatedAt: new Date().toISOString(),
    productCount: products.length,
    products,
  });
  if (!result.ok) throw new Error(`test pack is invalid: ${JSON.stringify(result.problem)}`);
  return result.pack;
}

suite('applying a catalogue pack', () => {
  let tenant: TestTenant;

  beforeAll(async () => {
    tenant = await provisionTestTenant('catalog-pack');
  });

  afterAll(async () => {
    await tenant.cleanup();
  });

  it('inserts what is new and counts it honestly', async () => {
    const name = brand('Zeta');
    const summary = await applyCatalogPack(
      pack([
        {
          name,
          manufacturer: 'Test Pharma',
          formulaText: 'Testolol',
          form: 'Tablet',
          strength: '10mg',
          packLevels: [{ name: 'tab', factor: 1 }],
          quality: 'verified',
        },
      ]),
      'test',
    );

    expect(summary.inserted).toBe(1);
    expect(summary.updated).toBe(0);
  });

  it('is idempotent — the same pack twice is the same catalogue as once', async () => {
    const name = brand('Repeat');
    const twice = pack([
      {
        name,
        manufacturer: 'Test Pharma',
        formulaText: 'Repeatamol',
        form: 'Tablet',
        strength: '250mg',
        quality: 'verified',
      },
    ]);

    const first = await applyCatalogPack(twice, 'test');
    const second = await applyCatalogPack(twice, 'test');

    expect(first.inserted).toBe(1);
    // The second run updates the row it already made rather than adding one.
    expect(second.inserted).toBe(0);
    expect(second.updated).toBe(1);
  });

  it('recognises the same medicine written differently, and does not duplicate it', async () => {
    const name = brand('Sloppy');
    await applyCatalogPack(
      pack([
        {
          name,
          manufacturer: 'Getz Pharma (Pvt) Ltd',
          formulaText: 'Paracetamol',
          form: 'Tablet',
          strength: '500mg',
          quality: 'verified',
        },
      ]),
      'test',
    );

    // Same medicine: casual capitalisation, an abbreviated form, the strength
    // in grams and the company without its legal suffix.
    const again = await applyCatalogPack(
      pack([
        {
          name: name.toUpperCase(),
          manufacturer: 'GETZ PHARMA',
          formulaText: 'Paracetamol',
          form: 'tab',
          strength: '0.5g',
          quality: 'verified',
        },
      ]),
      'test',
    );

    expect(again.inserted).toBe(0);
    expect(again.updated).toBe(1);
  });

  it('keeps two brands of the same molecule apart', async () => {
    // The failure that would destroy real inventory: these are alternatives a
    // pharmacy stocks side by side, not duplicates.
    const one = brand('Alpha');
    const two = brand('Beta');
    const summary = await applyCatalogPack(
      pack([
        {
          name: one,
          manufacturer: 'First Pharma',
          formulaText: 'Sharedamol',
          form: 'Tablet',
          strength: '500mg',
          quality: 'verified',
        },
        {
          name: two,
          manufacturer: 'Second Pharma',
          formulaText: 'Sharedamol',
          form: 'Tablet',
          strength: '500mg',
          quality: 'verified',
        },
      ]),
      'test',
    );

    expect(summary.inserted).toBe(2);
  });

  it('collapses a duplicate inside one pack rather than failing the import', async () => {
    const name = brand('Twice');
    const entry = {
      name,
      manufacturer: 'Test Pharma',
      formulaText: 'Twiceamol',
      form: 'Tablet',
      strength: '5mg',
      quality: 'verified' as const,
    };

    const summary = await applyCatalogPack(pack([entry, { ...entry }]), 'test');

    expect(summary.inserted).toBe(1);
    // The shortfall against productCount is how the caller reports what was
    // collapsed, so it must be visible rather than smoothed over.
    expect(summary.inserted + summary.updated).toBe(1);
  });

  it('changes no tenant product, price or stock', async () => {
    const product = await createTestProduct(tenant.scope, brand('Shelf'), 500);
    const before = await tenant.scope.db.query.products.findFirst({
      where: (row, { eq }) => eq(row.id, product.id),
    });

    await applyCatalogPack(
      pack([
        {
          // Deliberately the same name as the tenant's own product.
          name: before!.name,
          manufacturer: 'Someone Else',
          formulaText: 'Elsewhere',
          form: 'Tablet',
          strength: '999mg',
          referenceMrpPaisa: 999_999,
          quality: 'verified',
        },
      ]),
      'test',
    );

    const after = await tenant.scope.db.query.products.findFirst({
      where: (row, { eq }) => eq(row.id, product.id),
    });

    // Importing a catalogue must never move a pharmacy's own numbers (P8).
    expect(after?.defaultPricePerBaseUnit).toBe(before?.defaultPricePerBaseUnit);
    expect(after?.currentMrpPerBaseUnit).toBe(before?.currentMrpPerBaseUnit);
    expect(after?.globalProductId).toBe(before?.globalProductId);
    expect(after?.name).toBe(before?.name);
  });

  it('reports the newest catalogue by version, not by when it was applied', async () => {
    /*
     * `catalog_versions` is global — no tenant column, by design — so it
     * accumulates across every run of this suite on a shared database. An
     * assertion like `toBe('2099.06.1')` passes once and then fails forever
     * against whatever an earlier run left behind; that is the "never assert an
     * exact global count" trap CLAUDE.md records, met in a new place.
     *
     * So the assertion is the PROPERTY rather than the value: apply a newer
     * pack, then an older one, and the older one must not become current. That
     * is history-independent, which is the only kind of true this table allows.
     */
    const newer = '2099.06.1';
    const older = '2099.05.1';

    await applyCatalogPack(pack([{ name: brand('New'), quality: 'reference' }], newer), 'test');
    await applyCatalogPack(pack([{ name: brand('Old'), quality: 'reference' }], older), 'test');

    const current = await currentCatalog();
    expect(current).not.toBeNull();
    expect(compareCatalogVersions(current!.catalogVersion, older)).toBeGreaterThan(0);
  });

  it('says when an import went backwards, without refusing it', async () => {
    await applyCatalogPack(pack([{ name: brand('Fwd'), quality: 'reference' }], '2099.09.1'), 'test');
    const back = await applyCatalogPack(
      pack([{ name: brand('Back'), quality: 'reference' }], '2099.08.1'),
      'test',
    );

    // Rolling back to a known-good catalogue is legitimate during support; the
    // tool says so rather than making someone reach for psql.
    expect(back.wentBackwards).toBe(true);
  });
});
