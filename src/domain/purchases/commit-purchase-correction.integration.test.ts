/**
 * [PCN-009] Purchase corrections and supplier returns, against Postgres.
 *
 * Pins what the plan promised: a correction or a return moves stock through the
 * guarded batch functions and the verifier still agrees; a corrected cost
 * values every unit sold from the batch, before and after the correction; what
 * the shop owes the supplier follows the corrected invoice and falls by the
 * credit for goods sent back; and the one-supplier balance and the all-supplier
 * balances (its expansion) agree — the Day 8 lesson.
 */

import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { commitPurchase, type PurchaseCommand } from '@/domain/purchases/commit-purchase';
import { commitPurchaseCorrection } from '@/domain/purchases/commit-purchase-correction';
import { commitSale, type SaleCommand } from '@/domain/sales/commit-sale';
import { commitSupplierReturn } from '@/domain/suppliers/commit-supplier-return';
import { defaultReturnCreditPaisa } from '@/domain/suppliers/supplier-return';
import {
  batchCostLedger,
  batchCostPositions,
  supplierReturnStockCosts,
} from '@/db/batch-cost-queries';
import { verifyBatches } from '@/domain/inventory/rebuild';
import { reportFigures } from '@/db/reporting-queries';
import { batches, products, purchaseCorrections, suppliers, supplierReturns } from '@/db/schema';
import { balancesBySupplier, supplierBalance } from '@/db/supplier-queries';
import { uuidv7, type Uuid } from '@/lib/uuid';

import {
  createTestProduct,
  provisionTestTenant,
  type TestProduct,
  type TestTenant,
} from '../../../tests/fixtures';

const suite = process.env.DATABASE_URL ? describe : describe.skip;

let receiptCounter = 0;
function nextReceipt(): string {
  receiptCounter += 1;
  return `C-${receiptCounter}`;
}

