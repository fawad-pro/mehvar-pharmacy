import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { GLOBAL_KEYS } from '@/client/keyboard/registry';

/**
 * The Stock screen's "Adjust stock" button said "— F9" for a while, though
 * Adjust has always been bound to F8 (F9 is Day). Exactly the class of bug
 * `hint-sourcing.test.ts` polices for the two dispatch-based keys (udhaar,
 * switch-user) — but `Adjust` is an href-based registry entry, not a
 * `dispatch` one, so `keyFor()` does not cover it and that sweep could not see
 * this. This is the narrow, file-specific pin for that one hint instead.
 *
 * Derived from the registry rather than hardcoding "F8" a second time: if
 * Adjust ever moves off F8, this fails the moment the page's text goes stale,
 * rather than depending on someone remembering this test exists.
 */
describe('the Stock screen names the correct key for Adjust', () => {
  it('embeds the registry’s actual key for /stock/adjust', () => {
    const adjust = GLOBAL_KEYS.find((entry) => entry.href === '/stock/adjust');
    expect(adjust, 'no registry entry has href /stock/adjust').toBeDefined();

    const source = readFileSync(join(process.cwd(), 'src/app/(counter)/stock/page.tsx'), 'utf8');
    expect(source).toContain(`Adjust stock — ${adjust!.key}`);
  });
});
