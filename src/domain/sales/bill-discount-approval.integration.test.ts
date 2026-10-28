/**
 * [PCN-014] The owner's PIN approving a bill discount over the shop's limit,
 * and the sale recording who approved.
 *
 * The approval is the owner's alone: a salesman's PIN approves nothing, a
 * wrong PIN counts toward the same lockout as the PIN switch, and a sale
 * naming an approver who is not one of the shop's owners keeps no approver —
 * never refused, because its receipt has already printed.
 */

import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { approveAsOwner } from '@/auth/owner-approval';
import { hashPin, MAX_PIN_ATTEMPTS } from '@/auth/pin';
import { findReceipt } from '@/db/receipt-queries';
import { billDiscountsInRange, reportFigures } from '@/db/reporting-queries';
import { sales, users } from '@/db/schema';
import { uuidv7, type Uuid } from '@/lib/uuid';

import {
  addOpeningStock,
  createTestProduct,
  provisionTestTenant,
  type TestTenant,
} from '../../../tests/fixtures';
import { commitSale } from './commit-sale';

const suite = process.env.DATABASE_URL ? describe : describe.skip;

suite('approving a bill discount over the limit (PCN-014)', () => {
  let tenant: TestTenant;
  let salesmanId: Uuid;
  let receipt = 0;

  beforeAll(async () => {
    tenant = await provisionTestTenant('approval');
    await tenant.scope.update(
      users,
      { pinHash: await hashPin('1234') },
      eq(users.id, tenant.userId),
    );
    salesmanId = uuidv7();
    await tenant.scope.insert(users, {
      id: salesmanId,
      name: 'Bilal',
      role: 'salesman',
      pinHash: await hashPin('2345'),
      passwordHash: null,
    });
  });

  afterAll(async () => {
    await tenant.cleanup();
  });

  async function discountedSale(approvedBy: Uuid | null): Promise<Uuid> {
    const product = await createTestProduct(tenant.scope, `Approved ${uuidv7().slice(-6)}`, 10_000);
    await addOpeningStock(tenant.scope, product.id, 5);
    const saleId = uuidv7();
    receipt += 1;
    const sold = await commitSale(tenant.scope, {
      saleId,
      receiptNumber: `AP-${receipt}`,
      customerId: null,
      lines: [
        {
          lineId: uuidv7(),
          productId: product.id,
          qtyBase: 1,
          enteredUnitLevel: 'tab',
          unitPricePaisa: 10_000,
          lineDiscountPaisa: 0,
          priceOverridden: false,
        },
      ],
      // 30% off: over any sensible limit.
      invoiceDiscountPaisa: 3_000,
      invoiceDiscountApprovedBy: approvedBy,
      cashPaisa: 7_000,
      creditPaisa: 0,
      changePaisa: 0,
      origin: 'online',
      clientSchemaVersion: 1,
      clientCommittedAt: new Date(),
    });
    expect(sold.ok).toBe(true);
    return saleId;
  }

  async function receiptOf(saleId: Uuid): Promise<string> {
    return (await tenant.scope.selectOne(sales, eq(sales.id, saleId)))!.receiptNumber;
  }

  async function approverOf(saleId: Uuid): Promise<string | null | undefined> {
    return (await tenant.scope.selectOne(sales, eq(sales.id, saleId)))?.invoiceDiscountApprovedBy;
  }

  it('the owner’s PIN approves, and names the owner', async () => {
    expect(await approveAsOwner(tenant.scope, '1234')).toEqual({
      ok: true,
      ownerId: tenant.userId,
      ownerName: 'Owner approval',
    });
  });

  it('a salesman’s PIN approves nothing', async () => {
    expect(await approveAsOwner(tenant.scope, '2345')).toEqual({ ok: false, reason: 'bad_pin' });
  });

  it('a sale records the owner who approved', async () => {
    expect(await approverOf(await discountedSale(tenant.userId))).toBe(tenant.userId);
  });

  it('a sale naming a salesman, or nobody real, keeps no approver — and still sells', async () => {
    expect(await approverOf(await discountedSale(salesmanId))).toBeNull();
    expect(await approverOf(await discountedSale(null))).toBeNull();
  });

  it('wrong PINs lock the owner out, as the PIN switch does', async () => {
    for (let attempt = 0; attempt < MAX_PIN_ATTEMPTS; attempt += 1) {
      await approveAsOwner(tenant.scope, '9999');
    }
    const locked = await approveAsOwner(tenant.scope, '1234');
    expect(locked).toMatchObject({ ok: false, reason: 'locked_out' });
    // Clear it, so the shared tenant is left as found.
    await tenant.scope.update(
      users,
      { failedPinAttempts: 0, pinLockedUntil: null },
      eq(users.id, tenant.userId),
    );
  });

  describe('what the owner sees afterwards (step 4)', () => {
    const EVER = [new Date('2000-01-01'), new Date('2100-01-01')] as const;

    it('the day list shows each bill discount, who approved it, and flags one that should have been', async () => {
      const approved = await discountedSale(tenant.userId);
      const unapproved = await discountedSale(salesmanId);
      const rows = await billDiscountsInRange(tenant.scope, ...EVER, 10);
      const row = (saleId: Uuid) => rows.find((each) => each.saleId === saleId);

      expect(row(approved)).toMatchObject({
        approvedByName: 'Owner approval',
        billPaisa: 10_000,
        discountPaisa: 3_000,
        totalPaisa: 7_000,
        unapprovedOverLimit: false,
      });
      // 30% with no owner: the counter cannot produce it, so it is flagged.
      expect(row(unapproved)).toMatchObject({ approvedByName: null, unapprovedOverLimit: true });
      // Under a limit that allows it, nothing is wrong with it.
      const relaxed = await billDiscountsInRange(tenant.scope, ...EVER, 50);
      expect(relaxed.find((each) => each.saleId === unapproved)?.unapprovedOverLimit).toBe(false);
    });

    it('the day’s figures state the bill discounts given', async () => {
      const before = await reportFigures(tenant.scope, ...EVER);
      await discountedSale(tenant.userId);
      const after = await reportFigures(tenant.scope, ...EVER);
      expect(after.billDiscountPaisa - before.billDiscountPaisa).toBe(3_000);
      expect(after.itemDiscountPaisa).toBe(before.itemDiscountPaisa);
    });

    it('the receipt page shows the line’s share and the approver', async () => {
      const saleId = await discountedSale(tenant.userId);
      const detail = await findReceipt(tenant.scope, await receiptOf(saleId));
      expect(detail).toMatchObject({
        kind: 'sale',
        invoiceDiscountPaisa: 3_000,
        invoiceDiscountApprovedByName: 'Owner approval',
      });
      expect(detail?.lines?.[0]?.invoiceDiscountSharePaisa).toBe(3_000);
    });
  });
});
