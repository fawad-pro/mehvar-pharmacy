/**
 * `commitPurchaseCorrection` — [PCN-009]'s writer for correcting a received line.
 *
 * Same shape as every transactional writer: owns its transaction whole, and is
 * idempotent on the client id from the first commit. Online-only and
 * owner-only (enforced by the action), like supplier payments: correcting an
 * invoice is not something done mid-sale.
 *
 * The purchase line is never touched (ADR-1). Stock moves through ADR-8's two
 * guarded batch functions, so `batches.qty_remaining` and the verifier agree;
 * `batchLedger` counts the correction's deltas. A correction that adds units
 * does not answer the pending layer — a later purchase or count correction
 * still does that — because "the invoice said 10, 12 arrived" is a fact about
 * this delivery, not evidence about units sold before it.
 */

import {
  correctionsForLine,
  findCorrectionById,
  insertPurchaseCorrection,
  lockLineForCorrection,
} from '@/db/correction-queries';
import { restockToBatch } from '@/db/returns-queries';
import { consumeFromBatch } from '@/db/sales-queries';
import type { TenantScope } from '@/db/scoped';
import type { Uuid } from '@/lib/uuid';

import {
  correctedLine,
  lineStateOf,
  planCorrection,
  type CorrectionRejection,
} from './purchase-correction';

export interface PurchaseCorrectionCommand {
  /** Client-generated. Idempotency key, as everywhere else. */
  readonly correctionId: Uuid;
  readonly purchaseLineId: Uuid;
  /**
   * What the line should have said: invoiced and free quantities in base
   * units — whole packs, for a line bought per pack (PCN-012).
   */
  readonly qtyBase: number;
  readonly bonusQtyBase: number;
  /** Invoiced cost of ONE of the line's unit: per pack, or per base unit on an older line. */
  readonly unitCostPaisa: number;
  /** Why — required, because a correction without a reason is an edit. */
  readonly note: string;
}

export type PurchaseCorrectionResult =
  | { ok: true; value: { correctionId: Uuid; alreadyCommitted: boolean } }
  | { ok: false; reason: CorrectionRejection | 'unknown_line' };

export async function commitPurchaseCorrection(
  scope: TenantScope,
  command: PurchaseCorrectionCommand,
): Promise<PurchaseCorrectionResult> {
  return scope.transaction(async (tx) => {
    if (await findCorrectionById(tx, command.correctionId)) {
      return {
        ok: true,
        value: { correctionId: command.correctionId, alreadyCommitted: true },
      } satisfies PurchaseCorrectionResult;
    }

    const line = await lockLineForCorrection(tx, command.purchaseLineId);
    if (!line) {
      return { ok: false, reason: 'unknown_line' } satisfies PurchaseCorrectionResult;
    }

    const current = correctedLine(lineStateOf(line), await correctionsForLine(tx, line.lineId));
    const planned = planCorrection(
      current,
      {
        qtyBase: command.qtyBase,
        bonusQtyBase: command.bonusQtyBase,
        unitCostPaisa: command.unitCostPaisa,
      },
      command.note,
      line.batchRemainingBase,
    );
    if (!planned.ok) {
      return planned;
    }
    const { plan } = planned;

    if (plan.stockDeltaBase < 0) {
      // Guarded: under the batch lock this cannot fail, but if it ever does
      // the transaction refuses rather than writing a correction stock
      // cannot honour.
      if (!(await consumeFromBatch(tx, line.batchId, -plan.stockDeltaBase))) {
        return { ok: false, reason: 'more_than_on_hand' } satisfies PurchaseCorrectionResult;
      }
    } else if (plan.stockDeltaBase > 0) {
      await restockToBatch(tx, line.batchId, plan.stockDeltaBase);
    }

    await insertPurchaseCorrection(tx, {
      id: command.correctionId,
      purchaseLineId: line.lineId,
      batchId: line.batchId,
      qtyDeltaBase: plan.qtyDeltaBase,
      bonusDeltaBase: plan.bonusDeltaBase,
      correctedUnitCostPaisa: plan.correctedUnitCostPaisa,
      correctedUnitCostPaisaEntered: plan.correctedUnitCostPaisaEntered,
      effectiveUnitCostPaisa: plan.effectiveUnitCostPaisa,
      invoiceDeltaPaisa: plan.invoiceDeltaPaisa,
      note: command.note.trim(),
    });

    return {
      ok: true,
      value: { correctionId: command.correctionId, alreadyCommitted: false },
    } satisfies PurchaseCorrectionResult;
  });
}
