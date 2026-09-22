import { describe, expect, it } from 'vitest';

import {
  CAPTURE_BLOCKED_MESSAGE,
  CaptureBlockedError,
  captureBlockedFor,
  RESTRICTED_CAPTURE_KINDS,
} from './capture-policy';
import type { RecordKind } from './records';

/**
 * The L1 capture seam (PCN-006). New business is refused at capture while an
 * installation is restricted; settlement and delivery are never touched.
 */
describe('captureBlockedFor', () => {
  const ALL_KINDS: readonly RecordKind[] = ['sale', 'settlement', 'quick_item', 'customer'];

  it('blocks new business — sale, quick item, customer — while restricted', () => {
    for (const kind of ['sale', 'quick_item', 'customer'] as const) {
      expect(captureBlockedFor(true, kind), `${kind} must be blocked when restricted`).toBe(true);
    }
  });

  it('never blocks a settlement, even while restricted — the standing carve-out', () => {
    // Collecting an EXISTING udhaar closes out business already done; PCN-006
    // permits it in every state.
    expect(captureBlockedFor(true, 'settlement')).toBe(false);
  });

  it('blocks nothing at all while authorized (not restricted)', () => {
    for (const kind of ALL_KINDS) {
      expect(captureBlockedFor(false, kind), `${kind} must be allowed when authorized`).toBe(false);
    }
  });

  it('the withheld set is exactly the three new-business kinds', () => {
    expect([...RESTRICTED_CAPTURE_KINDS].sort()).toEqual(['customer', 'quick_item', 'sale']);
    expect(RESTRICTED_CAPTURE_KINDS.has('settlement')).toBe(false);
  });
});

describe('CaptureBlockedError', () => {
  it('carries the operator-facing message and its own name for `instanceof`', () => {
    const error = new CaptureBlockedError();
    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe('CaptureBlockedError');
    expect(error.message).toBe(CAPTURE_BLOCKED_MESSAGE);
  });

  it('names settling, printing and export as still working — never a dead end', () => {
    // I5 / P2: a refusal says what still works and what to do next.
    expect(CAPTURE_BLOCKED_MESSAGE).toMatch(/Settling udhaar/);
    expect(CAPTURE_BLOCKED_MESSAGE).toMatch(/Settings → Licence/);
  });
});
