/**
 * [PCN-007] Supplier balance and settlement — transaction semantics against a
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
import { commitSupplierReturn } from '@/domain/suppliers/commit-supplier-return';
import {
  balancesBySupplier,
  supplierBalance,
  supplierBook,
  supplierPositions,
} from '@/db/supplier-queries';
import { purchaseLines, purchases, suppliers } from '@/db/schema';
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

  /**
   * A purchase entered before supplier credit existed. Migration 0009 gave it
   * cash_paid_paisa = 0 by default and every such invoice read as owed in full
   * — the "Owed to suppliers" figure became the shop's whole purchase history.
   * Migration 0010 marks those rows untracked; this is one, written exactly as
   * that history looks (0 paid, credit_tracked false).
   */
  async function historicalPurchase(): Promise<void> {
    const purchaseId = uuidv7();
    await tenant.scope.insert(purchases, {
      id: purchaseId,
      supplierId,
      invoiceRef: 'BEFORE-SUPPLIER-CREDIT',
      invoiceDate: null,
      note: null,
      cashPaidPaisa: 0,
      creditTracked: false,
    });
    await tenant.scope.insert(purchaseLines, {
      id: uuidv7(),
      purchaseId,
      productId: product.id,
      qtyBase: 100,
      bonusQtyBase: 0,
      unitCostPaisa: 280,
      expiryDate: null,
      batchNumber: null,
      mrpAtReceivingPaisa: null,
      priceAtReceivingPaisa: 500,
    });
  }

  it('a purchase from before supplier credit owes nothing — its 0 paid was a default, not a fact', async () => {
    await historicalPurchase();
    expect(await supplierBalance(tenant.scope, supplierId)).toBe(0);
    expect((await balancesBySupplier(tenant.scope))[supplierId] ?? 0).toBe(0);
  });

  it('history does not hide real credit recorded since', async () => {
    await historicalPurchase();
    await commitPurchase(tenant.scope, purchase({ cashPaidPaisa: 8_000 }));
    // Only the tracked invoice counts: 28,000 − 8,000.
    expect(await supplierBalance(tenant.scope, supplierId)).toBe(20_000);
    expect((await balancesBySupplier(tenant.scope))[supplierId]).toBe(20_000);
  });

  it('a purchase recorded now is tracked, even when paid in full', async () => {
    const command = purchase();
    const result = await commitPurchase(tenant.scope, command);
    expect(result.ok).toBe(true);
    const row = (await tenant.scope.select(purchases)).find((p) => p.id === command.purchaseId);
    expect(row?.creditTracked).toBe(true);
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

/**
 * [PCN-011] A credit with a supplier is shown, never dropped. Until PCN-011 the
 * owed list filtered balances at or below zero and the Day total floored each
 * one, so both of these credits were invisible everywhere.
 *
 * Its own tenant, because the book sums every supplier in the pharmacy and the
 * suite above adds a supplier per test.
 */
suite('supplier credit is visible (PCN-011)', () => {
  let tenant: TestTenant;
  let product: TestProduct;

  beforeAll(async () => {
    tenant = await provisionTestTenant('suppliercredit');
    product = await createTestProduct(tenant.scope, `Credited ${uuidv7().slice(-6)}`, 500);
  });

  afterAll(async () => {
    await tenant.cleanup();
  });

  async function supplier(name: string): Promise<Uuid> {
    const id = uuidv7();
    await tenant.scope.insert(suppliers, {
      id,
      name: `${name} ${uuidv7().slice(-6)}`,
      phone: null,
    });
    return id;
  }

  /** 100 units at Rs 2.80 = 28,000 invoiced. */
  async function receive(supplierId: Uuid, cashPaidPaisa: number): Promise<Uuid> {
    const result = await commitPurchase(tenant.scope, {
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
          qtyBase: 100,
          bonusQtyBase: 0,
          unitCostPaisa: 280,
          expiryDate: '2030-06-30',
          batchNumber: null,
          mrpAtReceivingPaisa: null,
          priceAtReceivingPaisa: 500,
        },
      ],
    });
    if (!result.ok) throw new Error('purchase refused');
    return result.value.batchIds[0]! as Uuid;
  }

  it('lists credits apart from debts, and the book never nets them', async () => {
    // Paid in full, then 20 units sent back for 5,600 credit.
    const returnedTo = await supplier('Returned to');
    const batchId = await receive(returnedTo, 28_000);
    const returned = await commitSupplierReturn(tenant.scope, {
      returnId: uuidv7(),
      batchId,
      qtyBase: 20,
      creditPaisa: 5_600,
      note: null,
    });
    expect(returned.ok).toBe(true);

    // Owed 28,000, paid 30,000.
    const overpaid = await supplier('Overpaid');
    await receive(overpaid, 0);
    await commitSupplierPayment(tenant.scope, {
      paymentId: uuidv7(),
      supplierId: overpaid,
      amountPaisa: 30_000,
      purchaseId: null,
      note: null,
    });

    // Genuinely owed 10,000.
    const owing = await supplier('Owing');
    await receive(owing, 18_000);

    // Settled exactly: in neither list.
    const settled = await supplier('Settled');
    await receive(settled, 28_000);

    const positions = await supplierPositions(tenant.scope);
    expect(positions.owed.map((row) => [row.id, row.balancePaisa])).toEqual([[owing, 10_000]]);
    expect(positions.inCredit.map((row) => [row.id, row.creditPaisa])).toEqual([
      [returnedTo, 5_600],
      [overpaid, 2_000],
    ]);

    expect(await supplierBook(tenant.scope)).toEqual({
      owedPaisa: 10_000,
      creditPaisa: 7_600,
      suppliersOwed: 1,
      suppliersInCredit: 2,
    });

    // The book is the balances, split by direction — nothing appears or vanishes.
    const balances = Object.values(await balancesBySupplier(tenant.scope));
    const book = await supplierBook(tenant.scope);
    expect(book.owedPaisa - book.creditPaisa).toBe(balances.reduce((a, b) => a + b, 0));
  });
});
