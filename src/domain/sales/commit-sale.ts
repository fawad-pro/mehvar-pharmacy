/**
 * `commitSale` — the one transaction (Phase 9 §5.3, ADR-5).
 *
 *   "Sale commit = one transaction: insert sale + lines + FEFO allocations +
 *    payment + decrement qty_remaining. Offline ingestion runs the identical
 *    function per record, idempotent on client ID."
 *
 * This is the most consequential function in the product. Everything the
 * business promises passes through it: the money the customer is charged, the
 * stock the owner believes, the attribution the audit rests on. Three properties
 * are non-negotiable and each is implemented rather than intended.
 *
 * **It is one transaction.** Either every row lands or none does. A sale with
 * lines but no allocations, or allocations without a decrement, is a permanently
 * wrong stock figure that no later correction can distinguish from reality.
 *
 * **It is idempotent on the client id.** ADR-3 makes the counter mint sale ids
 * offline; sync may deliver the same sale more than once, and delivery is the
 * only thing that may repeat — never its effects. Idempotency is built in here,
 * on day one, rather than added on Day 5, because "one code path" (ADR-5) means
 * the online path must already have the property the offline path needs.
 *
 * **It never refuses a sellable cart.** Insufficient stock is not an error: it
 * is a pending allocation (D2) and a visible exception. P2 has no exceptions.
 */

import {
  consumeFromBatch,
  findSaleById,
  insertAllocations,
  insertSale,
  insertSaleLines,
  lockBatchesForProducts,
} from '@/db/sales-queries';
import type { TenantScope } from '@/db/scoped';
import { paisa, type Paisa } from '@/lib/branded';
import { uuidv7, type Uuid } from '@/lib/uuid';

import { planAllocation } from '../inventory/allocation';

export interface SaleLineCommand {
  /** Client-generated; becomes `sale_lines.id`. */
  readonly lineId: Uuid;
  readonly productId: Uuid;
  readonly qtyBase: number;
  readonly enteredUnitLevel: string;
  /** Per base unit, as charged (ADR-5: the client's last-known price). */
  readonly unitPricePaisa: number;
  readonly lineDiscountPaisa: number;
  readonly priceOverridden: boolean;
}

export interface SaleCommand {
  /** Client-generated (ADR-3). The idempotency key. */
  readonly saleId: Uuid;
  readonly receiptNumber: string;
  readonly customerId: Uuid | null;
  readonly lines: readonly SaleLineCommand[];
  readonly invoiceDiscountPaisa: number;
  readonly cashPaisa: number;
  readonly creditPaisa: number;
  readonly changePaisa: number;
  readonly origin: 'online' | 'offline_sync';
  readonly clientSchemaVersion: number;
  readonly clientCommittedAt: Date;
}

export type SaleRejection =
  | 'empty_cart'
  | 'invalid_quantity'
  | 'split_mismatch'
  | 'credit_without_customer'
  | 'negative_amount'
  | 'stale_batch_state';

export interface SaleCommitted {
  readonly saleId: Uuid;
  readonly receiptNumber: string;
  readonly subtotalPaisa: Paisa;
  readonly totalPaisa: Paisa;
  /** Base units that had no batch — the D2 exposure, per product. */
  readonly pendingByProduct: Readonly<Record<string, number>>;
  /** True when this call found the sale already committed (ADR-3 replay). */
  readonly alreadyCommitted: boolean;
}

export type SaleResult = { ok: true; value: SaleCommitted } | { ok: false; reason: SaleRejection };

/**
 * Validates a command against Phase 5 invariant 4 before any row is written.
 *
 * Pure and exported so the UI can check the same rules it will be judged by,
 * and so the schema's CHECK constraints are a backstop rather than the first
 * line of defence — a CHECK violation reaching a counter is an error message
 * nobody can act on.
 */
export function validateSaleCommand(
  command: SaleCommand,
): { ok: true; subtotalPaisa: number; totalPaisa: number } | { ok: false; reason: SaleRejection } {
  if (command.lines.length === 0) {
    return { ok: false, reason: 'empty_cart' };
  }

  let subtotal = 0;
  for (const line of command.lines) {
    if (!Number.isSafeInteger(line.qtyBase) || line.qtyBase <= 0) {
      return { ok: false, reason: 'invalid_quantity' };
    }
    if (line.unitPricePaisa < 0 || line.lineDiscountPaisa < 0) {
      return { ok: false, reason: 'negative_amount' };
    }
    const gross = line.unitPricePaisa * line.qtyBase;
    subtotal += Math.max(0, gross - line.lineDiscountPaisa);
  }

  if (command.invoiceDiscountPaisa < 0 || command.cashPaisa < 0 || command.creditPaisa < 0) {
    return { ok: false, reason: 'negative_amount' };
  }

  const total = subtotal - command.invoiceDiscountPaisa;
  if (total < 0) {
    return { ok: false, reason: 'negative_amount' };
  }
  if (command.cashPaisa + command.creditPaisa !== total) {
    return { ok: false, reason: 'split_mismatch' };
  }
  if (command.creditPaisa > 0 && command.customerId === null) {
    return { ok: false, reason: 'credit_without_customer' };
  }

  return { ok: true, subtotalPaisa: subtotal, totalPaisa: total };
}

