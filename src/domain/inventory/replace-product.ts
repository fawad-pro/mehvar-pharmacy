/**
 * [PCN-012] `replaceProduct` — "Replace this product", the owner's fix for a
 * product whose pack sizes were set wrong after stock or sales exist.
 *
 * A pack size cannot be edited once anything is recorded against it (every
 * stored quantity is a count of base units, and the sizes say what those
 * counts mean). So the product is replaced instead, in one transaction:
 *
 *  - a new product with the right pack is created;
 *  - every batch still holding stock leaves the old product through a
 *    `product_replaced` adjustment and arrives on the new one through another,
 *    at the count the owner confirmed in the new pack, with the same expiry
 *    and batch number. Its cost moves across exactly: what the old batch still
 *    holds is its total less the cumulative cost of everything that already
 *    left it (`batch-cost-queries.ts`), so nothing is written off and nothing
 *    is invented;
 *  - barcodes move to the unit of the same name; any other code is unlinked
 *    and listed so the owner can link it again;
 *  - the old product becomes inactive and names its replacement. Its sales and
 *    any unanswered shortfalls stay where they were recorded (ADR-1), and the
 *    shortfalls stay on the exception list until answered.
 *
 * Owner-only at the action. Idempotent: the old product can be replaced once.
 *
 * [PCN-013] `replaceIntoProduct` is the same move into a product the shop
 * already has — stock typed against the wrong product when the right one
 * exists. Allowed only when both count the same base unit, so no quantity is
 * silently reinterpreted; the owner still confirms each batch's count in the
 * receiving product's packs. Either way, stock arriving on a product that has
 * sold short answers those shortfalls (D2), as any arriving stock does.
 */

import { batchCostLedger } from '@/db/batch-cost-queries';
import {
  batchesOnHand,
  insertAdjustment,
  materializeAdjustmentBatch,
} from '@/db/adjustment-queries';
import { findProduct, markProductReplaced, moveBarcodesByUnitName } from '@/db/catalog-queries';
import { pendingAllocationsForProducts, resolveAllocation } from '@/db/purchase-queries';
import { consumeFromBatch } from '@/db/sales-queries';
import type { TenantScope } from '@/db/scoped';
import { uuidv7, type Uuid } from '@/lib/uuid';

import type { ProductDraft } from '../catalog/product';
import { createProduct } from '../catalog/writers';
import { planResolution } from './resolve-pending';

export interface ReplacedBatch {
  readonly batchId: Uuid;
  /** What the screen showed the batch holding; the move refuses if it changed. */
  readonly expectedRemainingBase: number;
  /** The owner's count, in the NEW product's base units. */
  readonly newQtyBase: number;
}

export interface ReplaceProductCommand {
  readonly oldProductId: Uuid;
  readonly product: ProductDraft;
  readonly batches: readonly ReplacedBatch[];
  readonly note: string | null;
}

export type ReplaceProductRejection =
  | 'not_found'
  | 'already_replaced'
  /** Stock moved since the screen was drawn: sold, returned or received. */
  | 'stale_batches'
  /** A batch confirmed at zero: write it off first, so the loss is visible. */
  | 'invalid_count'
  | 'invalid_product'
  /** [PCN-013] The product to move into is missing, removed, replaced, or this one. */
  | 'invalid_target'
  /** [PCN-013] The two count different base units: the counts would change meaning. */
  | 'base_unit_differs';

export type ReplaceProductResult =
  | {
      ok: true;
      value: {
        newProductId: Uuid;
        movedBatches: number;
        unlinkedBarcodes: { barcode: string; unitLevelName: string }[];
        /** Shortfalls on the receiving product that the moved stock answered (D2). */
        resolvedPendingBase: number;
      };
    }
  | {
      ok: false;
      reason: ReplaceProductRejection;
      /** For `invalid_product`: what the product form would have said. */
      detail?: unknown;
    };

/** Thrown inside the transaction so nothing half-done survives (see commit-adjustment). */
class ReplaceRefused extends Error {
  constructor(
    readonly reason: ReplaceProductRejection,
    readonly detail?: unknown,
  ) {
    super(reason);
    this.name = 'ReplaceRefused';
  }
}

