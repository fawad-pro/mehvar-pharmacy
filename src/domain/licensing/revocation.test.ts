import { generateKeyPairSync } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import type { Keyring } from '@/domain/trust/keys';

import {
  REVOCATION_PREFIX,
  signRevocation,
  verifyRevocation,
  type RevocationPayload,
} from './revocation';

const { publicKey, privateKey } = generateKeyPairSync('ed25519');
const KID = 'rev-test-1';
const keyring: Keyring = {
  [KID]: publicKey.export({ type: 'spki', format: 'der' }).toString('base64url'),
};

const { privateKey: foreignPrivate } = generateKeyPairSync('ed25519');

function payload(over: Partial<RevocationPayload> = {}): RevocationPayload {
  return {
    v: 1,
    kid: KID,
    licenceId: '0198a000-0000-7000-8000-000000000001',
    tenantSlug: 'al-shifa',
    revokedAt: '2026-06-01T00:00:00Z',
    reason: 'chargeback',
    ...over,
  };
}

describe('revocation round-trip', () => {
  it('signs, and verifies against the trust root', () => {
    const token = signRevocation(payload(), privateKey);
    expect(token.startsWith(`${REVOCATION_PREFIX}.`)).toBe(true);
    const result = verifyRevocation(token, { keyring });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.revocation.payload.reason).toBe('chargeback');
  });

  it('pins the pharmacy and the licence — no cross-licence or cross-tenant replay', () => {
    const token = signRevocation(payload(), privateKey);
    expect(verifyRevocation(token, { keyring, expectedLicenceId: 'other' }).ok).toBe(false);
    expect(verifyRevocation(token, { keyring, expectedTenantSlug: 'other-shop' }).ok).toBe(false);
    expect(
      verifyRevocation(token, {
        keyring,
        expectedLicenceId: payload().licenceId,
        expectedTenantSlug: 'al-shifa',
      }).ok,
    ).toBe(true);
  });
});

describe('a bad revocation is refused, never honoured', () => {
  it('refuses a tampered payload', () => {
    const token = signRevocation(payload(), privateKey);
    const [prefix, segment, sig] = token.split('.') as [string, string, string];
    const decoded = JSON.parse(
      Buffer.from(segment, 'base64url').toString('utf8'),
    ) as RevocationPayload;
    const forged = { ...decoded, licenceId: 'victim-licence' };
    const reSegment = Buffer.from(JSON.stringify(forged), 'utf8').toString('base64url');
    const result = verifyRevocation(`${prefix}.${reSegment}.${sig}`, { keyring });
    expect(result).toEqual({ ok: false, reason: 'bad_signature' });
  });

  it('refuses a signature from another key', () => {
    const token = signRevocation(payload(), foreignPrivate);
    expect(verifyRevocation(token, { keyring })).toEqual({ ok: false, reason: 'bad_signature' });
  });

  it('refuses an unknown kid distinctly', () => {
    const token = signRevocation(payload({ kid: 'nobody' }), privateKey);
    expect(verifyRevocation(token, { keyring })).toEqual({ ok: false, reason: 'unknown_key' });
  });

  it('refuses a newer format whole', () => {
    const token = signRevocation(payload({ v: 2 }), privateKey);
    expect(verifyRevocation(token, { keyring })).toEqual({ ok: false, reason: 'format_too_new' });
  });

  it('refuses junk without throwing — a crash here would be a crash at boot', () => {
    for (const junk of [
      '',
      'x',
      'MEHVARREV1.a',
      'MEHVARREV1..',
      'MEHVAR1.a.b',
      'MEHVARREV1.##.##',
    ]) {
      expect(() => verifyRevocation(junk, { keyring })).not.toThrow();
      expect(verifyRevocation(junk, { keyring }).ok).toBe(false);
    }
  });
});
