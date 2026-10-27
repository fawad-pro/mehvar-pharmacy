/**
 * [PCN-012] "Replace this product" against Postgres: stock and its exact cost
 * move to a product with the right pack, barcodes follow by unit name, and the
 * old product keeps its history. Every figure here can be checked by hand.
 */

import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { batchCostLedger } from '@/db/batch-cost-queries';
import { findBarcodeOwner, findProduct } from '@/db/catalog-queries';
import { reportFigures } from '@/db/reporting-queries';
import { adjustments, batches, products } from '@/db/schema';
import type { ProductDraft } from '@/domain/catalog/product';
import { addBarcode } from '@/domain/catalog/writers';
import { commitSale } from '@/domain/sales/commit-sale';
import { uuidv7, type Uuid } from '@/lib/uuid';

import {
  addOpeningStock,
  createTestProduct,
  provisionTestTenant,
  type TestTenant,
} from '../../../tests/fixtures';

import { verifyBatches } from './rebuild';
import { replaceProduct } from './replace-product';

const suite = process.env.DATABASE_URL ? describe : describe.skip;

suite('replaceProduct against Postgres (PCN-012)', () => {
  let tenant: TestTenant;

  beforeEach(async () => {
    tenant = await provisionTestTenant('replace');
  });

  afterEach(async () => {
    await tenant.cleanup();
  });

  /** The right pack: strips of 14 capsules, no box. */
  function rightPack(name: string): ProductDraft {
    return {
      name,
      globalProductId: null,
      manufacturer: null,
      form: 'Capsule',
      strength: null,
      formulaText: null,
      baseUnitName: 'tab',
      packLevels: [{ name: 'strip', factor: 14 }],
      pricePaisa: 0,
      unitPrices: [null, 7_000],
      mrpPaisa: null,
      minStockBaseUnits: null,
      needsCompletion: false,
    };
  }

  async function sell(productId: string, qtyBase: number): Promise<void> {
    const sold = await commitSale(tenant.scope, {
      saleId: uuidv7(),
      receiptNumber: `RP-${uuidv7().slice(-8)}`,
      customerId: null,
      lines: [
        {
          lineId: uuidv7(),
          productId,
          qtyBase,
          enteredUnitLevel: 'tab',
          unitPricePaisa: 350,
          lineDiscountPaisa: 0,
          priceOverridden: false,
        },
      ],
      invoiceDiscountPaisa: 0,
      cashPaisa: 350 * qtyBase,
      creditPaisa: 0,
      changePaisa: 0,
      origin: 'online',
      clientSchemaVersion: 1,
      clientCommittedAt: new Date(),
    });
    expect(sold.ok).toBe(true);
  }

  it('moves stock at the confirmed count with exactly the cost it still holds', async () => {
    const from = new Date(Date.now() - 1_000);
    // Set up with strips of 10 — wrong: they hold 14.
    const old = await createTestProduct(tenant.scope, `Wrongpack ${uuidv7().slice(-6)}`, 350);
    const batchId = await addOpeningStock(tenant.scope, old.id, 100, {
      unitCostPaisa: 280,
      expiryDate: '2030-03-31',
    });
    await sell(old.id, 20);
    const stripCode = `RPS${uuidv7().slice(-10)}`;
    const boxCode = `RPB${uuidv7().slice(-10)}`;
    await tenant.scope.update(
      products,
      {
        packLevels: [
          { name: 'strip', factor: 10 },
          { name: 'box', factor: 100 },
        ],
      },
      eq(products.id, old.id),
    );
    expect(
      (await addBarcode(tenant.scope, old.id, { barcode: stripCode, unitLevelName: 'strip' })).ok,
    ).toBe(true);
    expect(
      (await addBarcode(tenant.scope, old.id, { barcode: boxCode, unitLevelName: 'box' })).ok,
    ).toBe(true);

    // The shelf, counted in the right pack: 5 strips and 10 loose = 80.
    const result = await replaceProduct(tenant.scope, {
      oldProductId: old.id,
      product: rightPack(old.name),
      batches: [{ batchId, expectedRemainingBase: 80, newQtyBase: 80 }],
      note: 'strips hold 14',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const { newProductId } = result.value;

    const [oldBatch] = await tenant.scope.select(batches, eq(batches.id, batchId));
    expect(oldBatch?.qtyRemainingBase).toBe(0);
    const [newBatch] = await tenant.scope.select(batches, eq(batches.productId, newProductId));
    // 28,000 paid; 20 sold took ⌈28,000 × 20 ÷ 100⌉ = 5,600; 22,400 moves.
    expect(newBatch).toMatchObject({
      qtyRemainingBase: 80,
      qtyReceivedBase: 80,
      costTotalPaisa: 22_400,
      expiryDate: '2030-03-31',
    });

    // The old batch reconciles exactly; the move is not a write-off.
    const ledger = await batchCostLedger(tenant.scope);
    const ofOld = ledger.movements.filter((movement) => movement.batchId === batchId);
    expect(ofOld.reduce((sum, movement) => sum + movement.costPaisa, 0)).toBe(28_000);
    const figures = await reportFigures(tenant.scope, from, new Date(Date.now() + 1_000));
    expect(figures.writtenOffPaisa).toBe(0);
    expect(figures.costPaisa).toBe(5_600);

    // The old product is retired and names its replacement; its codes moved
    // by unit name, and the box code — no box now — is listed and unlinked.
    const [retired] = await tenant.scope.select(products, eq(products.id, old.id));
    expect(retired).toMatchObject({ isActive: false, replacedByProductId: newProductId });
    expect((await findBarcodeOwner(tenant.scope, stripCode))?.productId).toBe(newProductId);
    expect(await findBarcodeOwner(tenant.scope, boxCode)).toBeUndefined();
    expect(result.value.unlinkedBarcodes).toEqual([{ barcode: boxCode, unitLevelName: 'box' }]);
    expect((await findProduct(tenant.scope, newProductId))?.packLevels).toEqual([
      { name: 'strip', factor: 14 },
    ]);

    const moved = await tenant.scope.select(
      adjustments,
      eq(adjustments.reason, 'product_replaced'),
    );
    expect(moved.map((row) => row.qtyBaseDelta).sort((a, b) => a - b)).toEqual([-80, 80]);
    expect((await verifyBatches(tenant.scope)).ok).toBe(true);

    // Once only.
    expect(
      await replaceProduct(tenant.scope, {
        oldProductId: old.id,
        product: rightPack(old.name),
        batches: [],
        note: null,
      }),
    ).toMatchObject({ ok: false, reason: 'already_replaced' });
  });

  it('refuses when stock moved since the screen was drawn, and writes nothing', async () => {
    const old = await createTestProduct(tenant.scope, `Stale ${uuidv7().slice(-6)}`, 350);
    const batchId = await addOpeningStock(tenant.scope, old.id, 30);
    await sell(old.id, 2);

    const result = await replaceProduct(tenant.scope, {
      oldProductId: old.id as Uuid,
      product: rightPack(old.name),
      batches: [{ batchId, expectedRemainingBase: 30, newQtyBase: 28 }],
      note: null,
    });
    expect(result).toMatchObject({ ok: false, reason: 'stale_batches' });

    const [still] = await tenant.scope.select(products, eq(products.id, old.id));
    expect(still).toMatchObject({ isActive: true, replacedByProductId: null });
    expect(await tenant.scope.select(products, eq(products.name, old.name))).toHaveLength(1);
    const [batch] = await tenant.scope.select(batches, eq(batches.id, batchId));
    expect(batch?.qtyRemainingBase).toBe(28);
  });

  it('refuses a batch confirmed at zero — that is a write-off, recorded as one', async () => {
    const old = await createTestProduct(tenant.scope, `Zero ${uuidv7().slice(-6)}`, 350);
    const batchId = await addOpeningStock(tenant.scope, old.id, 5);
    expect(
      await replaceProduct(tenant.scope, {
        oldProductId: old.id as Uuid,
        product: rightPack(old.name),
        batches: [{ batchId, expectedRemainingBase: 5, newQtyBase: 0 }],
        note: null,
      }),
    ).toMatchObject({ ok: false, reason: 'invalid_count' });
  });
});
