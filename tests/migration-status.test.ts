/**
 * The check that turns a silent skip into a refusal.
 *
 * `db:migrate` used to end with "Migrations applied (6 file(s))" — a count of
 * files in a folder, printed identically whether six migrations were applied or
 * none were. A developer pulling a branch had no way to tell the difference,
 * and found out when the application crashed on a column that did not exist.
 *
 * These assertions pin the two properties that replace it: the message
 * describes what actually happened, and a database still behind the code stops
 * the run instead of being reported as a success.
 */

import { describe, expect, it } from 'vitest';

import {
  assertJournalApplied,
  compareJournal,
  describeRun,
  describeTarget,
  type JournalEntry,
} from '../scripts/db/migration-status';

const journal: JournalEntry[] = [
  { tag: '0000_first', when: 100 },
  { tag: '0001_second', when: 200 },
  { tag: '0002_third', when: 300 },
];

describe('comparing the journal against the database', () => {
  it('reports nothing missing when every entry is recorded', () => {
    const report = compareJournal(journal, [
      { createdAt: 100 },
      { createdAt: 200 },
      { createdAt: 300 },
    ]);
    expect(report.missing).toEqual([]);
  });

  it('names what is missing', () => {
    const report = compareJournal(journal, [{ createdAt: 100 }, { createdAt: 200 }]);
    expect(report.missing.map((entry) => entry.tag)).toEqual(['0002_third']);
  });

  it('matches on the recorded timestamp, not on how many rows there are', () => {
    // The state a long-lived development database drifts into: the right NUMBER
    // of rows, recorded from a different journal. Counting would call this
    // current; it is not.
    const report = compareJournal(journal, [
      { createdAt: 100 },
      { createdAt: 200 },
      { createdAt: 999 },
    ]);
    expect(report.missing.map((entry) => entry.tag)).toEqual(['0002_third']);
  });

  it('treats a never-migrated database as missing everything', () => {
    expect(compareJournal(journal, []).missing).toHaveLength(3);
  });
});

describe('describing what the run did', () => {
  it('says plainly when nothing was applied', () => {
    // The case the old message made indistinguishable from every other.
    const state = compareJournal(journal, [
      { createdAt: 100 },
      { createdAt: 200 },
      { createdAt: 300 },
    ]);
    expect(describeRun('demo on localhost', state, state)).toContain('already up to date');
  });

  it('names each migration it applied', () => {
    const before = compareJournal(journal, [{ createdAt: 100 }]);
    const after = compareJournal(journal, [
      { createdAt: 100 },
      { createdAt: 200 },
      { createdAt: 300 },
    ]);
    const message = describeRun('demo on localhost', before, after);

    expect(message).toContain('applied 2 migration(s)');
    expect(message).toContain('0001_second');
    expect(message).toContain('0002_third');
    expect(message).not.toContain('0000_first');
  });

  it('does not report a migration it only recorded as applied', () => {
    // renumbered-migrations.ts: recorded because it already ran, not re-run.
    const before = compareJournal(journal, [{ createdAt: 100 }]);
    const after = compareJournal(journal, [
      { createdAt: 100 },
      { createdAt: 200 },
      { createdAt: 300 },
    ]);
    const message = describeRun('demo on localhost', before, after, ['0001_second']);

    expect(message).toContain('applied 1 migration(s); recorded 1');
    expect(message).toContain('+ 0002_third');
    expect(message).not.toContain('+ 0001_second');
  });

  it('always names the database, so "which one did that touch?" is never a question', () => {
    const state = compareJournal(journal, []);
    expect(describeRun('mehvar_pharmacy on localhost:5432', state, state)).toContain(
      'mehvar_pharmacy',
    );
  });
});

describe('refusing to finish behind the code', () => {
  it('passes when the database is current', () => {
    const report = compareJournal(journal, [
      { createdAt: 100 },
      { createdAt: 200 },
      { createdAt: 300 },
    ]);
    expect(() => {
      assertJournalApplied('demo', report);
    }).not.toThrow();
  });

  it('throws, naming the migration rather than a count', () => {
    // "2 migrations are missing" sends someone to read a folder.
    // "0002_third" sends them to the answer.
    const report = compareJournal(journal, [{ createdAt: 100 }, { createdAt: 200 }]);
    expect(() => {
      assertJournalApplied('demo', report);
    }).toThrow(/0002_third/);
  });

  it('says which database is behind', () => {
    const report = compareJournal(journal, []);
    expect(() => {
      assertJournalApplied('mehvar_pharmacy on localhost:5432', report);
    }).toThrow(/mehvar_pharmacy/);
  });

  it('warns that the symptom will look unrelated', () => {
    // The whole point: the operator meets this as a "column does not exist"
    // error on a page that has nothing to do with the migration.
    const report = compareJournal(journal, []);
    expect(() => {
      assertJournalApplied('demo', report);
    }).toThrow(/column does not exist/);
  });
});

describe('labelling the target', () => {
  it('names the database, host and user', () => {
    expect(describeTarget('postgresql://mehvar:secret@localhost:5432/mehvar_pharmacy')).toBe(
      'mehvar_pharmacy on localhost:5432 as mehvar',
    );
  });

  it('never prints the password', () => {
    // This line goes into terminals, CI logs and support bundles.
    expect(describeTarget('postgresql://mehvar:hunter2@localhost:5432/db')).not.toContain(
      'hunter2',
    );
  });

  it('labels an unreadable URL rather than crashing the migration over a log line', () => {
    expect(describeTarget('not a url')).toBe('the configured database');
  });
});
