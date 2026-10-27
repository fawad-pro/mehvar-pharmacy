/**
 * What `db:migrate` actually did — and whether it was enough.
 *
 * WHY THIS EXISTS
 *
 * `migrate` used to end with:
 *
 *     Migrations applied (6 file(s)).
 *
 * That number is a count of `.sql` FILES IN A FOLDER. It is printed whether six
 * migrations were applied, one was, or none were. A developer who pulls a
 * branch, runs `db:migrate`, and sees "applied (6 file(s))" has been told
 * nothing at all — and the next thing they see is the application crashing on a
 * column that does not exist.
 *
 * That is the same shape of failure `migrations-location.ts` was written to
 * stop: a step that cannot do its job reporting that it did. The folder problem
 * was fixed by making a missing folder fatal; this is the other half — making
 * the SUCCESS message describe reality.
 *
 * Two things a person needs after a migration, neither of which was printed:
 *
 *   1. **Which database.** `DATABASE_ADMIN_URL ?? DATABASE_URL`, and dotenv
 *      fills either from `.env` when the shell does not set it. It is entirely
 *      possible — this happened while investigating — to believe you are
 *      migrating one database while migrating another, and the output looks
 *      identical either way.
 *   2. **What was applied.** Nothing, or something, and which.
 *
 * And one thing nothing checked at all: that after migrating, the schema is
 * actually current. `assertJournalApplied` turns "the application crashes on a
 * missing column, tomorrow" into "migrate refuses, now, naming the migration".
 */

/** One entry of drizzle's `meta/_journal.json`. */
export interface JournalEntry {
  readonly tag: string;
  readonly when: number;
}

/** A row of `drizzle.__drizzle_migrations`. */
export interface AppliedMigration {
  readonly createdAt: number;
}

export interface MigrationReport {
  /** Journal entries with no matching row — what this run should have applied. */
  readonly missing: readonly JournalEntry[];
  readonly appliedCount: number;
  readonly journalCount: number;
}

/**
 * Compares the journal against what the database records.
 *
 * Matched on `created_at`, which is what drizzle stores: the journal's `when`
 * for each entry. Comparing counts alone would pass a database that had six
 * rows recorded from a DIFFERENT journal, which is exactly the state a shared
 * or long-lived development database drifts into.
 */
export function compareJournal(
  journal: readonly JournalEntry[],
  applied: readonly AppliedMigration[],
): MigrationReport {
  const recorded = new Set(applied.map((row) => row.createdAt));
  return {
    missing: journal.filter((entry) => !recorded.has(entry.when)),
    appliedCount: applied.length,
    journalCount: journal.length,
  };
}

/**
 * The sentence printed after a successful run.
 *
 * Names the database, and says what changed — including saying plainly that
 * nothing did, which is the case the old message made indistinguishable from
 * every other. `recordedOnly` names migrations recorded rather than run
 * (`renumbered-migrations.ts`); they are not reported as applied, because
 * nothing about the schema changed for them.
 */
export function describeRun(
  databaseLabel: string,
  before: MigrationReport,
  after: MigrationReport,
  recordedOnly: readonly string[] = [],
): string {
  const applied = before.missing.filter(
    (entry) =>
      !after.missing.some((left) => left.when === entry.when) && !recordedOnly.includes(entry.tag),
  );

  if (applied.length === 0 && recordedOnly.length === 0) {
    return `${databaseLabel}: already up to date (${after.appliedCount} migration(s) applied previously).`;
  }

  const recorded =
    recordedOnly.length === 0
      ? ''
      : `; recorded ${recordedOnly.length} it had already applied under an earlier number`;
  return [
    `${databaseLabel}: applied ${applied.length} migration(s)${recorded}.`,
    ...applied.map((entry) => `  + ${entry.tag}`),
  ].join('\n');
}

/**
 * Refuses to report success when the database is still behind the code.
 *
 * The message names the migrations rather than the count, because "2
 * migrations are missing" sends someone to read a folder while
 * "0005_catalog_identity is missing" sends them to the answer.
 */
export function assertJournalApplied(databaseLabel: string, report: MigrationReport): void {
  if (report.missing.length === 0) return;

  throw new Error(
    [
      `${databaseLabel} is still behind the code after migrating.`,
      '',
      'These migrations are in the journal but not recorded as applied:',
      ...report.missing.map((entry) => `  ${entry.tag}`),
      '',
      'The application will fail on whatever these add — usually as a',
      '"column does not exist" error on a page that has nothing to do with',
      'the migration.',
      '',
      'Most often this means the database was migrated by a different',
      'journal, or that DATABASE_ADMIN_URL points somewhere other than the',
      'database the application reads. Check the name above is the one you',
      'expect.',
    ].join('\n'),
  );
}

/**
 * A human label for a connection string, with the password removed.
 *
 * Printed on every run, so "which database did that touch?" is never a
 * question. Parsing is deliberately forgiving: a URL this cannot read is still
 * worth labelling badly rather than crashing the migration over a log line.
 */
export function describeTarget(connectionString: string): string {
  try {
    const url = new URL(connectionString);
    const database = url.pathname.replace(/^\//, '') || '(default)';
    const host = url.port ? `${url.hostname}:${url.port}` : url.hostname;
    return `${database} on ${host} as ${url.username || '(default user)'}`;
  } catch {
    return 'the configured database';
  }
}
