/**
 * `ops:restore` — replacing a dead counter PC.
 *
 * Runs the REAL script as a child process against throwaway databases, never
 * the suite's own: a "new PC" database holding a freshly-provisioned pharmacy,
 * and a backup of the suite database standing in for the old machine. Pins the
 * promises the recovery procedure rests on:
 *
 *   - nothing is replaced without --replace;
 *   - a backup that cannot be restored and verified leaves the live database
 *     exactly as it was;
 *   - a good backup goes live only after it verified, the replaced database is
 *     kept (renamed) and dumped, and the counter gets a pairing key that works
 *     while the old one no longer does.
 *
 * Skips without a database, like every integration suite.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';

import { verifyPassword } from '../src/auth/pin';

const adminUrl = process.env.DATABASE_ADMIN_URL;
const appUrl = process.env.DATABASE_URL;
const suite = appUrl && adminUrl && process.env.APP_DB_ROLE ? describe : describe.skip;

const NEW_PC = 'mehvar_restore_newpc_test';

function withDatabase(url: string, database: string): string {
  const parsed = new URL(url);
  parsed.pathname = `/${database}`;
  return parsed.toString();
}

function psql(url: string, sql: string): string {
  return execFileSync('psql', [url, '-v', 'ON_ERROR_STOP=1', '-tAc', sql], {
    encoding: 'utf8',
  }).trim();
}

suite('ops:restore onto a replacement PC', () => {
  const work = mkdtempSync(join(tmpdir(), 'mehvar-restore-'));
  const maintenance = withDatabase(adminUrl ?? '', 'postgres');
  const newPcAdmin = withDatabase(adminUrl ?? '', NEW_PC);
  const newPcApp = withDatabase(appUrl ?? '', NEW_PC);
  const env = {
    ...process.env,
    DATABASE_ADMIN_URL: newPcAdmin,
    DATABASE_URL: newPcApp,
    MEHVAR_BACKUP_DIR: join(work, 'backups'),
  };
  const restore = (...args: string[]) =>
    spawnSync('npm', ['run', '-s', 'ops:restore', '--', ...args], { env, encoding: 'utf8' });

  afterAll(() => {
    const leftovers = psql(
      maintenance,
      `SELECT string_agg(datname, ' ') FROM pg_database WHERE datname LIKE '${NEW_PC}%'`,
    );
    for (const name of leftovers.split(' ').filter(Boolean)) {
      psql(maintenance, `DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
    }
    rmSync(work, { recursive: true, force: true });
  });

  it('builds a "new PC" with its own freshly installed pharmacy', () => {
    psql(maintenance, `DROP DATABASE IF EXISTS ${NEW_PC} WITH (FORCE)`);
    psql(maintenance, `CREATE DATABASE ${NEW_PC}`);
    execFileSync('npx', ['tsx', 'scripts/db/migrate.ts'], { env, stdio: 'pipe' });
    execFileSync('npx', ['tsx', 'scripts/db/grants.ts'], { env, stdio: 'pipe' });
    execFileSync('npx', ['tsx', '--conditions=react-server', 'scripts/db/init.ts'], {
      env: {
        ...env,
        MEHVAR_DATA_DIR: join(work, 'newpc'),
        MEHVAR_SHOP_NAME: 'Fresh Install',
        MEHVAR_OWNER_PIN: '1111',
      },
      stdio: 'pipe',
    });
    expect(psql(newPcAdmin, 'SELECT slug FROM tenants')).toBe('fresh-install');
  }, 120_000);

  it('refuses without --replace', () => {
    const dump = join(work, 'old-pc.dump');
    execFileSync('pg_dump', [
      '--format=custom',
      '--no-owner',
      '--no-acl',
      '--file',
      dump,
      adminUrl ?? '',
    ]);
    const run = restore(dump);
    expect(run.status).not.toBe(0);
    expect(run.stderr).toContain('Add --replace to confirm');
    expect(psql(newPcAdmin, 'SELECT slug FROM tenants')).toBe('fresh-install');
  }, 60_000);

  it('leaves the live database untouched when the backup cannot be restored', () => {
    const broken = join(work, 'broken.dump');
    writeFileSync(broken, 'this is not a pg_dump archive');
    const run = restore(broken, '--replace');
    expect(run.status).not.toBe(0);
    expect(run.stderr).toContain('The live database was not changed');
    expect(psql(newPcAdmin, 'SELECT slug FROM tenants')).toBe('fresh-install');
    expect(
      psql(
        maintenance,
        "SELECT count(*) FROM pg_database WHERE datname = 'mehvar_restore_incoming'",
      ),
    ).toBe('0');
  }, 60_000);

  it('never guesses which pharmacy a counter serves when the backup holds several', () => {
    // A backup with a second pharmacy and counter in it, built in its own
    // throwaway database so it does not depend on what the suite holds.
    const twoPharmacies = `${NEW_PC}_two`;
    const twoUrl = withDatabase(adminUrl ?? '', twoPharmacies);
    psql(maintenance, `DROP DATABASE IF EXISTS ${twoPharmacies} WITH (FORCE)`);
    psql(maintenance, `CREATE DATABASE ${twoPharmacies}`);
    execFileSync('pg_restore', [
      '--dbname',
      twoUrl,
      '--no-owner',
      '--no-acl',
      join(work, 'old-pc.dump'),
    ]);
    psql(
      twoUrl,
      `WITH t AS (INSERT INTO tenants (id, slug, name, status, settings)
                  VALUES (gen_random_uuid(), 'second-shop', 'Second Shop', 'active', '{}') RETURNING id)
       INSERT INTO devices (id, tenant_id, name, receipt_prefix, pairing_key_hash)
       SELECT gen_random_uuid(), id, 'Counter 1', 'A', 'x' FROM t`,
    );
    const dump = join(work, 'two-pharmacies.dump');
    execFileSync('pg_dump', ['--format=custom', '--no-owner', '--no-acl', '--file', dump, twoUrl]);
    psql(maintenance, `DROP DATABASE ${twoPharmacies} WITH (FORCE)`);

    const run = restore(dump, '--replace');
    expect(run.stderr).toMatch(/holds \d+ pharmacies .*second-shop.*Add --pharmacy <code>/s);
    expect(run.status).not.toBe(0);
    expect(psql(newPcAdmin, 'SELECT slug FROM tenants')).toBe('fresh-install');
  }, 120_000);

  it('restores a good backup: proven, swapped in, the old database kept, a working pairing key', async () => {
    const oldDevice = psql(
      adminUrl ?? '',
      "SELECT d.pairing_key_hash FROM devices d JOIN tenants t ON t.id = d.tenant_id WHERE t.slug = 'demo' AND d.receipt_prefix = 'A'",
    );
    const run = restore(join(work, 'old-pc.dump'), '--replace', '--pharmacy', 'demo');
    const output = `${run.stdout}\n${run.stderr}`;
    expect(output).toMatch(/refused UPDATE and DELETE on all \d+ event tables/);
    expect(run.status).toBe(0);

    // The live name now holds the backup's pharmacy and its trading history.
    // (Not compared to the suite database's live count: other suites keep
    // selling into it while this one runs.)
    expect(psql(newPcAdmin, "SELECT count(*) FROM tenants WHERE slug = 'demo'")).toBe('1');
    expect(output).toMatch(/ok — \d+ batches agree with the records/);
    // The application role can use it.
    expect(Number(psql(newPcApp, 'SELECT count(*) FROM sales'))).toBeGreaterThan(0);

    // The fresh pharmacy it replaced is kept, renamed, and dumped.
    const retired = psql(
      maintenance,
      `SELECT datname FROM pg_database WHERE datname LIKE '${NEW_PC}_replaced_%'`,
    );
    expect(psql(withDatabase(adminUrl ?? '', retired), 'SELECT slug FROM tenants')).toBe(
      'fresh-install',
    );
    expect(
      readdirSync(join(work, 'backups', 'pre-restore')).some((name) => name.endsWith('.dump')),
    ).toBe(true);

    // The printed key pairs this counter; the old machine's key does not.
    const key = /Setup key\s+(\S+)/.exec(run.stdout)?.[1] ?? '';
    const hash = psql(
      newPcAdmin,
      "SELECT d.pairing_key_hash FROM devices d JOIN tenants t ON t.id = d.tenant_id WHERE t.slug = 'demo' AND d.receipt_prefix = 'A'",
    );
    expect(await verifyPassword(hash, key)).toBe(true);
    expect(hash).not.toBe(oldDevice);
  }, 180_000);
});
