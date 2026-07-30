/**
 * THE tenant chokepoint — ADR-2, Phase 9 §5.2, Phase 11 §1.
 *
 *   "One data-access module owns every query; it requires tenant context to
 *    construct. No raw queries outside it."
 *
 * Row-scoped multi-tenancy is a consciously taken trade-off (Phase 13 §5): it is
 * the only variant compatible with one-week delivery and solo operations, and
 * the price is that isolation is guaranteed by discipline in ONE place rather
 * than by the database. This is that place. Postgres RLS is the documented
 * post-V1 hardening step (Phase 12 §5), not a V1 dependency.
 *
 * Three properties make the guarantee hold rather than merely being intended:
 *
 *   1. A scope cannot be constructed without a tenant id and an acting user —
 *      not "should not", cannot: the constructor rejects it.
 *   2. Tenant filtering is applied by this module, never by a call site. A
 *      caller cannot forget a WHERE clause it never writes.
 *   3. Tenant-free global-catalog tables are unreachable through a tenant scope,
 *      at compile time — `globalProducts` has no `tenant_id` column, so passing
 *      it to a scoped method does not type-check. Phase 6 §2's line between
 *      shared identity and tenant commercial data is enforced by the type
 *      system, not by memory.
 */

import 'server-only';

import { and, eq, getTableColumns, type SQL } from 'drizzle-orm';
import type { PgColumn, PgTable, PgTransaction } from 'drizzle-orm/pg-core';

import type { Uuid } from '@/lib/uuid';

import { database, type Database } from './client';

/** A table that carries `tenant_id` — i.e. everything except Phase 9 §6. */
export type TenantTable = PgTable & { tenantId: PgColumn };

/**
 * Insert payload with the columns this module stamps removed.
 *
 * Uses the table's own `$inferInsert` rather than `InferInsertModel<T>`: the
 * latter loses its column keys when resolved through this generic constraint.
 */
export type ScopedInsert<T extends TenantTable> = Omit<T['$inferInsert'], 'tenantId' | 'createdBy'>;

/** Row shape returned by reads and by `returning()`. */
export type ScopedRow<T extends TenantTable> = T['$inferSelect'];

export interface ActingContext {
  /** The pharmacy. Every row read or written belongs to exactly this tenant. */
  readonly tenantId: Uuid;
  /** The active PIN user — every record's attribution comes from here (T1, ADR-7). */
  readonly userId: Uuid;
}

export class MissingTenantContextError extends Error {
  constructor(what: string) {
    super(
      `Refusing to construct a data-access scope without ${what}. ` +
        'ADR-2: tenant isolation is guaranteed by this chokepoint alone.',
    );
    this.name = 'MissingTenantContextError';
  }
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function requireUuid(value: unknown, what: string): Uuid {
  if (typeof value !== 'string' || !UUID_PATTERN.test(value)) {
    throw new MissingTenantContextError(what);
  }
  return value;
}

type Executor = Database | PgTransaction<never, never, never>;

/**
 * A tenant-bound handle on the database. Construct with `tenantScope()`.
 */
export class TenantScope {
  readonly tenantId: Uuid;
  readonly userId: Uuid;

  /** @internal — use `tenantScope()`. */
  constructor(
    private readonly executor: Executor,
    context: ActingContext,
    private readonly inTransaction: boolean = false,
  ) {
    this.tenantId = requireUuid(context?.tenantId, 'a tenant id');
    this.userId = requireUuid(context?.userId, 'an acting user id');
  }

  /**
   * The tenant predicate, conjoined with any extra conditions. Exposed because
   * complex reads (Phase 9 §7's derived views) need to build their own queries —
   * but they build them *here*, inside `src/db`, never at a call site.
   */
  scopeOf<T extends TenantTable>(table: T, ...conditions: Array<SQL | undefined>): SQL {
    const predicate = and(eq(table.tenantId, this.tenantId), ...conditions);
    if (predicate === undefined) {
      // Unreachable: the tenant equality is always present.
      throw new Error('Empty scope predicate');
    }
    return predicate;
  }

  /** Reads rows of `table` belonging to this tenant. */
  async select<T extends TenantTable>(
    table: T,
    ...conditions: Array<SQL | undefined>
  ): Promise<Array<ScopedRow<T>>> {
    const rows = await this.db
      .select()
      .from(table as PgTable)
      .where(this.scopeOf(table, ...conditions));
    return rows as Array<ScopedRow<T>>;
  }

