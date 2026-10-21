/**
 * The restore drill accepts a backup taken under an OLDER schema.
 *
 * The upgrade test found the drill granting on `supplier_payments` before
 * migrating, so every dump taken before migration 0009 — the whole backup
 * history of a shop that had just updated — failed as "sev-1", although the
 * backups themselves were sound. The drill now restores, migrates, grants,
 * proves the application role cannot rewrite history, and verifies.
 *
 * This runs the REAL `ops:restore-drill` script, against a dump of a database
 * migrated only as far as 0008 and holding a pharmacy. It needs a database,
 * CREATEDB on the admin role, and `pg_dump`/`pg_restore` on PATH; like every
 * other integration suite it skips without DATABASE_URL.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';

const adminUrl = process.env.DATABASE_ADMIN_URL;
const suite =
  process.env.DATABASE_URL && adminUrl && process.env.APP_DB_ROLE ? describe : describe.skip;

const OLD_DB = 'mehvar_restore_drill_pre0009_test';

function withDatabase(url: string, database: string): string {
  const parsed = new URL(url);
  parsed.pathname = `/${database}`;
  return parsed.toString();
}

function psql(url: string, sql: string): string {
  return execFileSync('psql', [url, '-v', 'ON_ERROR_STOP=1', '-tAc', sql], { encoding: 'utf8' });
}

suite('ops:restore-drill on a backup older than the installed schema', () => {
  const work = mkdtempSync(join(tmpdir(), 'mehvar-drill-'));
  const maintenance = withDatabase(adminUrl ?? '', 'postgres');
  const oldUrl = withDatabase(adminUrl ?? '', OLD_DB);

  afterAll(() => {
    psql(maintenance, `DROP DATABASE IF EXISTS ${OLD_DB} WITH (FORCE)`);
    rmSync(work, { recursive: true, force: true });
  });

  it('migrates the restored dump to the current schema, grants, and verifies', () => {
    // A migrations folder that stops at 0008: the schema a shop had before
    // supplier credit existed.
    const source = join(process.cwd(), 'src', 'db', 'migrations');
    const folder = join(work, 'migrations');
    mkdirSync(join(folder, 'meta'), { recursive: true });
    const journal = JSON.parse(readFileSync(join(source, 'meta', '_journal.json'), 'utf8')) as {
      entries: Array<{ tag: string }>;
    };
    const old = journal.entries.slice(
      0,
      journal.entries.findIndex((e) => e.tag.startsWith('0009')),
    );
    expect(old.length).toBe(9);
    for (const entry of old)
      copyFileSync(join(source, `${entry.tag}.sql`), join(folder, `${entry.tag}.sql`));
    writeFileSync(
      join(folder, 'meta', '_journal.json'),
      JSON.stringify({ ...journal, entries: old }),
    );

    psql(maintenance, `DROP DATABASE IF EXISTS ${OLD_DB} WITH (FORCE)`);
    psql(maintenance, `CREATE DATABASE ${OLD_DB}`);
    const env = { ...process.env, DATABASE_ADMIN_URL: oldUrl, MEHVAR_MIGRATIONS_DIR: folder };
    execFileSync('npx', ['tsx', 'scripts/db/migrate.ts'], { env, stdio: 'pipe' });
    psql(
      oldUrl,
      "INSERT INTO tenants (id, slug, name, status, settings) VALUES (gen_random_uuid(), 'old-shop', 'Old Shop', 'active', '{}')",
    );
    expect(psql(oldUrl, "SELECT to_regclass('supplier_payments') IS NULL").trim()).toBe('t');

    const backups = join(work, 'backups');
    mkdirSync(backups);
    execFileSync('pg_dump', [
      '--format=custom',
      '--no-owner',
      '--no-acl',
      '--file',
      join(backups, 'mehvar-2026-01-01T00-00-00-000.dump'),
      oldUrl,
    ]);

    const drill = spawnSync('npm', ['run', '-s', 'ops:restore-drill'], {
      env: { ...process.env, MEHVAR_BACKUP_DIR: backups },
      encoding: 'utf8',
    });
    const output = `${drill.stdout}\n${drill.stderr}`;

    expect(output).toContain('+ 0009_supplier_credit');
    expect(output).toMatch(/refused UPDATE and DELETE on all \d+ event tables/);
    expect(output).toContain('Restore drill passed');
    expect(drill.status).toBe(0);
  }, 120_000);
});
