/**
 * [PCN-006] Supplier balance and settlement — transaction semantics against a
 * real database, the payable mirror of `commit-settlement.integration.test.ts`.
 *
 * Balance derivation and idempotency are both properties of what lands in
 * Postgres, so this runs against one (skipped without `DATABASE_URL`, like every
 * integration suite). The invariant under test is the money one:
 *
 *   supplier balance = Σ (invoice cost − cash paid) − Σ supplier payments
 *
 * and it is checked by making each term move and asserting the balance follows.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { commitPurchase, type PurchaseCommand } from '@/domain/purchases/commit-purchase';
import { commitSupplierPayment } from '@/domain/suppliers/commit-supplier-payment';
import { supplierBalance } from '@/db/supplier-queries';
import { suppliers } from '@/db/schema';
import { uuidv7, type Uuid } from '@/lib/uuid';

import {
  createTestProduct,
  provisionTestTenant,
  type TestProduct,
  type TestTenant,
} from '../../../tests/fixtures';

const suite = process.env.DATABASE_URL ? describe : describe.skip;

suite('supplier credit against Postgres', () => {
  let tenant: TestTenant;
  let product: TestProduct;
  let supplierId: Uuid;

  beforeAll(async () => {
    tenant = await provisionTestTenant('supplier');
    product = await createTestProduct(tenant.scope, `Supplied ${uuidv7().slice(0, 6)}`, 500);
  });

  afterAll(async () => {
    await tenant.cleanup();
  });

  beforeEach(async () => {
    supplierId = uuidv7();
    await tenant.scope.insert(suppliers, {
      id: supplierId,
      name: `Distributor ${uuidv7().slice(0, 6)}`,
      phone: null,
    });
  });

  function purchase(overrides: Partial<PurchaseCommand> = {}): PurchaseCommand {
    return {
      purchaseId: uuidv7(),
      supplierId,
      invoiceRef: null,
      invoiceDate: null,
      note: null,
      // 100 × 280 = 28,000 invoice cost.
      lines: [
        {
          lineId: uuidv7(),
          productId: product.id,
          qtyBase: 100,
          bonusQtyBase: 0,
          unitCostPaisa: 280,
          expiryDate: '2027-06-30',
          batchNumber: null,
          mrpAtReceivingPaisa: null,
          priceAtReceivingPaisa: 500,
        },
      ],
      ...overrides,
    };
  }

  it('a fully-paid purchase owes nothing', async () => {
    const result = await commitPurchase(tenant.scope, purchase());
    expect(result.ok).toBe(true);
    expect(await supplierBalance(tenant.scope, supplierId)).toBe(0);
  });

  it('a purchase on credit owes the unpaid remainder', async () => {
    await commitPurchase(tenant.scope, purchase({ cashPaidPaisa: 10_000 }));
    // 28,000 invoiced − 10,000 paid = 18,000 owed.
    expect(await supplierBalance(tenant.scope, supplierId)).toBe(18_000);
  });

  it('a payment reduces the balance, and the derivation matches the terms', async () => {
    await commitPurchase(tenant.scope, purchase({ cashPaidPaisa: 0 }));
    await commitPurchase(tenant.scope, purchase({ cashPaidPaisa: 5_000 }));
    // (28,000 − 0) + (28,000 − 5,000) = 51,000 owed before any settlement.
    expect(await supplierBalance(tenant.scope, supplierId)).toBe(51_000);

    const paid = await commitSupplierPayment(tenant.scope, {
      paymentId: uuidv7(),
      supplierId,
      amountPaisa: 20_000,
      purchaseId: null,
      note: null,
    });
    expect(paid.ok).toBe(true);
    if (paid.ok) {
      expect(paid.value.previousBalancePaisa).toBe(51_000);
      expect(paid.value.newBalancePaisa).toBe(31_000);
    }
    expect(await supplierBalance(tenant.scope, supplierId)).toBe(31_000);
  });

  it('is idempotent: the same payment id delivered twice pays once', async () => {
    await commitPurchase(tenant.scope, purchase({ cashPaidPaisa: 0 }));
    const paymentId = uuidv7();
    const command = { paymentId, supplierId, amountPaisa: 8_000, purchaseId: null, note: null };

    const first = await commitSupplierPayment(tenant.scope, command);
    const second = await commitSupplierPayment(tenant.scope, command);

    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    if (second.ok) {
      expect(second.value.alreadyCommitted).toBe(true);
    }
    // 28,000 − 8,000, and the replay did not subtract twice.
    expect(await supplierBalance(tenant.scope, supplierId)).toBe(20_000);
  });

  it('overpayment leaves an advance (a negative balance)', async () => {
    await commitPurchase(tenant.scope, purchase({ cashPaidPaisa: 28_000 }));
    await commitSupplierPayment(tenant.scope, {
      paymentId: uuidv7(),
      supplierId,
      amountPaisa: 5_000,
      purchaseId: null,
      note: null,
    });
    // Owed nothing, then paid 5,000 anyway — the supplier now holds an advance.
    expect(await supplierBalance(tenant.scope, supplierId)).toBe(-5_000);
  });
});
