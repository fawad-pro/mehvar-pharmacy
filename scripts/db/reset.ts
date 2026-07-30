/**
 * `db:reset` — drop and recreate the public schema on the local/staging database.
 *
 * Phase 11 §4: "`db:reset && db:migrate && db:seed` must always produce a
 * working demo pharmacy — the demo is a build artifact, always one command away."
 *
 * Refuses to run against production, unconditionally. Append-only records
 * (ADR-1) mean there is no honest way to undo this.
 */
import 'dotenv/config';

import { Pool } from 'pg';

async function main(): Promise<void> {
  const url = process.env.DATABASE_ADMIN_URL ?? process.env.DATABASE_URL;
  if (!url) {
    throw new Error('DATABASE_URL is not set. Copy .env.example to .env first.');
  }
  if (process.env.APP_ENV === 'production' || process.env.NODE_ENV === 'production') {
    throw new Error('db:reset refuses to run against production.');
  }

  const pool = new Pool({ connectionString: url });
  try {
    await pool.query('DROP SCHEMA IF EXISTS public CASCADE');
    await pool.query('CREATE SCHEMA public');
    // Drizzle records applied migrations in its own schema. Dropping `public`
    // alone leaves that ledger intact, so the next `db:migrate` believes it has
    // nothing to do and yields an empty database that claims to be migrated —
    // silently breaking Phase 11 §4's "always one command away" contract.
    await pool.query('DROP SCHEMA IF EXISTS drizzle CASCADE');
    console.log('Schema reset. Run `npm run db:migrate` next.');
  } finally {
    await pool.end();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
