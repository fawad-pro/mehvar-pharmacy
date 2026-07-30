import { describe, expect, it } from 'vitest';

import {
  afterFailedAttempt,
  afterSuccessfulAttempt,
  hashPassword,
  hashPin,
  InvalidPinFormatError,
  isLockedOut,
  isWellFormedPin,
  LOCKOUT_DURATION_MS,
  MAX_PIN_ATTEMPTS,
  remainingLockoutMs,
  verifyPassword,
  verifyPin,
  type LockoutState,
} from './pin';

describe('PIN hashing (Phase 12 §5 — Argon2id)', () => {
  it('hashes with Argon2id, never storing the PIN', async () => {
    const digest = await hashPin('4271');
    expect(digest.startsWith('$argon2id$')).toBe(true);
    expect(digest).not.toContain('4271');
  });

  it('salts: the same PIN hashes differently every time', async () => {
    expect(await hashPin('4271')).not.toBe(await hashPin('4271'));
  });

  it('verifies the right PIN and rejects the wrong one', async () => {
    const digest = await hashPin('4271');
    expect(await verifyPin(digest, '4271')).toBe(true);
    expect(await verifyPin(digest, '4272')).toBe(false);
  });

  it('rejects malformed PINs at the door', async () => {
    await expect(hashPin('12345')).rejects.toThrow(InvalidPinFormatError);
    await expect(hashPin('abcd')).rejects.toThrow(InvalidPinFormatError);
    expect(isWellFormedPin('0000')).toBe(true);
    expect(isWellFormedPin('12 34')).toBe(false);
  });

  it('treats an unreadable hash as a failed login, not a crash (P2)', async () => {
    expect(await verifyPin('not-a-hash', '4271')).toBe(false);
  });
});

describe('owner password (Phase 9 §2 — remote login)', () => {
  it('hashes and verifies', async () => {
    const digest = await hashPassword('correct horse battery');
    expect(await verifyPassword(digest, 'correct horse battery')).toBe(true);
    expect(await verifyPassword(digest, 'wrong horse battery')).toBe(false);
  });

  it('refuses trivially short passwords', async () => {
    await expect(hashPassword('short')).rejects.toThrow();
  });
});

describe('lockout policy (Phase 12 §5)', () => {
  const fresh: LockoutState = { failedPinAttempts: 0, pinLockedUntil: null };
  const now = new Date('2026-07-30T10:00:00Z');

  it('counts failures without locking below the threshold', () => {
    let state = fresh;
    for (let attempt = 1; attempt < MAX_PIN_ATTEMPTS; attempt += 1) {
      state = afterFailedAttempt(state, now);
      expect(state.failedPinAttempts).toBe(attempt);
      expect(isLockedOut(state, now)).toBe(false);
    }
  });

  it('locks on the threshold attempt', () => {
    let state = fresh;
    for (let attempt = 0; attempt < MAX_PIN_ATTEMPTS; attempt += 1) {
      state = afterFailedAttempt(state, now);
    }
    expect(isLockedOut(state, now)).toBe(true);
    expect(remainingLockoutMs(state, now)).toBe(LOCKOUT_DURATION_MS);
  });

  it('expires the lockout on its own — the counter is never bricked (P8)', () => {
    let state = fresh;
    for (let attempt = 0; attempt < MAX_PIN_ATTEMPTS; attempt += 1) {
      state = afterFailedAttempt(state, now);
    }
    const later = new Date(now.getTime() + LOCKOUT_DURATION_MS + 1);
    expect(isLockedOut(state, later)).toBe(false);
    expect(remainingLockoutMs(state, later)).toBe(0);
  });

  it('clears on success, which is also the owner override', () => {
    const locked = afterFailedAttempt(
      { failedPinAttempts: MAX_PIN_ATTEMPTS - 1, pinLockedUntil: null },
      now,
    );
    expect(isLockedOut(locked, now)).toBe(true);

    const cleared = afterSuccessfulAttempt();
    expect(cleared).toEqual({ failedPinAttempts: 0, pinLockedUntil: null });
    expect(isLockedOut(cleared, now)).toBe(false);
  });
});
