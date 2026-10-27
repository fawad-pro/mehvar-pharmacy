/**
 * Every action that writes also declares what it invalidated.
 *
 * This is a source-level check rather than a behavioural one because the
 * failure it guards is invisible at runtime: an action that forgets to
 * revalidate does not throw, does not log, and returns `{ ok: true }`. The only
 * symptom is a number on a screen that is quietly one action out of date, and
 * the shop's workaround — reload the browser — is precisely the reflex the
 * product exists to remove. Ten of the eleven writing actions had this bug
 * simultaneously and nothing anywhere reported it.
 *
 * The rule: a `'use server'` file that calls a domain writer (`commit*`) or a
 * db mutation (`insert*` / `update*` / `set*` / `reset*` / `remove*`) must
 * import `revalidateAfter`. Deliberately coarse — it cannot tell whether the
 * areas named are the RIGHT ones, and it does not try. It catches the case that
 * actually happened, which is not thinking about invalidation at all.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const COUNTER_DIR = join(process.cwd(), 'src', 'app', '(counter)');

/** Calls that reach the database to change something. */
const WRITER = /\b(commit[A-Z]\w*|insert[A-Z]\w*|update[A-Z]\w*|setUserActive|resetUserPin|removeBarcode|removeProduct|restoreProduct)\s*\(/;

/**
 * `sync/actions.ts` is the outbox's delivery endpoint. It writes, and it is
 * exempt on purpose: its caller is the sync pump rather than a navigation, so
 * a server-side revalidation would have nothing to re-render. Its screens are
 * refreshed from the client instead, by `client/sync/refresh-on-sync` reacting
 * to the pump's own delivery signal.
 */
const EXEMPT = new Set(['sync/actions.ts']);

function actionFiles(dir: string, prefix = ''): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const relative = prefix ? `${prefix}/${entry}` : entry;
    if (statSync(full).isDirectory()) {
      found.push(...actionFiles(full, relative));
      continue;
    }
    if (entry === 'actions.ts') found.push(relative);
  }
  return found;
}

describe('server actions declare their invalidations', () => {
  const files = actionFiles(COUNTER_DIR);

  it('finds the action files at all — a passing empty suite proves nothing', () => {
    expect(files.length).toBeGreaterThan(5);
  });

  for (const relative of files) {
    const source = readFileSync(join(COUNTER_DIR, relative), 'utf8');
    if (!source.includes("'use server'")) continue;

    const writes = WRITER.test(source);
    const declares = source.includes('revalidateAfter(');

    it(`${relative}${writes ? ' writes, so it must revalidate' : ' is read-only'}`, () => {
      if (!writes || EXEMPT.has(relative)) {
        expect(true).toBe(true);
        return;
      }
      expect(
        declares,
        `${relative} calls a writer but never calls revalidateAfter(). ` +
          'Every write leaves some screen stale — name the areas in src/app/(counter)/revalidate.ts.',
      ).toBe(true);
    });
  }
});