  /** Reads at most one row. Returns `undefined` rather than throwing on absence. */
  async selectOne<T extends TenantTable>(
    table: T,
    ...conditions: Array<SQL | undefined>
  ): Promise<ScopedRow<T> | undefined> {
    const rows = await this.db
      .select()
      .from(table as PgTable)
      .where(this.scopeOf(table, ...conditions))
      .limit(1);
    return rows[0] as ScopedRow<T> | undefined;
  }

  /**
   * Inserts rows, stamping `tenant_id` and — where the table carries it —
   * `created_by`. Attribution is not something a caller can forget to supply
   * (T1: every record carries the user who created it).
   */
  async insert<T extends TenantTable>(
    table: T,
    values: ScopedInsert<T> | Array<ScopedInsert<T>>,
  ): Promise<Array<ScopedRow<T>>> {
    const hasCreatedBy = 'createdBy' in getTableColumns(table);
    const stamp = (row: ScopedInsert<T>): T['$inferInsert'] =>
      ({
        ...row,
        tenantId: this.tenantId,
        ...(hasCreatedBy ? { createdBy: this.userId } : {}),
      }) as T['$inferInsert'];

    const rows = (Array.isArray(values) ? values : [values]).map(stamp);
    if (rows.length === 0) {
      return [];
    }

    const inserted = await this.db
      .insert(table as PgTable)
      .values(rows)
      .returning();
    return inserted as Array<ScopedRow<T>>;
  }

  /**
   * Updates a reference entity (Phase 9 §1: "editable fields limited to
   * identity/settings, never to anything a report derives from").
   *
   * Event tables are unreachable here in the way that counts: the database
   * itself refuses the statement, because Phase 9 §5.1 REVOKEs UPDATE from the
   * application role. This method exists for products, customers, suppliers,
   * users, devices, sessions and tenants — and for `batches.qty_remaining`,
   * whose two sanctioned writers live in `domain/inventory` (ADR-8).
   */
  async update<T extends TenantTable>(
    table: T,
    patch: Partial<T['$inferInsert']>,
    ...conditions: Array<SQL | undefined>
  ): Promise<Array<ScopedRow<T>>> {
    // Stamped here for the same reason `tenant_id` and `created_by` are: a
    // writer cannot forget a column it never sets. ADR-4's incremental index
    // refresh depends on this being true of every catalog edit, everywhere.
    const stamped =
      'updatedAt' in getTableColumns(table) ? { ...patch, updatedAt: new Date() } : patch;

    const rows = await this.db
      .update(table as PgTable)
      .set(stamped)
      .where(this.scopeOf(table, ...conditions))
      .returning();
    return rows as Array<ScopedRow<T>>;
  }

  /**
   * Runs `body` in one database transaction.
   *
   * Phase 11 §2: transactional writers own their transaction boundary whole; no
   * caller composes partial writes. `commitSale` (Phase 9 §5.3) is the reason
   * this exists — one transaction inserts the sale, its lines, the FEFO
   * allocations, the payment, and decrements `qty_remaining`.
   */
  async transaction<R>(body: (scope: TenantScope) => Promise<R>): Promise<R> {
    if (this.inTransaction) {
      // Already inside one — reuse it rather than opening a nested boundary.
      return body(this);
    }
    return this.db.transaction(async (tx) =>
      body(new TenantScope(tx as Executor, { tenantId: this.tenantId, userId: this.userId }, true)),
    );
  }

  /** Narrow escape hatch for `src/db`-internal query building. */
  get db(): Database {
    return this.executor as Database;
  }
}

let singleton: Database | undefined;

function sharedDatabase(): Database {
  singleton ??= database();
  return singleton;
}

/**
 * The only way to reach tenant data.
 *
 * @throws MissingTenantContextError when tenant or acting user is absent —
 *   which is the entire point (Phase 12 §5: "a test asserts that no query path
 *   constructs without tenant context").
 */
export function tenantScope(context: ActingContext): TenantScope {
  return new TenantScope(sharedDatabase(), context);
}

/**
 * Tenant-free access to the global catalog (Phase 9 §6).
 *
 * Deliberately a separate door with a separate name. The global catalog holds
 * identity only — no tenant pricing, no sales data, ever (Phase 6 §2) — and
 * keeping it off `TenantScope` means no query can drift across that line by
 * accident.
 */
export function globalCatalog(): Database {
  return sharedDatabase();
}
