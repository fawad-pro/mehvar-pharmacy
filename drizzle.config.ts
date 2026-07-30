import 'dotenv/config';

import { defineConfig } from 'drizzle-kit';

/**
 * Phase 11 §4 / Phase 12 §2.2: migrations are forward-only, committed with
 * their feature, and every migration must be additive-safe — new columns
 * nullable or defaulted, no destructive drops in the release that stops using
 * a column. That is why deploys never need a maintenance window, and why the
 * previous image still runs against the migrated schema on rollback.
 */
export default defineConfig({
  schema: './src/db/schema.ts',
  out: './src/db/migrations',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL ?? '',
  },
  strict: true,
  verbose: true,
});
