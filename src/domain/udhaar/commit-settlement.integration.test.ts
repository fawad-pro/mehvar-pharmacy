/**
 * Transaction semantics for `commitSettlement` — Phase 11 §3.2, W3, invariant 3.
 *
 * Against a real database because balance derivation and idempotency are both
 * properties of what actually lands in Postgres, not of the code in isolation.
 */

import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { commitSettlement, type SettlementCommand } from '@/domain/udhaar/commit-settlement';
import { commitSale, type SaleCommand } from '@/domain/sales/commit-sale';
import { customerBalance } from '@/db/udhaar-queries';
import { payments } from '@/db/schema';
import { uuidv7 } from '@/lib/uuid';

import {
  addOpeningStock,
  createTestProduct,
  provisionTestTenant,
  type TestProduct,
  type TestTenant,
} from '../../../tests/fixtures';

const suite = process.env.DATABASE_URL ? describe : describe.skip;

let receiptCounter = 0;
function nextReceipt(): string {
  receiptCounter += 1;
  return `A-${receiptCounter}`;
}

function settlement(overrides: Partial<SettlementCommand> = {}): SettlementCommand {
  return {
    paymentId: uuidv7(),
    receiptNumber: nextReceipt(),
    customerId: 'replace-me',
    amountPaisa: 1_000,
    origin: 'online',
    clientSchemaVersion: 1,
    clientCommittedAt: new Date(),
    ...overrides,
  };
}

suite('commitSettlement against Postgres', () => {
  let tenant: TestTenant;
  let customerId: string;

  beforeAll(async () => {
    tenant = await provisionTestTenant('settle');
  });

  afterAll(async () => {
    await tenant.cleanup();
  });

  beforeEach(async () => {
    const { customers } = await import('@/db/schema');
    const id = uuidv7();
    await tenant.scope.insert(customers, { id, name: `Customer ${id.slice(0, 8)}`, phone: null });
    customerId = id;
  });

  it('refuses a non-positive amount', async () => {
    const result = await commitSettlement(
      tenant.scope,
      settlement({ customerId, amountPaisa: 0 }),
    );
    expect(result).toEqual({ ok: false, reason: 'amount_not_positive' });
  });

  it('writes a standalone payment with a receipt number and no sale_id', async () => {
    const command = settlement({ customerId, amountPaisa: 50_000 });
    const result = await commitSettlement(tenant.scope, command);

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const [row] = await tenant.scope.select(payments, eq(payments.id, command.paymentId));
    expect(row?.saleId).toBeNull();
    expect(row?.receiptNumber).toBe(command.receiptNumber);
    expect(row?.amountPaisa).toBe(50_000);
  });

  it('computes the mini-statement from the balance at commit time (T4/T5)', async () => {
    // Extend some udhaar first, via a real sale, so there is a balance to pay down.
    const product = await createTestProduct(tenant.scope, `Product ${uuidv7().slice(0, 8)}`);
    await addOpeningStock(tenant.scope, product.id, 100);

    const sale: SaleCommand = {
      saleId: uuidv7(),
      receiptNumber: nextReceipt(),
      customerId,
      lines: [
        {
          lineId: uuidv7(),
          productId: product.id,
          qtyBase: 20,
          enteredUnitLevel: 'tab',
          unitPricePaisa: 350,
          lineDiscountPaisa: 0,
          priceOverridden: false,
        },
      ],
      invoiceDiscountPaisa: 0,
      cashPaisa: 0,
      creditPaisa: 7_000,
      changePaisa: 0,
      origin: 'online',
      clientSchemaVersion: 1,
      clientCommittedAt: new Date(),
    };
    await commitSale(tenant.scope, sale);
    expect(await customerBalance(tenant.scope, customerId)).toBe(7_000);

    const result = await commitSettlement(
      tenant.scope,
      settlement({ customerId, amountPaisa: 3_000 }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.statement).toEqual({
      previousBalancePaisa: 7_000,
      amountPaisa: -3_000,
      newBalancePaisa: 4_000,
    });
    expect(await customerBalance(tenant.scope, customerId)).toBe(4_000);
  });

  it('allows an overpayment, leaving the customer in credit', async () => {
    const result = await commitSettlement(
      tenant.scope,
      settlement({ customerId, amountPaisa: 10_000 }),
    );
    expect(result.ok).toBe(true);
    expect(await customerBalance(tenant.scope, customerId)).toBe(-10_000);
  });

  it('is idempotent on the client id (ADR-3)', async () => {
    const command = settlement({ customerId, amountPaisa: 5_000 });

    const first = await commitSettlement(tenant.scope, command);
    const second = await commitSettlement(tenant.scope, command);
    const third = await commitSettlement(tenant.scope, command);

    expect(first.ok && !first.value.alreadyCommitted).toBe(true);
    expect(second.ok && second.value.alreadyCommitted).toBe(true);
    expect(third.ok && third.value.alreadyCommitted).toBe(true);

    // Delivered three times, applied once.
    expect(await customerBalance(tenant.scope, customerId)).toBe(-5_000);
    const rows = await tenant.scope.select(payments, eq(payments.id, command.paymentId));
    expect(rows).toHaveLength(1);
  });

  it('rejects a duplicate receipt number (shared sequence with sales, PCN-002)', async () => {
    const receiptNumber = `A-DUP-${uuidv7().slice(0, 8)}`;
    await commitSettlement(tenant.scope, settlement({ customerId, receiptNumber, amountPaisa: 100 }));

    await expect(
      commitSettlement(
        tenant.scope,
        settlement({ customerId, receiptNumber, amountPaisa: 200 }),
      ),
    ).rejects.toThrow();
  });
});

describe('customer balance derivation (Phase 5 invariant 3)', () => {
  const dbSuite = process.env.DATABASE_URL ? describe : describe.skip;

  dbSuite('against Postgres', () => {
    let tenant: TestTenant;
    let product: TestProduct;
    let customerId: string;

    beforeAll(async () => {
      tenant = await provisionTestTenant('balance');
      product = await createTestProduct(tenant.scope, `Product ${uuidv7().slice(0, 8)}`);
      await addOpeningStock(tenant.scope, product.id, 500);

      const { customers } = await import('@/db/schema');
      const id = uuidv7();
      await tenant.scope.insert(customers, { id, name: 'Balance Test', phone: null });
      customerId = id;
    });

    afterAll(async () => {
      await tenant.cleanup();
    });

    it('starts at zero for a customer with no history', async () => {
      expect(await customerBalance(tenant.scope, customerId)).toBe(0);
    });

    it('is exactly credit extended minus payments after a mix of both', async () => {
      const extend = async (creditPaisa: number) =>
        commitSale(tenant.scope, {
          saleId: uuidv7(),
          receiptNumber: nextReceipt(),
          customerId,
          lines: [
            {
              lineId: uuidv7(),
              productId: product.id,
              qtyBase: 10,
              enteredUnitLevel: 'tab',
              unitPricePaisa: 350,
              lineDiscountPaisa: 0,
              priceOverridden: false,
            },
          ],
          invoiceDiscountPaisa: 0,
          cashPaisa: 3_500 - creditPaisa,
          creditPaisa,
          changePaisa: 0,
          origin: 'online',
          clientSchemaVersion: 1,
          clientCommittedAt: new Date(),
        });

      await extend(2_000);
      await extend(1_500);
      await commitSettlement(tenant.scope, settlement({ customerId, amountPaisa: 1_000 }));

      expect(await customerBalance(tenant.scope, customerId)).toBe(2_500);
    });
  });
});
