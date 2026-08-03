/**
 * Installation identity — the machine Mehvar is installed on.
 *
 * Distinct from tenant, deliberately. `tenants.id` is *business* identity
 * ("Al-Shifa Medical Store"); the installation id is *machine* identity ("the
 * PC this is running on"). Licensing, updates, support and telemetry key off
 * the installation. Conflating the two is what makes "the customer replaced
 * their PC" an unanswerable support ticket — see `docs/research/
 * commercialization.md` Part 1 §5.
 *
 * Roadmap Phase 1 stores it in a file and nowhere else. The database half
 * arrives with licensing in roadmap Phase 2, which is why this needs no
 * migration and no `db:grants` change today. §0.1: build the simple thing, and
 * check the harder thing is still reachable from it.
 *
 * Deliberately pure — fs and path only. It must not reach the database, and it
 * is imported by ops scripts that run when the application is not up.
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

import { uuidv7, type Uuid } from './uuid';

/**
 * Only the variables these functions actually read.
 *
 * Narrower than `NodeJS.ProcessEnv` on purpose: Next augments that type with
 * required keys, so demanding it would force every caller — and every test —
 * to supply a whole environment to ask where one directory is.
 */
export type EnvLike = Readonly<Record<string, string | undefined>>;

/** What `installation.json` holds. Additive-only, like every other record. */
export interface InstallationRecord {
  /** UUIDv7, minted once at install and never rewritten. */
  installationId: Uuid;
  /** ISO-8601. When this machine was first provisioned. */
  installedAt: string;
  /** The release that performed the install, for support triage. */
  installedVersion: string;
}

/**
 * Where the record lives, per platform.
 *
 * Windows uses `%ProgramData%` because the Node runs as a service under an
 * account whose profile the owner never sees, and the file must outlive any
 * one user. Elsewhere follows XDG so a developer's machine stays tidy.
 *
 * `MEHVAR_DATA_DIR` overrides both — the installer sets it, and tests use it.
 */
export function installationDir(env: EnvLike = process.env): string {
  const override = env.MEHVAR_DATA_DIR;
  if (override !== undefined && override !== '') return override;

  if (process.platform === 'win32') {
    const programData = env.ProgramData ?? env.PROGRAMDATA ?? 'C:\\ProgramData';
    return join(programData, 'Mehvar');
  }

  const xdg = env.XDG_DATA_HOME;
  if (xdg !== undefined && xdg !== '') return join(xdg, 'mehvar');
  return join(homedir(), '.local', 'share', 'mehvar');
}

export function installationFile(env: EnvLike = process.env): string {
  return join(installationDir(env), 'installation.json');
}

/**
 * The installation record, or `undefined` if this machine has none yet.
 *
 * A malformed file is reported rather than silently replaced: overwriting it
 * would mint a second identity for a machine that already has one, and the
 * support trail would go quiet exactly when someone is trying to follow it.
 */
export function readInstallation(env: EnvLike = process.env): InstallationRecord | undefined {
  const file = installationFile(env);

  let raw: string;
  try {
    raw = readFileSync(file, 'utf8');
  } catch {
    return undefined;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`Installation file is not valid JSON: ${file}`);
  }

  if (!isInstallationRecord(parsed)) {
    throw new Error(`Installation file is missing required fields: ${file}`);
  }
  return parsed;
}

/**
 * Mint the installation identity, once.
 *
 * Idempotent by design: an installer that runs twice — a repair, a reinstall
 * over the top — must not give one machine two identities. Returns the
 * existing record unchanged if there is one.
 */
export function ensureInstallation(
  installedVersion: string,
  env: EnvLike = process.env,
): InstallationRecord {
  const existing = readInstallation(env);
  if (existing !== undefined) return existing;

  const record: InstallationRecord = {
    installationId: uuidv7(),
    installedAt: new Date().toISOString(),
    installedVersion,
  };

  const file = installationFile(env);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(record, null, 2)}\n`, 'utf8');
  return record;
}

function isInstallationRecord(value: unknown): value is InstallationRecord {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.installationId === 'string' &&
    typeof candidate.installedAt === 'string' &&
    typeof candidate.installedVersion === 'string'
  );
}
