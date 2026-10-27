/**
 * [PCN-012] Receiving in packs: the invoice is stated in the unit it was bought
 * in, and every figure that sums it is exact.
 *
 * A box of 14 capsules at Rs 250 is the case per-base costing cannot hold:
 * 25,000 ÷ 14 is not a whole number of paisa, so ten boxes came to Rs 2,500.40
 * or Rs 2,499.00 depending on the rounding. Now the line, the batch and the
 * supplier's balance all say Rs 2,500.00.
 */

import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { insertSupplier } from '@/db/purchase-queries';
import { batches, products, purchaseLines } from '@/db/schema';
import { supplierBalance } from '@/db/supplier-queries';
import { commitPurchaseCorrection } from '@/domain/purchases/commit-purchase-correction';
import { uuidv7, type Uuid } from '@/lib/uuid';

import { provisionTestTenant, type TestTenant } from '../../../tests/fixtures';
import { commitPurchase, type PurchaseLineCommand } from './commit-purchase';

const suite = process.env.DATABASE_URL ? describe : describe.skip;

suite('receiving in packs against Postgres (PCN-012)', () => {
  let tenant: TestTenant;
  /** Capsules, in boxes of 14. */
  const productId = uuidv7();

  beforeAll(async () => {
    tenant = await provisionTestTenant('packrecv');
    await tenant.scope.insert(products, {
      id: productId,
      name: `Boxed caps ${uuidv7().slice(-6)}`,
      baseUnitName: 'cap',
      packLevels: [{ name: 'box', factor: 14 }],
      defaultPricePerBaseUnit: 2_000,
    });
  });

  afterAll(async () => {
    await tenant.cleanup();
  });

  /** "Ten boxes + one free at Rs 250, selling at Rs 280 a box." */
  function boxLine(overrides: Partial<PurchaseLineCommand> = {}): PurchaseLineCommand {
    return {
      lineId: uuidv7(),
      productId,
      qtyBase: 140,
      bonusQtyBase: 14,
      unitCostPaisa: 1_786,
      expiryDate: '2030-06-30',
      batchNumber: 'BX1',
      mrpAtReceivingPaisa: 30_000,
      priceAtReceivingPaisa: 2_000,
      entered: {
        unitKey: 'u1',
        unitName: 'box',
        unitCount: 10,
        bonusUnitCount: 1,
        unitCostPaisa: 25_000,
        pricePaisa: 28_000,
      },
      ...overrides,
    };
  }

  it('stores the line as invoiced and the batch at exactly what was paid', async () => {
    const line = boxLine();
    const result = await commitPurchase(tenant.scope, {
      purchaseId: uuidv7(),
      supplierId: null,
      invoiceRef: 'BX-1',
      invoiceDate: '2026-10-27',
      note: null,
      lines: [line],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const [stored] = await tenant.scope.select(purchaseLines, eq(purchaseLines.id, line.lineId));
    expect(stored).toMatchObject({
      unitName: 'box',
      unitCount: 10,
      bonusUnitCount: 1,
      unitCostPaisaEntered: 25_000,
      lineCostPaisa: 250_000,
      pricePaisaEntered: 28_000,
    });

    const [batch] = await tenant.scope.select(batches, eq(batches.id, result.value.batchIds[0]!));
    // Eleven boxes on the shelf, as capsules; ten boxes paid for, exactly.
    expect(batch?.qtyReceivedBase).toBe(154);
    expect(batch?.costTotalPaisa).toBe(250_000);
    // The per-capsule figure is nominal and never understates: 154 × it ≥ paid.
    expect((batch?.unitCostPaisa ?? 0) * 154).toBeGreaterThanOrEqual(250_000);
    // Each unit's price as it arrived: the box at the typed Rs 280.
    expect(batch?.pricesAtReceiving).toContainEqual({ key: 'u1', pricePaisa: 28_000 });
  });

  it('refuses a unit at a size the product does not have', async () => {
    // "10 boxes" of 10 — but this product's box holds 14.
    const line = boxLine({
      qtyBase: 100,
      bonusQtyBase: 0,
      entered: { ...boxLine().entered!, bonusUnitCount: 0 },
    });
    const result = await commitPurchase(tenant.scope, {
      purchaseId: uuidv7(),
      supplierId: null,
      invoiceRef: null,
      invoiceDate: null,
      note: null,
      lines: [line],
    });
    expect(result).toEqual({ ok: false, reason: 'invalid_unit', lineId: line.lineId });
  });

  it('owes the supplier the invoice to the paisa, and a box correction moves it exactly', async () => {
    const supplierId = uuidv7() as Uuid;
    await insertSupplier(tenant.scope, { id: supplierId, name: 'Box Distributor', phone: null });
    const line = boxLine();
    const received = await commitPurchase(tenant.scope, {
      purchaseId: uuidv7(),
      supplierId,
      invoiceRef: 'BX-2',
      invoiceDate: '2026-10-27',
      note: null,
      cashPaidPaisa: 0,
      lines: [line],
    });
    expect(received.ok).toBe(true);
    expect(await supplierBalance(tenant.scope, supplierId)).toBe(250_000);

    // The box was Rs 230, not Rs 250: Rs 200 less owed, not 140 × a rounded
    // per-capsule difference.
    const corrected = await commitPurchaseCorrection(tenant.scope, {
      correctionId: uuidv7(),
      purchaseLineId: line.lineId,
      qtyBase: 140,
      bonusQtyBase: 14,
      unitCostPaisa: 23_000,
      note: 'box price typed wrong',
    });
    expect(corrected.ok).toBe(true);
    expect(await supplierBalance(tenant.scope, supplierId)).toBe(230_000);
  });
});
