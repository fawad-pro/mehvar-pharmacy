/**
 * [PCN-012] Every batch's cost basis and the movements that took units out of
 * it — what `domain/inventory/batch-cost.ts` costs cumulatively.
 *
 * Inside `src/db` because ADR-2 puts every query here. Plain grouped queries,
 * folded in TypeScript (the Day 3 / Day 9 rule): no correlated subqueries.
 *
 * The basis is CURRENT (D1): the batch's total as corrected and its units
 * received as corrected. A batch from before PCN-012 has no stored total and
 * reads it from its purchase line (exactly what was invoiced) or, for opening
 * or counted stock, `unit_cost × qty_received` (what was entered).
 *
 * Every outflow is a movement (D2): sales (by their sale line's time — a
 * pending allocation resolved later still belongs to its sale), write-offs and
 * other negative adjustments, and returns to the supplier. A customer return
 * restocked into the batch is a movement back.
 */

import 'server-only';

import { and, eq, isNotNull, lt, sql } from 'drizzle-orm';

import { costMovements, type BatchCostBasis } from '@/domain/inventory/batch-cost';

import type { TenantScope } from './scoped';
import { purchaseLineCostSql } from './purchase-line-cost';
import {
  adjustments,
  batches,
  purchaseCorrections,
  purchaseLines,
  saleLineAllocations,
  saleLines,
  saleReturnLines,
  saleReturns,
  supplierReturns,
} from './schema';

export type MovementKind = 'sale' | 'adjustment' | 'supplier_return' | 'restock';

export interface CostedMovement {
  readonly id: string;
  readonly kind: MovementKind;
  readonly batchId: string;
  readonly at: Date;
  /** Base units out; negative for a restock. */
  readonly qtyBase: number;
  /** This movement's cumulative share of the batch cost; negative for a restock. */
  readonly costPaisa: number;
}

export interface BatchCostLedger {
  readonly basis: ReadonlyMap<string, BatchCostBasis>;
  /** Every movement up to the cut-off, oldest first, each costed. */
  readonly movements: readonly CostedMovement[];
}

/** Each batch's current cost basis (D1). */
export async function batchCostBases(scope: TenantScope): Promise<Map<string, BatchCostBasis>> {
  const rows = await scope.db
    .select({
      id: batches.id,
      qtyReceivedBase: batches.qtyReceivedBase,
      unitCostPaisa: batches.unitCostPaisa,
      costTotalPaisa: batches.costTotalPaisa,
      lineCostPaisa: purchaseLineCostSql,
    })
    .from(batches)
    .leftJoin(
      purchaseLines,
      and(eq(batches.source, 'purchase_line'), eq(purchaseLines.id, batches.sourceId)),
    )
    .where(scope.scopeOf(batches));

  const corrections = await scope.db
    .select({
      batchId: purchaseCorrections.batchId,
      invoiceDelta: sql<string>`sum(${purchaseCorrections.invoiceDeltaPaisa})`,
      stockDelta: sql<string>`sum(${purchaseCorrections.qtyDeltaBase} + ${purchaseCorrections.bonusDeltaBase})`,
    })
    .from(purchaseCorrections)
    .where(scope.scopeOf(purchaseCorrections))
    .groupBy(purchaseCorrections.batchId);
  const corrected = new Map(corrections.map((row) => [row.batchId, row]));

  return new Map(
    rows.map((row) => {
      const correction = corrected.get(row.id);
      const asReceived =
        row.costTotalPaisa ??
        (row.lineCostPaisa !== null ? Number(row.lineCostPaisa) : null) ??
        row.unitCostPaisa * row.qtyReceivedBase;
      return [
        row.id,
        {
          totalPaisa: asReceived + Number(correction?.invoiceDelta ?? 0),
          receivedBase: row.qtyReceivedBase + Number(correction?.stockDelta ?? 0),
        },
      ];
    }),
  );
}

