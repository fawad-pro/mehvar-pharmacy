/**
 * `npm run ops:restore-drill` — prove the backup is a backup.
 *
 * Phase 12 §3: "Restore drill: performed once before first paying customer and
 * quarterly thereafter — restore latest dump into a scratch database, run the
 * ADR-8 verifier, confirm invariants (Phase 5 §5) hold. **An untested backup is
 * not a backup.**"
 *
 * That sentence is the whole script. `ops:backup` writes a file; this is the
 * only thing that turns the file into evidence.
 *
 * Non-destructive by construction: it restores into a scratch database named
 * separately from the live one and drops it afterwards. It never writes to the
 * pharmacy's own database — a drill that could damage the thing it protects
 * would not be run often enough to be worth having.
 */
import 'dotenv/config';

import { join } from 'node:path';

import { backupDir, latestBackup } from '../../src/lib/backup';

import { run } from './run';

/** Distinct enough that no live database could collide with it. */
const SCRATCH_DB = 'mehvar_restore_drill';

/**
 * Swap the database name in a connection URL, keeping credentials and host.
 *
 * The drill connects to `postgres` to create and drop the scratch database,
 * then to the scratch database itself to verify it.
 */
export function withDatabase(url: string, database: string): string {
  const parsed = new URL(url);
  parsed.pathname = `/${database}`;
  return parsed.toString();
}

async function psql(url: string, statement: string): Promise<void> {
  await run('psql', [url, '-v', 'ON_ERROR_STOP=1', '-c', statement], { quiet: true });
}

async function main(): Promise<void> {
  const adminUrl = process.env.DATABASE_ADMIN_URL ?? process.env.DATABASE_URL;
  if (!adminUrl) {
    throw new Error('DATABASE_ADMIN_URL (or DATABASE_URL) is not set.');
  }

  const directory = backupDir();
  const newest = latestBackup(directory);
  if (newest === undefined) {
    throw new Error(
      `No dumps found in ${directory}. Run "npm run ops:backup" first — ` +
        `there is nothing to drill against.`,
    );
  }

  const dump = join(directory, newest);
  const maintenanceUrl = withDatabase(adminUrl, 'postgres');
  const scratchUrl = withDatabase(adminUrl, SCRATCH_DB);

  console.log(`Drilling ${newest} into ${SCRATCH_DB}…\n`);

  // Drop first: a previous drill that died mid-run must not block this one.
  await psql(maintenanceUrl, `DROP DATABASE IF EXISTS ${SCRATCH_DB}`);
  await psql(maintenanceUrl, `CREATE DATABASE ${SCRATCH_DB}`);

  let verified = false;
  try {
    await run('pg_restore', ['--dbname', scratchUrl, '--no-owner', '--no-acl', dump], {
      quiet: true,
    });

    /*
     * Point the database client at the scratch database BEFORE importing
     * anything that reaches it. `src/db/client.ts` builds its pool lazily from
     * `serverEnv()`, which caches on first read — so the override has to be in
     * place before the first import, and the import has to be dynamic.
     *
     * Getting this wrong would not fail loudly. It would verify the LIVE
     * database, pass, and prove nothing about the dump.
     */
    process.env.DATABASE_URL = scratchUrl;
    process.env.DATABASE_ADMIN_URL = scratchUrl;

    const { verifyAllTenants } = await import('../db/verify-all');
    verified = await verifyAllTenants();
  } finally {
    // Always clean up, including after a failed verify — a leftover scratch
    // database is how the next drill starts by reporting a stale problem.
    await psql(maintenanceUrl, `DROP DATABASE IF EXISTS ${SCRATCH_DB}`);
  }

  if (!verified) {
    throw new Error('the restored database does not verify — its records and caches disagree');
  }
  console.log(`\n  Restore drill passed: ${newest} restores clean and verifies.\n`);
}

main()
  .then(() => process.exit(0))
  .catch((error: unknown) => {
    console.error(`\n  Restore drill FAILED: ${error instanceof Error ? error.message : error}\n`);
    console.error('  Phase 12 §3: an untested backup is not a backup. Treat this as sev-1.\n');
    process.exit(1);
  });
