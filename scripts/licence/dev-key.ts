/**
 * The development signing key — **and its private half is committed here on
 * purpose, so it is public and secures nothing.**
 *
 * That is the point. It makes the whole chain runnable end to end — tests,
 * `licence:issue`, a real paste into Settings — without anybody minting
 * production key material on a build agent or in CI, where it would be exposed
 * the moment it existed.
 *
 * `licence:issue` prints a loud warning every time it signs with this key, and
 * `trust-keys.test.ts` states plainly that no production key is provisioned
 * yet. Provisioning one (`npm run licence:keygen`, public half into
 * `src/domain/trust/keys.ts`, private half into a password manager) is a
 * release blocker for roadmap Phase 2.
 */

export const DEV_PRIVATE_KEY_PKCS8_BASE64URL =
  'MC4CAQAwBQYDK2VwBCIEIKCV0glTWtNTxHLlVazDfq_ZXxAQnraV5W84RpTl5jB2';
