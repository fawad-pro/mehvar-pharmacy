/**
 * PIN policy — pure, dependency-free, and safe to import from a client
 * component.
 *
 * Split from `pin.ts` deliberately: hashing pulls in a native Argon2 binding,
 * and the PIN-switch overlay needs only the length and the lockout arithmetic.
 * Without this split, importing a single constant drags a native module into
 * the browser bundle.
 */

/** Four digits. Longer is not more secure at a counter — it is slower and written down. */
export const PIN_LENGTH = 4;

/** Phase 12 §5: lockout after repeated failures, with owner override. */
export const MAX_PIN_ATTEMPTS = 5;
export const LOCKOUT_DURATION_MS = 5 * 60 * 1000;

const PIN_PATTERN = new RegExp(`^\\d{${PIN_LENGTH}}$`);

export function isWellFormedPin(pin: string): boolean {
  return PIN_PATTERN.test(pin);
}

export class InvalidPinFormatError extends Error {
  constructor() {
    super(`PIN must be exactly ${PIN_LENGTH} digits.`);
    this.name = 'InvalidPinFormatError';
  }
}

export interface LockoutState {
  readonly failedPinAttempts: number;
  readonly pinLockedUntil: Date | null;
}

export function isLockedOut(state: LockoutState, now: Date = new Date()): boolean {
  return state.pinLockedUntil !== null && state.pinLockedUntil.getTime() > now.getTime();
}

export function remainingLockoutMs(state: LockoutState, now: Date = new Date()): number {
  if (!isLockedOut(state, now)) {
    return 0;
  }
  return (state.pinLockedUntil?.getTime() ?? 0) - now.getTime();
}

/** The state to persist after a failed attempt. */
export function afterFailedAttempt(state: LockoutState, now: Date = new Date()): LockoutState {
  const failedPinAttempts = state.failedPinAttempts + 1;
  if (failedPinAttempts >= MAX_PIN_ATTEMPTS) {
    return {
      failedPinAttempts,
      pinLockedUntil: new Date(now.getTime() + LOCKOUT_DURATION_MS),
    };
  }
  return { failedPinAttempts, pinLockedUntil: state.pinLockedUntil };
}

/** The state to persist after a successful attempt, and after an owner override. */
export function afterSuccessfulAttempt(): LockoutState {
  return { failedPinAttempts: 0, pinLockedUntil: null };
}
