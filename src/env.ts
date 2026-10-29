/**
 * Environment configuration — Phase 12 §1: environment variables only, held in
 * Railway; no secrets in the repository, no `.env` committed.
 *
 * Parsed once, at the edge, so a missing variable fails loudly at boot rather
 * than quietly at the counter. Server-only: never import this from a client
 * component.
 */

import 'server-only';

import { z } from 'zod';

const serverSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),

  /** Phase 12 §1 environments: local, staging, production. Three, no more. */
  APP_ENV: z.enum(['local', 'staging', 'production']).default('local'),

  /**
   * PCN-019: how this process is run. `local` (the default) is a shop PC with
   * one tenant and a PCN-006 licence file; `cloud` is the shared Railway
   * deployment, where entitlement is a per-tenant record. Configuration only —
   * nothing in `domain/` branches on it.
   */
  MEHVAR_DEPLOYMENT: z.enum(['local', 'cloud']).default('local'),

  /** The NON-OWNING application role — see PCN-001 and .env.example. */
  DATABASE_URL: z.string().url(),

  /** Session signing key for ADR-7's own auth. Rotated per Phase 12 §1. */
  SESSION_SECRET: z.string().min(32),

  /** Default tenant timezone (Phase 9 §1); single-timezone country. */
  TENANT_TIME_ZONE: z.string().default('Asia/Karachi'),

  /**
   * [Stage 2] The cloud licence service (roadmap Phase 3). Unset at launch, and
   * `refreshLicences()` is dormant while it is: a URL is what turns online
   * refresh, renewal and revocation on. Never on the sale path — see
   * `src/db/licence-refresh.ts`.
   */
  MEHVAR_LICENCE_URL: z.string().url().optional(),
});

export type ServerEnv = z.infer<typeof serverSchema>;

let cached: ServerEnv | undefined;

/**
 * Reads and validates server environment. Call sites get a typed, complete
 * config or a startup error naming exactly what is missing (I5 applied to us).
 */
export function serverEnv(): ServerEnv {
  if (cached !== undefined) {
    return cached;
  }

  const parsed = serverSchema.safeParse(process.env);
  if (!parsed.success) {
    const detail = parsed.error.issues
      .map((issue) => `  ${issue.path.join('.')}: ${issue.message}`)
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${detail}\n\nSee .env.example.`);
  }

  cached = parsed.data;
  return cached;
}
