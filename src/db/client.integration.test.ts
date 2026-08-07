/**
 * The pool releases its session when told to.
 *
 * This looks like a test of a two-line function. It is really a test of
 * `ops:restore-drill`, whose whole job is to restore a dump into a scratch
 * database, verify it, and drop it — and PostgreSQL will not drop a database
 * that still has a session on it.
 *
 * The failure this pins was reported from a real install:
 *
 *     ERROR:  database "mehvar_restore_drill" is being accessed by other users
 *     DETAIL:  There is 1 other session using the database.
 *
 * That one session was the verifier's own pool, which `client.ts` creates
 * lazily and (correctly, for a server) never closes. So the drill verified the
 * dump, proved the backup restorable, and then failed anyway at cleanup —
 * reporting what reads like a backup problem and is not one.
 *
 * The assertion is the drill's own shape rather than a proxy for it: connect
 * to a scratch database, close, then DROP it for real. A session left behind
 * makes the drop raise the exact error above.
 *
 * Requires Postgres, and an admin role that may CREATE DATABASE — which
 * `ops:restore-drill` already requires of any machine that runs it. Skips
 * itself without a database, like the other integration suites.
 */

import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { adminQuery, adminValue } from '../../tests/db-admin';

import { closeDatabase, database } from './client';

const DATABASE_AVAILABLE = Boolean(process.env.DATABASE_URL);
const suite = DATABASE_AVAILABLE ? describe : describe.skip;

/**
 * Its own database, not the shared test one.
 *
 * Two reasons. It is the drill's actual situation — verify a scratch database,
 * then drop it — and a shared database cannot answer "is anything still
 * connected?" without counting the other suites' connections, which run in
 * their own worker processes.
 */
const SCRATCH_DB = 'mehvar_pool_release_test';

function scratchUrl(): string {
  const url = new URL(process.env.DATABASE_URL ?? '');
  url.pathname = `/${SCRATCH_DB}`;
  return url.toString();
}

/** Sessions on the scratch database, counted through the admin connection. */
async function sessionsOnScratch(): Promise<number> {
  return Number(
    await adminValue('SELECT count(*) FROM pg_stat_activity WHERE datname = $1', [SCRATCH_DB]),
  );
}

suite('the database pool', () => {
  beforeAll(async () => {
    await adminQuery(`DROP DATABASE IF EXISTS ${SCRATCH_DB} WITH (FORCE)`);
    await adminQuery(`CREATE DATABASE ${SCRATCH_DB}`);

    // Before the first `database()` call, because `serverEnv()` caches on first
    // read — the same ordering `ops:restore-drill` depends on.
    process.env.DATABASE_URL = scratchUrl();
  });

  afterAll(async () => {
    await closeDatabase();
    await adminQuery(`DROP DATABASE IF EXISTS ${SCRATCH_DB} WITH (FORCE)`);
  });

  it('holds a session while open, and lets go on close so the drop succeeds', async () => {
    await database().execute(sql`select 1`);
    expect(await sessionsOnScratch(), 'the pool should be connected after a query').toBeGreaterThan(
      0,
    );

    await closeDatabase();
    expect(await sessionsOnScratch(), 'closeDatabase must leave no session behind').toBe(0);

    // The invariant the restore drill actually needs. No FORCE: a session left
    // behind raises `is being accessed by other users` here, exactly as it did
    // on the shop machine.
    await expect(adminQuery(`DROP DATABASE ${SCRATCH_DB}`)).resolves.toBeUndefined();
    await adminQuery(`CREATE DATABASE ${SCRATCH_DB}`);
  });

  it('is safe to close twice, and to close having never connected', async () => {
    await closeDatabase();
    await expect(closeDatabase()).resolves.toBeUndefined();
  });

  it('reconnects after a close, so closing is not a one-way door', async () => {
    await closeDatabase();
    const result = await database().execute(sql`select 1 as one`);
    expect(result.rowCount).toBe(1);
  });
});
