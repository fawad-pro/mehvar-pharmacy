/**
 * The migration logic behind `db:migrate`.
 *
 * Split out of `migrate.ts` so `ops:restore-drill` can migrate a restored
 * scratch database without spawning the CLI — the same reason `grants-apply.ts`
 * exists. A backup taken before a migration restores into an OLD schema; the
 * drill used to grant and verify it as if it were current, and failed with
 * `relation "supplier_payments" does not exist` on every dump older than 0009.
 *
 * A missing migrations folder is FATAL. It used to be a clean exit — correct
 * in Session 0, when there were none — and that early return is what let the
 * first real Windows install create an empty database and call it success.
 * See `migrations-location.ts`. The folder is found relative to THIS file,
 * which sits at the same depth whether it runs from `scripts/db/` in a
 * checkout or is bundled into `app/bin/db/` or `app/bin/ops/` in the package.
 */
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { readMigrationFiles } from 'drizzle-orm/migrator';
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
import {
  describeRepair,
  planRenumberRepairs,
  type RecordedRow,
  type RenumberRepair,
} from './renumbered-migrations';

/** A directory that exists and holds at least one `.sql` file. */
function looksLikeMigrations(candidate: string): boolean {
  try {
    return existsSync(candidate) && readdirSync(candidate).some((entry) => entry.endsWith('.sql'));
  } catch {
    return false;
  }
}

export async function applyMigrations(url: string): Promise<void> {
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
    const repaired = await recordRenumbered(pool, folder, journal);
    await migrate(drizzle(pool), { migrationsFolder: folder });
    const after = compareJournal(journal, await readApplied(pool));

    console.log(
      describeRun(
        target,
        before,
        after,
        repaired.map((repair) => repair.entry.tag),
      ),
    );

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

/**
 * Records migrations this database already ran under an earlier number, so
 * drizzle does not run them again. See `renumbered-migrations.ts` for the
 * history and the rule; this is only the part that touches the database.
 *
 * Everything that would refuse is checked before anything changes. Then, for
 * each repair in journal order: migrate up to the entry BEFORE it — drizzle
 * runs only what is newer than the newest recorded row, so a database whose
 * newest row is the branch's (dated 2026-08-11) still needs licensing's
 * 0006-0008 run first — and add the row drizzle would have written. No
 * existing row is changed.
 */
async function recordRenumbered(
  pool: Pool,
  folder: string,
  journal: readonly JournalEntry[],
): Promise<readonly RenumberRepair[]> {
  if (journal.length === 0) return [];

  // drizzle's own reading of the folder, so the hashes are the ones it records.
  const hashes = new Map(
    readMigrationFiles({ migrationsFolder: folder }).map((meta) => [meta.folderMillis, meta.hash]),
  );
  const hashed = journal.map((entry) => ({ ...entry, hash: hashes.get(entry.when) ?? '' }));
  const plan = planRenumberRepairs(hashed, await readRecorded(pool));

  const refusals = [...plan.refusals];
  for (const repair of plan.repairs) {
    if (!(await evidencePresent(pool, repair))) refusals.push(missingEvidence(repair));
  }
  if (refusals.length > 0) throw new Error(refusals.join('\n\n'));

  for (const repair of plan.repairs) {
    const index = journal.findIndex((entry) => entry.when === repair.entry.when);
    await migrateEntries(pool, folder, journal.slice(0, index));

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const { rows } = await client.query<{ present: boolean }>(
        `SELECT (${repair.renumbered.evidence}) AS present`,
      );
      if (rows[0]?.present !== true) throw new Error(missingEvidence(repair));
      await client.query(
        `INSERT INTO drizzle.__drizzle_migrations (hash, created_at)
         SELECT $1, $2::bigint
          WHERE NOT EXISTS (SELECT 1 FROM drizzle.__drizzle_migrations WHERE created_at = $2::bigint)`,
        [repair.entry.hash, String(repair.entry.when)],
      );
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
    console.log(describeRepair(repair));
  }

  return plan.repairs;
}

async function evidencePresent(pool: Pool, repair: RenumberRepair): Promise<boolean> {
  const { rows } = await pool.query<{ present: boolean }>(
    `SELECT (${repair.renumbered.evidence}) AS present`,
  );
  return rows[0]?.present === true;
}

function missingEvidence(repair: RenumberRepair): string {
  const { entry, renumbered } = repair;
  return [
    `${entry.tag} is recorded as applied under ${renumbered.formerTag}, but what it`,
    'creates is not all present, so the database has been changed by hand since.',
    'Nothing has been changed. Take a backup and have this database looked at.',
  ].join('\n');
}

/**
 * drizzle's migrate, over only these journal entries: the same folder,
 * staged with a shortened journal. A no-op when they are all recorded.
 */
async function migrateEntries(
  pool: Pool,
  folder: string,
  entries: readonly JournalEntry[],
): Promise<void> {
  if (entries.length === 0) return;
  const raw = JSON.parse(readFileSync(join(folder, 'meta', '_journal.json'), 'utf8')) as {
    entries: Array<{ tag: string }>;
  };
  const tags = new Set(entries.map((entry) => entry.tag));
  const staged = mkdtempSync(join(tmpdir(), 'mehvar-migrate-'));
  try {
    mkdirSync(join(staged, 'meta'));
    for (const tag of tags) copyFileSync(join(folder, `${tag}.sql`), join(staged, `${tag}.sql`));
    writeFileSync(
      join(staged, 'meta', '_journal.json'),
      JSON.stringify({ ...raw, entries: raw.entries.filter((entry) => tags.has(entry.tag)) }),
    );
    await migrate(drizzle(pool), { migrationsFolder: staged });
  } finally {
    rmSync(staged, { recursive: true, force: true });
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
          ? [
              {
                tag: String((entry as JournalEntry).tag),
                when: Number((entry as JournalEntry).when),
              },
            ]
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
  return (await readRecorded(pool)).map((row) => ({ createdAt: row.createdAt }));
}

async function readRecorded(pool: Pool): Promise<RecordedRow[]> {
  try {
    const { rows } = await pool.query<{ created_at: string; hash: string }>(
      'SELECT created_at, hash FROM drizzle.__drizzle_migrations ORDER BY created_at',
    );
    return rows.map((row) => ({ createdAt: Number(row.created_at), hash: row.hash }));
  } catch {
    return [];
  }
}
