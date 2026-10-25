/**
 * A barcode belongs to one product — never silently to a second.
 *
 * The owner's rule for the quick item that now keeps its scanned code: when the
 * code is already on another product, the new product is created without it,
 * and the code keeps resolving to its owner. "Already on" means under any form
 * the counter treats as the same item (`barcodeKeys`): a pack's GS1 string, its
 * GTIN-14 and the box's EAN-13 are one code.
 */

import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { findBarcodeOwner } from '@/db/catalog-queries';
import { productBarcodes } from '@/db/schema';
import { uuidv7, type Uuid } from '@/lib/uuid';

import { provisionTestTenant, type TestTenant } from '../../../tests/fixtures';
import { addBarcode, createProduct, createQuickItem } from './writers';

const suite = process.env.DATABASE_URL ? describe : describe.skip;

/** A GTIN-13 in GS1's restricted range (20–29), unique per call, valid check digit. */
function freshEan13(): string {
  const body = `2${String(Date.now()).slice(-8)}${String(Math.floor(Math.random() * 1000)).padStart(3, '0')}`;
  let sum = 0;
  for (let i = 0; i < 12; i += 1) {
    sum += Number(body[i]) * (i % 2 === 0 ? 1 : 3);
  }
  return `${body}${(10 - (sum % 10)) % 10}`;
}

/** The pack's 2D code for that item: (01) GTIN-14, (17) expiry, (10) batch. */
function packCode(ean13: string): string {
  return `010${ean13}17300131` + '10LOT9';
}

suite('barcode ownership against Postgres', () => {
  let tenant: TestTenant;

  beforeAll(async () => {
    tenant = await provisionTestTenant('barcodes');
  });

  afterAll(async () => {
    await tenant.cleanup();
  });

  async function product(name: string): Promise<Uuid> {
    const result = await createProduct(tenant.scope, {
      name: `${name} ${uuidv7().slice(-6)}`,
      globalProductId: null,
      manufacturer: null,
      form: null,
      strength: null,
      formulaText: null,
      baseUnitName: 'tab',
      packLevels: [{ name: 'box', factor: 10 }],
      pricePaisa: 100,
      mrpPaisa: null,
      minStockBaseUnits: null,
      needsCompletion: false,
    });
    if (!result.ok) throw new Error('could not create the test product');
    return result.value;
  }

  async function codesOf(productId: string): Promise<string[]> {
    const rows = await tenant.scope.select(
      productBarcodes,
      eq(productBarcodes.productId, productId),
    );
    return rows.map((row) => row.barcode);
  }

  it('a quick item added from a scan keeps the code, saved as its GTIN', async () => {
    const ean = freshEan13();
    const id = uuidv7();
    const result = await createQuickItem(tenant.scope, {
      id,
      name: 'Scanned quick item',
      pricePaisa: 500,
      baseUnitName: 'item',
      barcode: packCode(ean),
    });

    expect(result.ok).toBe(true);
    expect(await codesOf(id)).toEqual([`0${ean}`]);
    // The box's EAN and the pack's 2D code both find it.
    expect((await findBarcodeOwner(tenant.scope, ean))?.productId).toBe(id);
    expect((await findBarcodeOwner(tenant.scope, packCode(ean)))?.productId).toBe(id);
  });

  it('a code already on another product is not attached to the new quick item', async () => {
    const ean = freshEan13();
    const owner = await product('Owner');
    expect((await addBarcode(tenant.scope, owner, { barcode: ean, unitLevelName: 'box' })).ok).toBe(
      true,
    );

    const id = uuidv7();
    const result = await createQuickItem(tenant.scope, {
      id,
      name: 'Would-be duplicate',
      pricePaisa: 500,
      baseUnitName: 'item',
      barcode: packCode(ean),
    });

    // The item exists (a sale may depend on it) — without the code.
    expect(result.ok).toBe(true);
    expect(await codesOf(id)).toEqual([]);
    expect((await findBarcodeOwner(tenant.scope, packCode(ean)))?.productId).toBe(owner);
  });

  it('a replayed quick item creates nothing twice, code included', async () => {
    const ean = freshEan13();
    const command = {
      id: uuidv7(),
      name: 'Replayed',
      pricePaisa: 500,
      baseUnitName: 'item',
      barcode: ean,
    };
    await createQuickItem(tenant.scope, command);
    await createQuickItem(tenant.scope, command);
    expect(await codesOf(command.id)).toEqual([ean]);
  });

  it('linking refuses a code another product owns under an equivalent form, naming it', async () => {
    const ean = freshEan13();
    const owner = await product('Box code owner');
    await addBarcode(tenant.scope, owner, { barcode: ean, unitLevelName: 'box' });

    const other = await product('Other');
    const refused = await addBarcode(tenant.scope, other, {
      barcode: packCode(ean),
      unitLevelName: 'box',
    });
    expect(refused).toMatchObject({ ok: false, conflict: 'barcode_taken' });
    expect(await codesOf(other)).toEqual([]);
  });
});
