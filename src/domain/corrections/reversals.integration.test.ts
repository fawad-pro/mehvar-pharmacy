/**
 * [PCN-013] Cancelling a payment or cash entry typed wrong.
 *
 * The money rule: after a cancellation every figure is what it would have been
 * had the entry never been typed — the customer's balance, what is owed a
 * supplier, the drawer's expected cash — while both rows stay on record, each
 * naming the other. And a balance still expands into rows that sum to it
 * (Day 8): a cancellation is a term in the ledger, never a gap in it.
 */

import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { insertCashMovement } from '@/db/cash-queries';
import { findReceipt, listReceipts } from '@/db/receipt-queries';
import {
  cashMovementsExceptionInRange,
  hasOpeningFloat,
  paymentReversalsInRange,
  threeNumbers,
} from '@/db/reporting-queries';
import { customers, payments, suppliers } from '@/db/schema';
import { supplierBalance, supplierLedger } from '@/db/supplier-queries';
import { customerBalance, customerLedger } from '@/db/udhaar-queries';
import { commitCashMovement } from '@/domain/cash/commit-cash-movement';
import { commitCashReversal } from '@/domain/cash/commit-cash-reversal';
import { commitPurchase } from '@/domain/purchases/commit-purchase';
import { commitSale } from '@/domain/sales/commit-sale';
import { commitSupplierPayment } from '@/domain/suppliers/commit-supplier-payment';
import { commitSupplierPaymentReversal } from '@/domain/suppliers/commit-supplier-payment-reversal';
import { commitPaymentReversal } from '@/domain/udhaar/commit-payment-reversal';
import { commitSettlement } from '@/domain/udhaar/commit-settlement';
import { uuidv7, type Uuid } from '@/lib/uuid';

import {
  addOpeningStock,
  createTestProduct,
  provisionTestTenant,
  type TestProduct,
  type TestTenant,
} from '../../../tests/fixtures';

const suite = process.env.DATABASE_URL ? describe : describe.skip;

const EVER = [new Date('2000-01-01'), new Date('2100-01-01')] as const;

