/**
 * `npm run ops:backup` — the nightly dump.
 *
 * Phase 12 §3 calls backup "a trust feature (T3), not an IT chore", and PCN-004
 * is what makes it urgent: going local moved backup risk off a managed platform
 * and onto a shop with one disk. This ships in roadmap Phase 1 for that reason,
 * not as polish.
 *
 * The encrypted offsite copy arrives in roadmap Phase 3 and is explicitly in
 * deficit until then — Phase 12 §3's "one provider failure must not take the
 * backups with the database" is NOT satisfied by a second folder on the same
 * machine, and nothing here pretends otherwise. Point `MEHVAR_BACKUP_DIR` at a
 * USB drive and that gap narrows; it does not close.
 *
 * `ops:restore-drill` is what proves this worked. An untested backup is not a
 * backup, and this script cannot test itself.
 *
 * Shells out to `pg_dump` rather than reaching for Drizzle: it must run when
 * the application is down, and the bundled PostgreSQL ships the binary anyway.
 */
import 'dotenv/config';

import { mkdirSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';

import {
  backupDir,
  backupFileName,
  parseRetentionDays,
  pruneOldBackups,
} from '../../src/lib/backup';

import { run } from './run';

async function main(): Promise<void> {
  /*
   * The OWNER connection, not the app role. `pg_dump` must read every table,
   * including the event tables the app role is deliberately restricted on
   * (PCN-001) — a backup taken through a restricted role is one that silently
   * omits the records the product is trusted for.
   */
  const url = process.env.DATABASE_ADMIN_URL ?? process.env.DATABASE_URL;
  if (!url) {
    throw new Error('DATABASE_ADMIN_URL (or DATABASE_URL) is not set.');
  }

  const directory = backupDir();
  mkdirSync(directory, { recursive: true });

  const target = join(directory, backupFileName());

  // Custom format: compressed, and restorable with `pg_restore` into a scratch
  // database without touching the live one — which is what the drill needs.
  await run('pg_dump', ['--format=custom', '--no-owner', '--no-acl', '--file', target, url]);

  const { size } = statSync(target);
  if (size === 0) {
    // A zero-byte dump that stays on disk is worse than no dump: it looks like
    // a backup, and the retention window will happily keep it for 30 days.
    rmSync(target, { force: true });
    throw new Error('pg_dump produced an empty file; refusing to keep it.');
  }

  console.log(`Backed up to ${target} (${(size / 1024 / 1024).toFixed(1)} MB)`);

  const days = parseRetentionDays(process.env.MEHVAR_BACKUP_RETENTION_DAYS);
  const removed = pruneOldBackups(directory, days);
  if (removed.length > 0) {
    console.log(`Pruned ${removed.length} dump(s) older than ${days} days.`);
  }
}

main()
  .then(() => process.exit(0))
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