/**
 * Commits a sale.
 *
 * One transaction, from the batch lock to the last allocation row.
 */
export async function commitSale(scope: TenantScope, command: SaleCommand): Promise<SaleResult> {
  const validation = validateSaleCommand(command);
  if (!validation.ok) {
    return validation;
  }

  return scope.transaction(async (tx) => {
    // ADR-3 replay: the same sale delivered twice is delivered, not committed
    // twice. Checked inside the transaction so two concurrent deliveries of the
    // same id cannot both pass the check.
    const existing = await findSaleById(tx, command.saleId);
    if (existing) {
      return {
        ok: true,
        value: {
          saleId: command.saleId,
          receiptNumber: existing.receiptNumber,
          subtotalPaisa: paisa(validation.subtotalPaisa),
          totalPaisa: paisa(existing.totalPaisa),
          pendingByProduct: {},
          alreadyCommitted: true,
        },
      } satisfies SaleResult;
    }

    const productIds = [...new Set(command.lines.map((line) => line.productId))];
    const available = await lockBatchesForProducts(tx, productIds);

    await insertSale(tx, {
      id: command.saleId,
      receiptNumber: command.receiptNumber,
      customerId: command.customerId,
      subtotalPaisa: validation.subtotalPaisa,
      invoiceDiscountPaisa: command.invoiceDiscountPaisa,
      totalPaisa: validation.totalPaisa,
      cashPaisa: command.cashPaisa,
      creditPaisa: command.creditPaisa,
      changePaisa: command.changePaisa,
      origin: command.origin,
      clientSchemaVersion: command.clientSchemaVersion,
      clientCommittedAt: command.clientCommittedAt,
    });

    await insertSaleLines(
      tx,
      command.lines.map((line) => ({
        id: line.lineId,
        saleId: command.saleId,
        productId: line.productId,
        qtyBase: line.qtyBase,
        enteredUnitLevel: line.enteredUnitLevel,
        unitPricePaisa: line.unitPricePaisa,
        lineDiscountPaisa: line.lineDiscountPaisa,
        priceOverridden: line.priceOverridden,
      })),
    );

    const allocationRows: Array<{
      id: Uuid;
      saleLineId: Uuid;
      batchId: string | null;
      qtyBase: number;
      unitCostPaisa: number | null;
    }> = [];
    const pendingByProduct: Record<string, number> = {};

    for (const line of command.lines) {
      // Batches for this product, minus what earlier lines in this same cart
      // already took. Two lines of the same product must not both be planned
      // against the same units — a cart with "3 strips" and "4 tablets" of one
      // medicine is ordinary, and getting this wrong over-allocates a batch.
      const remaining = available.get(line.productId) ?? [];
      const plan = planAllocation(remaining, line.qtyBase as never);

      for (const allocation of plan.allocations) {
        allocationRows.push({
          id: uuidv7(),
          saleLineId: line.lineId,
          batchId: allocation.batchId,
          qtyBase: allocation.qtyBase,
          unitCostPaisa: allocation.unitCostPaisa,
        });

        if (allocation.batchId === null) {
          pendingByProduct[line.productId] =
            (pendingByProduct[line.productId] ?? 0) + allocation.qtyBase;
          continue;
        }

        const consumed = await consumeFromBatch(tx, allocation.batchId, allocation.qtyBase);
        if (!consumed) {
          // The locked read said there was enough and the guarded update
          // disagreed. That should be impossible under FOR UPDATE; if it ever
          // happens the transaction aborts rather than writing a half-truth.
          throw new StaleBatchStateError(allocation.batchId);
        }

        const batch = remaining.find((candidate) => candidate.batchId === allocation.batchId);
        if (batch) {
          // Keep the in-memory view in step for the next line of the same cart.
          const index = remaining.indexOf(batch);
          remaining[index] = {
            ...batch,
            qtyRemainingBase: batch.qtyRemainingBase - allocation.qtyBase,
          };
        }
      }

      available.set(line.productId, remaining);
    }

    await insertAllocations(tx, allocationRows);

    return {
      ok: true,
      value: {
        saleId: command.saleId,
        receiptNumber: command.receiptNumber,
        subtotalPaisa: paisa(validation.subtotalPaisa),
        totalPaisa: paisa(validation.totalPaisa),
        pendingByProduct,
        alreadyCommitted: false,
      },
    } satisfies SaleResult;
  });
}

export class StaleBatchStateError extends Error {
  constructor(batchId: string) {
    super(`Batch ${batchId} changed under a locked read; the sale was not committed.`);
    this.name = 'StaleBatchStateError';
  }
}
