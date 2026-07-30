'use client';

/**
 * Triggers a print — ADR-6.
 *
 * `window.print()` on a kiosk-configured browser (Chrome `--kiosk-printing`,
 * Phase 12 §6) prints silently and instantly; everywhere else it opens the
 * normal print dialog, which is the documented fallback. Either way the call
 * is the same — the difference is entirely in how the browser was launched,
 * not in this code.
 *
 * A receipt commits from local, already-known data (ADR-3: "the receipt prints
 * from local state instantly"), so this never awaits a network response.
 */

import { useCallback, useState } from 'react';

import type { ReceiptData } from './receipt';

export function usePrintReceipt() {
  const [receipt, setReceipt] = useState<ReceiptData | null>(null);

  const print = useCallback((data: ReceiptData) => {
    setReceipt(data);
    // Two ticks: React must commit the receipt into the DOM (mounted, but
    // display:none until print) before the browser's print engine walks it.
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        window.print();
      });
    });
  }, []);

  return { receipt, print };
}
