/**
 * Migrations that were renumbered after databases had already run them.
 *
 * WHY THIS EXISTS
 *
 * drizzle identifies an applied migration by ONE thing: the journal `when` it
 * recorded in `drizzle.__drizzle_migrations.created_at`. It runs every journal
 * entry whose `when` is later than the newest recorded row, and never compares
 * names or contents.
 *
 * Supplier credit was written on a branch as `0006_supplier_credit` (a79e57d,
 * `when` 1786460433684, 2026-08-11). Main had since taken 0006-0008 for
 * licensing, so the work was cherry-picked as `0009_supplier_credit`,
 * regenerated with a new `when` (1790111708134). The SQL is the same file byte
 * for byte (git blob 408d5e0a). To every database that had run the branch,
 * 0009 was a new migration: drizzle re-ran `CREATE TABLE "supplier_payments"`,
 * PostgreSQL refused, the whole batch rolled back (licensing with it, on a
 * database that had not met main yet), and 0010 never ran. The application
 * then crashed on `purchases.credit_tracked`.
 *
 * THE RULE
 *
 * A renumbered migration counts as applied when the database recorded its
 * FORMER `when` with a hash equal to the CURRENT file's hash. drizzle writes
 * that row in the same transaction as the migration's statements, and the hash
 * is the SHA-256 of the file, so the row is proof the identical statements
 * committed. Recording it under the new `when` is what drizzle would have done
 * had it been able to recognise the migration. Nothing is guessed:
 *
 *   - former `when` absent: nothing to do (fresh databases, main's own history);
 *   - former `when` present, hash different: REFUSE. Something else ran under
 *     that number, and deciding what it means is a person's job.
 *
 * Existing rows are never changed or deleted. The branch's row stays as the
 * record of what actually happened; one row is added beside it.
 *
 * Renumbering a migration that has run anywhere is the mistake. If it ever has
 * to happen again, add the pair here in the same commit. `renumbered-migrations
 * .test.ts` requires each pair's hash to match the file, so a later edit to the
 * file cannot quietly turn the proof into a guess.
 */

export interface RenumberedMigration {
  /** The journal tag the migration has now. */
  readonly tag: string;
  /** The tag it was applied under. */
  readonly formerTag: string;
  /** The `when` it was applied under, as recorded in `created_at`. */
  readonly formerWhen: number;
  /**
   * The SHA-256 of the file the former tag applied. Equal to the current
   * file's hash; the test pins that, and planning checks the database's row
   * against the CURRENT file, never against this constant.
   */
  readonly hash: string;
  /**
   * A query returning one boolean: are the objects this migration creates
   * present? Defensive only — the hash is the proof — but it turns a database
   * someone has altered by hand into a refusal rather than a record that lies.
   */
  readonly evidence: string;
}

export const RENUMBERED_MIGRATIONS: readonly RenumberedMigration[] = [
  {
    tag: '0009_supplier_credit',
    formerTag: '0006_supplier_credit',
    formerWhen: 1786460433684,
    hash: '7f6808b10b48b1f78473d8dcd95ca0dd37237978e8c3e5316b2025f7bf8cbf94',
    evidence: `SELECT to_regclass('public.supplier_payments') IS NOT NULL
                  AND EXISTS (SELECT 1 FROM information_schema.columns
                               WHERE table_schema = 'public'
                                 AND table_name = 'purchases'
                                 AND column_name = 'cash_paid_paisa')`,
  },
];

/** A journal entry with the hash drizzle computes for its file. */
export interface HashedEntry {
  readonly tag: string;
  readonly when: number;
  readonly hash: string;
}

/** A `drizzle.__drizzle_migrations` row. */
export interface RecordedRow {
  readonly createdAt: number;
  readonly hash: string;
}

export interface RenumberRepair {
  readonly entry: HashedEntry;
  readonly renumbered: RenumberedMigration;
}

export interface RenumberPlan {
  /** Entries to record as applied, in journal order. */
  readonly repairs: readonly RenumberRepair[];
  /** Why the database cannot be migrated safely; empty when it can. */
  readonly refusals: readonly string[];
}

/**
 * What must be recorded before drizzle can migrate this database.
 *
 * Pure: `migrate-apply.ts` reads the journal and the table, and acts on the
 * plan.
 */
export function planRenumberRepairs(
  journal: readonly HashedEntry[],
  recorded: readonly RecordedRow[],
  registry: readonly RenumberedMigration[] = RENUMBERED_MIGRATIONS,
): RenumberPlan {
  const repairs: RenumberRepair[] = [];
  const refusals: string[] = [];
  const recordedAt = new Map(recorded.map((row) => [row.createdAt, row.hash]));

  for (const entry of journal) {
    const renumbered = registry.find((candidate) => candidate.tag === entry.tag);
    if (renumbered === undefined || recordedAt.has(entry.when)) continue;

    const formerHash = recordedAt.get(renumbered.formerWhen);
    if (formerHash === undefined) continue;

    if (formerHash !== entry.hash) {
      refusals.push(
        [
          `${entry.tag} was first written as ${renumbered.formerTag}, and this database`,
          `recorded a migration under that number — but not this file (recorded hash`,
          `${formerHash.slice(0, 12)}…, file ${entry.hash.slice(0, 12)}…). Running ${entry.tag}`,
          'would repeat or contradict whatever ran, so nothing has been changed.',
          'Take a backup and ask for this database to be looked at by hand.',
        ].join('\n'),
      );
      continue;
    }

    repairs.push({ entry, renumbered });
  }

  return { repairs, refusals };
}

/** The line `db:migrate` prints for each repair. */
export function describeRepair(repair: RenumberRepair): string {
  const { entry, renumbered } = repair;
  const on = new Date(renumbered.formerWhen).toISOString().slice(0, 10);
  return `  = ${entry.tag} (already applied as ${renumbered.formerTag} on ${on}; recorded, not re-run)`;
}
