import 'server-only';

import { sql } from 'drizzle-orm';

import { globalCatalog } from './scoped';

/**
 * Can the application reach its database as the app role? What the platform's
 * health check asks (`/api/health`). One trivial statement, no tenant, no
 * table — a deploy that cannot answer this must not take traffic.
 */
export async function databaseReachable(): Promise<boolean> {
  try {
    await globalCatalog().execute(sql`select 1`);
    return true;
  } catch {
    return false;
  }
}
