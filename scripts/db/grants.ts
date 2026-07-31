/**
 * `db:grants` — Phase 9 §5.1, the enforcement half of ADR-1.
 *
 *   "Immutability: REVOKE UPDATE/DELETE on event tables for the app role;
 *    allocation-resolution and qty_remaining changes go through SECURITY
 *    DEFINER functions (or the single transaction path) — the only doors, and
 *    they only open forward."
 *
 * Run as the database owner (DATABASE_ADMIN_URL) after every migration that
 * adds a table. Idempotent: safe to re-run, and it must be re-run, because a
 * new event table starts life with default privileges.
 *
 * A note on why this matters operationally: a REVOKE against the table owner is
 * inert. The application MUST connect as a role that does not own the schema,
 * or this guarantee is decorative. See PCN-001 in docs/PLAN_CHANGE_NOTES.md.
 */
import 'dotenv/config';

import { Pool } from 'pg';

import { EVENT_TABLES } from '../../src/db/schema';

/** Tables the app may UPDATE: reference entities, plus ADR-8's single cache. */
const MUTABLE_TABLES = [
  'tenants',
  'users',
  'devices',
  'sessions',
  'products',
  'product_barcodes',
  'customers',
  'suppliers',
  'batches',
  'global_products',
  'global_barcodes',
  'catalog_proposals',
] as const;

/**
 * Owner-defined routines the app role may execute — see migration 0003.
 *
 * Signatures are spelled out because Postgres overloads on them, and granting
 * by bare name would silently miss a future overload.
 */
const SECURITY_DEFINER_ROUTINES = [
  'resolve_sale_line_allocation(uuid, uuid, uuid, bigint, uuid, uuid)',
] as const;

function quoteIdent(name: string): string {
  return `"${name.replaceAll('"', '""')}"`;
}

async function main(): Promise<void> {
  const adminUrl = process.env.DATABASE_ADMIN_URL ?? process.env.DATABASE_URL;
  if (!adminUrl) {
    throw new Error('DATABASE_ADMIN_URL (or DATABASE_URL) is not set.');
  }

  const role = process.env.APP_DB_ROLE;
  if (!role) {
    console.log(
      'APP_DB_ROLE is not set — skipping grants.\n' +
        'Without a non-owning application role, Phase 9 §5.1 immutability is not enforced.\n' +
        'See PCN-001 in docs/PLAN_CHANGE_NOTES.md.',
    );
    return;
  }

  const pool = new Pool({ connectionString: adminUrl });
  const app = quoteIdent(role);

  try {
    const { rows } = await pool.query<{ exists: boolean }>(
      'SELECT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = $1) AS exists',
      [role],
    );
    if (!rows[0]?.exists) {
      const password = process.env.APP_DB_PASSWORD;
      if (!password) {
        throw new Error(`Role ${role} does not exist and APP_DB_PASSWORD is not set to create it.`);
      }
      await pool.query(`CREATE ROLE ${app} LOGIN PASSWORD '${password.replaceAll("'", "''")}'`);
      console.log(`Created role ${role}.`);
    }

    await pool.query(`GRANT USAGE ON SCHEMA public TO ${app}`);

    // Reference entities and ADR-8's single transactional cache are mutable.
    for (const table of MUTABLE_TABLES) {
      await pool.query(`GRANT SELECT, INSERT, UPDATE, DELETE ON ${quoteIdent(table)} TO ${app}`);
    }

    // Event tables accept INSERT only. This is ADR-1 as a database privilege
    // rather than a code convention — the difference between a promise and a
    // guarantee, and the whole reason the product can say numbers cannot lie.
    for (const table of EVENT_TABLES) {
      await pool.query(`GRANT SELECT, INSERT ON ${quoteIdent(table)} TO ${app}`);
      await pool.query(`REVOKE UPDATE, DELETE ON ${quoteIdent(table)} FROM ${app}`);
    }

    // The one exception, and it is deliberately a *function* rather than a
    // table privilege: allocation resolution (ADR-8, migration 0003). The role
    // still cannot UPDATE `sale_line_allocations`; it can only ask the owner's
    // SECURITY DEFINER function to move a pending row to resolved, under the
    // guards written into the function itself. One capability, not one column
    // of open season on an event table.
    for (const routine of SECURITY_DEFINER_ROUTINES) {
      await pool.query(`GRANT EXECUTE ON FUNCTION ${routine} TO ${app}`);
    }

    // Drizzle's own bookkeeping.
    await pool.query(`GRANT USAGE ON SCHEMA drizzle TO ${app}`);
    await pool.query(`GRANT SELECT ON ALL TABLES IN SCHEMA drizzle TO ${app}`);

    console.log(
      `Grants applied to ${role}: INSERT-only on ${EVENT_TABLES.length} event tables, ` +
        `full DML on ${MUTABLE_TABLES.length} reference tables, ` +
        `EXECUTE on ${SECURITY_DEFINER_ROUTINES.length} sanctioned routine(s).`,
    );
  } finally {
    await pool.end();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
