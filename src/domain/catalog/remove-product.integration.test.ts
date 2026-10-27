/**
 * Removing a product entered by mistake, and putting it back.
 *
 * A soft archive (Phase 9 §1), so its history keeps counting; refused while it
 * holds stock or a shortfall (D2), because hiding either would take units out
 * of the count with no record of where they went.
 */

import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  catalogSnapshot,
  findProduct,
  listProducts,
  markProductReplaced,
} from '@/db/catalog-queries';
import { reportFigures } from '@/db/reporting-queries';
import { saleLines } from '@/db/schema';
import { commitSale } from '@/domain/sales/commit-sale';
import { uuidv7, type Uuid } from '@/lib/uuid';

import {
  addOpeningStock,
  createTestProduct,
  provisionTestTenant,
  type TestTenant,
} from '../../../tests/fixtures';
import { addBarcode, removeProduct, restoreProduct } from './writers';

const suite = process.env.DATABASE_URL ? describe : describe.skip;

const EVER = [new Date('2000-01-01'), new Date('2100-01-01')] as const;

suite('removing a product entered by mistake', () => {
  let tenant: TestTenant;

  beforeAll(async () => {
    tenant = await provisionTestTenant('remove');
  });

  afterAll(async () => {
    await tenant.cleanup();
  });

  async function product(): Promise<Uuid> {
    return (await createTestProduct(tenant.scope, `Mistake ${uuidv7().slice(-6)}`)).id;
  }

  function code(): string {
    // The random tail of a v7, never its timestamp head (CLAUDE.md, Day 10).
    return `R${uuidv7().replace(/-/g, '').slice(-11)}`;
  }

  async function sell(productId: Uuid, qtyBase: number): Promise<void> {
    const sold = await commitSale(tenant.scope, {
      saleId: uuidv7(),
      receiptNumber: `RM-${uuidv7().slice(-6)}`,
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

  it('a product with nothing recorded leaves the counter and every list', async () => {
    const id = await product();
    const since = new Date(Date.now() - 1_000);

    expect(await removeProduct(tenant.scope, id)).toEqual({ ok: true, unlinked: [] });

    expect((await findProduct(tenant.scope, id))?.isActive).toBe(false);
    const full = await catalogSnapshot(tenant.scope);
    expect(full.products.map((row) => row.id)).not.toContain(id);
    // A counter that already holds the product drops it on its next delta.
    expect((await catalogSnapshot(tenant.scope, since)).removedProductIds).toContain(id);
    expect((await listProducts(tenant.scope)).items.map((row) => row.id)).not.toContain(id);
    expect(
      (await listProducts(tenant.scope, { includeInactive: true, pageSize: 200 })).items.map(
        (row) => row.id,
      ),
    ).toContain(id);
  });

  it('its barcodes are unlinked, so the right product can take them', async () => {
    const wrong = await product();
    const right = await product();
    const barcode = code();
    expect((await addBarcode(tenant.scope, wrong, { barcode, unitLevelName: 'strip' })).ok).toBe(
      true,
    );

    const removed = await removeProduct(tenant.scope, wrong);
    expect(removed).toEqual({ ok: true, unlinked: [{ barcode, unitLevelName: 'strip' }] });
    expect((await findProduct(tenant.scope, wrong))?.barcodes).toEqual([]);

    // Before the fix this was `barcode_taken` by a product nobody could sell.
    expect((await addBarcode(tenant.scope, right, { barcode, unitLevelName: 'strip' })).ok).toBe(
      true,
    );
  });

  it('is refused while it has stock, and nothing changes', async () => {
    const id = await product();
    const barcode = code();
    await addBarcode(tenant.scope, id, { barcode, unitLevelName: 'tab' });
    await addOpeningStock(tenant.scope, id, 25);

    expect(await removeProduct(tenant.scope, id)).toEqual({
      ok: false,
      refusal: 'has_stock',
      stockBase: 25,
    });
    const after = await findProduct(tenant.scope, id);
    expect(after?.isActive).toBe(true);
    expect(after?.barcodes.map((row) => row.barcode)).toEqual([barcode]);
  });

  it('is refused while a sale is waiting for stock (D2)', async () => {
    // Sold with nothing on the shelf: no batch, so stock reads "never stocked",
    // and only the pending layer knows the shortfall exists.
    const id = await product();
    await sell(id, 4);
    expect((await findProduct(tenant.scope, id))?.stockBase).toBeNull();

    expect(await removeProduct(tenant.scope, id)).toEqual({
      ok: false,
      refusal: 'has_pending',
      pendingBase: 4,
    });
    expect((await findProduct(tenant.scope, id))?.isActive).toBe(true);
  });

  it('a product sold down to zero can go, and its sales still count', async () => {
    const id = await product();
    await addOpeningStock(tenant.scope, id, 3);
    await sell(id, 3);
    const before = await reportFigures(tenant.scope, ...EVER);

    expect((await removeProduct(tenant.scope, id)).ok).toBe(true);

    const after = await reportFigures(tenant.scope, ...EVER);
    expect(after.revenuePaisa).toBe(before.revenuePaisa);
    expect(after.costPaisa).toBe(before.costPaisa);
    const lines = await tenant.scope.select(saleLines, eq(saleLines.productId, id));
    expect(lines).toHaveLength(1);
  });

  it('removing twice changes nothing the second time', async () => {
    const id = await product();
    expect((await removeProduct(tenant.scope, id)).ok).toBe(true);
    expect(await removeProduct(tenant.scope, id)).toEqual({ ok: true, unlinked: [] });
  });

  it('restore puts it back on the counter', async () => {
    const id = await product();
    await removeProduct(tenant.scope, id);

    expect(await restoreProduct(tenant.scope, id)).toEqual({ ok: true });
    expect((await findProduct(tenant.scope, id))?.isActive).toBe(true);
    const full = await catalogSnapshot(tenant.scope);
    expect(full.products.map((row) => row.id)).toContain(id);
  });

  it('a replaced product cannot be restored: its stock lives on the replacement', async () => {
    const old = await product();
    const replacement = await product();
    expect(await markProductReplaced(tenant.scope, old, replacement)).toBe(true);

    expect(await restoreProduct(tenant.scope, old)).toEqual({ ok: false, refusal: 'replaced' });
    expect((await findProduct(tenant.scope, old))?.isActive).toBe(false);
  });

  it('a product that does not exist is named as such', async () => {
    expect(await removeProduct(tenant.scope, uuidv7())).toEqual({
      ok: false,
      refusal: 'not_found',
    });
    expect(await restoreProduct(tenant.scope, uuidv7())).toEqual({
      ok: false,
      refusal: 'not_found',
    });
  });
});
