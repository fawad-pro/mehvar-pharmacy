/**
 * `ops:restore <dump> --replace` — put a backup in place of the live database.
 *
 * The replacement-PC recovery (OPERATIONS.md, "Replacing the counter PC"):
 * install Mehvar on the new machine as normal, then restore the last backup
 * from the USB drive with this. On an installed machine it runs through
 * `mehvar-restore.cmd`, which stops the counter service first and starts it
 * afterwards.
 *
 * Nothing is overwritten until the backup has PROVEN itself, and nothing is
 * thrown away even then:
 *
 *   1. The dump must read back (`pg_restore --list`).
 *   2. The live database is dumped to backups\pre-restore\ first.
 *   3. The backup is restored into a scratch database, migrated to the
 *      installed schema (a dump from an older version restores into its own
 *      schema), granted, checked for immutability as the application role,
 *      and verified (ADR-8) as the application role.
 *   4. Only then is it swapped in. The previous live database is RENAMED
 *      aside, not dropped.
 *
 * Any failure before the swap drops the scratch database and leaves the live
 * one exactly as it was.
 *
 * The restored counter gets a NEW pairing key, shown once on screen and written
 * nowhere: the key it was first given was on the machine that died. The owner's
 * PIN is unchanged — it lives in the restored records. The licence then reads
 * "registered to a different computer" and the owner moves it from
 * Settings -> Licence (the self-service rebind, OPERATIONS.md section 6a).
 */
import 'dotenv/config';

import { existsSync, mkdirSync, rmSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { applyGrants, assertEventTablesImmutable } from '../db/grants-apply';
import { applyMigrations } from '../db/migrate-apply';
import { listDevices, reissuePairingKey, swapDatabases } from '../db/recovery';
import { backupDir, backupFileName } from '../../src/lib/backup';
import { installationDir } from '../../src/lib/installation';

import { databaseOf, withDatabase } from './database-url';
import { run } from './run';

/** Distinct from the drill's scratch database, so the two can never collide. */
const INCOMING = 'mehvar_restore_incoming';

interface Options {
  dump: string;
  replace: boolean;
  device: string | undefined;
  pharmacy: string | undefined;
}

function parseArgs(argv: readonly string[]): Options {
  const positional: string[] = [];
  let replace = false;
  let device: string | undefined;
  let pharmacy: string | undefined;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i] ?? '';
    if (arg === '--replace') replace = true;
    else if (arg === '--device') device = argv[(i += 1)];
    else if (arg === '--pharmacy') pharmacy = argv[(i += 1)];
    else positional.push(arg);
  }
  if (positional.length !== 1) {
    throw new Error(
      'Usage: restore <backup.dump> --replace [--pharmacy <code>] [--device "Counter 1"]',
    );
  }
  return { dump: resolve(positional[0] ?? ''), replace, device, pharmacy };
}

async function psql(url: string, statement: string): Promise<void> {
  await run('psql', [url, '-v', 'ON_ERROR_STOP=1', '-c', statement], { quiet: true });
}

