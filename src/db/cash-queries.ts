/**
 * Cash-movement queries — W10.
 *
 * Inside `src/db` because ADR-2 puts every query here.
 */

import 'server-only';

import { desc, eq, sql, sum } from 'drizzle-orm';

import type { TenantScope } from './scoped';
import { cashMovements, users } from './schema';

import type { CashDirection, CashReason } from '@/domain/cash/cash-command';
import type { Uuid } from '@/lib/uuid';

/** Idempotency: the same movement delivered twice is recorded once. */
export async function findCashMovementById(
  scope: TenantScope,
  movementId: Uuid,
): Promise<{ id: string } | undefined> {
  const row = await scope.selectOne(cashMovements, eq(cashMovements.id, movementId));
  return row ? { id: row.id } : undefined;
}

/** [PCN-013] A movement as a reversal needs it. */
export async function findCashMovementForReversal(
  scope: TenantScope,
  movementId: Uuid,
): Promise<
  | {
      id: string;
      direction: CashDirection;
      amountPaisa: number;
      reason: CashReason;
      reversesId: string | null;
    }
  | undefined
> {
  const row = await scope.selectOne(cashMovements, eq(cashMovements.id, movementId));
  return row
    ? {
        id: row.id,
        direction: row.direction,
        amountPaisa: row.amountPaisa,
        reason: row.reason,
        reversesId: row.reversesId,
      }
    : undefined;
}

/** [PCN-013] The row cancelling this movement, if one exists. */
export async function findCashMovementReversalOf(
  scope: TenantScope,
  movementId: Uuid,
): Promise<{ id: string } | undefined> {
  const row = await scope.selectOne(cashMovements, eq(cashMovements.reversesId, movementId));
  return row ? { id: row.id } : undefined;
}

export async function insertCashMovement(
  scope: TenantScope,
  row: Omit<typeof cashMovements.$inferInsert, 'tenantId' | 'createdBy'>,
): Promise<void> {
  await scope.insert(cashMovements, row as never);
}

/** Net cash movement in a window — the drawer's expected-cash term (W10). */
export async function netCashMovementInRange(
  scope: TenantScope,
  from: Date,
  to: Date,
): Promise<number> {
  const rows = await scope.db
    .select({ direction: cashMovements.direction, total: sum(cashMovements.amountPaisa).as('total') })
    .from(cashMovements)
    .where(
      scope.scopeOf(
        cashMovements,
        sql`${cashMovements.createdAt} >= ${from} AND ${cashMovements.createdAt} < ${to}`,
      ),
    )
    .groupBy(cashMovements.direction);

  let net = 0;
  for (const row of rows) {
    const total = Number(row.total ?? 0);
    net += row.direction === 'in' ? total : -total;
  }
  return net;
}

export interface CashMovementRow {
  readonly id: string;
  readonly direction: CashDirection;
  readonly amountPaisa: number;
  readonly reason: CashReason;
  readonly note: string | null;
  readonly byName: string;
  readonly createdAt: Date;
}

export async function cashMovementsInRange(
  scope: TenantScope,
  from: Date,
  to: Date,
): Promise<CashMovementRow[]> {
  const rows = await scope.db
    .select({
      id: cashMovements.id,
      direction: cashMovements.direction,
      amountPaisa: cashMovements.amountPaisa,
      reason: cashMovements.reason,
      note: cashMovements.note,
      byName: users.name,
      createdAt: cashMovements.createdAt,
    })
    .from(cashMovements)
    .innerJoin(users, eq(cashMovements.createdBy, users.id))
    .where(
      scope.scopeOf(
        cashMovements,
        sql`${cashMovements.createdAt} >= ${from} AND ${cashMovements.createdAt} < ${to}`,
      ),
    )
    .orderBy(desc(cashMovements.createdAt));

  return rows;
}
