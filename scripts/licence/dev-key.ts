/**
 * The development signing key — **and its private half is committed here on
 * purpose, so it is public and secures nothing.**
 *
 * That is the point. It makes the whole chain runnable end to end — tests,
 * `licence:issue`, a real paste into Settings — without anybody minting
 * production key material on a build agent or in CI, where it would be exposed
 * the moment it existed.
 *
 * `licence:issue` prints a loud warning every time it signs with this key.
 * Production keys (`mehvar-1`, `mehvar-2`) are now provisioned in
 * `src/domain/trust/keys.ts`, which drops this key from `TRUST_ROOT_KEYS` the
 * moment a production key exists (`trust-keys.test.ts` asserts it) — so
 * nothing this key signs is trusted by a real build any more. It stays
 * committed anyway, for the same reason it always was: dev, demo and test
 * runs that never set `MEHVAR_LICENCE_SIGNING_KEY` still need something to
 * sign with.
 */

export const DEV_PRIVATE_KEY_PKCS8_BASE64URL =
  'MC4CAQAwBQYDK2VwBCIEIKCV0glTWtNTxHLlVazDfq_ZXxAQnraV5W84RpTl5jB2';
