/**
 * The licence token's copy on disk, beside `installation.json`.
 *
 * Two homes for one token, because a shop loses state in two independent ways:
 * a database restored from an old dump has a stale licence, and a cleaned
 * `%ProgramData%` has none. Boot reconciles them by **union, not comparison** —
 * every token either side knows is inserted, and the effective one is chosen by
 * Invariant L2 afterwards.
 *
 * That is why nothing here reads a modification time. An earlier design took
 * "the newer of the two" by file mtime, which a restore rewrites and an attacker
 * controls; append-only rows make the whole ordering question disappear.
 *
 * Deliberately pure — `fs` and `path` only, like `installation.ts`. It must not
 * reach the database, and ops scripts import it when the application is down.
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { installationDir, type EnvLike } from './installation';

export function licenceFile(env: EnvLike = process.env): string {
  return join(installationDir(env), 'licence.txt');
}

/**
 * The token on disk, or `undefined`.
 *
 * A missing or unreadable file is simply "no token here" — never an error. The
 * database may well have one, and a crash at boot over a file that is allowed to
 * be absent would take the counter down for a licence question.
 */
export function readLicenceFile(env: EnvLike = process.env): string | undefined {
  try {
    const raw = readFileSync(licenceFile(env), 'utf8').trim();
    return raw === '' ? undefined : raw;
  } catch {
    return undefined;
  }
}

/** Writes the effective token back out. Best-effort: never throws at boot. */
export function writeLicenceFile(token: string, env: EnvLike = process.env): boolean {
  try {
    const file = licenceFile(env);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, `${token.trim()}\n`, 'utf8');
    return true;
  } catch {
    return false;
  }
}
