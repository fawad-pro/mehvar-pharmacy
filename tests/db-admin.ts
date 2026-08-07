/**
 * Test-only administrative database access.
 *
 * The application role cannot DELETE from event tables — that is Phase 9 §5.1
 * working as designed, and it means test teardown needs the owner connection.
 * Keeping that capability here, in `tests/`, rather than anywhere under `src/`
 * is deliberate: nothing the product ships can reach it.
 */

import { Pool } from 'pg';

let pool: Pool | undefined;

function adminPool(): Pool {
  const url = process.env.DATABASE_ADMIN_URL ?? process.env.DATABASE_URL;
  if (!url) {
    throw new Error('No database URL configured for test teardown.');
  }
  pool ??= new Pool({ connectionString: url });
  return pool;
}

export async function adminQuery(sql: string, params: unknown[] = []): Promise<void> {
  await adminPool().query(sql, params);
}

/**
 * The first column of the first row, for asking the server a question about
 * itself — session counts, privilege checks — that the app connection cannot
 * answer about its own state without changing it.
 */
export async function adminValue(sql: string, params: unknown[] = []): Promise<unknown> {
  const result = await adminPool().query<Record<string, unknown>>(sql, params);
  const row = result.rows[0];
  if (row === undefined) return undefined;
  return Object.values(row)[0];
}

/** Removes every row belonging to a test tenant, children first. */
export async function purgeTenant(tenantId: string): Promise<void> {
  const tables = [
    'sale_line_allocations',
    'sale_return_lines',
    'sale_returns',
    'sale_lines',
    'payments',
    'sales',
    'purchase_lines',
    'purchases',
    'adjustments',
    'cash_movements',
    'batches',
    'product_barcodes',
    'products',
    'customers',
    'suppliers',
    'catalog_proposals',
    'sessions',
    'devices',
    'users',
  ];
  for (const table of tables) {
    await adminQuery(`DELETE FROM "${table}" WHERE tenant_id = $1`, [tenantId]);
  }
  await adminQuery('DELETE FROM tenants WHERE id = $1', [tenantId]);
}

/**
 * Asserts that a rejection came from Postgres refusing the statement. Drizzle
 * wraps driver errors, so the reason is on the cause chain rather than the
 * message.
 */
export function isPermissionDenied(error: unknown): boolean {
  let current: unknown = error;
  for (let depth = 0; depth < 5 && current; depth += 1) {
    const candidate = current as { code?: string; message?: string; cause?: unknown };
    // 42501 is insufficient_privilege.
    if (candidate.code === '42501' || /permission denied/i.test(candidate.message ?? '')) {
      return true;
    }
    current = candidate.cause;
  }
  return false;
}
