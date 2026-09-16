/**
 * Signed catalogue packs (Stage 2).
 *
 * A catalogue update that arrives from OUTSIDE the application — a downloaded
 * pack, roadmap Phase 3's distribution — must be signed by the founder and
 * verified against the SAME trust root as the licence, before a single medicine
 * from it reaches a pharmacy. The envelope is the licence token's shape:
 *
 *     MEHVARPACK1.<base64url(pack JSON)>.<base64url(ed25519 signature)>
 *
 * WHAT THIS DOES AND DOES NOT DECIDE
 *
 * This module answers exactly one question: *did the founder sign these bytes,
 * with a key this build trusts?* It returns the verified pack JSON text; the
 * caller then runs the existing `readPack` to validate structure. Signature
 * first, structure second — a tampered pack is refused before its contents are
 * ever parsed, and a structurally-broken pack from a trusted signer still gets
 * the same clear `readPack` diagnosis it always did.
 *
 * THE BUNDLED STARTER PACK IS DIFFERENT, ON PURPOSE
 *
 * The pack the installer ships and `db:setup` loads is built from the repo's own
 * `seed-data.ts` at package time and travels INSIDE the code-signed installer.
 * It is already covered by the application's own distribution trust; re-signing
 * it with the licence key buys nothing and would require a signing key at build
 * time, which Stage 1 deliberately keeps off build agents. So `catalog:import`
 * accepts a raw (unsigned) pack only when the caller explicitly asserts it is
 * that local, build-produced artifact (`--trusted-local`); every other pack
 * must be a verified envelope.
 */

import { signEnvelope, verifyEnvelope } from '@/domain/trust/envelope';
import type { Keyring } from '@/domain/trust/keys';
import type { KeyObject } from 'node:crypto';

export const SIGNED_PACK_PREFIX = 'MEHVARPACK1';

export type SignedPackReason = 'malformed' | 'unknown_key' | 'bad_signature';

export type SignedPackResult =
  | { readonly ok: true; readonly packJson: string }
  | { readonly ok: false; readonly reason: SignedPackReason };

/** Whether a file looks like a signed envelope at all (vs a raw pack JSON). */
export function looksSigned(text: string): boolean {
  return text.trim().startsWith(`${SIGNED_PACK_PREFIX}.`);
}

function readKid(json: string): string | undefined {
  // The signing metadata rides alongside the pack under `_sig`, so the pack's
  // own top level stays exactly the shape `readPack` already understands.
  try {
    const parsed = JSON.parse(json) as Record<string, unknown>;
    const meta = parsed._sig;
    if (
      typeof meta === 'object' &&
      meta !== null &&
      typeof (meta as Record<string, unknown>).kid === 'string'
    ) {
      return (meta as Record<string, unknown>).kid as string;
    }
    return undefined;
  } catch {
    return undefined;
  }
}

/**
 * Verify a signed pack envelope. Total — never throws.
 *
 * On success returns the pack JSON with the `_sig` metadata stripped, so the
 * caller hands `readPack` exactly the shape it expects.
 */
export function verifySignedPack(envelope: string, keyring?: Keyring): SignedPackResult {
  const verified = verifyEnvelope(SIGNED_PACK_PREFIX, envelope, readKid, keyring);
  if (!verified.ok) return { ok: false, reason: verified.reason };

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(verified.json) as Record<string, unknown>;
  } catch {
    return { ok: false, reason: 'malformed' };
  }
  // Strip the signing metadata; the pack readers never see it.
  const { _sig, ...pack } = parsed;
  void _sig;
  return { ok: true, packJson: JSON.stringify(pack) };
}

/**
 * Sign a pack. The founder's half, used by `catalog:build --sign`.
 *
 * `packJson` is the raw pack (as `readPack` would accept). The `kid` is embedded
 * so the verifier knows which key to check, exactly as the licence token embeds
 * its kid.
 */
export function signPack(packJson: string, kid: string, privateKey: KeyObject): string {
  const pack = JSON.parse(packJson) as Record<string, unknown>;
  const withMeta = JSON.stringify({ ...pack, _sig: { kid } });
  return signEnvelope(SIGNED_PACK_PREFIX, withMeta, privateKey);
}
