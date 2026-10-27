/**
 * [PCN-013] Correcting a customer or a supplier: edit the name or phone,
 * remove one added by mistake, restore it.
 *
 * The money rule under test: removal is refused while a balance is open in
 * either direction, and a removed record that later gains a balance (an
 * offline udhaar sale arriving after removal) is never hidden from the lists
 * that add up what is owed.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { listSuppliers, supplierBalance, supplierPositions } from '@/db/supplier-queries';
import { customers, suppliers } from '@/db/schema';
import { customerBalance, findCustomer, listCustomers, searchCustomers } from '@/db/udhaar-queries';
import { commitPurchase } from '@/domain/purchases/commit-purchase';
import { commitSale } from '@/domain/sales/commit-sale';
import { commitSupplierPayment } from '@/domain/suppliers/commit-supplier-payment';
import { editSupplier, removeSupplier, restoreSupplier } from '@/domain/suppliers/writers';
import { uuidv7, type Uuid } from '@/lib/uuid';

import {
  addOpeningStock,
  createTestProduct,
  provisionTestTenant,
  type TestProduct,
  type TestTenant,
} from '../../../tests/fixtures';
import { commitSettlement } from './commit-settlement';
import { editCustomer, removeCustomer, restoreCustomer } from './writers';

const suite = process.env.DATABASE_URL ? describe : describe.skip;

suite('correcting customers and suppliers', () => {
  let tenant: TestTenant;
  let product: TestProduct;
  let receipt = 0;

  beforeAll(async () => {
    tenant = await provisionTestTenant('contacts');
    product = await createTestProduct(tenant.scope, `Udhaar item ${uuidv7().slice(-6)}`, 100);
    await addOpeningStock(tenant.scope, product.id, 10_000);
  });

  afterAll(async () => {
    await tenant.cleanup();
  });

  async function customer(name = `Customer ${uuidv7().slice(-6)}`): Promise<Uuid> {
    const id = uuidv7();
    await tenant.scope.insert(customers, { id, name, phone: null });
    return id;
  }

  async function supplier(): Promise<Uuid> {
    const id = uuidv7();
    await tenant.scope.insert(suppliers, {
      id,
      name: `Distributor ${uuidv7().slice(-6)}`,
      phone: null,
    });
    return id;
  }

  /** One unit at Rs 1, all of it on udhaar. */
  async function udhaarSale(customerId: Uuid, units: number): Promise<void> {
    receipt += 1;
    const sold = await commitSale(tenant.scope, {
      saleId: uuidv7(),
      receiptNumber: `CC-${receipt}`,
      customerId,
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
  }

  async function settle(customerId: Uuid, amountPaisa: number): Promise<void> {
    receipt += 1;
    const paid = await commitSettlement(tenant.scope, {
      paymentId: uuidv7(),
      receiptNumber: `CC-${receipt}`,
      customerId,
      amountPaisa,
      origin: 'online',
      clientSchemaVersion: 1,
      clientCommittedAt: new Date(),
    });
    expect(paid.ok).toBe(true);
  }

  describe('customers', () => {
    it('an edited name keeps every rupee of the balance', async () => {
      const id = await customer('Aslam');
      await udhaarSale(id, 5);

      expect(
        await editCustomer(tenant.scope, id, { name: ' Aslam Khan ', phone: '0300-1234567' }),
      ).toEqual({
        ok: true,
      });
      expect(await findCustomer(tenant.scope, id)).toMatchObject({
        name: 'Aslam Khan',
        phone: '0300-1234567',
      });
      expect(await customerBalance(tenant.scope, id)).toBe(500);
    });

    it('an empty name is refused and nothing changes', async () => {
      const id = await customer('Bashir');
      const result = await editCustomer(tenant.scope, id, { name: '  ', phone: null });
      expect(result).toEqual({ ok: false, rejections: [{ reason: 'name_required' }] });
      expect((await findCustomer(tenant.scope, id))?.name).toBe('Bashir');
    });

    it('removal is refused while they owe, and while they have paid in advance', async () => {
      const owes = await customer();
      await udhaarSale(owes, 3);
      expect(await removeCustomer(tenant.scope, owes)).toEqual({
        ok: false,
        refusal: 'has_balance',
        balancePaisa: 300,
      });

      const advance = await customer();
      await settle(advance, 1_000);
      expect(await removeCustomer(tenant.scope, advance)).toEqual({
        ok: false,
        refusal: 'has_balance',
        balancePaisa: -1_000,
      });
      expect((await findCustomer(tenant.scope, advance))?.isActive).toBe(true);
    });

    it('once settled up they can be removed, and leave the picker', async () => {
      const name = `Removable ${uuidv7().slice(-6)}`;
      const id = await customer(name);
      await udhaarSale(id, 2);
      await settle(id, 200);

      expect(await removeCustomer(tenant.scope, id)).toEqual({ ok: true });
      expect(await removeCustomer(tenant.scope, id)).toEqual({ ok: true });
      expect((await searchCustomers(tenant.scope, name)).map((row) => row.id)).not.toContain(id);
      const listed = await listCustomers(tenant.scope, { search: name });
      expect(listed.items.map((row) => row.id)).not.toContain(id);
      const withRemoved = await listCustomers(tenant.scope, { search: name, includeRemoved: true });
      expect(withRemoved.items).toEqual([expect.objectContaining({ id, isActive: false })]);

      expect(await restoreCustomer(tenant.scope, id)).toEqual({ ok: true });
      expect((await searchCustomers(tenant.scope, name)).map((row) => row.id)).toContain(id);
    });

    it('a debt that arrives after removal is still listed and still counted', async () => {
      // An udhaar sale captured offline before removal, delivered after it.
      const name = `Late udhaar ${uuidv7().slice(-6)}`;
      const id = await customer(name);
      const before = await listCustomers(tenant.scope);
      expect((await removeCustomer(tenant.scope, id)).ok).toBe(true);
      await udhaarSale(id, 4);

      const after = await listCustomers(tenant.scope);
      expect(after.items).toContainEqual(
        expect.objectContaining({ id, isActive: false, balancePaisa: 400 }),
      );
      expect(after.outstandingPaisa).toBe(before.outstandingPaisa + 400);
    });
  });

  describe('suppliers', () => {
    function purchase(supplierId: Uuid, cashPaidPaisa: number) {
      return commitPurchase(tenant.scope, {
        purchaseId: uuidv7(),
        supplierId,
        invoiceRef: null,
        invoiceDate: null,
        note: null,
        cashPaidPaisa,
        lines: [
          {
            lineId: uuidv7(),
            productId: product.id,
            qtyBase: 10,
            bonusQtyBase: 0,
            unitCostPaisa: 80,
            expiryDate: '2030-06-30',
            batchNumber: null,
            mrpAtReceivingPaisa: null,
            priceAtReceivingPaisa: 100,
          },
        ],
      });
    }

    it('an edited name keeps the balance', async () => {
      const id = await supplier();
      expect((await purchase(id, 0)).ok).toBe(true);
      expect(
        await editSupplier(tenant.scope, id, { name: 'Muller & Phipps', phone: null }),
      ).toEqual({
        ok: true,
      });
      expect(await supplierBalance(tenant.scope, id)).toBe(800);
    });

    it('removal is refused while owed, and while they hold credit', async () => {
      const id = await supplier();
      expect((await purchase(id, 0)).ok).toBe(true);
      expect(await removeSupplier(tenant.scope, id)).toEqual({
        ok: false,
        refusal: 'has_balance',
        balancePaisa: 800,
      });

      const paid = await commitSupplierPayment(tenant.scope, {
        paymentId: uuidv7(),
        supplierId: id,
        amountPaisa: 1_000,
        purchaseId: null,
        note: null,
      });
      expect(paid.ok).toBe(true);
      expect(await removeSupplier(tenant.scope, id)).toEqual({
        ok: false,
        refusal: 'has_balance',
        balancePaisa: -200,
      });
    });

    it('a settled supplier can be removed and restored', async () => {
      const id = await supplier();
      expect((await purchase(id, 800)).ok).toBe(true);

      expect(await removeSupplier(tenant.scope, id)).toEqual({ ok: true });
      expect((await listSuppliers(tenant.scope)).map((row) => row.id)).not.toContain(id);
      expect(
        (await listSuppliers(tenant.scope, { includeRemoved: true })).find((row) => row.id === id),
      ).toMatchObject({ isActive: false, balancePaisa: 0 });

      expect(await restoreSupplier(tenant.scope, id)).toEqual({ ok: true });
      expect((await listSuppliers(tenant.scope)).map((row) => row.id)).toContain(id);
    });

    it('a removed supplier with a balance stays on the owed panel', async () => {
      const id = await supplier();
      expect((await removeSupplier(tenant.scope, id)).ok).toBe(true);
      expect((await purchase(id, 0)).ok).toBe(true);

      const positions = await supplierPositions(tenant.scope);
      expect(positions.owed.map((row) => row.id)).toContain(id);
      expect((await listSuppliers(tenant.scope)).map((row) => row.id)).toContain(id);
    });
  });
});
