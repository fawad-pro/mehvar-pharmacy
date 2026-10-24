/**
 * [PCN-012] A product's units lock once anything is recorded against it.
 *
 * Every stored quantity is a count of the product's base unit; its pack sizes
 * say what those counts mean as strips and boxes. Changing either after stock
 * or sales exist would silently reinterpret everything already recorded
 * (Phase 9 §1), so `editProduct` refuses it — while still allowing the edits a
 * trading pharmacy needs: prices, names, and a larger pack on top.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { findProduct } from '@/db/catalog-queries';
import { commitSale } from '@/domain/sales/commit-sale';
import { products } from '@/db/schema';
import { uuidv7, type Uuid } from '@/lib/uuid';

import { addOpeningStock, provisionTestTenant, type TestTenant } from '../../../tests/fixtures';
import type { ProductDraft } from './product';
import { createProduct, editProduct } from './writers';

const suite = process.env.DATABASE_URL ? describe : describe.skip;

function draft(overrides: Partial<ProductDraft> = {}): ProductDraft {
  return {
    name: `Locked ${uuidv7().slice(-6)}`,
    globalProductId: null,
    manufacturer: null,
    form: 'Tablet',
    strength: '500mg',
    formulaText: null,
    baseUnitName: 'tab',
    packLevels: [
      { name: 'strip', factor: 10 },
      { name: 'box', factor: 100 },
    ],
    pricePaisa: 350,
    mrpPaisa: null,
    minStockBaseUnits: null,
    needsCompletion: false,
    ...overrides,
  };
}

function rejectionReasons(result: Awaited<ReturnType<typeof editProduct>>): string[] {
  return !result.ok && 'rejections' in result ? result.rejections.map((r) => r.reason) : [];
}

suite('pack structure locks once a product has history (PCN-012)', () => {
  let tenant: TestTenant;

  beforeAll(async () => {
    tenant = await provisionTestTenant('packlock');
  });

  afterAll(async () => {
    await tenant.cleanup();
  });

  async function created(overrides: Partial<ProductDraft> = {}): Promise<{
    id: Uuid;
    base: ProductDraft;
  }> {
    const base = draft(overrides);
    const result = await createProduct(tenant.scope, base);
    if (!result.ok) throw new Error(`create refused: ${JSON.stringify(result)}`);
    return { id: result.value, base };
  }

  it('a product with nothing recorded can still be restructured freely', async () => {
    const { id, base } = await created();
    const result = await editProduct(tenant.scope, id, {
      ...base,
      baseUnitName: 'capsule',
      packLevels: [{ name: 'strip', factor: 14 }],
    });
    expect(result.ok).toBe(true);
    expect((await findProduct(tenant.scope, id))?.baseUnitName).toBe('capsule');
  });

  it('once stock exists, the base unit and existing pack sizes are refused', async () => {
    const { id, base } = await created();
    await addOpeningStock(tenant.scope, id, 250);

    const newBase = await editProduct(tenant.scope, id, { ...base, baseUnitName: 'strip' });
    expect(rejectionReasons(newBase)).toEqual(['pack_structure_locked']);

    const newBox = await editProduct(tenant.scope, id, {
      ...base,
      packLevels: [
        { name: 'strip', factor: 10 },
        { name: 'box', factor: 200 },
      ],
    });
    expect(rejectionReasons(newBox)).toEqual(['pack_structure_locked']);

    const removed = await editProduct(tenant.scope, id, {
      ...base,
      packLevels: [{ name: 'strip', factor: 10 }],
    });
    expect(rejectionReasons(removed)).toEqual(['pack_structure_locked']);

    // Nothing was written by the refusals.
    const after = await findProduct(tenant.scope, id);
    expect(after?.baseUnitName).toBe('tab');
    expect(after?.packLevels).toEqual(base.packLevels);
  });

  it('a sale with no stock behind it locks the product too', async () => {
    // Sold before any stock was entered: the pending layer holds the line with
    // no batch (D2), so only the sale line records that the product traded.
    const { id, base } = await created();
    const sold = await commitSale(tenant.scope, {
      saleId: uuidv7(),
      receiptNumber: `L-${uuidv7().slice(-6)}`,
      customerId: null,
      lines: [
        {
          lineId: uuidv7(),
          productId: id,
          qtyBase: 10,
          enteredUnitLevel: 'strip',
          unitPricePaisa: 350,
          lineDiscountPaisa: 0,
          priceOverridden: false,
        },
      ],
      invoiceDiscountPaisa: 0,
      cashPaisa: 3_500,
      creditPaisa: 0,
      changePaisa: 0,
      origin: 'online',
      clientSchemaVersion: 1,
      clientCommittedAt: new Date(),
    });
    expect(sold.ok).toBe(true);

    const result = await editProduct(tenant.scope, id, {
      ...base,
      packLevels: [{ name: 'strip', factor: 14 }],
    });
    expect(rejectionReasons(result)).toEqual(['pack_structure_locked']);
  });

  it('a price edit and a larger pack on top are still allowed', async () => {
    const { id, base } = await created();
    await addOpeningStock(tenant.scope, id, 250);

    expect((await editProduct(tenant.scope, id, { ...base, pricePaisa: 400 })).ok).toBe(true);

    const carton = await editProduct(tenant.scope, id, {
      ...base,
      packLevels: [...base.packLevels, { name: 'carton', factor: 1_000 }],
    });
    expect(carton.ok).toBe(true);
    expect((await findProduct(tenant.scope, id))?.packLevels).toHaveLength(3);
  });

  it('a structure from before the nesting rule is grandfathered for unrelated edits', async () => {
    // Written as a product created before PCN-012 could be: a box of 25 over
    // a strip of 10, already trading.
    const id = uuidv7();
    await tenant.scope.insert(products, {
      id,
      name: `Legacy ${uuidv7().slice(-6)}`,
      baseUnitName: 'tab',
      packLevels: [
        { name: 'strip', factor: 10 },
        { name: 'box', factor: 25 },
      ],
      defaultPricePerBaseUnit: 350,
    });
    await addOpeningStock(tenant.scope, id, 50);

    const legacy = draft({
      packLevels: [
        { name: 'strip', factor: 10 },
        { name: 'box', factor: 25 },
      ],
    });
    expect((await editProduct(tenant.scope, id, { ...legacy, pricePaisa: 380 })).ok).toBe(true);

    // But a pack added on top must still nest in the box below it.
    const carton = await editProduct(tenant.scope, id, {
      ...legacy,
      packLevels: [...legacy.packLevels, { name: 'carton', factor: 60 }],
    });
    expect(rejectionReasons(carton)).toEqual(['pack_level_not_nested']);
  });

  it('a new product must nest from the start', async () => {
    const result = await createProduct(
      tenant.scope,
      draft({
        packLevels: [
          { name: 'strip', factor: 10 },
          { name: 'box', factor: 25 },
        ],
      }),
    );
    expect(result.ok).toBe(false);
  });

  it('prices typed per unit are stored exactly, with the rest suggested (PCN-012)', async () => {
    const { id, base } = await created({
      baseUnitName: 'cap',
      packLevels: [{ name: 'box', factor: 14 }],
      unitPrices: [null, 25_000],
    });
    const stored = await findProduct(tenant.scope, id);
    // A box of 14 at Rs 250 is Rs 250 — not 14 × a rounded capsule price.
    expect(stored?.units.map((unit) => [unit.name, unit.pricePaisa])).toEqual([
      ['cap', 1_786],
      ['box', 25_000],
    ]);
    // The legacy per-base column follows the base unit's own price.
    expect(stored?.pricePaisa).toBe(1_786);

    // Adding a carton keeps both existing prices and suggests the new one from
    // the box directly below it: ten boxes, exactly.
    const extended = await editProduct(tenant.scope, id, {
      ...base,
      packLevels: [...(base.packLevels ?? []), { name: 'carton', factor: 140 }],
      unitPrices: [1_786, 25_000, null],
    });
    expect(extended.ok).toBe(true);
    expect((await findProduct(tenant.scope, id))?.units.map((unit) => unit.pricePaisa)).toEqual([
      1_786, 25_000, 250_000,
    ]);
  });
});
