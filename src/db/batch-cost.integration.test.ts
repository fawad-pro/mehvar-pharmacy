/**
 * [PCN-012] Margin cost, counted cumulatively per batch, against Postgres.
 *
 * The owner's decisions: corrections restate what already left (D1), and
 * every outflow — sale, write-off, return to supplier — takes its share of the
 * batch (D2). Each test is a batch whose figures can be checked by hand.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { batchCostLedger } from '@/db/batch-cost-queries';
import { reportFigures } from '@/db/reporting-queries';
import { products } from '@/db/schema';
import { commitAdjustment } from '@/domain/inventory/commit-adjustment';
import { commitPurchase } from '@/domain/purchases/commit-purchase';
import { commitReturn } from '@/domain/sales/commit-return';
import { commitSale, type SaleCommand } from '@/domain/sales/commit-sale';
import { uuidv7, type Uuid } from '@/lib/uuid';

import { provisionTestTenant, type TestTenant } from '../../tests/fixtures';

const suite = process.env.DATABASE_URL ? describe : describe.skip;

let receiptCounter = 0;
const nextReceipt = () => `BC-${(receiptCounter += 1)}`;

suite('cumulative batch cost against Postgres (PCN-012)', () => {
  let tenant: TestTenant;
  let productId: Uuid;

  // A tenant per test: each report window then holds that test's batch only.
  beforeEach(async () => {
    tenant = await provisionTestTenant('batchcost');
    productId = uuidv7() as Uuid;
    await tenant.scope.insert(products, {
      id: productId,
      name: `Costed caps ${uuidv7().slice(-6)}`,
      baseUnitName: 'cap',
      packLevels: [{ name: 'box', factor: 14 }],
      defaultPricePerBaseUnit: 2_000,
    });
  });

  afterEach(async () => {
    await tenant.cleanup();
  });

  /** One box of 14 capsules, bought for exactly Rs 250. */
  async function receiveOneBox(): Promise<string> {
    const result = await commitPurchase(tenant.scope, {
      purchaseId: uuidv7(),
      supplierId: null,
      invoiceRef: null,
      invoiceDate: null,
      note: null,
      lines: [
        {
          lineId: uuidv7(),
          productId,
          qtyBase: 14,
          bonusQtyBase: 0,
          unitCostPaisa: 1_786,
          expiryDate: '2030-06-30',
          batchNumber: null,
          mrpAtReceivingPaisa: null,
          priceAtReceivingPaisa: 2_000,
          entered: {
            unitKey: 'u1',
            unitName: 'box',
            unitCount: 1,
            bonusUnitCount: 0,
            unitCostPaisa: 25_000,
            pricePaisa: 28_000,
          },
        },
      ],
    });
    if (!result.ok) throw new Error(`purchase refused: ${result.reason}`);
    return result.value.batchIds[0]!;
  }

  function capsules(qtyBase: number): SaleCommand {
    return {
      saleId: uuidv7(),
      receiptNumber: nextReceipt(),
      customerId: null,
      lines: [
        {
          lineId: uuidv7(),
          productId,
          qtyBase,
          enteredUnitLevel: 'cap',
          unitPricePaisa: 2_000,
          lineDiscountPaisa: 0,
          priceOverridden: false,
        },
      ],
      invoiceDiscountPaisa: 0,
      cashPaisa: 2_000 * qtyBase,
      creditPaisa: 0,
      changePaisa: 0,
      origin: 'online',
      clientSchemaVersion: 1,
      clientCommittedAt: new Date(),
    };
  }

  const window = () => ({
    from: new Date(Date.now() - 1_000),
    to: () => new Date(Date.now() + 1_000),
  });

  it('a box of 14 at Rs 250, sold one capsule at a time, costs exactly Rs 250', async () => {
    const { from, to } = window();
    await receiveOneBox();
    for (let capsule = 0; capsule < 14; capsule += 1) {
      expect((await commitSale(tenant.scope, capsules(1))).ok).toBe(true);
    }
    // Per-capsule costing gave Rs 249.90 (floored) or Rs 250.04 (rounded up).
    expect((await reportFigures(tenant.scope, from, to())).costPaisa).toBe(25_000);
  });

  it('a write-off takes its share, shown beside the margin; sales are not charged for it (D2)', async () => {
    const { from, to } = window();
    const batchId = await receiveOneBox();
    await commitSale(tenant.scope, capsules(7));
    const writeOff = await commitAdjustment(tenant.scope, {
      adjustmentId: uuidv7(),
      productId,
      qtyBaseDelta: -7,
      reason: 'expiry_writeoff',
      batchId: batchId as Uuid,
      note: 'expired on the shelf',
    });
    expect(writeOff.ok).toBe(true);

    const figures = await reportFigures(tenant.scope, from, to());
    expect(figures.costPaisa).toBe(12_500);
    expect(figures.writtenOffPaisa).toBe(12_500);
    // Every unit gone, every paisa accounted for: sold + written off = paid.
    const ledger = await batchCostLedger(tenant.scope);
    const ofBatch = ledger.movements.filter((movement) => movement.batchId === batchId);
    expect(ofBatch.reduce((sum, movement) => sum + movement.costPaisa, 0)).toBe(25_000);
  });

  it('a restocked return gives back the cost its units left with', async () => {
    const { from, to } = window();
    const batchId = await receiveOneBox();
    const sale = capsules(14);
    await commitSale(tenant.scope, sale);
    await commitReturn(tenant.scope, {
      returnId: uuidv7(),
      saleId: sale.saleId,
      receiptNumber: nextReceipt(),
      lines: [{ saleLineId: sale.lines[0]!.lineId, qtyBase: 1, restockBatchId: batchId as Uuid }],
      refundMethod: 'cash',
      reasonNote: null,
    });
    // 13 of 14 out: ⌈25,000 × 13 ÷ 14⌉ = 23,215.
    expect((await reportFigures(tenant.scope, from, to())).costPaisa).toBe(23_215);
  });

  it('never reports less than the exact share at any point while a batch sells down', async () => {
    const batchId = await receiveOneBox();
    for (const qty of [3, 5, 1, 4]) {
      await commitSale(tenant.scope, capsules(qty));
      const ledger = await batchCostLedger(tenant.scope);
      const ofBatch = ledger.movements.filter((movement) => movement.batchId === batchId);
      const taken = ofBatch.reduce((sum, movement) => sum + movement.qtyBase, 0);
      const cost = ofBatch.reduce((sum, movement) => sum + movement.costPaisa, 0);
      expect(cost * 14).toBeGreaterThanOrEqual(25_000 * taken);
    }
  });

  it('opening stock counted as boxes and capsules carries its exact cost (decision 5)', async () => {
    const { from, to } = window();
    // 2 boxes and 3 capsules on the shelf at Rs 250 a box: 31 capsules,
    // ⌈25,000 × 31 ÷ 14⌉ = 55,358 — rounded once, never per capsule.
    const opening = await commitAdjustment(tenant.scope, {
      adjustmentId: uuidv7(),
      productId,
      qtyBaseDelta: 31,
      reason: 'opening_stock',
      batchId: null,
      note: null,
      costTotalPaisa: 55_358,
      unitCostPaisa: 1_786,
      pricePerBaseUnitPaisa: 2_000,
    });
    expect(opening.ok).toBe(true);
    if (!opening.ok) return;
    const ledger = await batchCostLedger(tenant.scope);
    expect(ledger.basis.get(opening.value.batchId!)).toEqual({
      totalPaisa: 55_358,
      receivedBase: 31,
    });

    await commitSale(tenant.scope, capsules(31));
    expect((await reportFigures(tenant.scope, from, to())).costPaisa).toBe(55_358);
  });
});