/**
 * Every movement out of (or back into) any batch before `until`, costed.
 * A movement's cost depends only on the movements before it, so a cut-off
 * loses nothing a report of an earlier range needs.
 */
export async function batchCostLedger(
  scope: TenantScope,
  /** Movements strictly before this; every movement when absent. */
  until?: Date,
): Promise<BatchCostLedger> {
  const basis = await batchCostBases(scope);

  const sold = await scope.db
    .select({
      id: saleLineAllocations.id,
      batchId: saleLineAllocations.batchId,
      at: saleLines.createdAt,
      qtyBase: saleLineAllocations.qtyBase,
    })
    .from(saleLineAllocations)
    .innerJoin(saleLines, eq(saleLines.id, saleLineAllocations.saleLineId))
    .where(
      scope.scopeOf(
        saleLineAllocations,
        isNotNull(saleLineAllocations.batchId),
        until ? lt(saleLines.createdAt, until) : undefined,
      ),
    );

  const adjusted = await scope.db
    .select({
      id: adjustments.id,
      batchId: adjustments.batchId,
      at: adjustments.createdAt,
      delta: adjustments.qtyBaseDelta,
    })
    .from(adjustments)
    .where(
      scope.scopeOf(
        adjustments,
        isNotNull(adjustments.batchId),
        lt(adjustments.qtyBaseDelta, 0),
        until ? lt(adjustments.createdAt, until) : undefined,
      ),
    );

  const returnedToSupplier = await scope.db
    .select({
      id: supplierReturns.id,
      batchId: supplierReturns.batchId,
      at: supplierReturns.createdAt,
      qtyBase: supplierReturns.qtyBase,
    })
    .from(supplierReturns)
    .where(scope.scopeOf(supplierReturns, until ? lt(supplierReturns.createdAt, until) : undefined));

  const restocked = await scope.db
    .select({
      id: saleReturnLines.id,
      batchId: saleReturnLines.restockBatchId,
      at: saleReturns.createdAt,
      qtyBase: saleReturnLines.qtyBase,
    })
    .from(saleReturnLines)
    .innerJoin(saleReturns, eq(saleReturns.id, saleReturnLines.saleReturnId))
    .where(
      scope.scopeOf(
        saleReturnLines,
        isNotNull(saleReturnLines.restockBatchId),
        until ? lt(saleReturns.createdAt, until) : undefined,
      ),
    );

  type Raw = Omit<CostedMovement, 'costPaisa'>;
  const raw: Raw[] = [
    ...sold.map((row) => ({ ...row, batchId: row.batchId!, kind: 'sale' as const })),
    ...adjusted.map((row) => ({
      id: row.id,
      batchId: row.batchId!,
      at: row.at,
      qtyBase: -row.delta,
      kind: 'adjustment' as const,
    })),
    ...returnedToSupplier.map((row) => ({ ...row, kind: 'supplier_return' as const })),
    ...restocked.map((row) => ({
      id: row.id,
      batchId: row.batchId!,
      at: row.at,
      qtyBase: -row.qtyBase,
      kind: 'restock' as const,
    })),
  ];

  // Oldest first; ties broken by id so the order — and every cost — is stable.
  raw.sort((a, b) => a.at.getTime() - b.at.getTime() || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  const byBatch = new Map<string, Raw[]>();
  for (const movement of raw) {
    byBatch.set(movement.batchId, [...(byBatch.get(movement.batchId) ?? []), movement]);
  }

  const costs = new Map<string, number>();
  for (const [batchId, movements] of byBatch) {
    const batchBasis = basis.get(batchId) ?? { totalPaisa: 0, receivedBase: 0 };
    for (const [id, cost] of costMovements(batchBasis, movements)) {
      costs.set(id, cost);
    }
  }

  return {
    basis,
    movements: raw.map((movement) => ({ ...movement, costPaisa: costs.get(movement.id) ?? 0 })),
  };
}
