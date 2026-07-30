/**
 * PIN and password hashing — ADR-7, Phase 12 §5.
 *
 *   "The counter is a *shared terminal* — the real auth act is 'which person is
 *    acting now', a PIN-switch interaction no hosted auth product models well."
 *
 * Phase 12 §5 sets the posture: "PINs are hashed (Argon2id), rate-limited,
 * lockout after repeated failures with owner override."
 *
 * Server-only: Argon2 is a native binding. The pure half of the policy — length,
 * lockout arithmetic — lives in `pin-policy.ts` so the counter UI can import it
 * without dragging this into the browser bundle.
 */

import 'server-only';

import { hash, verify, type Algorithm } from '@node-rs/argon2';

import { InvalidPinFormatError, isWellFormedPin } from './pin-policy';

export * from './pin-policy';

/**
 * `Algorithm.Argon2id` is an ambient const enum, unreadable under
 * `verbatimModuleSyntax`; 2 is its value (RFC 9106's hybrid mode).
 */
const ARGON2ID: Algorithm = 2;

const ARGON2ID_OPTIONS = {
  algorithm: ARGON2ID,
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
} as const;

export async function hashPin(pin: string): Promise<string> {
  if (!isWellFormedPin(pin)) {
    throw new InvalidPinFormatError();
  }
  return hash(pin, ARGON2ID_OPTIONS);
}

/**
 * Verifies a PIN against its hash. Returns false rather than throwing on a
 * malformed hash: an unreadable credential is a failed login, not a crash at
 * the counter (P2 — nothing about a bad PIN may take the terminal down).
 */
export async function verifyPin(pinHash: string, pin: string): Promise<boolean> {
  if (!isWellFormedPin(pin)) {
    return false;
  }
  try {
    return await verify(pinHash, pin, ARGON2ID_OPTIONS);
  } catch {
    return false;
  }
}

/** Owner remote login (Phase 9 §2's `password_hash`) uses the same primitive. */
export async function hashPassword(password: string): Promise<string> {
  if (password.length < 8) {
    throw new Error('Password must be at least 8 characters.');
  }
  return hash(password, ARGON2ID_OPTIONS);
}

export async function verifyPassword(passwordHash: string, password: string): Promise<boolean> {
  try {
    return await verify(passwordHash, password, ARGON2ID_OPTIONS);
  } catch {
    return false;
  }
}
