/**
 * Pairing keys: generated, entered once at a counter, stored only as a hash.
 *
 * Shared by `init` (the first counter of a new pharmacy) and `ops:restore`
 * (a replacement PC, whose counter must pair with the restored pharmacy while
 * the key it was first given died with the old machine).
 */
import { randomBytes } from 'node:crypto';

/**
 * A pairing key the founder reads aloud once and the counter never types again.
 *
 * Generated rather than chosen: it is entered exactly once, at setup, so there
 * is nothing to remember and no reason to let a weak one be picked. Hyphenated
 * because it gets dictated over a phone.
 */
export function generatePairingKey(): string {
  const alphabet = 'abcdefghjkmnpqrstuvwxyz23456789';
  const groups = [0, 1, 2].map(() =>
    Array.from(randomBytes(4), (byte) => alphabet[byte % alphabet.length]).join(''),
  );
  return groups.join('-');
}
