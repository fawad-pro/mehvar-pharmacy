/**
 * A shortcut hint that spells its key out by hand can drift the moment the
 * bar is reordered.
 *
 * THE REGRESSION THIS EXISTS FOR
 *
 * The Sale surface said "F8 — attach a customer for udhaar" and the payment
 * overlay said "Attach a customer (F8)" long after Udhaar moved to F4 —
 * `registry.test.ts` pins that the HANDLER binds by meaning, but nothing
 * pinned that on-screen TEXT did the same, so the bar moved and the hints
 * did not. The top bar's "F10" for Switch user and a server action's "Press
 * F10 to switch user" were the identical bug, only accidentally still
 * correct because that key has not moved yet.
 *
 * TWO CHECKS
 *
 * The first names the four sites this regression actually broke (or would
 * have, for the two that were accidentally still right) and asserts each
 * calls `keyFor()` for its dispatch — a positive assertion, so reverting any
 * one of them fails immediately rather than depending on a pattern match.
 *
 * The second sweeps every other source file for the same SHAPE of bug: a
 * line naming what the udhaar or switch-user key does, in the same breath as
 * a literal function-key number instead of a lookup. It is deliberately
 * allowed to find nothing — the fix removed every such literal — but a new
 * screen that reintroduces one is exactly what it exists to catch. Narrative
 * comments that describe the PIN-switch MECHANISM rather than advise which
 * key to press right now (`pin-switch-overlay.tsx`, `login/page.tsx`,
 * `use-global-keys.ts`'s note on browser-reserved keys) are exempted by
 * name — they are history, not a hint that could go stale.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const SRC = join(process.cwd(), 'src');

describe('the four known hint sites source their key from keyFor()', () => {
  // Every place this regression touched or could plausibly have touched: the
  // Sale surface and payment overlay (the two that actually went stale), and
  // the top bar / products action (the two that were still correct only by
  // luck, because Switch user has not moved off F10 — yet).
  const sites: { file: string; dispatch: string }[] = [
    { file: 'app/(counter)/sale/sale-surface.tsx', dispatch: 'udhaar' },
    { file: 'app/(counter)/sale/payment-overlay.tsx', dispatch: 'udhaar' },
    { file: 'components/top-bar.tsx', dispatch: 'switch-user' },
    { file: 'app/(counter)/products/actions.ts', dispatch: 'switch-user' },
  ];

  for (const { file, dispatch } of sites) {
    it(`${file} calls keyFor('${dispatch}')`, () => {
      const source = readFileSync(join(SRC, file), 'utf8');
      expect(source).toContain(`keyFor('${dispatch}')`);
    });
  }
});

const EXEMPT = new Set(
  [
    'client/keyboard/registry.ts',
    'client/keyboard/registry.test.ts',
    'client/keyboard/hint-sourcing.test.ts',
    'client/keyboard/udhaar-key-context.tsx', // tells its own renaming history
    'client/keyboard/use-global-keys.ts', // "F1/F5/F10" is browser-reserved keys
    'components/pin-switch-overlay.tsx', // the mechanism, not a live hint
    'components/password-autofill.test.ts',
    'app/login/page.tsx',
    'auth/actions.ts',
  ].map((relative) => join(SRC, relative)),
);

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...walk(full));
      continue;
    }
    if (/\.(ts|tsx)$/.test(entry) && !/\.test\.tsx?$/.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

// Same shape as the bug: a line naming what the udhaar or switch-user key
// does, next to a literal function-key number rather than a lookup.
const HINT_PATTERN =
  /\b(udhaar|switch user)\b.{0,40}\bF\d{1,2}\b|\bF\d{1,2}\b.{0,40}\b(udhaar|switch user)\b/i;

const hits: { file: string; line: number; text: string }[] = [];
for (const file of walk(SRC).filter((candidate) => !EXEMPT.has(candidate))) {
  readFileSync(file, 'utf8')
    .split('\n')
    .forEach((text, index) => {
      if (HINT_PATTERN.test(text)) {
        hits.push({ file: file.slice(SRC.length + 1), line: index + 1, text });
      }
    });
}

describe('no other file reintroduces a hand-typed key next to what it does', () => {
  // Static, so the suite is never empty: today the fix removed every literal,
  // so this is the expected steady state, not a coincidence. It also means
  // the sweep below cannot silently stop having anything to assert on.
  it('finds nothing outside the four known sites, because the fix sources them all', () => {
    expect(hits).toEqual([]);
  });

  for (const { file, line, text } of hits) {
    it(`${file}:${line} calls keyFor() rather than spelling out the key`, () => {
      expect(
        text.includes('keyFor('),
        `${file}:${line} names a dispatch key next to what it does, without sourcing it from ` +
          `keyFor(): "${text.trim()}". A hand-typed letter is exactly what went stale when Udhaar ` +
          'moved from F8 to F4.',
      ).toBe(true);
    });
  }
});
