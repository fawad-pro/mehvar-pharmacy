/**
 * The database half of `ops:restore` — replacing a dead counter PC.
 *
 * Owner-connection operations only, kept out of the CLI so it stays a sequence
 * of named steps. Two of them change things, and both are deliberately
 * non-destructive:
 *
 *   - `swapDatabases` RENAMES the live database aside rather than dropping it.
 *     On a replacement PC that is the empty pharmacy the installer just made;
 *     anywhere else it is a second way back, beside the pre-restore dump.
 *   - `reissuePairingKey` changes one device's pairing-key hash. `devices` is a
 *     reference table (mutable by design, Phase 9 §5.1), and the key the
 *     restored counter was first given was written on the machine that died.
 */
import { Pool } from 'pg';

import { generatePairingKey } from '../../src/auth/pairing-key';
import { hashPassword } from '../../src/auth/pin';

export interface RestoredDevice {
  readonly deviceId: string;
  readonly deviceName: string;
  readonly receiptPrefix: string;
  readonly tenantSlug: string;
  readonly tenantName: string;
}

async function withPool<T>(url: string, work: (pool: Pool) => Promise<T>): Promise<T> {
  const pool = new Pool({ connectionString: url });
  try {
    return await work(pool);
  } finally {
    await pool.end();
  }
}

/** Active counters in a database, first prefix first (the shop's main PC is `A`). */
export async function listDevices(adminUrl: string): Promise<RestoredDevice[]> {
  return withPool(adminUrl, async (pool) => {
    const { rows } = await pool.query<RestoredDevice>(
      `SELECT d.id AS "deviceId", d.name AS "deviceName", d.receipt_prefix AS "receiptPrefix",
              t.slug AS "tenantSlug", t.name AS "tenantName"
         FROM devices d JOIN tenants t ON t.id = d.tenant_id
        WHERE d.is_active
        ORDER BY t.slug, d.receipt_prefix`,
    );
    return rows;
  });
}

/**
 * Give one restored counter a new pairing key. Returned to be SHOWN once, never
 * written anywhere: a key on disk is a credential on disk (the lesson of
 * first-run.txt).
 */
export async function reissuePairingKey(adminUrl: string, deviceId: string): Promise<string> {
  const pairingKey = generatePairingKey();
  const hash = await hashPassword(pairingKey);
  await withPool(adminUrl, async (pool) => {
    const { rowCount } = await pool.query(
      'UPDATE devices SET pairing_key_hash = $1 WHERE id = $2',
      [hash, deviceId],
    );
    if (rowCount !== 1) throw new Error(`No device ${deviceId} to give a pairing key to.`);
  });
  return pairingKey;
}

function quoteIdent(name: string): string {
  return `"${name.replaceAll('"', '""')}"`;
}

/**
 * Put `incoming` in place of `live`, keeping `live` as `retired`.
 *
 * Sessions on either database are ended first: PostgreSQL will not rename a
 * database anyone is connected to, and the counter service should already be
 * stopped (mehvar-restore.cmd stops it). Each rename is atomic; between the two
 * there is briefly no database under the live name, which is why the service
 * is down for this.
 */
export async function swapDatabases(
  maintenanceUrl: string,
  live: string,
  incoming: string,
  retired: string,
): Promise<{ retiredExisting: boolean }> {
  return withPool(maintenanceUrl, async (pool) => {
    await pool.query(
      `SELECT pg_terminate_backend(pid) FROM pg_stat_activity
        WHERE datname = ANY($1) AND pid <> pg_backend_pid()`,
      [[live, incoming]],
    );
    const { rows } = await pool.query<{ exists: boolean }>(
      'SELECT EXISTS (SELECT 1 FROM pg_database WHERE datname = $1) AS exists',
      [live],
    );
    const retiredExisting = rows[0]?.exists === true;
    if (retiredExisting) {
      await pool.query(`ALTER DATABASE ${quoteIdent(live)} RENAME TO ${quoteIdent(retired)}`);
    }
    await pool.query(`ALTER DATABASE ${quoteIdent(incoming)} RENAME TO ${quoteIdent(live)}`);
    return { retiredExisting };
  });
}
