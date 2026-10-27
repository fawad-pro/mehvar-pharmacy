/**
 * Migration 0010 marks purchase history untracked without touching a row.
 *
 * The upgrade test found every pre-supplier-credit purchase reading as owed in
 * full after 0009 (its `cash_paid_paisa` was the column default 0). 0010 adds
 * `credit_tracked` with DEFAULT false and then switches the default to true;
 * the order is what makes history untracked and everything after tracked.
 * drizzle-kit generates the one-step form, which would get this backwards, so
 * the property is pinned against a real database: history written under 0009,
 * then 0010 applied, then a new purchase.
 *
 * "Without touching a row" is checked with `xmin`: an UPDATE gives a row a new
 * one. Skips without a database, like every integration suite.
 */
import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';

const adminUrl = process.env.DATABASE_ADMIN_URL;
const suite = process.env.DATABASE_URL && adminUrl ? describe : describe.skip;

const DB = 'mehvar_supplier_credit_migration_test';

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

suite('migration 0010 on a database with purchase history', () => {
  const work = mkdtempSync(join(tmpdir(), 'mehvar-0010-'));
  const maintenance = withDatabase(adminUrl ?? '', 'postgres');
  const url = withDatabase(adminUrl ?? '', DB);
  const source = join(process.cwd(), 'src', 'db', 'migrations');
  const journal = JSON.parse(readFileSync(join(source, 'meta', '_journal.json'), 'utf8')) as {
    entries: Array<{ tag: string }>;
  };

  function migrateThrough(lastTag: string | undefined): void {
    const folder = join(work, lastTag ?? 'all');
    mkdirSync(join(folder, 'meta'), { recursive: true });
    const upTo =
      lastTag === undefined
        ? journal.entries.length
        : journal.entries.findIndex((e) => e.tag === lastTag) + 1;
    const entries = journal.entries.slice(0, upTo);
    for (const entry of entries)
      copyFileSync(join(source, `${entry.tag}.sql`), join(folder, `${entry.tag}.sql`));
    writeFileSync(join(folder, 'meta', '_journal.json'), JSON.stringify({ ...journal, entries }));
    execFileSync('npx', ['tsx', 'scripts/db/migrate.ts'], {
      env: { ...process.env, DATABASE_ADMIN_URL: url, MEHVAR_MIGRATIONS_DIR: folder },
      stdio: 'pipe',
    });
  }

  afterAll(() => {
    psql(maintenance, `DROP DATABASE IF EXISTS ${DB} WITH (FORCE)`);
    rmSync(work, { recursive: true, force: true });
  });

  it('history becomes untracked, untouched; what follows is tracked', () => {
    psql(maintenance, `DROP DATABASE IF EXISTS ${DB} WITH (FORCE)`);
    psql(maintenance, `CREATE DATABASE ${DB}`);
    migrateThrough('0009_supplier_credit');

    const tenant = psql(
      url,
      "INSERT INTO tenants (id, slug, name, status, settings) VALUES (gen_random_uuid(), 'history', 'History', 'active', '{}') RETURNING id",
    ).split('\n')[0];
    const user = psql(
      url,
      `INSERT INTO users (id, tenant_id, name, role, pin_hash) VALUES (gen_random_uuid(), '${tenant}', 'Owner', 'owner', 'x') RETURNING id`,
    ).split('\n')[0];
    // As 0009 left history: the default 0, which reads as "nothing paid".
    psql(
      url,
      `INSERT INTO purchases (id, tenant_id, created_by) VALUES (gen_random_uuid(), '${tenant}', '${user}')`,
    );
    const before = psql(url, "SELECT xmin::text || '/' || cash_paid_paisa FROM purchases");

    migrateThrough(undefined);

    expect(psql(url, 'SELECT credit_tracked FROM purchases')).toBe('f');
    // Same row version, same cash_paid: nothing was rewritten or invented.
    expect(psql(url, "SELECT xmin::text || '/' || cash_paid_paisa FROM purchases")).toBe(before);

    psql(
      url,
      `INSERT INTO purchases (id, tenant_id, created_by, invoice_ref) VALUES (gen_random_uuid(), '${tenant}', '${user}', 'AFTER')`,
    );
    expect(psql(url, "SELECT credit_tracked FROM purchases WHERE invoice_ref = 'AFTER'")).toBe('t');
  }, 120_000);
});