export async function replaceProduct(
  scope: TenantScope,
  command: ReplaceProductCommand,
): Promise<ReplaceProductResult> {
  if (
    command.batches.some(
      (batch) => !Number.isSafeInteger(batch.newQtyBase) || batch.newQtyBase <= 0,
    )
  ) {
    return { ok: false, reason: 'invalid_count' };
  }

  try {
    return await scope.transaction(async (tx) => {
      const old = await findProduct(tx, command.oldProductId);
      if (!old) throw new ReplaceRefused('not_found');

      const created = await createProduct(tx, command.product);
      if (!created.ok) {
        throw new ReplaceRefused('invalid_product', created);
      }
      const newProductId = created.value;

      return {
        ok: true,
        value: await moveStockAndRetire(tx, command, newProductId),
      } satisfies ReplaceProductResult;
    });
  } catch (error) {
    return refusal(error);
  }
}

export interface ReplaceIntoCommand {
  readonly oldProductId: Uuid;
  readonly intoProductId: Uuid;
  readonly batches: readonly ReplacedBatch[];
  readonly note: string | null;
}

/** [PCN-013] Moves the stock into a product the shop already has. */
export async function replaceIntoProduct(
  scope: TenantScope,
  command: ReplaceIntoCommand,
): Promise<ReplaceProductResult> {
  if (
    command.batches.some(
      (batch) => !Number.isSafeInteger(batch.newQtyBase) || batch.newQtyBase <= 0,
    )
  ) {
    return { ok: false, reason: 'invalid_count' };
  }

  try {
    return await scope.transaction(async (tx) => {
      const old = await findProduct(tx, command.oldProductId);
      if (!old) throw new ReplaceRefused('not_found');
      const into = await findProduct(tx, command.intoProductId);
      if (!into || into.id === old.id || !into.isActive || into.replacedByProductId !== null) {
        throw new ReplaceRefused('invalid_target');
      }
      if (sameUnitName(into.baseUnitName) !== sameUnitName(old.baseUnitName)) {
        throw new ReplaceRefused('base_unit_differs');
      }
      return {
        ok: true,
        value: await moveStockAndRetire(tx, command, command.intoProductId),
      } satisfies ReplaceProductResult;
    });
  } catch (error) {
    return refusal(error);
  }
}

function sameUnitName(name: string): string {
  return name.trim().toLowerCase();
}

function refusal(error: unknown): ReplaceProductResult {
  if (error instanceof ReplaceRefused) {
    return {
      ok: false,
      reason: error.reason,
      ...(error.detail === undefined ? {} : { detail: error.detail }),
    };
  }
  throw error;
}

/**
 * The move itself, shared by both: every batch with stock leaves the old
 * product at what the screen saw and arrives on `newProductId` at the owner's
 * count with its remaining cost; barcodes follow by unit name; the old product
 * is retired, naming where its stock went; shortfalls on the receiving
 * product are answered from the arriving stock.
 */
