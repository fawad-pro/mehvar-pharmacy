import { generateKeyPairSync } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import type { Keyring } from '@/domain/trust/keys';

import { signPayload } from './sign';
import type { LicencePayload } from './state';
import { parseToken } from './token';
import { verifyToken } from './verify';

const { publicKey, privateKey } = generateKeyPairSync('ed25519');
const KID = 'test-1';
const keyring: Keyring = {
  [KID]: publicKey.export({ type: 'spki', format: 'der' }).toString('base64url'),
};

const { publicKey: otherPublic, privateKey: otherPrivate } = generateKeyPairSync('ed25519');
void otherPublic;

function payload(over: Partial<LicencePayload> = {}): LicencePayload {
  return {
    v: 1,
    kid: KID,
    licenceId: '0198a000-0000-7000-8000-000000000001',
    tenantSlug: 'al-shifa',
    customerName: 'Al-Shifa Medical Store',
    plan: 'standard',
    branches: 1,
    issuedAt: '2026-01-01T00:00:00Z',
    entitlementEndsAt: '2027-01-01T00:00:00Z',
    expiresAt: '2027-03-01T00:00:00Z',
    graceDays: 30,
    warnDays: 45,
    ...over,
  };
}

describe('token round-trip', () => {
  it('signs, parses and verifies', () => {
    const token = signPayload(payload(), privateKey);
    const result = verifyToken(token, { expectedTenantSlug: 'al-shifa', keyring });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.licence.payload.customerName).toBe('Al-Shifa Medical Store');
  });

  it('survives whitespace, because it arrives pasted from WhatsApp', () => {
    const token = signPayload(payload(), privateKey);
    expect(verifyToken(`\n  ${token}  \n`, { keyring }).ok).toBe(true);
  });
});

describe('refusals', () => {
  it('refuses a tampered payload', () => {
    const token = signPayload(payload(), privateKey);
    const [prefix, segment, signature] = token.split('.') as [string, string, string];
    const decoded = JSON.parse(
      Buffer.from(segment, 'base64url').toString('utf8'),
    ) as LicencePayload;
    const forged = { ...decoded, entitlementEndsAt: '2099-01-01T00:00:00Z' };
    const reSegment = Buffer.from(JSON.stringify(forged), 'utf8').toString('base64url');

    const result = verifyToken(`${prefix}.${reSegment}.${signature}`, { keyring });
    expect(result).toEqual({ ok: false, reason: 'bad_signature' });
  });

  it('refuses a signature from another key', () => {
    const token = signPayload(payload(), otherPrivate);
    expect(verifyToken(token, { keyring })).toEqual({ ok: false, reason: 'bad_signature' });
  });

  it('refuses an unknown kid, and says so distinctly', () => {
    const token = signPayload(payload({ kid: 'nobody-1' }), privateKey);
    expect(verifyToken(token, { keyring })).toEqual({ ok: false, reason: 'unknown_key' });
  });

  it('refuses another pharmacy’s licence', () => {
    const token = signPayload(payload(), privateKey);
    expect(verifyToken(token, { expectedTenantSlug: 'other-shop', keyring })).toEqual({
      ok: false,
      reason: 'wrong_pharmacy',
    });
  });

  it('refuses a newer format WHOLE, rather than reading part of it', () => {
    const token = signPayload(payload({ v: 2 }), privateKey);
    expect(verifyToken(token, { keyring })).toEqual({ ok: false, reason: 'format_too_new' });
    expect(parseToken(token)).toMatchObject({ ok: false, reason: 'format_too_new', found: 2 });
  });

  it('refuses junk without throwing — a crash here is a crash at the counter', () => {
    for (const junk of ['', 'hello', 'MEHVAR1.x', 'MEHVAR1..', 'MEHVAR2.a.b', 'MEHVAR1.###.###']) {
      expect(() => verifyToken(junk, { keyring })).not.toThrow();
      expect(verifyToken(junk, { keyring }).ok).toBe(false);
    }
  });

  it('clamps an over-generous graceDays rather than punishing the pharmacy', () => {
    const token = signPayload(payload({ graceDays: 9999 }), privateKey);
    const result = verifyToken(token, { keyring });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.licence.payload.graceDays).toBe(180);
  });
});
