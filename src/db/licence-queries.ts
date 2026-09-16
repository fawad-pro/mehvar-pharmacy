import 'server-only';

import { desc, eq, max, min, sql } from 'drizzle-orm';

import {
  adjustments,
  cashMovements,
  clockObservations,
  licences,
  payments,
  purchases,
  saleReturns,
  sales,
  tenants,
} from '@/db/schema';
import { tenantScope, globalCatalog, type TenantScope } from '@/db/scoped';
import {
  effectiveLicenceRow,
  isBoundHere,
  rebindsUsed,
  REBIND_WINDOW_DAYS,
  type LicenceRow,
} from '@/domain/licensing/verify';
import type { Uuid } from '@/lib/uuid';

/**
 * Licensing reads and the one licence write (PCN-005).
 *
 * `licences` and `clock_observations` are event tables, so there is deliberately
 * no update or delete anywhere in this module — renewing is a row, rebinding is
 * a row, and repairing a poisoned clock is a signed `clockCeiling` rather than a
 * DELETE (Invariant L6). If a future change wants to modify one of these rows,
 * that is a design error and not a grant to widen.
 *
 * Every derived figure here is computed in TypeScript from plain per-table
 * aggregates. No correlated `sql` subqueries: a correlated subquery is correct
 * only while its outer query keeps a join it does not own, so an unrelated edit
 * can silently falsify it — and it counts zero forever without erroring.
 */

const DAY_MS = 86_400_000;

/** The shape the domain selects over. Dates, not strings. */
export interface StoredLicence extends LicenceRow {
  readonly id: Uuid;
}

export async function listLicences(scope: TenantScope): Promise<StoredLicence[]> {
  const rows = await scope.select(licences);
  return rows.map((row) => ({
    id: row.id as Uuid,
    licenceId: row.licenceId,
    token: row.token,
    issuedAt: row.issuedAt,
    entitlementEndsAt: row.entitlementEndsAt,
    installationId: row.installationId,
    installedAt: row.createdAt,
  }));
}

/**
 * Insert a verified licence. Idempotent on (tenant, licence, installation): a
 * second paste of the same token on the same machine collapses onto the
 * existing row, and the same token on a NEW machine is a rebind and gets a row
 * of its own.
 *
 * `onConflictDoNothing` rather than an upsert, because there is nothing to
 * update — the row is a record of something that happened.
 */
export async function insertLicence(
  scope: TenantScope,
  input: {
    readonly id: Uuid;
    readonly token: string;
    readonly licenceId: string;
    readonly issuedAt: Date;
    readonly entitlementEndsAt: Date;
    readonly tokenExpiresAt: Date;
    readonly graceDays: number;
    readonly warnDays: number;
    readonly installationId: string;
  },
): Promise<void> {
  await scope.db
    .insert(licences)
    .values({
      id: input.id,
      tenantId: scope.tenantId,
      createdBy: scope.userId,
      token: input.token,
      licenceId: input.licenceId,
      issuedAt: input.issuedAt,
      entitlementEndsAt: input.entitlementEndsAt,
      tokenExpiresAt: input.tokenExpiresAt,
      graceDays: input.graceDays,
      warnDays: input.warnDays,
      installationId: input.installationId,
    })
    .onConflictDoNothing();
}

export interface LicenceStanding {
  readonly rows: StoredLicence[];
  readonly effective: StoredLicence | undefined;
  readonly boundHere: boolean;
  readonly rebindsUsed: number;
}

/** Invariants L2 and L3, asked as the two separate questions they are. */
export async function licenceStanding(
  scope: TenantScope,
  installationId: string,
  now: Date,
): Promise<LicenceStanding> {
  const rows = await listLicences(scope);
  const effective = effectiveLicenceRow(rows);
  if (effective === undefined) {
    return { rows, effective: undefined, boundHere: false, rebindsUsed: 0 };
  }
  const since = new Date(now.getTime() - REBIND_WINDOW_DAYS * DAY_MS);
  return {
    rows,
    effective,
    boundHere: isBoundHere(rows, effective.licenceId, installationId),
    rebindsUsed: rebindsUsed(rows, effective.licenceId, since),
  };
}

/**
 * The newest event row across the ledger — one anchor of `businessNow`.
 *
 * Six plain grouped aggregates merged in TypeScript, which is this codebase's
 * settled pattern for a multi-table rollup (`reportFigures` does the same). A
 * `UNION` would need a column list of casts nobody could read, for six numbers.
 */