suite('purchase corrections and supplier returns against Postgres', () => {
  let tenant: TestTenant;
  let product: TestProduct;
  let supplierId: Uuid;

  beforeAll(async () => {
    tenant = await provisionTestTenant('corrections');
  });

  afterAll(async () => {
    await tenant.cleanup();
  });

  beforeEach(async () => {
    product = await createTestProduct(tenant.scope, `Corrected ${uuidv7().slice(-6)}`, 500);
    supplierId = uuidv7();
    await tenant.scope.insert(suppliers, {
      id: supplierId,
      name: `Distributor ${uuidv7().slice(-6)}`,
      phone: null,
    });
  });

  /** 100 units at Rs 2.80, paid Rs 100 now: Rs 180 owed. */
  async function receive(overrides: Partial<PurchaseCommand> = {}) {
    const lineId = uuidv7();
    const result = await commitPurchase(tenant.scope, {
      purchaseId: uuidv7(),
      supplierId,
      invoiceRef: null,
      invoiceDate: null,
      note: null,
      cashPaidPaisa: 10_000,
      lines: [
        {
          lineId,
          productId: product.id,
          qtyBase: 100,
          bonusQtyBase: 0,
          unitCostPaisa: 280,
          expiryDate: '2030-06-30',
          batchNumber: null,
          mrpAtReceivingPaisa: null,
          priceAtReceivingPaisa: 500,
        },
      ],
      ...overrides,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('purchase refused');
    return { lineId, batchId: result.value.batchIds[0]! };
  }

  function sale(qtyBase: number): SaleCommand {
    return {
      saleId: uuidv7(),
      receiptNumber: nextReceipt(),
      customerId: null,
      lines: [
        {
          lineId: uuidv7(),
          productId: product.id,
          qtyBase,
          enteredUnitLevel: 'tab',
          unitPricePaisa: 500,
          lineDiscountPaisa: 0,
          priceOverridden: false,
        },
      ],
      invoiceDiscountPaisa: 0,
      cashPaisa: 500 * qtyBase,
      creditPaisa: 0,
      changePaisa: 0,
      origin: 'online',
      clientSchemaVersion: 1,
      clientCommittedAt: new Date(),
    };
  }

  async function remaining(batchId: string): Promise<number | undefined> {
    const [row] = await tenant.scope.select(batches, eq(batches.id, batchId));
    return row?.qtyRemainingBase;
  }

  async function expectBalance(expected: number): Promise<void> {
    expect(await supplierBalance(tenant.scope, supplierId)).toBe(expected);
    // The expansion must agree with the figure (Day 8).
    expect((await balancesBySupplier(tenant.scope))[supplierId] ?? 0).toBe(expected);
  }

  it('a corrected cost lowers what is owed and re-values units already sold', async () => {
    const { lineId, batchId } = await receive();
    const from = new Date(Date.now() - 1_000);
    await commitSale(tenant.scope, sale(10)); // 10 sold at the mistyped cost
    await expectBalance(18_000);

    const result = await commitPurchaseCorrection(tenant.scope, {
      correctionId: uuidv7(),
      purchaseLineId: lineId as Uuid,
      qtyBase: 100,
      bonusQtyBase: 0,
      unitCostPaisa: 250,
      note: 'cost typed wrong',
    });
    expect(result.ok).toBe(true);

    // 100 × Rs 0.30 off the invoice.
    await expectBalance(15_000);
    // Stock untouched by a cost-only correction.
    expect(await remaining(batchId)).toBe(90);
    // The ten units sold before the correction now cost 250 each.
    const figures = await reportFigures(tenant.scope, from, new Date(Date.now() + 1_000));
    expect(figures.costPaisa).toBe(2_500);
    expect((await verifyBatches(tenant.scope)).ok).toBe(true);
  });

  it('a quantity correction moves the batch, the invoice and the verifier together', async () => {
    const { lineId, batchId } = await receive();
    await commitSale(tenant.scope, sale(5));

    const result = await commitPurchaseCorrection(tenant.scope, {
      correctionId: uuidv7(),
      purchaseLineId: lineId as Uuid,
      qtyBase: 90,
      bonusQtyBase: 0,
      unitCostPaisa: 280,
      note: 'ten never arrived',
    });
    expect(result.ok).toBe(true);
    expect(await remaining(batchId)).toBe(85);
    await expectBalance(18_000 - 2_800);
    expect((await verifyBatches(tenant.scope)).ok).toBe(true);
  });

  it('refuses to take off units already sold, and writes nothing', async () => {
    const { lineId, batchId } = await receive();
    await commitSale(tenant.scope, sale(95));

    const result = await commitPurchaseCorrection(tenant.scope, {
      correctionId: uuidv7(),
      purchaseLineId: lineId as Uuid,
      qtyBase: 50,
      bonusQtyBase: 0,
      unitCostPaisa: 280,
      note: 'wrong',
    });
    expect(result).toEqual({ ok: false, reason: 'more_than_on_hand' });
    expect(await remaining(batchId)).toBe(5);
    const rows = await tenant.scope.select(
      purchaseCorrections,
      eq(purchaseCorrections.purchaseLineId, lineId),
    );
    expect(rows).toEqual([]);
  });

  it('is idempotent on the client id, and computes the next correction from the last', async () => {
    const { lineId, batchId } = await receive();
    const command = {
      correctionId: uuidv7(),
      purchaseLineId: lineId as Uuid,
      qtyBase: 110,
      bonusQtyBase: 0,
      unitCostPaisa: 280,
      note: 'ten extra came',
    };
    await commitPurchaseCorrection(tenant.scope, command);
    const replay = await commitPurchaseCorrection(tenant.scope, command);
    expect(replay).toEqual({
      ok: true,
      value: { correctionId: command.correctionId, alreadyCommitted: true },
    });
    expect(await remaining(batchId)).toBe(110);

    // A second correction is a delta against the corrected line, not the original.
    await commitPurchaseCorrection(tenant.scope, {
      ...command,
      correctionId: uuidv7(),
      qtyBase: 105,
      note: 'five of the extra were for another shop',
    });
    expect(await remaining(batchId)).toBe(105);
    await expectBalance(18_000 + 1_400);
    expect((await verifyBatches(tenant.scope)).ok).toBe(true);
  });

  it('a supplier return takes the units out and the credit off what is owed', async () => {
    const { batchId } = await receive();
    const result = await commitSupplierReturn(tenant.scope, {
      returnId: uuidv7(),
      batchId: batchId as Uuid,
      qtyBase: 20,
      creditPaisa: 5_600,
      note: 'near expiry',
    });
    expect(result.ok).toBe(true);
    expect(await remaining(batchId)).toBe(80);
    await expectBalance(18_000 - 5_600);
    const [row] = await tenant.scope.select(supplierReturns, eq(supplierReturns.batchId, batchId));
    expect(row?.supplierId).toBe(supplierId);
    expect((await verifyBatches(tenant.scope)).ok).toBe(true);
  });

  it('refuses a return larger than the batch holds, or from an invoice with no supplier', async () => {
    const { batchId } = await receive();
    expect(
      await commitSupplierReturn(tenant.scope, {
        returnId: uuidv7(),
        batchId: batchId as Uuid,
        qtyBase: 101,
        creditPaisa: 0,
        note: null,
      }),
    ).toEqual({ ok: false, reason: 'more_than_on_hand' });

    const noSupplier = await receive({ supplierId: null, cashPaidPaisa: 28_000 });
    expect(
      await commitSupplierReturn(tenant.scope, {
        returnId: uuidv7(),
        batchId: noSupplier.batchId as Uuid,
        qtyBase: 1,
        creditPaisa: 0,
        note: null,
      }),
    ).toEqual({ ok: false, reason: 'no_supplier' });
    expect(await remaining(batchId)).toBe(100);
  });

  it('a return counted in strips is recorded as counted; a wrong strip size is refused (PCN-012)', async () => {
    const { batchId } = await receive();
    expect(
      await commitSupplierReturn(tenant.scope, {
        returnId: uuidv7(),
        batchId: batchId as Uuid,
        qtyBase: 5,
        creditPaisa: 0,
        note: null,
        entered: { unitKey: 'u1', unitName: 'strip', unitCount: 1 },
      }),
    ).toEqual({ ok: false, reason: 'invalid_quantity' });

    const returnId = uuidv7();
    const result = await commitSupplierReturn(tenant.scope, {
      returnId,
      batchId: batchId as Uuid,
      qtyBase: 30,
      creditPaisa: 8_400,
      note: null,
      entered: { unitKey: 'u1', unitName: 'strip', unitCount: 3 },
    });
    expect(result.ok).toBe(true);
    expect(await remaining(batchId)).toBe(70);
    const [row] = await tenant.scope.select(supplierReturns, eq(supplierReturns.id, returnId));
    expect(row).toMatchObject({ qtyBase: 30, unitKey: 'u1', unitName: 'strip', unitCount: 3 });
    expect((await verifyBatches(tenant.scope)).ok).toBe(true);
  });

  it('strips back from a box delivery: suggested credit equals the stock cost removed, and the batch still reconciles (PCN-012)', async () => {
    // 2 boxes of 10 strips of 10 tablets at Rs 640 a box, 1 box free. A box
    // added on top of the strip; the earliest expiry, so FEFO sells it first.
    await tenant.scope.update(
      products,
      {
        packLevels: [
          { name: 'strip', factor: 10 },
          { name: 'box', factor: 100 },
        ],
      },
      eq(products.id, product.id),
    );
    const { batchId } = await receive({
      cashPaidPaisa: 0,
      lines: [
        {
          lineId: uuidv7(),
          productId: product.id,
          qtyBase: 200,
          bonusQtyBase: 100,
          unitCostPaisa: 427,
          expiryDate: '2029-01-31',
          batchNumber: null,
          mrpAtReceivingPaisa: null,
          priceAtReceivingPaisa: 500,
          entered: {
            unitKey: 'u2',
            unitName: 'box',
            unitCount: 2,
            bonusUnitCount: 1,
            unitCostPaisa: 64_000,
            pricePaisa: 70_000,
          },
        },
      ],
    });
    await commitSale(tenant.scope, sale(7));

    const position = (await batchCostPositions(tenant.scope, [batchId])).get(batchId)!;
    expect(position.basis).toEqual({ totalPaisa: 128_000, receivedBase: 300 });
    expect(position.takenBase).toBe(7);
    // 3 strips: C(37) − C(7) = ⌈128,000 × 37 ÷ 300⌉ − ⌈128,000 × 7 ÷ 300⌉ = 15,787 − 2,987.
    const suggested = defaultReturnCreditPaisa(position.basis, position.takenBase, 30);
    expect(suggested).toBe(12_800);

    const returnId = uuidv7();
    const returned = await commitSupplierReturn(tenant.scope, {
      returnId,
      batchId: batchId as Uuid,
      qtyBase: 30,
      creditPaisa: suggested,
      note: 'damaged strips',
      entered: { unitKey: 'u1', unitName: 'strip', unitCount: 3 },
    });
    expect(returned.ok).toBe(true);
    expect(await remaining(batchId)).toBe(263);
    // The movement the ledger books is the suggestion, to the paisa.
    expect((await supplierReturnStockCosts(tenant.scope)).get(returnId)).toBe(suggested);

    // Selling out the rest, every paisa paid is accounted for.
    await commitSale(tenant.scope, sale(263));
    const ledger = await batchCostLedger(tenant.scope);
    const ofBatch = ledger.movements.filter((movement) => movement.batchId === batchId);
    expect(ofBatch.reduce((sum, movement) => sum + movement.costPaisa, 0)).toBe(128_000);
    expect((await verifyBatches(tenant.scope)).ok).toBe(true);
  });
});
