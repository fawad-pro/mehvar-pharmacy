/**
 * `commitAdjustment` refusing to remove units a batch does not have.
 *
 * The refusal used to be RETURNED from inside the transaction, which committed
 * it: the adjustment row stayed, the batch kept its units, and the verifier
 * reported a mismatch (ADR-8, sev-1). The Adjust screen then said "try again",
 * so the operator wrote a second phantom. Everything here is about the
 * refusal leaving nothing behind.
 */
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { adjustments, batches } from '@/db/schema';
import { uuidv7 } from '@/lib/uuid';

import {
  addOpeningStock,
  createTestProduct,
  provisionTestTenant,
  type TestProduct,
  type TestTenant,
} from '../../../tests/fixtures';

import { commitAdjustment, type AdjustmentCommand } from './commit-adjustment';
import { verifyBatches } from './rebuild';

const suite = process.env.DATABASE_URL ? describe : describe.skip;

suite('commitAdjustment against Postgres', () => {
  let tenant: TestTenant;
  let product: TestProduct;

  beforeAll(async () => {
    tenant = await provisionTestTenant('adjustment');
    product = await createTestProduct(tenant.scope, `Adjusted ${uuidv7().slice(-6)}`, 500);
  });

  afterAll(async () => {
    await tenant.cleanup();
  });

  function damage(batchId: string, units: number): AdjustmentCommand {
    return {
      adjustmentId: uuidv7(),
      productId: product.id,
      batchId: batchId as AdjustmentCommand['batchId'],
      qtyBaseDelta: -units,
      reason: 'damage',
      note: null,
    };
  }

  it('removing more than the batch has writes nothing, and the records still agree', async () => {
    const batchId = await addOpeningStock(tenant.scope, product.id, 2);
    const command = damage(batchId, 3);

    const result = await commitAdjustment(tenant.scope, command);
    expect(result).toEqual({ ok: false, reason: 'stale_batch_state' });

    const written = await tenant.scope.select(
      adjustments,
      eq(adjustments.id, command.adjustmentId),
    );
    expect(written).toHaveLength(0);

    const [batch] = await tenant.scope.select(batches, eq(batches.id, batchId));
    expect(batch?.qtyRemainingBase).toBe(2);

    const report = await verifyBatches(tenant.scope);
    expect(report.mismatches).toEqual([]);
  });

  it('a retry of the refused adjustment is refused again, never reported as already done', async () => {
    const batchId = await addOpeningStock(tenant.scope, product.id, 1);
    const command = damage(batchId, 3);

    const first = await commitAdjustment(tenant.scope, command);
    const second = await commitAdjustment(tenant.scope, command);

    expect(first.ok).toBe(false);
    expect(second).toEqual({ ok: false, reason: 'stale_batch_state' });
    expect((await verifyBatches(tenant.scope)).mismatches).toEqual([]);
  });

  it('removing exactly what the batch has still commits', async () => {
    const batchId = await addOpeningStock(tenant.scope, product.id, 3);

    const result = await commitAdjustment(tenant.scope, damage(batchId, 3));
    expect(result.ok).toBe(true);

    const [batch] = await tenant.scope.select(batches, eq(batches.id, batchId));
    expect(batch?.qtyRemainingBase).toBe(0);
    expect((await verifyBatches(tenant.scope)).mismatches).toEqual([]);
  });

  it('a removal counted in strips is recorded as counted; a wrong strip size is refused (PCN-012)', async () => {
    const batchId = await addOpeningStock(tenant.scope, product.id, 30);

    const wrong = await commitAdjustment(tenant.scope, {
      ...damage(batchId, 5),
      entered: { unitKey: 'u1', unitName: 'strip', unitCount: 1 },
    });
    expect(wrong).toEqual({ ok: false, reason: 'invalid_unit' });

    const command = {
      ...damage(batchId, 20),
      entered: { unitKey: 'u1', unitName: 'strip', unitCount: 2 },
    };
    expect((await commitAdjustment(tenant.scope, command)).ok).toBe(true);
    const [row] = await tenant.scope.select(adjustments, eq(adjustments.id, command.adjustmentId));
    expect(row).toMatchObject({
      qtyBaseDelta: -20,
      unitKey: 'u1',
      unitName: 'strip',
      unitCount: 2,
    });
    const [batch] = await tenant.scope.select(batches, eq(batches.id, batchId));
    expect(batch?.qtyRemainingBase).toBe(10);
    expect((await verifyBatches(tenant.scope)).ok).toBe(true);
  });
});
