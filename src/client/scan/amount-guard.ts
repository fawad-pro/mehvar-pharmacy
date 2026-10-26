'use client';

/**
 * A barcode scanned into an amount field — Cash tendered, a settlement's
 * amount — must never become money.
 *
 * Those fields commit on Enter, and a keyboard-wedge scanner (I1) ends every
 * code with Enter. A scanned EAN-13 in Cash tendered committed the sale and
 * printed "Paid 8,964,000,101,018.00"; in a settlement it would have recorded a
 * payment of billions against the customer and the drawer.
 *
 * Two layers. The scan itself is recognised (`burst.ts`), the field is put
 * back as it was, and nothing commits. A scan that slipped past (a very busy
 * PC) still cannot commit by Enter: an amount this large commits only by a
 * click, which no scanner makes. Nothing is refused — W3 caps no payment —
 * an implausible amount is only confirmed by hand.
 */

import { useRef } from 'react';
import type React from 'react';

import { scanCandidates, type KeyStroke } from './burst';

/** Rs 1 crore. No counter takes this in cash; an 8-digit code or longer does. */
export const CLICK_TO_COMMIT_PAISA = 1_000_000_000;

export function needsClickToCommit(amountPaisa: number): boolean {
  return amountPaisa >= CLICK_TO_COMMIT_PAISA;
}

/**
 * For an amount field's `onKeyDown`, every key. Returns the field's value from
 * before the scan when this Enter ended one — the caller restores it and does
 * not commit — or null for everything else.
 */
export function useAmountScanGuard(
  currentValue: string,
): (event: React.KeyboardEvent) => string | null {
  const strokes = useRef<KeyStroke[]>([]);
  const before = useRef<string[]>([]);

  return (event) => {
    // When the key was pressed, not when this handler ran (see `burst.ts`).
    const at = event.timeStamp;
    if (event.key === 'Enter') {
      const typed = strokes.current;
      const snapshots = before.current;
      strokes.current = [];
      before.current = [];
      const candidates = scanCandidates(typed, at);
      if (!candidates) {
        return null;
      }
      return snapshots[typed.length - candidates[0]!.length] ?? snapshots[0] ?? currentValue;
    }
    if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
      // Keydown runs before the field changes: this is the value as it stood.
      before.current.push(currentValue);
      strokes.current.push({ key: event.key, at });
    }
    return null;
  };
}
