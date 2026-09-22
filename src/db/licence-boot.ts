import 'server-only';

import { hostname } from 'node:os';

import { listTenantIds, anyUserId } from '@/db/provisioning';
import { findInstallation, soleInstallation, upsertInstallation } from '@/db/installation-queries';
import {
  insertLicence,
  listLicences,
  newestObservation,
  recordObservation,
} from '@/db/licence-queries';
import { shouldObserve } from '@/domain/licensing/clock';
import { verifyToken } from '@/domain/licensing/verify';
import {
  ensureInstallation,
  readInstallation,
  writeInstallation,
  type InstallationRecord,
} from '@/lib/installation';
import { readLicenceFile, writeLicenceFile } from '@/lib/licence-file';
import { tenantScope } from '@/db/scoped';
import { uuidv7 } from '@/lib/uuid';

/**
 * Boot reconciliation (PCN-005) — three idempotent rules, run once at startup.
 *
 * Everything here is best-effort by design. A licence question must never stop a
 * Node from coming up: the counter has to be able to sell, and a pharmacy whose
 * server refuses to start because it could not decide about a licence is exactly
 * the wall P2 exists to prevent.
 */

export interface BootReport {
  readonly installationId: string;
  readonly restoredIdentity: boolean;
  readonly tokensAdopted: number;
  readonly observationWritten: boolean;
  readonly problems: readonly string[];
}

export async function reconcileOnBoot(version: string): Promise<BootReport> {
  const problems: string[] = [];
  let restoredIdentity = false;
  let tokensAdopted = 0;
  let observationWritten = false;

  // ---- 1. Machine identity: restore, do not mint. -------------------------
  let record = readInstallation();
  if (record === undefined) {
    // The file is gone. If the database remembers exactly one machine, this IS
    // that machine — a cleaned ProgramData, not a new install. Minting here
    // would unbind a paying pharmacy and reset its trial anchor at once.
    const known = await soleInstallation().catch(() => undefined);
    record = ensureInstallation(
      version,
      process.env,
      known
        ? { installationId: known.id, installedAt: known.firstSeenAt.toISOString() }
        : undefined,
    );
    restoredIdentity = known !== undefined;
  }

  const identity: InstallationRecord = record;

  try {
    const existing = await findInstallation(identity.installationId);
    await upsertInstallation({
      id: identity.installationId,
      // Never moved forward: `first_seen_at` is one of the trial anchor's
      // sources, and a writer that could advance it is a trial reset.
      firstSeenAt: existing?.firstSeenAt ?? new Date(identity.installedAt),
      version,
      hostname: hostname(),
    });
    if (existing !== undefined && readInstallation() === undefined) {
      writeInstallation(identity);
    }
  } catch (error) {
    problems.push(`installation record: ${describe(error)}`);
  }

  // ---- 2. Licence tokens: union, never comparison. ------------------------
  try {
    tokensAdopted = await reconcileTokens(identity.installationId);
  } catch (error) {
    problems.push(`licence reconciliation: ${describe(error)}`);
  }

  // ---- 3. The clock witness. ---------------------------------------------
  try {
    const systemNow = new Date();
    const newest = await newestObservation();
    if (shouldObserve({ systemNow, newestObservation: newest, reason: 'boot' })) {
      await recordObservation(uuidv7(), systemNow, 'boot');
      observationWritten = true;
    }
  } catch (error) {
    problems.push(`clock witness: ${describe(error)}`);
  }

  return {
    installationId: identity.installationId,
    restoredIdentity,
    tokensAdopted,
    observationWritten,
    problems,
  };
}

/**
 * Adopt any token either side knows and the other does not.
 *
 * **Union, not comparison.** Append-only rows make both sides mergeable, so
 * there is no "which is newer" question to get wrong — and no file timestamp to
 * trust, which is what an earlier design did and what a restore rewrites.
 */
async function reconcileTokens(installationId: string): Promise<number> {
  const tenantIds = await listTenantIds();
  let adopted = 0;

  for (const tenantId of tenantIds) {
    const userId = await anyUserId(tenantId);
    if (userId === undefined) continue;
    const scope = tenantScope({ tenantId, userId });

    const stored = await listLicences(scope);
    const onDisk = readLicenceFile();

    if (onDisk !== undefined && !stored.some((row) => row.token === onDisk)) {
      const verified = verifyToken(onDisk);
      if (verified.ok) {
        const { payload } = verified.licence;
        await insertLicence(scope, {
          id: uuidv7(),
          token: verified.licence.token,
          licenceId: payload.licenceId,
          issuedAt: new Date(payload.issuedAt),
          installationId,
        });
        adopted += 1;
      }
    }

    // Write the effective token back out, so a wiped ProgramData is refilled
    // from the database on the very next boot.
    const refreshed = adopted > 0 ? await listLicences(scope) : stored;
    const newest = [...refreshed].sort(
      (a, b) => b.issuedAt.getTime() - a.issuedAt.getTime(),
    )[0];
    if (newest !== undefined && newest.token !== onDisk) {
      writeLicenceFile(newest.token);
    }
  }

  return adopted;
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
