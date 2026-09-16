/**
 * Detached Ed25519 verification — the one signature check in the product.
 *
 * **The algorithm is hardcoded and the artifact carries no `alg` field.** A
 * verifier that reads the algorithm out of the thing it is verifying is how
 * signature-stripping bugs happen; there is nothing to strip here because there
 * is nothing to read. The only thing an artifact may choose is which *key* it
 * was signed with (`kid`), and an unknown kid is a refusal.
 *
 * Node 22 does Ed25519 natively, so this costs no dependency. That matters: the
 * packager already special-cases the one native binding in the tree
 * (`@node-rs/argon2`), and a second would be a second thing to get wrong on a
 * customer's Windows machine.
 *
 * Server-side only by nature — it reaches `node:crypto`. Nothing a client
 * component imports may reach this file; `domain/licensing/state.ts` is the pure
 * half that the browser is allowed to see, exactly as `auth/pin-policy.ts` is the
 * pure half of `auth/pin.ts`.
 */

import { createPublicKey, verify as cryptoVerify, type KeyObject } from 'node:crypto';

import { TRUST_ROOT_KEYS, type Keyring, type Kid } from './keys';

/**
 * Parsed keys are cached because verification runs on a timer and on every
 * licence paste, and re-parsing DER each time buys nothing.
 */
const parsed = new Map<string, KeyObject>();

function publicKeyFor(kid: Kid, keyring: Keyring): KeyObject | undefined {
  const encoded = keyring[kid];
  if (encoded === undefined) return undefined;

  const cacheKey = `${kid}:${encoded}`;
  const hit = parsed.get(cacheKey);
  if (hit !== undefined) return hit;

  let key: KeyObject;
  try {
    key = createPublicKey({
      key: Buffer.from(encoded, 'base64url'),
      format: 'der',
      type: 'spki',
    });
  } catch {
    // A malformed key in the keyring is a build defect, not a runtime input.
    // Returning undefined makes it a refusal rather than a crash at the counter.
    return undefined;
  }

  parsed.set(cacheKey, key);
  return key;
}

/**
 * True when `signature` is a valid Ed25519 signature over `payload` by `kid`.
 *
 * Never throws. Every failure mode — unknown kid, malformed key, malformed
 * signature, wrong signature — is `false`, because the caller's decision is the
 * same in all of them and a thrown error on a licence check is a crash at the
 * counter.
 *
 * `keyring` is injectable so tests can sign with a keypair they generated
 * themselves. That is not a weakening: anyone able to pass a keyring is already
 * able to edit this file.
 */
export function verifyDetached(
  payload: Uint8Array,
  signature: Uint8Array,
  kid: Kid,
  keyring: Keyring = TRUST_ROOT_KEYS,
): boolean {
  const key = publicKeyFor(kid, keyring);
  if (key === undefined) return false;

  try {
    return cryptoVerify(null, payload, key, signature);
  } catch {
    return false;
  }
}