async function moveStockAndRetire(
  tx: TenantScope,
  command: { oldProductId: Uuid; batches: readonly ReplacedBatch[]; note: string | null },
  newProductId: Uuid,
): Promise<{
  newProductId: Uuid;
  movedBatches: number;
  unlinkedBarcodes: { barcode: string; unitLevelName: string }[];
  resolvedPendingBase: number;
}> {
  // First write on the old product, and the lock: a second replacement
  // finds it already named and changes nothing.
  if (!(await markProductReplaced(tx, command.oldProductId, newProductId))) {
    throw new ReplaceRefused('already_replaced');
  }

  // Every batch with stock must be accounted for, at what the screen saw.
  const onHand = await batchesOnHand(tx, command.oldProductId);
  const confirmed = new Map(command.batches.map((batch) => [batch.batchId, batch]));
  if (
    onHand.length !== command.batches.length ||
    onHand.some(
      (batch) =>
        confirmed.get(batch.batchId as Uuid)?.expectedRemainingBase !== batch.qtyRemainingBase,
    )
  ) {
    throw new ReplaceRefused('stale_batches');
  }

  // What each batch still holds, in cost: its total less what already left.
  const ledger = await batchCostLedger(tx);
  const taken = new Map<string, number>();
  for (const movement of ledger.movements) {
    taken.set(movement.batchId, (taken.get(movement.batchId) ?? 0) + movement.costPaisa);
  }

  const fresh = await findProduct(tx, newProductId);
  const pricePerBase = fresh?.pricePaisa ?? 0;

  const arrivals: { batchId: string; inId: Uuid; qtyBase: number; unitCostPaisa: number }[] = [];
  for (const batch of onHand) {
    const move = confirmed.get(batch.batchId as Uuid)!;
    const basis = ledger.basis.get(batch.batchId);
    const costPaisa = Math.max(0, (basis?.totalPaisa ?? 0) - (taken.get(batch.batchId) ?? 0));

    const outId = uuidv7();
    await insertAdjustment(tx, {
      id: outId,
      productId: command.oldProductId,
      batchId: batch.batchId,
      qtyBaseDelta: -batch.qtyRemainingBase,
      reason: 'product_replaced',
      note: command.note,
    });
    if (!(await consumeFromBatch(tx, batch.batchId as Uuid, batch.qtyRemainingBase))) {
      throw new ReplaceRefused('stale_batches');
    }

    const inId = uuidv7();
    const newBatchId = uuidv7();
    await materializeAdjustmentBatch(tx, {
      id: newBatchId,
      productId: newProductId,
      sourceId: inId,
      batchNumber: batch.batchNumber,
      expiryDate: batch.expiryDate,
      // Nominal; margin reads `costTotalPaisa` (PCN-012).
      unitCostPaisa: Math.ceil(costPaisa / move.newQtyBase),
      pricePerBaseUnitPaisa: pricePerBase,
      qtyReceivedBase: move.newQtyBase,
      qtyRemainingBase: move.newQtyBase,
      costTotalPaisa: costPaisa,
    });
    await insertAdjustment(tx, {
      id: inId,
      productId: newProductId,
      batchId: newBatchId,
      qtyBaseDelta: move.newQtyBase,
      reason: 'product_replaced',
      note: command.note,
    });
    arrivals.push({
      batchId: newBatchId,
      inId,
      qtyBase: move.newQtyBase,
      unitCostPaisa: Math.ceil(costPaisa / move.newQtyBase),
    });
  }

  // D2: stock arriving on a product that sold short answers those sales, as a
  // delivery or a count would. A new product has none, so this is the
  // existing-product case (PCN-013) in practice.
  let resolvedPendingBase = 0;
  const pending = await pendingAllocationsForProducts(tx, [newProductId]);
  if (pending.length > 0) {
    const arrivedBy = new Map(arrivals.map((arrival) => [arrival.batchId, arrival.inId]));
    const plan = planResolution(
      pending,
      arrivals.map((arrival) => ({
        batchId: arrival.batchId,
        productId: newProductId,
        qtyAvailableBase: arrival.qtyBase,
        unitCostPaisa: arrival.unitCostPaisa,
      })),
    );
    for (const resolution of plan.resolutions) {
      const moved = await resolveAllocation(tx, {
        allocationId: resolution.allocationId,
        batchId: resolution.batchId,
        unitCostPaisa: resolution.unitCostPaisa,
        purchaseLineId: null,
        adjustmentId: arrivedBy.get(resolution.batchId) ?? null,
      });
      // Answered first by someone else: the units stay on the shelf.
      if (!moved) continue;
      if (!(await consumeFromBatch(tx, resolution.batchId, resolution.qtyBase))) {
        throw new ReplaceRefused('stale_batches');
      }
      resolvedPendingBase += resolution.qtyBase;
    }
  }

  const unlinkedBarcodes = await moveBarcodesByUnitName(
    tx,
    command.oldProductId,
    newProductId,
    fresh?.units.map((unit) => unit.name) ?? [],
  );

  return { newProductId, movedBatches: onHand.length, unlinkedBarcodes, resolvedPendingBase };
}
