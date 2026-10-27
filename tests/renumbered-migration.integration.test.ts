/**
 * A database that ran supplier credit as `0006_supplier_credit` migrates.
 *
 * Supplier credit was first written on a branch as migration
 * `0006_supplier_credit` (a79e57d, journal `when` 1786460433684). Main had
 * meanwhile taken 0006–0008 for licensing, so the work was cherry-picked as
 * `0009_supplier_credit` — the same file byte for byte (git blob 408d5e0a), but
 * a new `when`. drizzle identifies a migration by `when` alone, so to any
 * database that had run the branch, 0009 looked new: it re-ran
 * `CREATE TABLE "supplier_payments"`, failed, rolled back everything with it,
 * and 0010 never ran. The Day screen then crashed on `credit_tracked`.
 *
 * Built here exactly as such a database was: the branch's journal first, with
 * real trading on it, then the current one. Two histories, because a database
 * could have met main before or after licensing landed. Skips without a
 * database, like every integration suite.
 */
import { spawnSync, execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';

const adminUrl = process.env.DATABASE_ADMIN_URL;
const suite = process.env.DATABASE_URL && adminUrl ? describe : describe.skip;

const PREFIX = 'mehvar_renumbered_test';
/** The branch's journal entry for the migration main renumbered to 0009. */
const BRANCH_ENTRY = { tag: '0006_supplier_credit', when: 1786460433684 } as const;

interface Entry {
  idx: number;
  version: string;
  when: number;
  tag: string;
  breakpoints: boolean;
}

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

suite('a database that ran supplier credit under its branch number', () => {
  const work = mkdtempSync(join(tmpdir(), 'mehvar-renumbered-'));
  const maintenance = withDatabase(adminUrl ?? '', 'postgres');
  const source = join(process.cwd(), 'src', 'db', 'migrations');
  const journal = JSON.parse(readFileSync(join(source, 'meta', '_journal.json'), 'utf8')) as {
    entries: Entry[];
  };
  const tagIndex = (tag: string) => journal.entries.findIndex((entry) => entry.tag === tag);

  /** A migrations folder holding exactly these journal entries. */
  function folder(name: string, entries: Entry[], sqlFor: (entry: Entry) => string): string {
    const dir = join(work, name);
    mkdirSync(join(dir, 'meta'), { recursive: true });
    for (const entry of entries) copyFileSync(sqlFor(entry), join(dir, `${entry.tag}.sql`));
    writeFileSync(join(dir, 'meta', '_journal.json'), JSON.stringify({ ...journal, entries }));
    return dir;
  }

  /** The branch's journal: main's 0000–0005, then supplier credit as 0006. */
  function branchFolder(sqlFile = join(source, '0009_supplier_credit.sql')): string {
    const entries: Entry[] = [
      ...journal.entries.slice(0, tagIndex('0005_catalog_identity') + 1),
      { idx: 6, version: '7', breakpoints: true, ...BRANCH_ENTRY },
    ];
    return folder(`branch-${entries.length}-${Date.now()}`, entries, (entry) =>
      entry.tag === BRANCH_ENTRY.tag ? sqlFile : join(source, `${entry.tag}.sql`),
    );
  }

  function currentFolder(lastTag?: string): string {
    const upTo = lastTag === undefined ? journal.entries.length : tagIndex(lastTag) + 1;
    return folder(`current-${upTo}`, journal.entries.slice(0, upTo), (entry) =>
      join(source, `${entry.tag}.sql`),
    );
  }

  function migrate(url: string, dir: string) {
    return spawnSync('npx', ['tsx', 'scripts/db/migrate.ts'], {
      env: { ...process.env, DATABASE_ADMIN_URL: url, MEHVAR_MIGRATIONS_DIR: dir },
      encoding: 'utf8',
    });
  }

  function freshDatabase(name: string): string {
    psql(maintenance, `DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
    psql(maintenance, `CREATE DATABASE ${name}`);
    return withDatabase(adminUrl ?? '', name);
  }

  /** Trading on the branch: a purchase before credit, one on credit, a payment. */
  function trade(url: string): void {
    const tenant = psql(
      url,
      "INSERT INTO tenants (id, slug, name, status, settings) VALUES (gen_random_uuid(), 'branch', 'Branch', 'active', '{}') RETURNING id",
    ).split('\n')[0];
    const user = psql(
      url,
      `INSERT INTO users (id, tenant_id, name, role, pin_hash) VALUES (gen_random_uuid(), '${tenant}', 'Owner', 'owner', 'x') RETURNING id`,
    ).split('\n')[0];
    const supplier = psql(
      url,
      `INSERT INTO suppliers (id, tenant_id, name) VALUES (gen_random_uuid(), '${tenant}', 'Distributor') RETURNING id`,
    ).split('\n')[0];
    psql(
      url,
      `INSERT INTO purchases (id, tenant_id, supplier_id, created_by, invoice_ref, cash_paid_paisa)
       VALUES (gen_random_uuid(), '${tenant}', '${supplier}', '${user}', 'OLD', 0),
              (gen_random_uuid(), '${tenant}', '${supplier}', '${user}', 'CREDIT', 5000)`,
    );
    psql(
      url,
      `INSERT INTO supplier_payments (id, tenant_id, supplier_id, amount_paisa, created_by)
       VALUES (gen_random_uuid(), '${tenant}', '${supplier}', 2500, '${user}')`,
    );
  }

  /** Everything the trade wrote, with each row's version: an UPDATE changes xmin. */
  function records(url: string): string {
    return psql(
      url,
      `SELECT string_agg(r, ' | ' ORDER BY r) FROM (
         SELECT 'p:' || invoice_ref || ':' || cash_paid_paisa || ':' || xmin::text AS r FROM purchases
         UNION ALL
         SELECT 'sp:' || amount_paisa || ':' || xmin::text FROM supplier_payments) rows`,
    );
  }

  function schema(url: string): string {
    return execFileSync('pg_dump', ['--schema-only', '--schema=public', '--no-owner', url], {
      encoding: 'utf8',
    })
      .split('\n')
      .filter((line) => !line.startsWith('--') && !line.startsWith('\\'))
      .join('\n');
  }

  afterAll(() => {
    const leftovers = psql(
      maintenance,
      `SELECT string_agg(datname, ' ') FROM pg_database WHERE datname LIKE '${PREFIX}%'`,
    );
    for (const name of leftovers.split(' ').filter(Boolean)) {
      psql(maintenance, `DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
    }
    rmSync(work, { recursive: true, force: true });
  });

  const fresh = (() => {
    let dumped: string | undefined;
    return (): string => {
      if (dumped === undefined) {
        const url = freshDatabase(`${PREFIX}_fresh`);
        const run = migrate(url, currentFolder());
        expect(run.status, run.stderr).toBe(0);
        dumped = schema(url);
      }
      return dumped;
    };
  })();

  it.each([
    ['straight from the branch', undefined],
    ['after migrating main before supplier credit merged', '0008_drop_licence_expiry'],
  ])(
    'migrates %s, keeps every record, and ends on the fresh schema',
    (_label, mainThrough) => {
      const url = freshDatabase(`${PREFIX}_${mainThrough === undefined ? 'branch' : 'main'}`);
      const onBranch = migrate(url, branchFolder());
      expect(onBranch.status, onBranch.stderr).toBe(0);
      trade(url);
      if (mainThrough !== undefined) {
        const meanwhile = migrate(url, currentFolder(mainThrough));
        expect(meanwhile.status, meanwhile.stderr).toBe(0);
      }
      const branchRow = psql(
        url,
        `SELECT id || ':' || hash FROM drizzle.__drizzle_migrations WHERE created_at = ${BRANCH_ENTRY.when}`,
      );
      const before = records(url);

      const run = migrate(url, currentFolder());
      expect(run.status, `${run.stdout}\n${run.stderr}`).toBe(0);
      expect(run.stdout).toContain('0009_supplier_credit');
      expect(run.stdout).toContain(BRANCH_ENTRY.tag);

      // Every journal entry is recorded; the branch's own row is left as it was.
      const recorded = psql(
        url,
        "SELECT string_agg(created_at::text, ',') FROM drizzle.__drizzle_migrations",
      );
      for (const entry of journal.entries)
        expect(recorded.split(',')).toContain(String(entry.when));
      expect(
        psql(
          url,
          `SELECT id || ':' || hash FROM drizzle.__drizzle_migrations WHERE created_at = ${BRANCH_ENTRY.when}`,
        ),
      ).toBe(branchRow);

      // Nothing rewritten, nothing lost; history is untracked per PCN-007.
      expect(records(url)).toBe(before);
      expect(
        psql(url, "SELECT string_agg(DISTINCT credit_tracked::text, ',') FROM purchases"),
      ).toBe('false');
      expect(schema(url)).toBe(fresh());

      // Running it again is a no-op, and what is recorded next is tracked.
      const again = migrate(url, currentFolder());
      expect(again.status, again.stderr).toBe(0);
      expect(again.stdout).toContain('already up to date');
      psql(
        url,
        `INSERT INTO purchases (id, tenant_id, created_by, invoice_ref)
       SELECT gen_random_uuid(), tenant_id, created_by, 'AFTER' FROM purchases LIMIT 1`,
      );
      expect(psql(url, "SELECT credit_tracked FROM purchases WHERE invoice_ref = 'AFTER'")).toBe(
        't',
      );
    },
    240_000,
  );

  it('refuses, changing nothing, when the branch ran a migration that is not the same file', () => {
    const url = freshDatabase(`${PREFIX}_different`);
    const altered = join(work, 'altered.sql');
    writeFileSync(
      altered,
      `${readFileSync(join(source, '0009_supplier_credit.sql'), 'utf8')}\n-- not the same file`,
    );
    const onBranch = migrate(url, branchFolder(altered));
    expect(onBranch.status, onBranch.stderr).toBe(0);
    const before = psql(url, 'SELECT count(*) FROM drizzle.__drizzle_migrations');

    const run = migrate(url, currentFolder());
    expect(run.status).not.toBe(0);
    expect(run.stderr).toContain('0009_supplier_credit');
    expect(run.stderr).toContain(BRANCH_ENTRY.tag);
    expect(run.stderr).not.toContain('already exists');
    expect(psql(url, 'SELECT count(*) FROM drizzle.__drizzle_migrations')).toBe(before);
    expect(psql(url, "SELECT to_regclass('public.licences') IS NULL")).toBe('t');
  }, 120_000);
});
