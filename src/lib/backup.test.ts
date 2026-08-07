import { mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  backupDir,
  backupFileName,
  isBackupFile,
  latestBackup,
  parseRetentionDays,
  pruneOldBackups,
} from './backup';

const created: string[] = [];

function scratchDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'mehvar-backup-'));
  created.push(dir);
  return dir;
}

/** Write a file and backdate it, so retention has something to act on. */
function writeAged(dir: string, name: string, ageDays: number): string {
  const path = join(dir, name);
  writeFileSync(path, 'dump', 'utf8');

  const seconds = (Date.now() - ageDays * 24 * 60 * 60 * 1000) / 1000;
  utimesSync(path, seconds, seconds);
  return path;
}

afterEach(() => {
  while (created.length > 0) {
    const dir = created.pop();
    if (dir !== undefined) rmSync(dir, { recursive: true, force: true });
  }
});

describe('backup naming', () => {
  it('names dumps so they sort chronologically as plain strings', () => {
    const earlier = backupFileName(new Date('2026-08-03T09:00:00Z'));
    const later = backupFileName(new Date('2026-08-03T21:40:00Z'));

    expect([later, earlier].sort()).toEqual([earlier, later]);
  });

  it('produces a filename with no characters Windows rejects', () => {
    // `:` in a timestamp is the classic one — it silently fails on NTFS.
    expect(backupFileName(new Date('2026-08-03T21:40:00Z'))).not.toMatch(/[:*?"<>|]/);
  });

  it('recognises only its own files', () => {
    expect(isBackupFile('mehvar-2026-08-03T21-40-00-000.dump')).toBe(true);
    expect(isBackupFile('customer-list.csv')).toBe(false);
    expect(isBackupFile('mehvar-notes.txt')).toBe(false);
  });

  it('honours an explicit backup directory over the install default', () => {
    expect(backupDir({ MEHVAR_BACKUP_DIR: '/mnt/usb/mehvar' })).toBe('/mnt/usb/mehvar');
  });
});

describe('retention parsing', () => {
  it('falls back when unset or blank', () => {
    expect(parseRetentionDays(undefined)).toBe(30);
    expect(parseRetentionDays('  ')).toBe(30);
  });

  it('rejects values that would delete everything', () => {
    // `0` would mean "older than now", i.e. every dump including tonight's.
    expect(() => parseRetentionDays('0')).toThrow(/positive integer/);
    expect(() => parseRetentionDays('-5')).toThrow(/positive integer/);
    expect(() => parseRetentionDays('nightly')).toThrow(/positive integer/);
  });
});

describe('pruning old backups', () => {
  it('removes dumps past the window and keeps the rest', () => {
    const dir = scratchDir();
    writeAged(dir, 'mehvar-old.dump', 45);
    writeAged(dir, 'mehvar-recent.dump', 3);

    expect(pruneOldBackups(dir, 30)).toEqual(['mehvar-old.dump']);
    expect(latestBackup(dir)).toBe('mehvar-recent.dump');
  });

  it('never touches a file it did not name', () => {
    // The guarantee that matters: an owner who keeps anything else in this
    // folder must not lose it to our cleanup job.
    const dir = scratchDir();
    writeAged(dir, 'stock-count-2025.csv', 400);
    writeAged(dir, 'mehvar-old.dump', 400);

    expect(pruneOldBackups(dir, 30)).toEqual(['mehvar-old.dump']);
    expect(latestBackup(dir)).toBeUndefined();
    expect(() => writeAged(dir, 'stock-count-2025.csv', 400)).not.toThrow();
  });

  it('keeps a dump sitting exactly on the boundary', () => {
    const dir = scratchDir();
    writeAged(dir, 'mehvar-boundary.dump', 29.9);

    expect(pruneOldBackups(dir, 30)).toEqual([]);
  });
});

describe('finding the newest dump', () => {
  it('returns undefined for an empty directory', () => {
    expect(latestBackup(scratchDir())).toBeUndefined();
  });

  it('picks the newest by name, which is newest by time', () => {
    const dir = scratchDir();
    writeAged(dir, backupFileName(new Date('2026-08-01T10:00:00Z')), 3);
    writeAged(dir, backupFileName(new Date('2026-08-03T10:00:00Z')), 1);

    expect(latestBackup(dir)).toBe(backupFileName(new Date('2026-08-03T10:00:00Z')));
  });
});
