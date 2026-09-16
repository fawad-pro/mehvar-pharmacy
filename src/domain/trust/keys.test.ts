import {
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  sign as cryptoSign,
} from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { DEV_PRIVATE_KEY_PKCS8_BASE64URL } from '../../../scripts/licence/dev-key';
import { signPayload } from '../licensing/sign';
import type { LicencePayload } from '../licensing/state';
import { verifyToken } from '../licensing/verify';

import { composeTrustRoot, DEV_KID, hasProductionKey, TRUST_ROOT_KEYS, type Keyring } from './keys';
import { verifyDetached } from './signature';

describe('composeTrustRoot — the dev key is dropped once a production key exists', () => {
  const DEV_PUB = 'devpub';

  it('trusts only the dev key while no production key is configured', () => {
    expect(composeTrustRoot({}, DEV_KID, DEV_PUB)).toEqual({ [DEV_KID]: DEV_PUB });
  });

  it('EXCLUDES the dev key the moment a production key is configured', () => {
    // The committed dev private half is public. If it stayed trusted here, it
    // would be a universal forgery key for every pharmacy. This is the assertion
    // that the whole "commit the dev key" bargain rests on.
    const root = composeTrustRoot({ 'mehvar-1': 'prodpub' }, DEV_KID, DEV_PUB);
    expect(root).not.toHaveProperty(DEV_KID);
    expect(root).toEqual({ 'mehvar-1': 'prodpub' });
  });

  it('keeps the cold spare alongside the signer, and still no dev key', () => {
    const root = composeTrustRoot({ 'mehvar-1': 'a', 'mehvar-2': 'b' }, DEV_KID, DEV_PUB);
    expect(Object.keys(root).sort()).toEqual(['mehvar-1', 'mehvar-2']);
  });
});

describe('the trust root', () => {
  it('carries at least one usable key, or nothing can ever be verified', () => {
    expect(Object.keys(TRUST_ROOT_KEYS).length).toBeGreaterThan(0);
  });

  /**
   * Not `expect(hasProductionKey()).toBe(true)`, because that would fail today
   * and a red suite teaches people to ignore red suites. This states the
   * position instead: the only key this build carries is one whose private half
   * is published, and shipping to a paying pharmacy on it is not a thing to do.
   *
   * Provisioning `mehvar-1` and `mehvar-2` (npm run licence:keygen) is a release
   * blocker for roadmap Phase 2, and flipping this assertion is how it gets
   * closed.
   */
  it('states plainly whether a production key has been provisioned', () => {
    if (!hasProductionKey()) {
      // Stage 1: the dev key is the ONLY key, and it is the only one, so nothing
      // it can forge is worth protecting yet.
      expect(Object.keys(TRUST_ROOT_KEYS)).toEqual([DEV_KID]);
      return;
    }
    // The security-critical half of the dev-key bargain: the moment a real key
    // exists, the committed (public) private half must NOT be trusted, or it is
    // a universal forgery key for every pharmacy. See the next test for the
    // property this length check stands in for.
    expect(Object.keys(TRUST_ROOT_KEYS)).not.toContain(DEV_KID);
  });
});

/**
 * The committed dev private key must never forge a licence a PRODUCTION build
 * would accept.
 *
 * `TRUST_ROOT_KEYS` is computed once at module load from `PRODUCTION_KEYS`, so
 * this cannot flip the real root at runtime. Instead it reconstructs the two
 * states as keyrings and verifies against each — which is exactly what
 * `verifyToken` does, and is a faithful model of what the real root becomes the
 * day `mehvar-1` is pasted in.
 */
describe('the dev key cannot forge a production licence', () => {
  const devPrivate = createPrivateKey({
    key: Buffer.from(DEV_PRIVATE_KEY_PKCS8_BASE64URL, 'base64url'),
    format: 'der',
    type: 'pkcs8',
  });
  const devPublic = createPublicKey(devPrivate)
    .export({ type: 'spki', format: 'der' })
    .toString('base64url');

  const payload: LicencePayload = {
    v: 1,
    kid: DEV_KID,
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
  };
  const devToken = signPayload(payload, devPrivate);

  // A production keyring: a real key, and deliberately NOT the dev key — the
  // shape `keys.ts` produces once `PRODUCTION_KEYS` is non-empty.
  const { publicKey: prodPublic } = generateKeyPairSync('ed25519');
  const productionRoot: Keyring = {
    'mehvar-1': prodPublic.export({ type: 'spki', format: 'der' }).toString('base64url'),
  };

  it('a dev-signed token is accepted while the dev key is the only key (Stage 1)', () => {
    const devRoot: Keyring = { [DEV_KID]: devPublic };
    expect(verifyToken(devToken, { keyring: devRoot }).ok).toBe(true);
  });

  it('a dev-signed token is REFUSED against a production root', () => {
    const result = verifyToken(devToken, { keyring: productionRoot });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('unknown_key');
  });
});

describe('verifyDetached never throws', () => {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const keyring: Keyring = {
    good: publicKey.export({ type: 'spki', format: 'der' }).toString('base64url'),
    malformed: 'not-a-key',
  };
  const message = new Uint8Array(Buffer.from('hello'));
  const signature = new Uint8Array(cryptoSign(null, message, privateKey));

  it('accepts a real signature', () => {
    expect(verifyDetached(message, signature, 'good', keyring)).toBe(true);
  });

  it('refuses an unknown kid', () => {
    expect(verifyDetached(message, signature, 'nobody', keyring)).toBe(false);
  });

  it('refuses a malformed key in the keyring rather than crashing', () => {
    // A bad key here is a build defect. It must be a refusal, not an exception
    // at the counter.
    expect(() => verifyDetached(message, signature, 'malformed', keyring)).not.toThrow();
    expect(verifyDetached(message, signature, 'malformed', keyring)).toBe(false);
  });

  it('refuses a garbage signature', () => {
    expect(verifyDetached(message, new Uint8Array([1, 2, 3]), 'good', keyring)).toBe(false);
  });

  it('refuses a tampered message', () => {
    expect(verifyDetached(new Uint8Array(Buffer.from('hellp')), signature, 'good', keyring)).toBe(
      false,
    );
  });
});
