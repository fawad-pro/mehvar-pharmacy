/**
 * Backup file naming and retention — the pure half of `ops:backup`.
 *
 * Lives here rather than in the script so it can be tested: the script runs
 * `main()` at import time, and this half **deletes files**. A retention rule
 * nobody can write a test against is one nobody should trust with a pharmacy's
 * only copy of its records.
 *
 * Phase 12 §3 (backup is a trust feature, T3) and PCN-004 (going local moved
 * the risk onto a shop with one disk).
 */

import { readdirSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { installationDir, type EnvLike } from './installation';

/** Kept generous: disk is cheap, and a bad day is often noticed late. */
export const DEFAULT_RETENTION_DAYS = 30;

const FILE_PREFIX = 'mehvar-';
const FILE_SUFFIX = '.dump';

export function backupDir(env: EnvLike = process.env): string {
  const override = env.MEHVAR_BACKUP_DIR;
  if (override !== undefined && override !== '') return override;
  return join(installationDir(env), 'backups');
}

/** `mehvar-2026-08-03T21-40-00-000.dump` — sorts chronologically as a string. */
export function backupFileName(now: Date = new Date()): string {
  const stamp = now.toISOString().replace(/[:.]/g, '-').replace(/Z$/, '');
  return `${FILE_PREFIX}${stamp}${FILE_SUFFIX}`;
}

/** Whether this script named the file — the guard on every destructive path. */
export function isBackupFile(name: string): boolean {
  return name.startsWith(FILE_PREFIX) && name.endsWith(FILE_SUFFIX);
}

export function parseRetentionDays(
  raw: string | undefined,
  fallback: number = DEFAULT_RETENTION_DAYS,
): number {
  if (raw === undefined || raw.trim() === '') return fallback;

  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed < 1) {
    throw new Error(`Backup retention must be a positive integer of days, got: ${raw}`);
  }
  return parsed;
}

/**
 * Delete dumps older than the retention window.
 *
 * Only ever touches files this system named. A backup folder the owner has put
 * something else in is their business, and a cleanup job that deletes
 * unrecognised files is a data-loss bug waiting for its moment.
 */
export function pruneOldBackups(
  directory: string,
  days: number = DEFAULT_RETENTION_DAYS,
  now: Date = new Date(),
): string[] {
  const cutoff = now.getTime() - days * 24 * 60 * 60 * 1000;
  const removed: string[] = [];

  for (const entry of readdirSync(directory)) {
    if (!isBackupFile(entry)) continue;

    const path = join(directory, entry);
    if (statSync(path).mtimeMs >= cutoff) continue;

    rmSync(path, { force: true });
    removed.push(entry);
  }
  return removed.sort();
}

/** Newest dump in the directory, or `undefined`. What the drill restores. */
export function latestBackup(directory: string): string | undefined {
  const dumps = readdirSync(directory).filter(isBackupFile).sort();
  return dumps.at(-1);
}
