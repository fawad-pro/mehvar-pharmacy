/**
 * `db:migrate` — apply forward-only migrations (Phase 11 §4, Phase 12 §2.2).
 *
 * Run in the pre-deploy gate (Phase 12 §2.3), immediately before the ADR-8
 * rebuild verifier in post-deploy verification (§2.4), and by the Windows
 * installer on every install and update.
 *
 * A missing migrations folder is FATAL. It used to be a clean exit — correct
 * in Session 0, when there were none — and that early return is what let the
 * first real Windows install create an empty database and call it success.
 * See `migrations-location.ts`.
 */
import 'dotenv/config';

import { existsSync, readdirSync } from 'node:fs';

import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Pool } from 'pg';

import { resolveMigrationsFolder } from './migrations-location';

/** A directory that exists and holds at least one `.sql` file. */
function looksLikeMigrations(candidate: string): boolean {
  try {
    return existsSync(candidate) && readdirSync(candidate).some((entry) => entry.endsWith('.sql'));
  } catch {
    return false;
  }
}

async function main(): Promise<void> {
  const url = process.env.DATABASE_ADMIN_URL ?? process.env.DATABASE_URL;
  if (!url) {
    throw new Error('DATABASE_URL is not set. Copy .env.example to .env first.');
  }

  const { folder, searched } = resolveMigrationsFolder({
    env: process.env,
    scriptDir: __dirname,
    cwd: process.cwd(),
    looksLikeMigrations,
  });

  if (folder === undefined) {
    throw new Error(
      [
        'No migrations folder found. Looked in:',
        '',
        ...searched.map((candidate) => `  ${candidate}`),
        '',
        'Set MEHVAR_MIGRATIONS_DIR to the folder holding the .sql files.',
        '',
        'This is fatal on purpose: continuing would leave an empty database',
        'and report success, which is exactly how the first Windows install',
        'failed.',
      ].join('\n'),
    );
  }

  console.log(`Applying migrations from ${folder}`);

  const pool = new Pool({ connectionString: url });
  try {
    await migrate(drizzle(pool), { migrationsFolder: folder });
    console.log(
      `Migrations applied (${readdirSync(folder).filter((e) => e.endsWith('.sql')).length} file(s)).`,
    );
  } finally {
    await pool.end();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
