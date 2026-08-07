/**
 * The two queries that make the shared catalogue reachable.
 *
 * `searchGlobalCatalog` is what turns adding Panadol from nine typed fields
 * into a search and a price. `alternativesFor` answers the question a customer
 * actually asks when the brand they wanted is out.
 *
 * Both cross the tenant boundary in a controlled way — one reads the shared
 * table and cross-references the caller's own catalogue, the other stays
 * entirely inside one tenant — so both need a real database to mean anything.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { applyCatalogPack } from '@/db/catalog-pack-queries';
import { alternativesFor, searchGlobalCatalog } from '@/db/catalog-queries';
import { createProduct } from '@/domain/catalog/writers';
import { PACK_FORMAT, readPack, type CatalogPack } from '@/domain/catalog/pack';
import { uuidv7 } from '@/lib/uuid';

import { provisionTestTenant, type TestTenant } from '../../tests/fixtures';

const suite = process.env.DATABASE_URL ? describe : describe.skip;

/** The tail of a v7 is its random half — the head is a clock. */
function unique(label: string): string {
  return `${label}${uuidv7().slice(-12)}`;
}

function pack(products: CatalogPack['products']): CatalogPack {
  const result = readPack({
    format: PACK_FORMAT,
    catalogVersion: '2099.02.1',
    generatedAt: new Date().toISOString(),
    productCount: products.length,
    products,
  });
  if (!result.ok) throw new Error(JSON.stringify(result.problem));
  return result.pack;
}

suite('finding medicines to add', () => {
  let tenant: TestTenant;
  let brand: string;
  let molecule: string;
  let company: string;

  beforeAll(async () => {
    tenant = await provisionTestTenant('catalog-suggest');
    brand = unique('Zyntra');
    molecule = unique('Zyntamol');
    // Unique per run: `global_products` has no tenant column and accumulates
    // across every run of the suite, so a shared company name would put this
    // brand behind whatever earlier runs left under the same manufacturer.
    company = unique('Zyntra Pharma');

    await applyCatalogPack(
      pack([
        {
          name: brand,
          manufacturer: `${company} (Pvt) Ltd`,
          formulaText: molecule,
          form: 'Tablet',
          strength: '500mg',
          packLevels: [
            { name: 'tab', factor: 1 },
            { name: 'strip', factor: 10 },
          ],
          referenceMrpPaisa: 350,
          quality: 'verified',
        },
        {
          name: `${brand} Forte`,
          manufacturer: `${company} (Pvt) Ltd`,
          formulaText: molecule,
          form: 'Tablet',
          strength: '650mg',
          packLevels: [{ name: 'tab', factor: 1 }],
          quality: 'verified',
        },
      ]),
      'test',
    );
  });

  afterAll(async () => {
    await tenant.cleanup();
  });

  it('finds a medicine by brand, and brings its pack structure with it', async () => {
    const found = await searchGlobalCatalog(tenant.scope, brand);
    const exact = found.find((row) => row.name === brand);

    expect(exact).toBeDefined();
    // The whole point: the operator types a price, not a pack structure.
    expect(exact?.packLevels).toEqual([
      { name: 'tab', factor: 1 },
      { name: 'strip', factor: 10 },
    ]);
    expect(exact?.referenceMrpPaisa).toBe(350);
    expect(exact?.alreadyStockedId).toBeNull();
  });

  it('finds it by salt, which is how a substitute is looked for', async () => {
    const found = await searchGlobalCatalog(tenant.scope, molecule);
    expect(found.length).toBeGreaterThanOrEqual(2);
  });

  it('finds it by company', async () => {
    const found = await searchGlobalCatalog(tenant.scope, company);
    expect(found.some((row) => row.name === brand)).toBe(true);
  });

  it('says nothing until there is enough to go on', async () => {
    // One character matches most of a real catalogue; answering would be noise.
    expect(await searchGlobalCatalog(tenant.scope, 'Z')).toEqual([]);
    expect(await searchGlobalCatalog(tenant.scope, ' ')).toEqual([]);
  });

  it('marks what the shop already stocks, so it is not offered again', async () => {
    const created = await createProduct(tenant.scope, {
      name: brand,
      // Deliberately typed the way an operator would, not the way the pack
      // spells it — the check must survive casual entry.
      manufacturer: company.toUpperCase(),
      form: 'tab',
      strength: '0.5g',
      formulaText: molecule,
      baseUnitName: 'tab',
      packLevels: [{ name: 'strip', factor: 10 }],
      pricePaisa: 400,
      mrpPaisa: 350,
      minStockBaseUnits: null,
      needsCompletion: false,
      globalProductId: null,
    });
    expect(created.ok).toBe(true);

    const found = await searchGlobalCatalog(tenant.scope, brand);
    const exact = found.find((row) => row.name === brand);

    // Matched on identity rather than on the catalogue link, so a product typed
    // by hand months before the catalogue existed is still recognised.
    expect(exact?.alreadyStockedId).not.toBeNull();

    // The other strength is a different medicine and stays addable.
    const forte = found.find((row) => row.name === `${brand} Forte`);
    expect(forte?.alreadyStockedId).toBeNull();
  });
});