suite('cancelling payments and cash entries', () => {
  let tenant: TestTenant;
  let product: TestProduct;
  let receipt = 0;
  const nextReceipt = () => `RV-${++receipt}`;

  beforeAll(async () => {
    tenant = await provisionTestTenant('reversal');
    product = await createTestProduct(tenant.scope, `Reversal item ${uuidv7().slice(-6)}`, 100);
    await addOpeningStock(tenant.scope, product.id, 10_000);
  });

  afterAll(async () => {
    await tenant.cleanup();
  });

  async function customerOwing(units: number): Promise<Uuid> {
    const id = uuidv7();
    await tenant.scope.insert(customers, { id, name: `Cust ${id.slice(-6)}`, phone: null });
    const sold = await commitSale(tenant.scope, {
      saleId: uuidv7(),
      receiptNumber: nextReceipt(),
      customerId: id,
      lines: [
        {
          lineId: uuidv7(),
          productId: product.id,
          qtyBase: units,
          enteredUnitLevel: 'tab',
          unitPricePaisa: 100,
          lineDiscountPaisa: 0,
          priceOverridden: false,
        },
      ],
      invoiceDiscountPaisa: 0,
      cashPaisa: 0,
      creditPaisa: 100 * units,
      changePaisa: 0,
      origin: 'online',
      clientSchemaVersion: 1,
      clientCommittedAt: new Date(),
    });
    expect(sold.ok).toBe(true);
    return id;
  }

  async function settle(customerId: Uuid, amountPaisa: number) {
    const paymentId = uuidv7();
    const receiptNumber = nextReceipt();
    const paid = await commitSettlement(tenant.scope, {
      paymentId,
      receiptNumber,
      customerId,
      amountPaisa,
      origin: 'online',
      clientSchemaVersion: 1,
      clientCommittedAt: new Date(),
    });
    expect(paid.ok).toBe(true);
    return { paymentId, receiptNumber };
  }

  function cancelPayment(paymentId: Uuid, reversalId: Uuid = uuidv7()) {
    return commitPaymentReversal(tenant.scope, {
      reversalId,
      paymentId,
      receiptNumber: nextReceipt(),
      clientCommittedAt: new Date(),
    });
  }

  describe('an udhaar payment', () => {
    it('a payment typed wrong is cancelled, and the balance is as if it never happened', async () => {
      const customerId = await customerOwing(60); // owes Rs 60.00
      const before = await threeNumbers(tenant.scope, ...EVER);
      const wrong = await settle(customerId, 5_000); // Rs 50 typed, Rs 5 handed over
      expect(await customerBalance(tenant.scope, customerId)).toBe(1_000);

      const cancelled = await cancelPayment(wrong.paymentId);
      expect(cancelled.ok).toBe(true);
      if (!cancelled.ok) return;
      expect(cancelled.value.againstReceiptNumber).toBe(wrong.receiptNumber);
      // The slip's mini-statement: before → the amount coming back → after.
      expect(cancelled.value.statement).toEqual({
        previousBalancePaisa: 1_000,
        amountPaisa: 5_000,
        newBalancePaisa: 6_000,
      });

      expect(await customerBalance(tenant.scope, customerId)).toBe(6_000);
      const after = await threeNumbers(tenant.scope, ...EVER);
      expect(after.expectedCashPaisa).toBe(before.expectedCashPaisa);
    });

    it('the ledger shows both halves and still sums to the balance', async () => {
      const customerId = await customerOwing(30);
      const wrong = await settle(customerId, 2_000);
      const cancelled = await cancelPayment(wrong.paymentId);
      expect(cancelled.ok).toBe(true);
      await settle(customerId, 500);

      const ledger = await customerLedger(tenant.scope, customerId);
      expect(ledger.map((row) => [row.kind, row.amountPaisa])).toEqual([
        ['sale', 3_000],
        ['payment', -2_000],
        ['payment_reversal', 2_000],
        ['payment', -500],
      ]);
      expect(ledger[1]).toMatchObject({ reversed: true });
      expect(ledger[2]).toMatchObject({ againstReceiptNumber: wrong.receiptNumber });
      expect(ledger[3]).toMatchObject({ reversed: false });
      const sum = ledger.reduce((total, row) => total + row.amountPaisa, 0);
      expect(sum).toBe(await customerBalance(tenant.scope, customerId));
      expect(sum).toBe(2_500);
    });

    it('is cancelled once, a cancellation is never cancelled, and replays are harmless', async () => {
      const customerId = await customerOwing(10);
      const wrong = await settle(customerId, 400);
      const reversalId = uuidv7();
      expect((await cancelPayment(wrong.paymentId, reversalId)).ok).toBe(true);

      const replay = await cancelPayment(wrong.paymentId, reversalId);
      expect(replay.ok && replay.value.alreadyCommitted).toBe(true);
      expect(await cancelPayment(wrong.paymentId)).toEqual({
        ok: false,
        reason: 'already_reversed',
      });
      expect(await cancelPayment(reversalId)).toEqual({ ok: false, reason: 'is_reversal' });
      expect(await cancelPayment(uuidv7())).toEqual({ ok: false, reason: 'not_found' });
      expect(await customerBalance(tenant.scope, customerId)).toBe(1_000);
    });

    it('two cancellations racing record one', async () => {
      const customerId = await customerOwing(10);
      const wrong = await settle(customerId, 700);
      const results = await Promise.all([
        cancelPayment(wrong.paymentId),
        cancelPayment(wrong.paymentId),
      ]);
      expect(results.filter((result) => result.ok)).toHaveLength(1);
      expect(results.filter((result) => !result.ok)).toEqual([
        { ok: false, reason: 'already_reversed' },
      ]);
      expect(await customerBalance(tenant.scope, customerId)).toBe(1_000);
    });

    it('receipts name each half, and the exception list shows the cancellation', async () => {
      const customerId = await customerOwing(10);
      const wrong = await settle(customerId, 300);
      const cancelled = await cancelPayment(wrong.paymentId);
      if (!cancelled.ok) throw new Error('cancel refused');

      expect(await findReceipt(tenant.scope, wrong.receiptNumber)).toMatchObject({
        kind: 'settlement',
        amountPaisa: 300,
        cancelledByReceiptNumber: cancelled.value.receiptNumber,
      });
      expect(await findReceipt(tenant.scope, cancelled.value.receiptNumber)).toMatchObject({
        kind: 'payment_cancelled',
        amountPaisa: 300,
        cancelsReceiptNumber: wrong.receiptNumber,
      });
      const listed = await listReceipts(tenant.scope, { search: cancelled.value.receiptNumber });
      expect(listed.items[0]).toMatchObject({ kind: 'payment_cancelled', amountPaisa: 300 });

      const exceptions = await paymentReversalsInRange(tenant.scope, ...EVER);
      expect(exceptions).toContainEqual(
        expect.objectContaining({
          kind: 'udhaar',
          amountPaisa: 300,
          receiptNumber: cancelled.value.receiptNumber,
        }),
      );
    });

    it('the database refuses a negative payment that cancels nothing', async () => {
      const customerId = await customerOwing(1);
      await expect(
        tenant.scope.insert(payments, {
          id: uuidv7(),
          customerId,
          amountPaisa: -100,
          method: 'cash',
          saleId: null,
          receiptNumber: nextReceipt(),
          origin: 'online',
          clientSchemaVersion: 1,
          clientCommittedAt: new Date(),
        }),
      ).rejects.toThrow();
    });
  });

  describe('a supplier payment', () => {
    it('cancelled, what is owed is restored and the ledger sums to it', async () => {
      const supplierId = uuidv7();
      await tenant.scope.insert(suppliers, {
        id: supplierId,
        name: `Dist ${supplierId.slice(-6)}`,
        phone: null,
      });
      expect(
        (
          await commitPurchase(tenant.scope, {
            purchaseId: uuidv7(),
            supplierId,
            invoiceRef: null,
            invoiceDate: null,
            note: null,
            cashPaidPaisa: 0,
            lines: [
              {
                lineId: uuidv7(),
                productId: product.id,
                qtyBase: 10,
                bonusQtyBase: 0,
                unitCostPaisa: 500,
                expiryDate: '2030-06-30',
                batchNumber: null,
                mrpAtReceivingPaisa: null,
                priceAtReceivingPaisa: 100,
              },
            ],
          })
        ).ok,
      ).toBe(true);
      const paymentId = uuidv7();
      await commitSupplierPayment(tenant.scope, {
        paymentId,
        supplierId,
        amountPaisa: 4_500,
        purchaseId: null,
        note: null,
      });
      expect(await supplierBalance(tenant.scope, supplierId)).toBe(500);

      const cancelled = await commitSupplierPaymentReversal(tenant.scope, {
        reversalId: uuidv7(),
        paymentId,
      });
      expect(cancelled).toMatchObject({ ok: true, value: { newBalancePaisa: 5_000 } });
      expect(
        await commitSupplierPaymentReversal(tenant.scope, { reversalId: uuidv7(), paymentId }),
      ).toEqual({ ok: false, reason: 'already_reversed' });

      const ledger = await supplierLedger(tenant.scope, supplierId);
      expect(ledger.map((row) => row.kind)).toEqual(['invoice', 'payment', 'payment_reversal']);
      expect(ledger[1]).toMatchObject({ reversed: true });
      expect(ledger.reduce((sum, row) => sum + row.amountPaisa, 0)).toBe(5_000);

      const exceptions = await paymentReversalsInRange(tenant.scope, ...EVER);
      expect(exceptions).toContainEqual(
        expect.objectContaining({ kind: 'supplier', amountPaisa: 4_500 }),
      );
    });
  });

  describe('a cash movement', () => {
    it('an expense typed wrong: cancelled, expected cash is restored, both rows listed', async () => {
      const before = await threeNumbers(tenant.scope, ...EVER);
      const movementId = uuidv7();
      expect(
        (
          await commitCashMovement(tenant.scope, {
            movementId,
            direction: 'out',
            amountPaisa: 500_000,
            reason: 'expense',
            note: 'typed an extra zero',
          })
        ).ok,
      ).toBe(true);
      expect((await threeNumbers(tenant.scope, ...EVER)).expectedCashPaisa).toBe(
        before.expectedCashPaisa - 500_000,
      );

      const reversalId = uuidv7();
      expect(await commitCashReversal(tenant.scope, { reversalId, movementId })).toEqual({
        ok: true,
        value: { alreadyCommitted: false },
      });
      expect((await threeNumbers(tenant.scope, ...EVER)).expectedCashPaisa).toBe(
        before.expectedCashPaisa,
      );
      expect(await commitCashReversal(tenant.scope, { reversalId: uuidv7(), movementId })).toEqual({
        ok: false,
        reason: 'already_reversed',
      });
      expect(
        await commitCashReversal(tenant.scope, { reversalId: uuidv7(), movementId: reversalId }),
      ).toEqual({ ok: false, reason: 'is_reversal' });

      const rows = await cashMovementsExceptionInRange(tenant.scope, ...EVER);
      expect(rows.find((row) => row.id === movementId)).toMatchObject({
        reversed: true,
        reversesId: null,
      });
      expect(rows.find((row) => row.id === reversalId)).toMatchObject({
        direction: 'in',
        reason: 'expense',
        reversesId: movementId,
        reversed: false,
      });
    });

    it('a cancelled opening float no longer counts as the float being recorded', async () => {
      // A tenant of its own: the float check is per day, and the suite shares one.
      const own = await provisionTestTenant('float');
      try {
        const day = [new Date(Date.now() - 60_000), new Date(Date.now() + 60_000)] as const;
        const movementId = uuidv7();
        await insertCashMovement(own.scope, {
          id: movementId,
          direction: 'in',
          amountPaisa: 100_000,
          reason: 'opening_float',
          note: null,
        });
        expect(await hasOpeningFloat(own.scope, ...day)).toBe(true);

        await commitCashReversal(own.scope, { reversalId: uuidv7(), movementId });
        expect(await hasOpeningFloat(own.scope, ...day)).toBe(false);

        await insertCashMovement(own.scope, {
          id: uuidv7(),
          direction: 'in',
          amountPaisa: 10_000,
          reason: 'opening_float',
          note: null,
        });
        expect(await hasOpeningFloat(own.scope, ...day)).toBe(true);
      } finally {
        await own.cleanup();
      }
    });
  });

  it('the app role cannot update a payment row to fake a cancellation', async () => {
    // ADR-1: corrections are new rows. The grant, not the code, enforces it.
    if (!process.env.APP_DB_ROLE) return;
    await expect(
      tenant.scope.db.execute(
        sql`update payments set amount_paisa = 1 where tenant_id = ${tenant.tenantId}`,
      ),
    ).rejects.toThrow();
  });
});
