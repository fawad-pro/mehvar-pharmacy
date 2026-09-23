/**
 * `db:grants` — applies the ADR-1 privilege split to the app role.
 *
 * Run as the database owner (DATABASE_ADMIN_URL) after every migration that
 * adds a table. Idempotent: safe to re-run, and it must be re-run, because a
 * new event table starts life with default privileges.
 *
 * The grants logic itself lives in `grants-apply.ts` so `ops:restore-drill`
 * can call it against a restored scratch database without spawning this CLI.
 */
import 'dotenv/config';

import { applyGrants } from './grants-apply';

applyGrants().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
