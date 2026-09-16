/**
 * Signing — the founder's half, used by `licence:issue` and by tests.
 *
 * Lives beside the verifier on purpose: a signer and a verifier that disagree
 * about what bytes are covered produce tokens that verify nowhere, and the
 * cheapest way to keep them honest is for both to call `token.ts`.
 *
 * The private key never appears in this module. It arrives as a `KeyObject` the
 * caller built from a file path, so nothing here can accidentally log it.
 */

import { sign as cryptoSign, type KeyObject } from 'node:crypto';

import type { LicencePayload } from './state';
import { assembleToken, encodePayload } from './token';

export function signPayload(payload: LicencePayload, privateKey: KeyObject): string {
  const { segment, signedBytes } = encodePayload(payload);
  const signature = cryptoSign(null, signedBytes, privateKey);
  return assembleToken(segment, new Uint8Array(signature));
}