function stamp(now: Date): string {
  return now.toISOString().replace(/[-:T]/g, '').slice(0, 14);
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));

  const adminUrl = process.env.DATABASE_ADMIN_URL;
  const appUrl = process.env.DATABASE_URL;
  if (!adminUrl || !appUrl) {
    throw new Error(
      'DATABASE_ADMIN_URL and DATABASE_URL must both be set (the installed .env has both).',
    );
  }
  if (!existsSync(options.dump) || statSync(options.dump).size === 0) {
    throw new Error(`No backup at ${options.dump}.`);
  }
  if (!options.replace) {
    throw new Error(
      'This replaces the pharmacy database with the backup. Add --replace to confirm.\n' +
        'The current database is kept (renamed) and dumped first, so it can be recovered.',
    );
  }

  const live = databaseOf(adminUrl);
  const maintenance = withDatabase(adminUrl, 'postgres');
  const incomingAdmin = withDatabase(adminUrl, INCOMING);
  const incomingApp = withDatabase(appUrl, INCOMING);

  console.log(`Restoring ${options.dump}\n  into ${live} (via ${INCOMING})\n`);

  console.log('1. Reading the backup back…');
  await run('pg_restore', ['--list', options.dump], { quiet: true });

  console.log('2. Saving the current database first…');
  const safety = join(backupDir(), 'pre-restore');
  mkdirSync(safety, { recursive: true });
  const safetyFile = join(safety, backupFileName());
  await run(
    'pg_dump',
    ['--format=custom', '--no-owner', '--no-acl', '--file', safetyFile, adminUrl],
    {
      quiet: true,
    },
  );
  console.log(`   ${safetyFile}`);

  let swapped = false;
  try {
    console.log('3. Restoring into a scratch database and proving it…');
    await psql(maintenance, `DROP DATABASE IF EXISTS ${INCOMING} WITH (FORCE)`);
    await psql(maintenance, `CREATE DATABASE ${INCOMING}`);
    await run('pg_restore', ['--dbname', incomingAdmin, '--no-owner', '--no-acl', options.dump], {
      quiet: true,
    });

    await applyMigrations(incomingAdmin);

    process.env.DATABASE_ADMIN_URL = incomingAdmin;
    await applyGrants();
    await assertEventTablesImmutable(incomingApp);

    // As the application role, against the scratch copy. The client builds its
    // pool lazily from the environment, so the override precedes the import —
    // see restore-drill.ts for why getting this wrong would verify the wrong
    // database and pass.
    process.env.DATABASE_URL = incomingApp;
    const { verifyAllTenants } = await import('../db/verify-all');
    const verified = await verifyAllTenants();
    const { closeDatabase } = await import('../../src/db/client');
    await closeDatabase();
    if (!verified) {
      throw new Error('the backup does not verify — its records and caches disagree');
    }

    // A pharmacy installation holds one pharmacy. Should a backup hold more,
    // which counter gets the new key is the operator's call, never a guess.
    const all = await listDevices(incomingAdmin);
    const pharmacies = [...new Set(all.map((candidate) => candidate.tenantSlug))];
    if (options.pharmacy === undefined && pharmacies.length > 1) {
      throw new Error(
        `The backup holds ${pharmacies.length} pharmacies (${pharmacies.join(', ')}). ` +
          'Add --pharmacy <code> to say which one this counter serves.',
      );
    }
    const devices =
      options.pharmacy === undefined
        ? all
        : all.filter((candidate) => candidate.tenantSlug === options.pharmacy);
    const device =
      options.device === undefined
        ? devices[0]
        : devices.find((candidate) => candidate.deviceName === options.device);
    if (device === undefined) {
      throw new Error(
        devices.length === 0
          ? `The backup holds no active counter${options.pharmacy ? ` for ${options.pharmacy}` : ''} to pair with.`
          : `No active counter named "${options.device ?? ''}". The backup has: ${devices.map((d) => d.deviceName).join(', ')}.`,
      );
    }
    const pairingKey = await reissuePairingKey(incomingAdmin, device.deviceId);

    console.log('4. Swapping it in…');
    const retired = `${live}_replaced_${stamp(new Date())}`;
    const { retiredExisting } = await swapDatabases(maintenance, live, INCOMING, retired);
    swapped = true;

    // first-run.txt described the pharmacy this restore just replaced: its key
    // and password no longer open anything, and plaintext credentials should
    // not outlive their purpose. The new key above is the only one now.
    const staleFirstRun = join(installationDir(), 'first-run.txt');
    if (existsSync(staleFirstRun)) rmSync(staleFirstRun, { force: true });

    console.log(
      [
        '',
        `  Restored ${device.tenantName} (${device.tenantSlug}). The backup verified before it went live.`,
        '',
        '  Set up this counter in the browser with:',
        `    Pharmacy code  ${device.tenantSlug}`,
        `    Counter name   ${device.deviceName}`,
        `    Setup key      ${pairingKey}`,
        '  This key is shown once and saved nowhere. Its old key no longer works.',
        '',
        "  Log in with the owner's existing PIN; it came back with the records.",
        '  Then Settings -> Licence will say the licence is registered to a',
        '  different computer: press the button to move it here.',
        '',
        retiredExisting
          ? `  The database this replaced is kept as ${retired}, and dumped to\n  ${safetyFile}.`
          : `  The previous database was dumped to ${safetyFile}.`,
        '',
      ].join('\n'),
    );
  } finally {
    if (!swapped) {
      await psql(maintenance, `DROP DATABASE IF EXISTS ${INCOMING} WITH (FORCE)`).catch(
        () => undefined,
      );
    }
  }
}

main()
  .then(() => process.exit(0))
  .catch((error: unknown) => {
    console.error(`\n  Restore FAILED: ${error instanceof Error ? error.message : error}`);
    console.error('  The live database was not changed.\n');
    process.exit(1);
  });
