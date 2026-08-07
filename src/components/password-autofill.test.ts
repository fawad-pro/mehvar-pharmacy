/**
 * No password field in this product may look like a login to a browser.
 *
 * THE BUG THIS PINS
 *
 * The pairing screen is two text fields followed by `type="password"`. Chrome
 * reads that shape as a login form regardless of what it is called, offered to
 * save it, and stored the **counter name** — "Counter 1" — as the username.
 *
 * The damage appeared somewhere else entirely. Pressing F10 mounts the PIN
 * overlay, and a lone password input is enough for Chrome to go looking for a
 * username field to fill. The nearest text input on the page is the counter's
 * product search box, so F10 typed "Counter 1" into the search box by itself —
 * with the quick-item row underneath offering `Add "Counter 1" and keep
 * selling`. One Enter from a junk product in a real pharmacy's catalog.
 *
 * `autoComplete="off"` does not prevent it. Chrome has ignored `off` on
 * credential fields since 2014, which is exactly why the original code looked
 * correct and was not.
 *
 * Neither typecheck nor lint nor any component test can see this: it is a
 * browser heuristic reacting to markup. A source assertion is the only cheap
 * guard, so it is the one that exists.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * Every place the product renders a password input.
 *
 * Listed explicitly rather than globbed: a new one should have to be added
 * here deliberately, which is the moment to think about this at all.
 */
const PASSWORD_FIELDS = [
  { file: 'src/components/pin-switch-overlay.tsx', what: 'the PIN switch overlay (F10)' },
  { file: 'src/app/login/page.tsx', what: 'the device pairing screen' },
];

/**
 * Tokens a browser honours as "do not offer a saved credential here".
 *
 * `off` is deliberately absent — it is the value that was already there when
 * this bug shipped.
 */
const RESPECTED = ['one-time-code', 'new-password'];

describe('password fields do not invite credential autofill', () => {
  for (const { file, what } of PASSWORD_FIELDS) {
    const source = readFileSync(join(process.cwd(), file), 'utf8');

    it(`${what} still renders a password input`, () => {
      // Guards the guard: if the field is renamed or removed, the assertion
      // below would pass vacuously.
      expect(source).toMatch(/type=["'{]?["']?password/);
    });

    it(`${what} opts out with a token browsers actually honour`, () => {
      const opted = RESPECTED.some((token) => source.includes(`autoComplete="${token}"`));
      expect(
        opted,
        `${file} renders a password input without one of ${RESPECTED.join(' / ')}. ` +
          'autoComplete="off" is ignored by Chrome on credential fields, and the ' +
          'result is a saved "username" autofilled into the product search box.',
      ).toBe(true);
    });
  }
});
