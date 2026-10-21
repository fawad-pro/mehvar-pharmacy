/**
 * Recording a renumbered migration only when the database proves it ran.
 *
 * `scripts/db/renumbered-migrations.ts` has the history: 0009_supplier_credit
 * ran on some databases as 0006_supplier_credit, and drizzle, which knows a
 * migration only by its journal `when`, tried to run it again. These pin the
 * rule (record on a hash match, refuse on a mismatch, otherwise leave alone)
 * and that the registry's proof is the real file's hash.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { readMigrationFiles } from 'drizzle-orm/migrator';
import { describe, expect, it } from 'vitest';

import {
  RENUMBERED_MIGRATIONS,
  describeRepair,
  planRenumberRepairs,
  type HashedEntry,
  type RenumberedMigration,
} from '../scripts/db/renumbered-migrations';

const folder = join(process.cwd(), 'src', 'db', 'migrations');

describe('the registry', () => {
  const journal = (
    JSON.parse(readFileSync(join(folder, 'meta', '_journal.json'), 'utf8')) as {
      entries: Array<{ tag: string; when: number }>;
    }
  ).entries;
  const hashes = new Map(
    readMigrationFiles({ migrationsFolder: folder }).map((meta) => [meta.folderMillis, meta.hash]),
  );

  it.each(RENUMBERED_MIGRATIONS.map((entry) => [entry.tag, entry]))(
    '%s: the hash drizzle records for the file today is the one the registry names',
    (_tag, renumbered) => {
      const entry = journal.find((candidate) => candidate.tag === renumbered.tag);
      expect(entry).toBeDefined();
      // If this fails, the migration file was edited. A database's row for the
      // former number then no longer proves the current file ran.
      expect(hashes.get(entry?.when ?? 0)).toBe(renumbered.hash);
    },
  );

  it.each(RENUMBERED_MIGRATIONS.map((entry) => [entry.tag, entry]))(
    '%s: the former number is not a timestamp the journal uses',
    (_tag, renumbered) => {
      expect(journal.map((entry) => entry.when)).not.toContain(renumbered.formerWhen);
    },
  );
});

describe('planning', () => {
  const renumbered: RenumberedMigration = {
    tag: '0003_moved',
    formerTag: '0001_moved',
    formerWhen: 150,
    hash: 'abc',
    evidence: 'SELECT true',
  };
  const journal: HashedEntry[] = [
    { tag: '0000_first', when: 100, hash: 'h0' },
    { tag: '0001_other', when: 200, hash: 'h1' },
    { tag: '0003_moved', when: 300, hash: 'abc' },
    { tag: '0004_after', when: 400, hash: 'h4' },
  ];
  const plan = (rows: Array<[number, string]>) =>
    planRenumberRepairs(
      journal,
      rows.map(([createdAt, hash]) => ({ createdAt, hash })),
      [renumbered],
    );

  it('leaves a fresh database alone', () => {
    expect(plan([])).toEqual({ repairs: [], refusals: [] });
  });

  it('leaves a database that ran the migration under its current number alone', () => {
    expect(
      plan([
        [100, 'h0'],
        [200, 'h1'],
        [300, 'abc'],
      ]),
    ).toEqual({ repairs: [], refusals: [] });
  });

  it('records the migration when its former number was recorded with the same file', () => {
    const result = plan([
      [100, 'h0'],
      [150, 'abc'],
    ]);
    expect(result.refusals).toEqual([]);
    expect(result.repairs.map((repair) => repair.entry.tag)).toEqual(['0003_moved']);
  });

  it('does not record it twice once both numbers are recorded', () => {
    expect(
      plan([
        [100, 'h0'],
        [150, 'abc'],
        [200, 'h1'],
        [300, 'abc'],
      ]).repairs,
    ).toEqual([]);
  });

  it('refuses, naming both numbers, when something else ran under the former number', () => {
    const result = plan([
      [100, 'h0'],
      [150, 'different'],
    ]);
    expect(result.repairs).toEqual([]);
    expect(result.refusals).toHaveLength(1);
    expect(result.refusals[0]).toContain('0003_moved');
    expect(result.refusals[0]).toContain('0001_moved');
    expect(result.refusals[0]).toContain('nothing has been changed');
  });

  it('says on the run that it recorded rather than ran', () => {
    const [repair] = plan([[150, 'abc']]).repairs;
    expect(repair && describeRepair(repair)).toMatch(/0003_moved \(already applied as 0001_moved/);
  });
});