export async function ledgerHighWaterMark(scope: TenantScope): Promise<Date | undefined> {
  const tables = [sales, payments, saleReturns, cashMovements, adjustments, purchases] as const;

  const results = await Promise.all(
    tables.map(async (table) => {
      const [row] = await scope.db
        .select({ newest: max(table.createdAt) })
        .from(table)
        .where(scope.scopeOf(table));
      return row?.newest ?? undefined;
    }),
  );

  return latestOf(results);
}

/** The oldest event row — one of the four sources the trial anchor mins over. */
export async function earliestEventAt(scope: TenantScope): Promise<Date | undefined> {
  const tables = [sales, payments, saleReturns, cashMovements, adjustments, purchases] as const;

  const results = await Promise.all(
    tables.map(async (table) => {
      const [row] = await scope.db
        .select({ oldest: min(table.createdAt) })
        .from(table)
        .where(scope.scopeOf(table));
      return row?.oldest ?? undefined;
    }),
  );

  return earliestOf(results);
}

function latestOf(dates: ReadonlyArray<Date | undefined>): Date | undefined {
  let best: Date | undefined;
  for (const date of dates) {
    if (date === undefined) continue;
    if (best === undefined || date.getTime() > best.getTime()) best = date;
  }
  return best;
}

function earliestOf(dates: ReadonlyArray<Date | undefined>): Date | undefined {
  let best: Date | undefined;
  for (const date of dates) {
    if (date === undefined) continue;
    if (best === undefined || date.getTime() < best.getTime()) best = date;
  }
  return best;
}

export async function tenantCreatedAt(tenantId: Uuid): Promise<Date | undefined> {
  const [row] = await globalCatalog()
    .select({ createdAt: tenants.createdAt })
    .from(tenants)
    .where(eq(tenants.id, tenantId))
    .limit(1);
  return row?.createdAt;
}

/** A scope for licensing reads that run outside a request (the boot job). */
export function licensingScope(tenantId: Uuid, userId: Uuid): TenantScope {
  return tenantScope({ tenantId, userId });
}

/* ------------------------------------------------------------------ */
/* The clock witness — tenant-free, because it is a fact about the     */
/* machine rather than about any one pharmacy.                          */
/* ------------------------------------------------------------------ */

/**
 * Observations, newest first, capped.
 *
 * Only the top of the list can matter: the witness is the K-th largest, so
 * anything below the first K rows cannot change it. The cap keeps a machine
 * that has been running for years from reading its whole history to answer one
 * question — and it is safe precisely because the reducer is a K-th largest.
 */
export async function recentObservations(limit = 200): Promise<Date[]> {
  const rows = await globalCatalog()
    .select({ observedAt: clockObservations.observedAt })
    .from(clockObservations)
    .orderBy(desc(clockObservations.observedAt))
    .limit(limit);
  return rows.map((row) => row.observedAt);
}

export async function newestObservation(): Promise<Date | undefined> {
  const [row] = await globalCatalog()
    .select({ newest: max(clockObservations.observedAt) })
    .from(clockObservations);
  return row?.newest ?? undefined;
}

export async function earliestObservation(): Promise<Date | undefined> {
  const [row] = await globalCatalog()
    .select({ oldest: min(clockObservations.observedAt) })
    .from(clockObservations);
  return row?.oldest ?? undefined;
}

export async function recordObservation(
  id: Uuid,
  observedAt: Date,
  source: 'boot' | 'interval',
): Promise<void> {
  await globalCatalog().insert(clockObservations).values({ id, observedAt, source });
}

/**
 * The top distinct observation values with their counts — the support bundle's
 * histogram.
 *
 * This is what lets a human separate the two causes of `system_behind`, which
 * the software deliberately does not try to guess: a clock fault is one row at
 * 2099 against hundreds at 2026, and a rollback is a dense continuous run.
 */
export async function observationHistogram(
  limit = 8,
): Promise<Array<{ readonly day: string; readonly count: number }>> {
  const day = sql<string>`to_char(${clockObservations.observedAt}, 'YYYY-MM-DD')`;
  const rows = await globalCatalog()
    .select({ day, count: sql<string>`count(*)` })
    .from(clockObservations)
    .groupBy(day)
    .orderBy(desc(day))
    .limit(limit);
  return rows.map((row) => ({ day: row.day, count: Number(row.count) }));
}
