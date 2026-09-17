import { generateKeyPairSync } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import type { Keyring } from '@/domain/trust/keys';

import { readPackJson, PACK_FORMAT } from './pack';
import { looksSigned, signPack, verifySignedPack, SIGNED_PACK_PREFIX } from './signed-pack';

const { publicKey, privateKey } = generateKeyPairSync('ed25519');
const KID = 'pack-test-1';
const keyring: Keyring = {
  [KID]: publicKey.export({ type: 'spki', format: 'der' }).toString('base64url'),
};
const { privateKey: foreignPrivate } = generateKeyPairSync('ed25519');

const packJson = JSON.stringify({
  format: PACK_FORMAT,
  catalogVersion: '2026.09.1',
  generatedAt: '2026-09-01T00:00:00Z',
  productCount: 1,
  products: [{ name: 'Panadol', quality: 'verified', packLevels: [{ name: 'tablet', factor: 1 }] }],
});

describe('a signed pack verifies, then reads', () => {
  it('round-trips and the verified JSON is a valid pack with no _sig leakage', () => {
    const envelope = signPack(packJson, KID, privateKey);
    expect(looksSigned(envelope)).toBe(true);
    expect(envelope.startsWith(`${SIGNED_PACK_PREFIX}.`)).toBe(true);

    const verified = verifySignedPack(envelope, keyring);
    expect(verified.ok).toBe(true);
    if (!verified.ok) return;

    // The pack readers must never see the signing metadata.
    expect(verified.packJson).not.toContain('_sig');
    const read = readPackJson(verified.packJson);
    expect(read.ok).toBe(true);
    if (read.ok) expect(read.pack.products[0]?.name).toBe('Panadol');
  });
});

describe('an untrusted pack is refused before its contents are read', () => {
  it('refuses a tampered envelope whose payload is still valid JSON', () => {
    // Tamper by re-encoding a MODIFIED payload and keeping the old signature —
    // so it decodes to valid JSON and the ONLY thing wrong is the signature.
    // (A tamper that corrupts the base64 would land as `malformed` instead;
    // both are refusals, but this pins that the signature itself is checked.)
    const envelope = signPack(packJson, KID, privateKey);
    const [prefix, seg, sig] = envelope.split('.') as [string, string, string];
    const decoded = JSON.parse(Buffer.from(seg, 'base64url').toString('utf8')) as Record<
      string,
      unknown
    >;
    const forged = { ...decoded, productCount: 999 };
    const reSeg = Buffer.from(JSON.stringify(forged), 'utf8').toString('base64url');
    const result = verifySignedPack(`${prefix}.${reSeg}.${sig}`, keyring);
    expect(result).toEqual({ ok: false, reason: 'bad_signature' });
  });

  it('refuses a pack signed by another key', () => {
    const envelope = signPack(packJson, KID, foreignPrivate);
    expect(verifySignedPack(envelope, keyring)).toEqual({ ok: false, reason: 'bad_signature' });
  });

  it('refuses an unknown signing key distinctly', () => {
    const envelope = signPack(packJson, 'nobody-1', privateKey);
    expect(verifySignedPack(envelope, keyring)).toEqual({ ok: false, reason: 'unknown_key' });
  });

  it('refuses a malformed envelope without throwing', () => {
    for (const junk of ['', 'not-a-pack', 'MEHVARPACK1.a', 'MEHVARPACK1..', 'MEHVAR1.a.b']) {
      expect(() => verifySignedPack(junk, keyring)).not.toThrow();
      expect(verifySignedPack(junk, keyring).ok).toBe(false);
    }
    // A raw pack JSON is NOT a signed envelope — the importer routes it to the
    // explicit --trusted-local path, not to verification.
    expect(looksSigned(packJson)).toBe(false);
    expect(looksSigned(signPack(packJson, KID, privateKey))).toBe(true);
  });
});
