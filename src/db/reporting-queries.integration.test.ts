/**
 * The three numbers (W10, W11) — the query this day exists to get right, so
 * it gets its own arithmetic test against a real database rather than trust
 * that the SQL reads correctly.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { commitAdjustment } from '@/domain/inventory/commit-adjustment';
import { commitCashMovement } from '@/domain/cash/commit-cash-movement';
import { commitReturn, type ReturnCommand } from '@/domain/sales/commit-return';
import { commitSale, type SaleCommand } from '@/domain/sales/commit-sale';
import { commitSettlement } from '@/domain/udhaar/commit-settlement';
import { expiredStockSoldInRange, reportFigures, threeNumbers } from '@/db/reporting-queries';
import { uuidv7 } from '@/lib/uuid';

import {
  addOpeningStock,
  createTestCustomer,
  createTestProduct,
  provisionTestTenant,
  type TestTenant,
} from '../../tests/fixtures';

const suite = process.env.DATABASE_URL ? describe : describe.skip;

let receiptCounter = 0;
function nextReceipt(): string {
  receiptCounter += 1;
  return `T-${receiptCounter}`;
}

suite('threeNumbers against Postgres', () => {
  let tenant: TestTenant;

  beforeAll(async () => {
    tenant = await provisionTestTenant('three-numbers');
  });

  afterAll(async () => {
    await tenant.cleanup();
  });

  it('adds a cash sale to sales and to expected cash, and leaves udhaar untouched', async () => {
    const product = await createTestProduct(tenant.scope, `Three ${uuidv7().slice(0, 6)}`, 500);
    await addOpeningStock(tenant.scope, product.id, 50, { pricePaisa: 500 });

    const from = new Date();

    const command: SaleCommand = {
      saleId: uuidv7(),
      receiptNumber: nextReceipt(),
      customerId: null,
      lines: [
        {
          lineId: uuidv7(),
          productId: product.id,
          qtyBase: 4,
          enteredUnitLevel: 'tab',
          unitPricePaisa: 500,
          lineDiscountPaisa: 0,
          priceOverridden: false,
        },
      ],
      invoiceDiscountPaisa: 0,
      cashPaisa: 2_000,
      creditPaisa: 0,
      changePaisa: 0,
      origin: 'online',
      clientSchemaVersion: 1,
      clientCommittedAt: new Date(),
    };
    await commitSale(tenant.scope, command);

    const to = new Date(Date.now() + 60_000);
    const numbers = await threeNumbers(tenant.scope, from, to);
    expect(numbers.salesPaisa).toBe(2_000);
    expect(numbers.expectedCashPaisa).toBe(2_000);
    expect(numbers.udhaarOwedPaisa).toBe(0);
  });

  it('an udhaar sale adds to sales and to the running udhaar total, but not to expected cash', async () => {
    const product = await createTestProduct(tenant.scope, `Udhaar ${uuidv7().slice(0, 6)}`, 500);
    await addOpeningStock(tenant.scope, product.id, 50, { pricePaisa: 500 });
    const customerId = await createTestCustomer(tenant.scope, 'Credit Customer');

    const from = new Date();

    await commitSale(tenant.scope, {
      saleId: uuidv7(),
      receiptNumber: nextReceipt(),
      customerId,
      lines: [
        {
          lineId: uuidv7(),
          productId: product.id,
          qtyBase: 6,
          enteredUnitLevel: 'tab',
          unitPricePaisa: 500,
          lineDiscountPaisa: 0,
          priceOverridden: false,
        },
      ],
      invoiceDiscountPaisa: 0,
      cashPaisa: 0,
      creditPaisa: 3_000,
      changePaisa: 0,
      origin: 'online',
      clientSchemaVersion: 1,
      clientCommittedAt: new Date(),
    });

    const to = new Date(Date.now() + 60_000);
    const numbers = await threeNumbers(tenant.scope, from, to);
    expect(numbers.salesPaisa).toBe(3_000);
    expect(numbers.expectedCashPaisa).toBe(0);
    expect(numbers.udhaarOwedPaisa).toBe(3_000);
  });

  it('a cash return reduces expected cash without touching udhaar', async () => {
    const product = await createTestProduct(tenant.scope, `Refund ${uuidv7().slice(0, 6)}`, 500);
    const batchId = await addOpeningStock(tenant.scope, product.id, 50, { pricePaisa: 500 });

    const from = new Date();
    // The udhaar total is a running, all-time figure by design (not windowed
    // like the other two) — captured before this test's own activity so the
    // assertion checks the *delta* rather than assuming a clean slate on a
    // tenant this suite shares across tests.
    const udhaarBefore = (await threeNumbers(tenant.scope, from, new Date(Date.now() + 60_000)))
      .udhaarOwedPaisa;
    const saleId = uuidv7();
    const lineId = uuidv7();
    await commitSale(tenant.scope, {
      saleId,
      receiptNumber: nextReceipt(),
      customerId: null,
      lines: [
        {
          lineId,
          productId: product.id,
          qtyBase: 5,
          enteredUnitLevel: 'tab',
          unitPricePaisa: 500,
          lineDiscountPaisa: 0,
          priceOverridden: false,
        },
      ],
      invoiceDiscountPaisa: 0,
      cashPaisa: 2_500,
      creditPaisa: 0,
      changePaisa: 0,
      origin: 'online',
      clientSchemaVersion: 1,
      clientCommittedAt: new Date(),
    });

    const returnCommand: ReturnCommand = {
      returnId: uuidv7(),
      saleId,
      receiptNumber: nextReceipt(),
      lines: [{ saleLineId: lineId, qtyBase: 2, restockBatchId: batchId }],
      refundMethod: 'cash',
      reasonNote: null,
    };
    await commitReturn(tenant.scope, returnCommand);

    const to = new Date(Date.now() + 60_000);
    const numbers = await threeNumbers(tenant.scope, from, to);
    // Sold 2,500, refunded 1,000 cash — expected cash reflects the net.
    expect(numbers.expectedCashPaisa).toBe(1_500);
    expect(numbers.udhaarOwedPaisa).toBe(udhaarBefore);
  });

  it('opening float and a withdrawal move expected cash without touching sales', async () => {
    const from = new Date();

    await commitCashMovement(tenant.scope, {
      movementId: uuidv7(),
      direction: 'in',
      amountPaisa: 5_000,
      reason: 'opening_float',
      note: null,
    });
    await commitCashMovement(tenant.scope, {
      movementId: uuidv7(),
      direction: 'out',
      amountPaisa: 1_200,
      reason: 'owner_withdrawal',
      note: null,
    });

    const to = new Date(Date.now() + 60_000);
    const numbers = await threeNumbers(tenant.scope, from, to);
    expect(numbers.salesPaisa).toBe(0);
    expect(numbers.expectedCashPaisa).toBe(3_800);
  });

  /**
   * The reported bug, at the level it actually lived.
   *
   * One customer owes; another has paid ahead. Netted across the book — which
   * is what the old global subtraction did — this reads as a *negative* amount
   * owed to the shop, and the screen printed "TOTAL OWED TO YOU -Rs 100.00".
   * The customers list, which had always floored per customer before summing,
   * reported the debt at the same moment. Both derived from the same records.
   */
  it('never nets one customer’s advance against another customer’s debt', async () => {
    const product = await createTestProduct(tenant.scope, `Book ${uuidv7().slice(0, 6)}`, 500);
    await addOpeningStock(tenant.scope, product.id, 50, { pricePaisa: 500 });

    const debtor = await createTestCustomer(tenant.scope, `Debtor ${uuidv7().slice(0, 6)}`);
    const overpayer = await createTestCustomer(tenant.scope, `Ahead ${uuidv7().slice(0, 6)}`);

    const from = new Date();
    const before = await threeNumbers(tenant.scope, from, new Date(Date.now() + 60_000));

    // One customer takes Rs 20 on udhaar.
    await commitSale(tenant.scope, {
      saleId: uuidv7(),
      receiptNumber: nextReceipt(),
      customerId: debtor,
      lines: [
        {
          lineId: uuidv7(),
          productId: product.id,
          qtyBase: 4,
          enteredUnitLevel: 'tab',
          unitPricePaisa: 500,
          lineDiscountPaisa: 0,
          priceOverridden: false,
        },
      ],
      invoiceDiscountPaisa: 0,
      cashPaisa: 0,
      creditPaisa: 2_000,
      changePaisa: 0,
      origin: 'online',
      clientSchemaVersion: 1,
      clientCommittedAt: new Date(),
    });

    // Another pays Rs 100 having owed nothing — legal under W3, and the exact
    // act that produced the negative figure.
    await commitSettlement(tenant.scope, {
      paymentId: uuidv7(),
      receiptNumber: nextReceipt(),
      customerId: overpayer,
      amountPaisa: 10_000,
      origin: 'online',
      clientSchemaVersion: 1,
      clientCommittedAt: new Date(),
    });

    const after = await threeNumbers(tenant.scope, from, new Date(Date.now() + 60_000));

    // The debt is reported in full. Netted, this would have been -8,000.
    expect(after.udhaarOwedPaisa - before.udhaarOwedPaisa).toBe(2_000);
    expect(after.udhaarOwedPaisa).toBeGreaterThanOrEqual(0);

    // And the advance is reported separately rather than silently cancelling it.
    expect(after.udhaarCreditPaisa - before.udhaarCreditPaisa).toBe(10_000);
  });

  /**
   * Day 6 wrote the rule: "a reported margin is never better than the real one."
   * The margin figure was breaking it.
   *
   * `commitReturn` correctly touches neither the sale nor its allocations
   * (ADR-1), so a refunded sale used to keep contributing its full revenue AND
   * its full cost to the report forever. Since a sale earns more revenue than it
   * costs, dropping the returned portion removes more revenue than cost — so the
   * gross figure was strictly optimistic, which is the one direction this
   * project has said a margin must never err in.
   */
  it('subtracts a return from revenue and from cost, so margin never flatters', async () => {
    const product = await createTestProduct(tenant.scope, `Margin ${uuidv7().slice(0, 6)}`, 1_000);
    // Costs 400 a unit, sells at 1,000 — 600 of margin per unit.
    const batchId = await addOpeningStock(tenant.scope, product.id, 100, {
      pricePaisa: 1_000,
      unitCostPaisa: 400,
    });

    const from = new Date();
    const saleId = uuidv7();
    const lineId = uuidv7();
    await commitSale(tenant.scope, {
      saleId,
      receiptNumber: nextReceipt(),
      customerId: null,
      lines: [
        {
          lineId,
          productId: product.id,
          qtyBase: 10,
          enteredUnitLevel: 'tab',
          unitPricePaisa: 1_000,
          lineDiscountPaisa: 0,
          priceOverridden: false,
        },
      ],
      invoiceDiscountPaisa: 0,
      cashPaisa: 10_000,
      creditPaisa: 0,
      changePaisa: 0,
      origin: 'online',
      clientSchemaVersion: 1,
      clientCommittedAt: new Date(),
    });

    const sold = await reportFigures(tenant.scope, from, new Date(Date.now() + 60_000));
    expect(sold.revenuePaisa).toBe(10_000);
    expect(sold.costPaisa).toBe(4_000);
    expect(sold.marginPaisa).toBe(6_000);

    // Four units come back: 4,000 of revenue and 1,600 of cost reversed.
    await commitReturn(tenant.scope, {
      returnId: uuidv7(),
      saleId,
      receiptNumber: nextReceipt(),
      lines: [{ saleLineId: lineId, qtyBase: 4, restockBatchId: batchId }],
      refundMethod: 'cash',
      reasonNote: null,
    });

    const after = await reportFigures(tenant.scope, from, new Date(Date.now() + 60_000));
    expect(after.returnedPaisa).toBe(4_000);
    expect(after.revenuePaisa).toBe(6_000);
    expect(after.costPaisa).toBe(2_400);

    // Six units really sold at 600 margin each. Gross would have said 6,000.
    expect(after.marginPaisa).toBe(3_600);
    expect(after.marginPaisa).toBeLessThan(sold.marginPaisa);
  });

  it('a count correction leaves the three numbers untouched — stock, not money', async () => {
    const product = await createTestProduct(tenant.scope, `Counted ${uuidv7().slice(0, 6)}`, 500);
    const from = new Date();

    await commitAdjustment(tenant.scope, {
      adjustmentId: uuidv7(),
      productId: product.id,
      qtyBaseDelta: 20,
      reason: 'opening_stock',
      batchId: null,
      note: null,
      unitCostPaisa: 250,
      pricePerBaseUnitPaisa: 500,
    });

    const to = new Date(Date.now() + 60_000);
    const numbers = await threeNumbers(tenant.scope, from, to);
    expect(numbers.salesPaisa).toBe(0);
    expect(numbers.expectedCashPaisa).toBe(0);
  });
});

