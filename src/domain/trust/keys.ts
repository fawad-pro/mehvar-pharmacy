/**
 * The trust root — the public half of every signature Mehvar honours.
 *
 * One root, three consumers: licence tokens (roadmap Phase 2), update manifests
 * and catalogue packs. They are three signed artifacts from one founder, so they
 * get one verification path rather than three, and one place to look when
 * something will not verify.
 *
 * **Two slots, from day one.** `mehvar-1` signs; `mehvar-2` is a cold spare
 * generated at the same time and never used. Every signed artifact names its
 * `kid`, so rotating to the spare is a one-line change here plus a normal
 * release — not an emergency. Three lines of code for a recovery path that
 * costs nothing to carry.
 *
 * There is deliberately no certificate chain. A chain delegates signing to
 * people who do not exist.
 *
 * Keys are Ed25519 public keys in SPKI DER, base64url. See `signature.ts` for
 * why the algorithm is not negotiable.
 */

/** A key identifier, carried by every signed artifact so rotation is possible. */
export type Kid = string;

/** kid → Ed25519 public key, SPKI DER as base64url. */
export type Keyring = Readonly<Record<Kid, string>>;

/**
 * The development key.
 *
 * **Its private half is committed in `scripts/licence/dev-key.ts` and is
 * therefore public.** That is the point: it makes the whole chain runnable —
 * tests, `licence:issue`, a real paste into Settings — without anyone minting
 * production key material on a shared machine.
 *
 * It carries no security claim whatsoever. `licence:issue` says so, loudly,
 * every time it signs with it.
 */
export const DEV_KID = 'dev-1';

const DEV_PUBLIC_KEY = 'MCowBQYDK2VwAyEAFwq9f4diE4x-6TZJQMKeRA0-C5moOJeNL2TR05S7hQU';

/**
 * Production keys, minted by the founder on the founder's own machine.
 *
 * **Provisioned.** `mehvar-1` signs; `mehvar-2` is the cold spare, generated at
 * the same sitting and never used until a rotation calls for it. Both private
 * halves live in the founder's password manager and nowhere else — never a
 * repository, never a build agent, never CI.
 *
 * Their presence here is what makes `composeTrustRoot` drop `dev-1` from
 * `TRUST_ROOT_KEYS` below: `trust-keys.test.ts` states plainly which branch
 * that leaves the suite on, so a future accidental reversion (deleting these
 * two lines) would fail loudly rather than silently re-trusting the published
 * dev key.
 */
const PRODUCTION_KEYS: Keyring = {
  'mehvar-1': 'MCowBQYDK2VwAyEAhlbrSb_IyLQjt2PWHq_CcTNz8HlID0wvv0SChSjS-Uw',
  'mehvar-2': 'MCowBQYDK2VwAyEA8GbgDwf7X7Hg9cDDdZdw2bqp7FHdPLzNqA8Oqf6rvqs',   // cold spare, never used until needed
};

/**
 * The keys this build trusts — and the dev key is trusted **only while there is
 * no production key.**
 *
 * This is the whole safety of committing the dev private half. During Stage 1
 * there is nothing to protect: no paying pharmacy exists, and the dev key is the
 * only way to run the chain at all. The moment a real `mehvar-1` is pasted into
 * `PRODUCTION_KEYS`, the dev key drops out of the trusted set — so the
 * committed, public private half can never forge a licence a real pharmacy
 * accepts. The exposure ends automatically, at exactly the point it would start
 * to matter, rather than depending on someone remembering to delete a line.
 *
 * The rule is a pure function so the security-critical branch — "dev key absent
 * once a production key exists" — is testable today, while `PRODUCTION_KEYS` is
 * still empty. `keys.test.ts` exercises both states.
 */
export function composeTrustRoot(
  productionKeys: Keyring,
  devKid: string,
  devPublicKey: string,
): Keyring {
  return Object.keys(productionKeys).length > 0
    ? { ...productionKeys }
    : { [devKid]: devPublicKey };
}

export const TRUST_ROOT_KEYS: Keyring = composeTrustRoot(PRODUCTION_KEYS, DEV_KID, DEV_PUBLIC_KEY);

/** Whether this build carries any key the founder actually controls privately. */
export function hasProductionKey(keyring: Keyring = TRUST_ROOT_KEYS): boolean {
  return Object.keys(keyring).some((kid) => kid !== DEV_KID);
}
