/**
 * [PCN-014] Refunds from a bill that carried a bill discount.
 *
 * The bill of the note: Panadol Rs 500 less a Rs 50 item discount, Augmentin
 * Rs 1,630 — Rs 2,080 — charged Rs 2,000. The Rs 80 falls on the lines in
 * proportion to their totals (17.31 and 62.69, in paisa by largest remainder),
 * so the lines paid 432.69 and 1,567.31.
 * A refund gives back what a line paid, never more, and a line returned in
 * parts ends at exactly what it would have refunded in one go.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { findReceipt } from '@/db/receipt-queries';
import { returnableLinesForSale } from '@/db/returns-queries';
import { threeNumbers } from '@/db/reporting-queries';
import { commitReturn } from '@/domain/sales/commit-return';
import { commitSale } from '@/domain/sales/commit-sale';
import { uuidv7, type Uuid } from '@/lib/uuid';

import {
  addOpeningStock,
  createTestProduct,
  provisionTestTenant,
  type TestTenant,
} from '../../../tests/fixtures';

const suite = process.env.DATABASE_URL ? describe : describe.skip;

const EVER = [new Date('2000-01-01'), new Date('2100-01-01')] as const;

suite('refunds from a bill with a bill discount (PCN-014)', () => {
  let tenant: TestTenant;
  let receipt = 0;
  const nextReceipt = () => `BD-${++receipt}`;

  beforeAll(async () => {
    tenant = await provisionTestTenant('bill-discount');
  });

  afterAll(async () => {
    await tenant.cleanup();
  });

  /** The note's bill: 10 Panadol at Rs 50 less Rs 50, one Augmentin at Rs 1,630, less Rs 80. */
  async function theBill(): Promise<{ saleId: Uuid; panadol: Uuid; augmentin: Uuid }> {
    const panadol = await createTestProduct(tenant.scope, `Panadol ${uuidv7().slice(-6)}`, 5_000);
    const augmentin = await createTestProduct(
      tenant.scope,
      `Augmentin ${uuidv7().slice(-6)}`,
      163_000,
    );
    await addOpeningStock(tenant.scope, panadol.id, 100);
    await addOpeningStock(tenant.scope, augmentin.id, 100);
    const saleId = uuidv7();
    const panadolLine = uuidv7();
    const augmentinLine = uuidv7();
    const sold = await commitSale(tenant.scope, {
      saleId,
      receiptNumber: nextReceipt(),
      customerId: null,
      lines: [
        {
          lineId: panadolLine,
          productId: panadol.id,
          qtyBase: 10,
          enteredUnitLevel: 'tab',
          unitPricePaisa: 5_000,
          lineDiscountPaisa: 5_000,
          priceOverridden: false,
        },
        {
          lineId: augmentinLine,
          productId: augmentin.id,
          qtyBase: 1,
          enteredUnitLevel: 'tab',
          unitPricePaisa: 163_000,
          lineDiscountPaisa: 0,
          priceOverridden: false,
        },
      ],
      invoiceDiscountPaisa: 8_000,
      cashPaisa: 200_000,
      creditPaisa: 0,
      changePaisa: 0,
      origin: 'online',
      clientSchemaVersion: 1,
      clientCommittedAt: new Date(),
    });
    expect(sold.ok).toBe(true);
    return { saleId, panadol: panadolLine, augmentin: augmentinLine };
  }

  function returnOf(saleId: Uuid, lines: { saleLineId: Uuid; qtyBase: number }[]) {
    return commitReturn(tenant.scope, {
      returnId: uuidv7(),
      saleId,
      receiptNumber: nextReceipt(),
      lines: lines.map((line) => ({ ...line, restockBatchId: null })),
      refundMethod: 'cash',
      reasonNote: null,
    });
  }

  function refunded(result: Awaited<ReturnType<typeof returnOf>>): number {
    if (!result.ok) throw new Error(`return refused: ${result.reason}`);
    return result.value.totalRefundPaisa;
  }

  it('each line carries its share of the bill discount, summing to the discount', async () => {
    const bill = await theBill();
    const lines = await returnableLinesForSale(tenant.scope, bill.saleId);
    const share = (id: Uuid) =>
      lines.find((line) => line.saleLineId === id)?.invoiceDiscountSharePaisa;
    expect(share(bill.panadol)).toBe(1_731);
    expect(share(bill.augmentin)).toBe(6_269);
  });

  it('returning the whole bill refunds exactly what was collected, and the drawer agrees', async () => {
    const before = await threeNumbers(tenant.scope, ...EVER);
    const bill = await theBill();
    const refund = refunded(
      await returnOf(bill.saleId, [
        { saleLineId: bill.panadol, qtyBase: 10 },
        { saleLineId: bill.augmentin, qtyBase: 1 },
      ]),
    );
    // Today's code refunds Rs 2,080: Rs 80 out of a drawer it never entered.
    expect(refund).toBe(200_000);
    expect((await threeNumbers(tenant.scope, ...EVER)).expectedCashPaisa).toBe(
      before.expectedCashPaisa,
    );
  });

  it('one line returned refunds what that line paid', async () => {
    const bill = await theBill();
    expect(
      refunded(await returnOf(bill.saleId, [{ saleLineId: bill.augmentin, qtyBase: 1 }])),
    ).toBe(156_731);
  });

  it('a line returned in parts refunds, in total, exactly what it paid', async () => {
    // 10 Panadol paid Rs 432.69. In parts of 3, 3, 3 and 1, rounding each
    // return alone refunds 129.80 three times and 43.26 — Rs 432.66, three
    // paisa short. Cumulatively it lands on exactly what was paid.
    const bill = await theBill();
    let total = 0;
    for (const qtyBase of [3, 3, 3, 1]) {
      total += refunded(await returnOf(bill.saleId, [{ saleLineId: bill.panadol, qtyBase }]));
    }
    expect(total).toBe(43_269);
  });

  it('a return receipt’s lines add up to its refund', async () => {
    const bill = await theBill();
    // A partial return first, so the second return's lines start part-way.
    await returnOf(bill.saleId, [{ saleLineId: bill.panadol, qtyBase: 3 }]);
    const second = await returnOf(bill.saleId, [
      { saleLineId: bill.panadol, qtyBase: 4 },
      { saleLineId: bill.augmentin, qtyBase: 1 },
    ]);
    if (!second.ok) throw new Error('refused');
    const detail = await findReceipt(tenant.scope, second.value.receiptNumber);
    const lineTotal = (detail?.lines ?? []).reduce(
      (sum, line) => sum + (line.lineAmountPaisa ?? 0),
      0,
    );
    expect(lineTotal).toBe(second.value.totalRefundPaisa);
  });
});
