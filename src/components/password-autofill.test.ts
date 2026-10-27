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

import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';

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
  { file: 'src/app/(counter)/settings/settings-surface.tsx', what: 'a new salesman’s PIN' },
];

/**
 * Password inputs that ARE a person's login, where a browser saving and
 * filling the password is wanted. Nothing on the counter belongs here.
 */
const REAL_LOGINS = ['src/app/owner/login/page.tsx'];

/**
 * Tokens a browser honours as "do not offer a saved credential here".
 *
 * `off` is deliberately absent — it is the value that was already there when
 * this bug shipped.
 */
const RESPECTED = ['one-time-code', 'new-password'];

/** Every source file under `src` that renders a password input. */
function filesWithPasswordInputs(dir = join(process.cwd(), 'src')): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return filesWithPasswordInputs(path);
    if (!/\.tsx$/.test(entry.name) || /\.test\./.test(entry.name)) return [];
    return /type=["'{]?["']?password/.test(readFileSync(path, 'utf8'))
      ? [relative(process.cwd(), path)]
      : [];
  });
}

describe('every password input is accounted for', () => {
  // The Settings PIN field shipped without an opt-out because the list above
  // was written by hand and nobody added it. Chrome then filled the device's
  // saved login into "New salesman's name" and "PIN". Now a new password
  // input fails here until someone decides which list it belongs in.
  it('is either opted out of autofill or a real login', () => {
    const known = new Set([...PASSWORD_FIELDS.map((field) => field.file), ...REAL_LOGINS]);
    expect(filesWithPasswordInputs().filter((file) => !known.has(file))).toEqual([]);
  });
});

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
