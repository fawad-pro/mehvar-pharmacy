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

export type Database = ReturnType<typeof database>;
