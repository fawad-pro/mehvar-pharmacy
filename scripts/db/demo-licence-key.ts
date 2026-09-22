/**
 * The signing key `db:seed` uses for the demo's perpetual licence.
 *
 * Pulled out of `seed.ts` into its own module so it can be unit-tested without
 * importing a script whose body runs a live database seed on import.
 *
 * MUST resolve to a key the CURRENT trust root actually verifies, or return
 * `null`. Signing with the published development key — as `db:seed` used to —
 * stopped producing anything verifiable the moment `mehvar-1`/`mehvar-2` were
 * provisioned in `domain/trust/keys.ts`: `composeTrustRoot` correctly drops the
 * dev key from the trust root the instant a production key exists, so a
 * "perpetual" demo licence signed with it now resolves to `invalid` forever —
 * the exact regression this module fixes.
 *
 * `null` is the correct answer whenever no real key is configured, and the
 * caller must treat it as "issue nothing", never "fall back to the dev key".
 * Inserting a licence nobody can verify is worse than inserting none: PCN-006
 * already gives an unlicensed installation a fully-functional 30-day
 * evaluation, so a machine with no real signing key should fall through to
 * that instead of a doomed, permanently-`invalid` licence row.
 *
 * Same lookup `licence:issue`, `licence:revoke` and `catalog:build` already
 * use: `MEHVAR_LICENCE_SIGNING_KEY` pointing at a base64url PKCS8 private key
 * file, kid `mehvar-1`. Unlike those founder-run CLIs this has NO dev-key
 * fallback on purpose — `db:seed` runs unattended on every developer machine,
 * and a silent fallback to an untrusted key is exactly the bug being fixed.
 */

import { createPrivateKey, type KeyObject } from 'node:crypto';
import { readFileSync } from 'node:fs';

/** Narrower than `NodeJS.ProcessEnv`, so a test can inject a plain object. */
export type EnvLike = Readonly<Record<string, string | undefined>>;

export interface DemoSigningKey {
  readonly key: KeyObject;
  readonly kid: string;
}

/**
 * `null` when `MEHVAR_LICENCE_SIGNING_KEY` is unset or blank — the caller's
 * cue to skip issuing a demo licence entirely rather than mint one that can
 * never verify.
 */
export function resolveDemoSigningKey(env: EnvLike = process.env): DemoSigningKey | null {
  const path = env.MEHVAR_LICENCE_SIGNING_KEY;
  if (path === undefined || path.trim() === '') return null;

  const raw = readFileSync(path.trim(), 'utf8').trim();
  return {
    key: createPrivateKey({ key: Buffer.from(raw, 'base64url'), format: 'der', type: 'pkcs8' }),
    // Matches `licence:issue`/`licence:revoke`/`catalog:build`'s default —
    // there is no `--kid` flag here since `db:seed` is not run with arguments.
    kid: 'mehvar-1',
  };
}
