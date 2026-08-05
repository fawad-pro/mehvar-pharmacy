/**
 * Raw database connection.
 *
 * ============================================================================
 * DO NOT IMPORT THIS OUTSIDE `src/db`. The lint rule in eslint.config.mjs
 * enforces it, and that rule is ADR-2 made mechanical: every tenant-scoped
 * query is constructed in `scoped.ts`, which is the single chokepoint standing
 * between the application and cross-tenant leakage.
 * ============================================================================
 */

import 'server-only';

import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';

import { serverEnv } from '@/env';

import * as schema from './schema';

let pool: Pool | undefined;

function connectionPool(): Pool {
  if (pool === undefined) {
    pool = new Pool({ connectionString: serverEnv().DATABASE_URL });
  }
  return pool;
}

/**
 * The unscoped Drizzle handle. Two legitimate callers, and no others:
 *   - `scoped.ts`, which wraps it in tenant context;
 *   - global-catalog access (Phase 9 §6), whose tables carry no tenant_id.
 */
export function database(): ReturnType<typeof drizzle<typeof schema>> {
  return drizzle(connectionPool(), { schema });
}

/**
 * Close the pool and forget it.
 *
 * The server never calls this — the process outlives every request, so a pool
 * that is created once and never closed is exactly right there. A *script* is
 * the opposite shape. `ops:restore-drill` verifies a scratch database and then
 * drops it, and PostgreSQL refuses to drop a database that still has a session
 * on it: left open, the drill fails its cleanup with
 * `database "mehvar_restore_drill" is being accessed by other users` — after
 * the verification it exists to run has already passed.
 *
 * Safe to call when no pool was ever built, and safe to call twice.
 */
export async function closeDatabase(): Promise<void> {
  if (pool === undefined) return;
  const closing = pool;
  pool = undefined;
  await closing.end();
}

export type Database = ReturnType<typeof database>;
