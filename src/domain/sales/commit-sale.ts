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
import { findUser } from '@/db/auth-queries';
import { customerBalance } from '@/db/udhaar-queries';
import type { TenantScope } from '@/db/scoped';
import { packFactor, paisa, type Paisa } from '@/lib/branded';
import { businessDayOf } from '@/lib/business-day';
import { nominalPricePerBase } from '@/lib/quantity';
import { uuidv7, type Uuid } from '@/lib/uuid';

import { planAllocation } from '../inventory/allocation';
import {
  invoiceDiscountShares,
  saleLineGrossPaisa,
  storedLineGrossPaisa,
  validateSaleCommand,
  type SaleCommand,
  type SaleRejection,
} from './sale-command';

// The command and its validator are pure and live apart (see `sale-command.ts`
// for why); re-exported so every existing caller keeps one import.
export {
  validateSaleCommand,
  type SaleCommand,
  type SaleLineCommand,
  type SaleRejection,
} from './sale-command';

export interface SaleCommitted {
  readonly saleId: Uuid;
  readonly receiptNumber: string;
  readonly subtotalPaisa: Paisa;
  readonly totalPaisa: Paisa;
  /** Base units that had no batch — the D2 exposure, per product. */
  readonly pendingByProduct: Readonly<Record<string, number>>;
  /** True when this call found the sale already committed (ADR-3 replay). */
  readonly alreadyCommitted: boolean;
  /**
   * The customer's balance immediately before this sale, when credit was
   * extended — W2/Phase 10 §7's mini-statement needs it. Undefined for a
   * fully-cash sale, and on a replay (the figure would already be stale).
   *
   * A display figure, not an authority: Phase 5 invariant 3 means the balance
   * is always re-derivable from records regardless of what any receipt claims,
   * so this is read once inside the transaction rather than locked — the same
   * posture ADR-5 takes on batch-price variance.
   */
  readonly balanceBeforePaisa?: Paisa;
}

export type SaleResult = { ok: true; value: SaleCommitted } | { ok: false; reason: SaleRejection };

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
    // PCN-008: what counts as expired is decided by the day the sale lands,
    // which is also the day the owner's exception list files it under.
    const today = businessDayOf(new Date());

    // Read before the sale lands, so the mini-statement's "previous balance"
    // means what it says (T4/T5, Phase 10 §7).
    const balanceBeforePaisa =
      command.creditPaisa > 0 && command.customerId
        ? paisa(await customerBalance(tx, command.customerId))
        : undefined;

    // [PCN-014] An approval names one of this shop's owners, or it is not
    // kept. Never refused: the receipt has already printed (Phase 7 rule 3);
    // a sale over the limit without a valid approver is the day list's job.
    const approver =
      command.invoiceDiscountPaisa > 0 && command.invoiceDiscountApprovedBy
        ? await findUser(tx, command.invoiceDiscountApprovedBy)
        : undefined;

    await insertSale(tx, {
      id: command.saleId,
      receiptNumber: command.receiptNumber,
      customerId: command.customerId,
      subtotalPaisa: validation.subtotalPaisa,
      invoiceDiscountPaisa: command.invoiceDiscountPaisa,
      invoiceDiscountApprovedBy: approver?.role === 'owner' ? approver.id : null,
      totalPaisa: validation.totalPaisa,
      cashPaisa: command.cashPaisa,
      creditPaisa: command.creditPaisa,
      changePaisa: command.changePaisa,
      origin: command.origin,
      clientSchemaVersion: command.clientSchemaVersion,
      clientCommittedAt: command.clientCommittedAt,
    });

    const lineRows = command.lines.map((line) => ({
      id: line.lineId,
      saleId: command.saleId,
      productId: line.productId,
      qtyBase: line.qtyBase,
      enteredUnitLevel: line.enteredUnitLevel,
      // [PCN-012] The nominal per-base price is derived here, not trusted:
      // money is read from `lineAmountPaisa` whenever it is present.
      unitPricePaisa:
        line.unitCount !== undefined && line.unitPricePaisaEntered !== undefined
          ? nominalPricePerBase(
              paisa(line.unitPricePaisaEntered),
              packFactor(line.qtyBase / line.unitCount),
            )
          : line.unitPricePaisa,
      unitKey: line.unitCount !== undefined ? (line.unitKey ?? null) : null,
      unitName: line.unitCount !== undefined ? (line.unitName ?? null) : null,
      unitCount: line.unitCount ?? null,
      unitPricePaisaEntered:
        line.unitCount !== undefined ? (line.unitPricePaisaEntered ?? null) : null,
      lineAmountPaisa: line.unitCount !== undefined ? saleLineGrossPaisa(line) : null,
      lineDiscountPaisa: line.lineDiscountPaisa,
      priceOverridden: line.priceOverridden,
    }));
    // [PCN-014] Each line's share of the bill discount, from the very values
    // the rows store, so every later reader — a refund, the receipt page —
    // reads the share this sale was charged with.
    const shares = invoiceDiscountShares(
      lineRows.map((row) => ({
        id: row.id,
        totalPaisa: storedLineGrossPaisa(row) - row.lineDiscountPaisa,
      })),
      command.invoiceDiscountPaisa,
    );
    await insertSaleLines(
      tx,
      lineRows.map((row) => ({ ...row, invoiceDiscountSharePaisa: shares.get(row.id) ?? 0 })),
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
      const plan = planAllocation(remaining, line.qtyBase as never, today);

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
        ...(balanceBeforePaisa !== undefined ? { balanceBeforePaisa } : {}),
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
