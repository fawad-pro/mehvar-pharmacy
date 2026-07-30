/**
 * `db:migrate` — apply forward-only migrations (Phase 11 §4, Phase 12 §2.2).
 *
 * Run in the pre-deploy gate (Phase 12 §2.3) and immediately before the ADR-8
 * rebuild verifier in post-deploy verification (§2.4).
 */
import 'dotenv/config';

import { existsSync, readdirSync } from 'node:fs';
import path from 'node:path';

import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Pool } from 'pg';

const MIGRATIONS_FOLDER = path.join(process.cwd(), 'src/db/migrations');

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error('DATABASE_URL is not set. Copy .env.example to .env first.');
  }

  const hasMigrations =
    existsSync(MIGRATIONS_FOLDER) &&
    readdirSync(MIGRATIONS_FOLDER).some((entry) => entry.endsWith('.sql'));

  if (!hasMigrations) {
    // Session 0: the schema (Phase 9) lands on Day 1. Exiting cleanly keeps the
    // `db:reset && db:migrate && db:seed` contract honest from the very first commit.
    console.log('No migrations yet — the Phase 9 schema lands in Session 1 (Day 1).');
    return;
  }

  const pool = new Pool({ connectionString: url });
  try {
    await migrate(drizzle(pool), { migrationsFolder: MIGRATIONS_FOLDER });
    console.log('Migrations applied.');
  } finally {
    await pool.end();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
