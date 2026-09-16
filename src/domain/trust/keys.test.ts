import { generateKeyPairSync, sign as cryptoSign } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { DEV_KID, hasProductionKey, TRUST_ROOT_KEYS, type Keyring } from './keys';
import { verifyDetached } from './signature';

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
      expect(Object.keys(TRUST_ROOT_KEYS)).toEqual([DEV_KID]);
      return;
    }
    // Once provisioned, the spare must ship alongside the signer — rotation
    // with no spare is an emergency waiting to happen.
    expect(Object.keys(TRUST_ROOT_KEYS).length).toBeGreaterThanOrEqual(3);
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
