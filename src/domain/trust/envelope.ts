/**
 * A signed envelope — the licence token's mechanism, factored for reuse.
 *
 * Stage 2 adds two more signed artifacts (revocations and catalogue packs) that
 * verify against the SAME trust root as the licence, the SAME way. Rather than
 * re-implement Ed25519 detached verification three times, they share this:
 *
 *     <PREFIX>.<base64url(payload bytes)>.<base64url(ed25519 signature)>
 *
 * The signature covers the base64url PAYLOAD SEGMENT bytes, never a
 * re-serialised object — so verification is independent of JSON key order,
 * whitespace and number formatting, exactly as the licence token established.
 * There is no `alg` field and none is read: the algorithm is fixed
 * (`signature.ts`), and the only thing an envelope may choose is which KEY
 * (`kid`) signed it. That whole class of signature-stripping bug is designed
 * out.
 *
 * The `kid` is carried INSIDE the payload (each artifact's payload declares its
 * own `kid`), so this module verifies against a caller-supplied kid — it does
 * not parse the payload itself. Parsing is each artifact's own job, after the
 * signature is known good.
 */

import { sign as cryptoSign, type KeyObject } from 'node:crypto';

import type { Keyring } from './keys';
import { verifyDetached } from './signature';

export type EnvelopeParse =
  | { readonly ok: true; readonly payloadBytes: Uint8Array; readonly signature: Uint8Array }
  | { readonly ok: false; readonly reason: 'malformed' };

/** Split and base64url-decode. Never throws; a bad envelope is `malformed`. */
export function parseEnvelope(prefix: string, text: string): EnvelopeParse {
  const parts = text.trim().split('.');
  if (parts.length !== 3 || parts[0] !== prefix) return { ok: false, reason: 'malformed' };

  const [, encodedPayload, encodedSignature] = parts as [string, string, string];
  let payloadBytes: Uint8Array;
  let signature: Uint8Array;
  try {
    // The signed bytes are the ENCODED segment, verbatim — the same bytes the
    // signer covered. Decoding is only to read the payload afterwards.
    payloadBytes = new Uint8Array(Buffer.from(encodedPayload, 'utf8'));
    signature = new Uint8Array(Buffer.from(encodedSignature, 'base64url'));
  } catch {
    return { ok: false, reason: 'malformed' };
  }
  if (signature.length === 0) return { ok: false, reason: 'malformed' };
  return { ok: true, payloadBytes, signature };
}

/** The decoded payload JSON text of an envelope segment. */
export function decodeSegment(payloadBytes: Uint8Array): string {
  return Buffer.from(Buffer.from(payloadBytes).toString('utf8'), 'base64url').toString('utf8');
}

export type EnvelopeVerify =
  | { readonly ok: true; readonly json: string }
  | { readonly ok: false; readonly reason: 'malformed' | 'unknown_key' | 'bad_signature' };

/**
 * Verify an envelope whose payload declares its own `kid`.
 *
 * `readKid` pulls the kid out of the decoded payload JSON so the signature can
 * be checked against the right key. It runs BEFORE the signature check only to
 * find the key; a payload that cannot be read at all is `malformed`, and a
 * `kid` absent from the trust root is `unknown_key` — the same three-way
 * classification the licence verifier uses.
 */
export function verifyEnvelope(
  prefix: string,
  text: string,
  readKid: (json: string) => string | undefined,
  keyring?: Keyring,
): EnvelopeVerify {
  const parsed = parseEnvelope(prefix, text);
  if (!parsed.ok) return { ok: false, reason: 'malformed' };

  let json: string;
  let kid: string | undefined;
  try {
    json = decodeSegment(parsed.payloadBytes);
    kid = readKid(json);
  } catch {
    return { ok: false, reason: 'malformed' };
  }
  if (kid === undefined) return { ok: false, reason: 'malformed' };

  if (!verifyDetached(parsed.payloadBytes, parsed.signature, kid, keyring)) {
    const known = keyring !== undefined ? kid in keyring : undefined;
    return { ok: false, reason: known === false ? 'unknown_key' : 'bad_signature' };
  }
  return { ok: true, json };
}

/** Sign arbitrary payload JSON into an envelope. The founder's half. */
export function signEnvelope(prefix: string, payloadJson: string, privateKey: KeyObject): string {
  const segment = Buffer.from(payloadJson, 'utf8').toString('base64url');
  const signedBytes = new Uint8Array(Buffer.from(segment, 'utf8'));
  const signature = cryptoSign(null, signedBytes, privateKey);
  return `${prefix}.${segment}.${Buffer.from(signature).toString('base64url')}`;
}
