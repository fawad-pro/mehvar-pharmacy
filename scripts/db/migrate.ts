/**
 * `db:migrate` — apply forward-only migrations (Phase 11 §4, Phase 12 §2.2).
 *
 * Run in the pre-deploy gate (Phase 12 §2.3), immediately before the ADR-8
 * rebuild verifier in post-deploy verification (§2.4), and by the Windows
 * installer on every install and update.
 *
 * A missing migrations folder is FATAL. It used to be a clean exit — correct
 * in Session 0, when there were none — and that early return is what let the
 * first real Windows install create an empty database and call it success.
 * See `migrations-location.ts`.
 */
import 'dotenv/config';

import { applyMigrations } from './migrate-apply';

async function main(): Promise<void> {
  const url = process.env.DATABASE_ADMIN_URL ?? process.env.DATABASE_URL;
  if (!url) {
    throw new Error('DATABASE_URL is not set. Copy .env.example to .env first.');
  }
  await applyMigrations(url);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  // drizzle wraps the database's own error, and its message is only the failed
  // query. The reason ("relation ... already exists") is in the cause; without
  // it the 0009 failure printed a CREATE TABLE and no explanation.
  if (error instanceof Error && error.cause instanceof Error) {
    console.error(`\nCause: ${error.cause.message}`);
  }
  process.exit(1);
});
