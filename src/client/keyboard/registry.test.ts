/**
 * The registry is the whole truth about the key map, or it is not worth having.
 *
 * "The keyboard registry is one array. The key bar renders it and the handler
 * binds it. Add a key in one place." That was true of every key with an `href`
 * and quietly false of the two without one: the handler branched on the
 * literal strings 'F8' and 'F10'. Reordering the bar — which this session did
 * — would have left Udhaar's dispatch attached to whichever key inherited F8,
 * with nothing to catch it, because the registry still looked complete.
 *
 * These assertions pin the properties that make the one-array claim real.
 */

import { describe, expect, it } from 'vitest';

import { GLOBAL_KEYS, keyFor, keysFor } from './registry';

describe('the global key registry', () => {
  it('binds every routeless key to a meaning', () => {
    // The actual invariant: a key that navigates nowhere must say what it does
    // instead, or pressing it is a no-op the bar still advertises.
    for (const binding of GLOBAL_KEYS) {
      if (binding.href === null) {
        expect(
          binding.dispatch,
          `${binding.key} (${binding.label}) has no href and no dispatch — pressing it does nothing.`,
        ).toBeDefined();
      }
    }
  });

  it('never gives one key both a route and a dispatch', () => {
    // Both would fire, navigating away from the overlay it just opened.
    for (const binding of GLOBAL_KEYS) {
      expect(binding.href !== null && binding.dispatch !== undefined).toBe(false);
    }
  });

  it('uses each key and each dispatch exactly once', () => {
    const keys = GLOBAL_KEYS.map((binding) => binding.key);
    expect(new Set(keys).size).toBe(keys.length);

    const dispatches = GLOBAL_KEYS.flatMap((binding) =>
      binding.dispatch ? [binding.dispatch] : [],
    );
    expect(new Set(dispatches).size).toBe(dispatches.length);
  });

  it('keeps its bands contiguous, because the bar draws dividers between them', () => {
    // The key bar starts a new band wherever the group changes. A group that
    // appears, stops and reappears would draw two dividers and read as four
    // bands rather than three.
    const seen: string[] = [];
    for (const binding of GLOBAL_KEYS) {
      if (seen[seen.length - 1] !== binding.group) {
        expect(
          seen.includes(binding.group),
          `group "${binding.group}" is split across the registry`,
        ).toBe(false);
        seen.push(binding.group);
      }
    }
  });

  it('numbers the keys in order, so the bar reads F1…F10 left to right', () => {
    const numbers = GLOBAL_KEYS.map((binding) => Number(binding.key.slice(1)));
    expect(numbers).toEqual([...numbers].sort((a, b) => a - b));
  });

  it('stays inside the function keys a browser will actually give us', () => {
    // F11 is fullscreen and F12 is devtools; neither can be taken reliably, and
    // F12 is already used *within* the Sale surface for Pay.
    for (const binding of GLOBAL_KEYS) {
      const number = Number(binding.key.slice(1));
      expect(binding.key).toMatch(/^F\d+$/);
      expect(number).toBeGreaterThanOrEqual(1);
      expect(number).toBeLessThanOrEqual(10);
    }
  });
});

// Neither assertion below names a letter — that is the whole point. If a
// future session reorders the bar again, these stay correct untouched, which
// is exactly the property the hand-typed UI hints lacked.
describe('keyFor — the one way a UI hint may name a dispatch key', () => {
  it('returns whatever key currently dispatches udhaar', () => {
    const binding = GLOBAL_KEYS.find((candidate) => candidate.dispatch === 'udhaar');
    expect(keyFor('udhaar')).toBe(binding?.key);
  });

  it('returns whatever key currently dispatches switch-user', () => {
    const binding = GLOBAL_KEYS.find((candidate) => candidate.dispatch === 'switch-user');
    expect(keyFor('switch-user')).toBe(binding?.key);
  });
});

describe('keysFor — a shop that does not sell on udhaar', () => {
  it('has no udhaar key, and keeps every other key in order', () => {
    expect(keysFor(true)).toEqual(GLOBAL_KEYS);
    const without = keysFor(false);
    expect(without.some((key) => key.dispatch === 'udhaar')).toBe(false);
    expect(without.map((key) => key.key)).toEqual(
      GLOBAL_KEYS.filter((key) => key.dispatch !== 'udhaar').map((key) => key.key),
    );
  });
});