suite('what else could be given instead', () => {
  let tenant: TestTenant;

  beforeAll(async () => {
    tenant = await provisionTestTenant('alternatives');
  });

  afterAll(async () => {
    await tenant.cleanup();
  });

  async function add(
    name: string,
    formulaText: string | null,
    strength: string,
    form = 'Tablet',
  ): Promise<string> {
    const result = await createProduct(tenant.scope, {
      name,
      manufacturer: 'Someone',
      form,
      strength,
      formulaText,
      baseUnitName: 'tab',
      packLevels: [],
      pricePaisa: 500,
      mrpPaisa: null,
      minStockBaseUnits: null,
      needsCompletion: false,
      globalProductId: null,
    });
    if (!result.ok) throw new Error('could not create test product');
    return result.value;
  }

  it('lists another brand of the same molecule, strength and form', async () => {
    const molecule = unique('Altamol');
    const mine = await add(unique('BrandA'), molecule, '500mg');
    const other = await add(unique('BrandB'), molecule, '500mg');

    const alternatives = await alternativesFor(tenant.scope, mine);
    expect(alternatives.map((row) => row.id)).toContain(other);
  });

  it('does not list a different strength as a substitute', async () => {
    // The safety-shaped half: 500mg and 650mg are not interchangeable, and a
    // list that mixed them would be actively dangerous at a counter.
    const molecule = unique('Doseamol');
    const mine = await add(unique('BrandC'), molecule, '500mg');
    const stronger = await add(unique('BrandD'), molecule, '650mg');

    const alternatives = await alternativesFor(tenant.scope, mine);
    expect(alternatives.map((row) => row.id)).not.toContain(stronger);
  });

  it('does not list a different form as a substitute', async () => {
    const molecule = unique('Formamol');
    const tablet = await add(unique('BrandE'), molecule, '500mg', 'Tablet');
    const syrup = await add(unique('BrandF'), molecule, '500mg', 'Syrup');

    const alternatives = await alternativesFor(tenant.scope, tablet);
    expect(alternatives.map((row) => row.id)).not.toContain(syrup);
  });

  it('never lists the product itself', async () => {
    const molecule = unique('Selfamol');
    const mine = await add(unique('BrandG'), molecule, '100mg');
    const alternatives = await alternativesFor(tenant.scope, mine);
    expect(alternatives.map((row) => row.id)).not.toContain(mine);
  });

  it('says nothing when no formula is recorded, rather than guessing from the name', async () => {
    // Without the molecule there is nothing honest to say about substitution.
    const mine = await add(unique('Mystery'), null, '10mg');
    await add(unique('Mystery2'), null, '10mg');
    expect(await alternativesFor(tenant.scope, mine)).toEqual([]);
  });
});