suite('expiredStockSoldInRange against Postgres (PCN-008)', () => {
  let tenant: TestTenant;

  beforeAll(async () => {
    tenant = await provisionTestTenant('expired-sold');
  });

  afterAll(async () => {
    await tenant.cleanup();
  });

  function sale(productId: string, qtyBase: number): SaleCommand {
    return {
      saleId: uuidv7(),
      receiptNumber: nextReceipt(),
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
    };
  }

  it('lists only the units that came from an expired batch, naming its expiry', async () => {
    const product = await createTestProduct(tenant.scope, `Expired ${uuidv7().slice(-6)}`);
    await addOpeningStock(tenant.scope, product.id, 4, { expiryDate: '2030-01-01' });
    await addOpeningStock(tenant.scope, product.id, 20, { expiryDate: '2020-01-01' });
    const from = new Date(Date.now() - 1_000);

    // Four from the good batch, then six from the expired one.
    await commitSale(tenant.scope, sale(product.id, 10));

    const rows = (
      await expiredStockSoldInRange(tenant.scope, from, new Date(Date.now() + 1_000))
    ).filter((row) => row.productName === product.name);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.qtyBase).toBe(6);
    expect(rows[0]?.expiryDate).toBe('2020-01-01');
  });

  it('lists nothing for a sale met entirely from unexpired stock', async () => {
    const product = await createTestProduct(tenant.scope, `Fresh ${uuidv7().slice(-6)}`);
    await addOpeningStock(tenant.scope, product.id, 20, { expiryDate: '2030-01-01' });
    await addOpeningStock(tenant.scope, product.id, 20, { expiryDate: '2020-01-01' });
    const from = new Date(Date.now() - 1_000);

    await commitSale(tenant.scope, sale(product.id, 10));

    const rows = (
      await expiredStockSoldInRange(tenant.scope, from, new Date(Date.now() + 1_000))
    ).filter((row) => row.productName === product.name);
    expect(rows).toEqual([]);
  });
});
