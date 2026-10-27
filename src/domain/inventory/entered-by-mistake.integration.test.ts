/**
 * [PCN-013] "Entered by mistake": stock typed in that never existed.
 *
 * Before this, the only way to take back opening stock typed too high was a
 * count correction, and the reports read that as stock lost — a typing
 * mistake became a fake loss in the owner's margin and write-off figures.
 * Under test: it removes the units, it is never a loss, it is never quiet,
 * and it cannot be used on stock that came on an invoice (whose money must
 * stay accounted for).
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { batchesOnHand } from '@/db/adjustment-queries';
import { batchCostLedger } from '@/db/batch-cost-queries';
import { adjustmentsInRange, reportFigures } from '@/db/reporting-queries';
import { adjustments } from '@/db/schema';
import { commitPurchase } from '@/domain/purchases/commit-purchase';
import { commitSale } from '@/domain/sales/commit-sale';
import { uuidv7, type Uuid } from '@/lib/uuid';

import {
  addOpeningStock,
  createTestProduct,
  provisionTestTenant,
  type TestTenant,
} from '../../../tests/fixtures';
import { commitAdjustment } from './commit-adjustment';
import { verifyBatches } from './rebuild';

const suite = process.env.DATABASE_URL ? describe : describe.skip;

const EVER = [new Date('2000-01-01'), new Date('2100-01-01')] as const;

suite('removing stock entered by mistake', () => {
  let tenant: TestTenant;

  beforeAll(async () => {
    tenant = await provisionTestTenant('mistake');
  });

  afterAll(async () => {
    await tenant.cleanup();
  });

  async function stocked(qty: number): Promise<{ productId: Uuid; batchId: Uuid }> {
    const product = await createTestProduct(tenant.scope, `Typed ${uuidv7().slice(-6)}`, 400);
    const batchId = await addOpeningStock(tenant.scope, product.id, qty, { unitCostPaisa: 280 });
    return { productId: product.id, batchId };
  }

  function remove(
    productId: Uuid,
    batchId: Uuid,
    qty: number,
    reason: 'entered_by_mistake' | 'count_correction',
  ) {
    return commitAdjustment(tenant.scope, {
      adjustmentId: uuidv7(),
      productId,
      batchId,
      qtyBaseDelta: -qty,
      reason,
      note: null,
    });
  }

  it('takes the units back and is not a loss — unlike a count correction', async () => {
    const before = await reportFigures(tenant.scope, ...EVER);

    const typed = await stocked(100);
    expect((await remove(typed.productId, typed.batchId, 40, 'entered_by_mistake')).ok).toBe(true);
    const after = await reportFigures(tenant.scope, ...EVER);
    expect(after.writtenOffPaisa).toBe(before.writtenOffPaisa);
    expect(after.costPaisa).toBe(before.costPaisa);

    // The same 40 units as a count correction is a loss of 40 × Rs 2.80.
    const counted = await stocked(100);
    expect((await remove(counted.productId, counted.batchId, 40, 'count_correction')).ok).toBe(
      true,
    );
    expect((await reportFigures(tenant.scope, ...EVER)).writtenOffPaisa).toBe(
      before.writtenOffPaisa + 40 * 280,
    );

    expect((await verifyBatches(tenant.scope)).ok).toBe(true);
  });

  it('is always on the owner’s exception list', async () => {
    const typed = await stocked(20);
    const removed = await remove(typed.productId, typed.batchId, 5, 'entered_by_mistake');
    if (!removed.ok) throw new Error('refused');
    const listed = await adjustmentsInRange(tenant.scope, ...EVER);
    expect(listed).toContainEqual(
      expect.objectContaining({ id: removed.value.adjustmentId, reason: 'entered_by_mistake' }),
    );
  });

  it('a used-up batch still costs exactly what it was entered at', async () => {
    // 10 typed, 4 of them never there, the other 6 sold: the sold units carry
    // the batch's cost for 6 and the mistake carries the rest, so nothing is
    // lost from the batch total and nothing invented.
    const typed = await stocked(10);
    expect((await remove(typed.productId, typed.batchId, 4, 'entered_by_mistake')).ok).toBe(true);
    const sold = await commitSale(tenant.scope, {
      saleId: uuidv7(),
      receiptNumber: `EM-${uuidv7().slice(-6)}`,
      customerId: null,
      lines: [
        {
          lineId: uuidv7(),
          productId: typed.productId,
          qtyBase: 6,
          enteredUnitLevel: 'tab',
          unitPricePaisa: 400,
          lineDiscountPaisa: 0,
          priceOverridden: false,
        },
      ],
      invoiceDiscountPaisa: 0,
      cashPaisa: 2_400,
      creditPaisa: 0,
      changePaisa: 0,
      origin: 'online',
      clientSchemaVersion: 1,
      clientCommittedAt: new Date(),
    });
    expect(sold.ok).toBe(true);

    const ledger = await batchCostLedger(tenant.scope);
    const mine = ledger.movements.filter((movement) => movement.batchId === typed.batchId);
    expect(mine.map((movement) => movement.kind).sort()).toEqual(['mistake', 'sale']);
    expect(mine.reduce((sum, movement) => sum + movement.costPaisa, 0)).toBe(10 * 280);
  });

  it('only removes: "entered by mistake" never adds stock', async () => {
    const typed = await stocked(5);
    const result = await commitAdjustment(tenant.scope, {
      adjustmentId: uuidv7(),
      productId: typed.productId,
      batchId: null,
      qtyBaseDelta: 5,
      reason: 'entered_by_mistake',
      note: null,
    });
    expect(result).toEqual({ ok: false, reason: 'reason_sign_mismatch' });
    // And the database refuses it even past the writer (Phase 9 §5.4).
    await expect(
      tenant.scope.insert(adjustments, {
        id: uuidv7(),
        productId: typed.productId,
        batchId: null,
        qtyBaseDelta: 5,
        reason: 'entered_by_mistake',
        note: null,
      }),
    ).rejects.toThrow();
  });

  it('is refused on stock that came on an invoice — correct the purchase instead', async () => {
    const product = await createTestProduct(tenant.scope, `Invoiced ${uuidv7().slice(-6)}`, 400);
    const received = await commitPurchase(tenant.scope, {
      purchaseId: uuidv7(),
      supplierId: null,
      invoiceRef: null,
      invoiceDate: null,
      note: null,
      lines: [
        {
          lineId: uuidv7(),
          productId: product.id,
          qtyBase: 30,
          bonusQtyBase: 0,
          unitCostPaisa: 280,
          expiryDate: '2030-06-30',
          batchNumber: null,
          mrpAtReceivingPaisa: null,
          priceAtReceivingPaisa: 400,
        },
      ],
    });
    expect(received.ok).toBe(true);
    const typedBatch = await addOpeningStock(tenant.scope, product.id, 10);

    const onHand = await batchesOnHand(tenant.scope, product.id);
    const invoiced = onHand.find((batch) => batch.batchId !== typedBatch);
    expect(invoiced?.enteredByHand).toBe(false);
    expect(onHand.find((batch) => batch.batchId === typedBatch)?.enteredByHand).toBe(true);

    expect(await remove(product.id, invoiced!.batchId as Uuid, 5, 'entered_by_mistake')).toEqual({
      ok: false,
      reason: 'mistake_on_purchased_stock',
    });
    expect((await remove(product.id, typedBatch, 5, 'entered_by_mistake')).ok).toBe(true);
  });
});
