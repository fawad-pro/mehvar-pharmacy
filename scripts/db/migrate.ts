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

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Pool } from 'pg';

import { resolveMigrationsFolder } from './migrations-location';
import {
  assertJournalApplied,
  compareJournal,
  describeRun,
  describeTarget,
  type AppliedMigration,
  type JournalEntry,
} from './migration-status';

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

  const target = describeTarget(url);
  console.log(`Applying migrations from ${folder}`);
  console.log(`Target: ${target}`);

  const journal = readJournal(folder);

  const pool = new Pool({ connectionString: url });
  try {
    const before = compareJournal(journal, await readApplied(pool));
    await migrate(drizzle(pool), { migrationsFolder: folder });
    const after = compareJournal(journal, await readApplied(pool));

    console.log(describeRun(target, before, after));

    /*
     * The check the old success message stood in for.
     *
     * `migrate()` resolving is not evidence the schema is current — it resolves
     * happily when it decides there is nothing to do, and "nothing to do" is a
     * conclusion drawn from a table that can disagree with the journal. Fail
     * here, naming the migration, rather than let the application discover it
     * as a missing column.
     */
    assertJournalApplied(target, after);
  } finally {
    await pool.end();
  }
}

/** Drizzle's journal — the list of migrations the code expects. */
function readJournal(folder: string): JournalEntry[] {
  const path = join(folder, 'meta', '_journal.json');
  if (!existsSync(path)) {
    // Hand-assembled migration folders (and the packaged payload) are allowed
    // to omit it; without a journal there is nothing to check against, which is
    // weaker but not wrong.
    return [];
  }
  const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'));
  const entries =
    typeof parsed === 'object' && parsed !== null && 'entries' in parsed
      ? (parsed as { entries: unknown }).entries
      : [];
  return Array.isArray(entries)
    ? entries.flatMap((entry: unknown) =>
        typeof entry === 'object' && entry !== null && 'tag' in entry && 'when' in entry
          ? [{ tag: String((entry as JournalEntry).tag), when: Number((entry as JournalEntry).when) }]
          : [],
      )
    : [];
}

/**
 * What the database records as applied.
 *
 * An absent table is not an error — it is a database that has never been
 * migrated, which is the normal first run.
 */
async function readApplied(pool: Pool): Promise<AppliedMigration[]> {
  try {
    const { rows } = await pool.query<{ created_at: string }>(
      'SELECT created_at FROM drizzle.__drizzle_migrations ORDER BY created_at',
    );
    return rows.map((row) => ({ createdAt: Number(row.created_at) }));
  } catch {
    return [];
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
