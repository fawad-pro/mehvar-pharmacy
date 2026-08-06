/**
 * The bundled catalogue is reachable from the product picker.
 *
 * WHY THIS TEST EXISTS, IN THE WORDS OF THE BUG IT MISSED
 *
 * The Add Product picker answered "Nothing in the catalogue matches" to every
 * query on every fresh install — Amoxil, Augmentin, GSK, paracetamol, all of
 * it. `global_products` was empty, because nothing in `db:setup` ever imported
 * the pack: the Windows installer did it, the developer path did not, and the
 * only reason it worked on the machine it was built on is that the pack had
 * been imported there by hand while building it.
 *
 * The existing tests all passed throughout, and that is the important part.
 * `catalog-suggestions.integration.test.ts` applies its OWN pack of invented
 * brands and then searches for them, so it proves the query works and proves
 * nothing about whether the catalogue a real user gets is ever loaded. A test
 * that supplies its own fixture cannot notice that the real supply chain is
 * broken.
 *
 * So this suite deliberately does two things the other one does not:
 *
 *   1. It uses the REAL pack — built from `seed-data.ts`, the same source the
 *      installer and `catalog:seed` build from — rather than a fixture.
 *   2. It searches for the names a pharmacist would actually type, including
 *      the exact four the bug report named.
 *
 * WHAT THIS SUITE STILL CANNOT CATCH, SAID PLAINLY
 *
 * It applies the pack itself, so it proves the bundled CONTENT is searchable
 * and would not have caught the actual regression, which was that nothing in
 * `db:setup` applied it. Claiming otherwise would repeat the mistake that
 * caused this: mistaking a green component test for a working path.
 * `tests/setup-path.test.ts` covers that half, and the two are only meaningful
 * together.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { applyCatalogPack } from '@/db/catalog-pack-queries';
import { globalCatalogSize, searchGlobalCatalog } from '@/db/catalog-queries';
import { PACK_FORMAT, readPack, type CatalogPack } from '@/domain/catalog/pack';

import { SEED_PRODUCTS } from '../../scripts/db/seed-data';
import { provisionTestTenant, type TestTenant } from '../../tests/fixtures';

const suite = process.env.DATABASE_URL ? describe : describe.skip;

/**
 * The bundled pack, assembled exactly as `catalog:build` assembles it.
 *
 * Deliberately not a copy of that logic with test data substituted: the point
 * is that THIS content, from THIS source, ends up searchable.
 */
function bundledPack(): CatalogPack {
  const result = readPack({
    format: PACK_FORMAT,
    catalogVersion: '2099.12.1',
    generatedAt: new Date().toISOString(),
    productCount: SEED_PRODUCTS.length,
    products: SEED_PRODUCTS.map((seed) => ({
      name: seed.name,
      manufacturer: seed.manufacturer,
      formulaText: seed.formula,
      form: seed.form,
      strength: seed.strength,
      packLevels: [{ name: seed.baseUnit, factor: 1 }, ...seed.packLevels],
      referenceMrpPaisa: seed.mrp,
      quality: 'verified' as const,
    })),
  });
  if (!result.ok) throw new Error(`the bundled pack is invalid: ${JSON.stringify(result.problem)}`);
  return result.pack;
}

suite('the bundled catalogue, as an operator meets it', () => {
  let tenant: TestTenant;

  beforeAll(async () => {
    tenant = await provisionTestTenant('bundled-catalog');
    await applyCatalogPack(bundledPack(), 'test:bundled');
  });

  afterAll(async () => {
    await tenant.cleanup();
  });

  it('puts the whole bundled catalogue into global_products', async () => {
    // The first thing that was false: the table was simply empty.
    expect(await globalCatalogSize()).toBeGreaterThanOrEqual(SEED_PRODUCTS.length);
  });

  /*
   * The four brands from the bug report, by name, one test each so a failure
   * says which medicine could not be found rather than "0 !== 4".
   */
  for (const brand of ['Amoxil', 'Augmentin', 'Amaryl', 'Actifed']) {
    it(`finds "${brand}" — searching a brand is the primary workflow`, async () => {
      const found = await searchGlobalCatalog(tenant.scope, brand);
      expect(
        found.length,
        `Searching "${brand}" returned nothing. Either the catalogue is not loaded or ` +
          'the search no longer matches on brand name.',
      ).toBeGreaterThan(0);
      expect(found.some((row) => row.name.toLowerCase().includes(brand.toLowerCase()))).toBe(true);
    });
  }

  for (const company of ['GSK', 'Sanofi']) {
    it(`finds medicines by manufacturer "${company}"`, async () => {
      const found = await searchGlobalCatalog(tenant.scope, company);
      expect(found.length).toBeGreaterThan(0);
    });
  }

  for (const salt of ['Paracetamol', 'Amoxicillin', 'Metformin']) {
    it(`finds medicines by salt "${salt}" — how a substitute is looked for`, async () => {
      const found = await searchGlobalCatalog(tenant.scope, salt);
      expect(found.length).toBeGreaterThan(0);
      expect(
        found.some((row) => (row.formulaText ?? '').toLowerCase().includes(salt.toLowerCase())),
      ).toBe(true);
    });
  }

  it('brings the pack structure and MRP with a picked medicine', async () => {
    // The whole reason picking from the catalogue beats typing: the operator
    // enters a price, not a pack structure.
    const [panadol] = await searchGlobalCatalog(tenant.scope, 'Panadol');
    expect(panadol).toBeDefined();
    expect(panadol?.packLevels.length).toBeGreaterThan(1);
    expect(panadol?.referenceMrpPaisa).not.toBeNull();
  });

  it('is case-insensitive and matches partial words, as typing does', async () => {
    expect((await searchGlobalCatalog(tenant.scope, 'amox')).length).toBeGreaterThan(0);
    expect((await searchGlobalCatalog(tenant.scope, 'AUGMENTIN')).length).toBeGreaterThan(0);
  });
});
