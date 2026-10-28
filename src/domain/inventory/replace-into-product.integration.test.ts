/**
 * [PCN-013] "Move to a product I already have": stock typed against the wrong
 * product moves to the right one, which the shop already stocks.
 *
 * Under test: the stock and its exact cost arrive; the receiving product's
 * shortfalls are answered by it (D2); nothing is written off; the wrong
 * product is retired, naming where its stock went; and a move between
 * products counting different base units is refused, because the confirmed
 * counts would change meaning.
 */

import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { batchCostLedger } from '@/db/batch-cost-queries';
import { findBarcodeOwner, findProduct } from '@/db/catalog-queries';
import { pendingIncidents } from '@/db/adjustment-queries';
import { reportFigures } from '@/db/reporting-queries';
import { batches, products } from '@/db/schema';
import { addBarcode, removeProduct } from '@/domain/catalog/writers';
import { commitSale } from '@/domain/sales/commit-sale';
import { uuidv7, type Uuid } from '@/lib/uuid';

import {
  addOpeningStock,
  createTestProduct,
  provisionTestTenant,
  type TestTenant,
} from '../../../tests/fixtures';
import { verifyBatches } from './rebuild';
import { replaceIntoProduct } from './replace-product';

const suite = process.env.DATABASE_URL ? describe : describe.skip;

const EVER = [new Date('2000-01-01'), new Date('2100-01-01')] as const;

suite('replaceIntoProduct against Postgres (PCN-013)', () => {
  let tenant: TestTenant;

  beforeEach(async () => {
    tenant = await provisionTestTenant('replace-into');
  });

  afterEach(async () => {
    await tenant.cleanup();
  });

  async function sellShort(productId: Uuid, qtyBase: number): Promise<void> {
    const sold = await commitSale(tenant.scope, {
      saleId: uuidv7(),
      receiptNumber: `RI-${uuidv7().slice(-6)}`,
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

  it('moves the stock and its cost, answers the shortfall, and retires the wrong product', async () => {
    const wrong = await createTestProduct(tenant.scope, 'Panadol typed as Paracip');
    const right = await createTestProduct(tenant.scope, 'Panadol');
    const batchId = await addOpeningStock(tenant.scope, wrong.id, 30, { unitCostPaisa: 280 });
    await addBarcode(tenant.scope, wrong.id, { barcode: '8964000000017', unitLevelName: 'strip' });
    // The right product sold 5 it did not have on record.
    await sellShort(right.id, 5);
    const before = await reportFigures(tenant.scope, ...EVER);

    const result = await replaceIntoProduct(tenant.scope, {
      oldProductId: wrong.id,
      intoProductId: right.id,
      batches: [{ batchId, expectedRemainingBase: 30, newQtyBase: 30 }],
      note: 'typed under the wrong name',
    });
    expect(result).toMatchObject({
      ok: true,
      value: { newProductId: right.id, movedBatches: 1, resolvedPendingBase: 5 },
    });

    // 30 arrived, 5 of them answered the sale already made: 25 on the shelf.
    expect((await findProduct(tenant.scope, right.id))?.stockBase).toBe(25);
    expect((await findProduct(tenant.scope, wrong.id))?.stockBase).toBe(0);
    expect((await pendingIncidents(tenant.scope)).map((row) => row.productId)).not.toContain(
      right.id,
    );

    // A transfer, not a loss; and the moved batch carries exactly 30 × Rs 2.80.
    const after = await reportFigures(tenant.scope, ...EVER);
    expect(after.writtenOffPaisa).toBe(before.writtenOffPaisa);
    const [arrived] = await tenant.scope.select(batches, eq(batches.productId, right.id));
    const ledger = await batchCostLedger(tenant.scope);
    expect(ledger.basis.get(arrived!.id)?.totalPaisa).toBe(30 * 280);

    expect((await findBarcodeOwner(tenant.scope, '8964000000017'))?.productId).toBe(right.id);
    const old = await findProduct(tenant.scope, wrong.id);
    expect(old).toMatchObject({ isActive: false, replacedByProductId: right.id });
    // Retired already, so removing it changes nothing and cannot fail.
    expect((await removeProduct(tenant.scope, wrong.id)).ok).toBe(true);

    expect((await verifyBatches(tenant.scope)).ok).toBe(true);
  });

  it('is refused between products counting different base units, and nothing moves', async () => {
    const wrong = await createTestProduct(tenant.scope, 'Amoxil caps typed as tabs');
    const right = await createTestProduct(tenant.scope, 'Amoxil');
    await tenant.scope.update(products, { baseUnitName: 'capsule' }, eq(products.id, right.id));
    const batchId = await addOpeningStock(tenant.scope, wrong.id, 12);

    expect(
      await replaceIntoProduct(tenant.scope, {
        oldProductId: wrong.id,
        intoProductId: right.id,
        batches: [{ batchId, expectedRemainingBase: 12, newQtyBase: 12 }],
        note: null,
      }),
    ).toEqual({ ok: false, reason: 'base_unit_differs' });
    expect(await findProduct(tenant.scope, wrong.id)).toMatchObject({
      isActive: true,
      stockBase: 12,
      replacedByProductId: null,
    });
  });

  it('is refused into itself, a removed product, or one that does not exist', async () => {
    const wrong = await createTestProduct(tenant.scope, 'Typed twice');
    const removed = await createTestProduct(tenant.scope, 'Already removed');
    await removeProduct(tenant.scope, removed.id);
    const batchId = await addOpeningStock(tenant.scope, wrong.id, 4);
    const batches = [{ batchId, expectedRemainingBase: 4, newQtyBase: 4 }];

    for (const intoProductId of [wrong.id, removed.id, uuidv7()]) {
      expect(
        await replaceIntoProduct(tenant.scope, {
          oldProductId: wrong.id,
          intoProductId,
          batches,
          note: null,
        }),
      ).toEqual({ ok: false, reason: 'invalid_target' });
    }
    expect((await findProduct(tenant.scope, wrong.id))?.stockBase).toBe(4);
  });
});
