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

/** The roll's printable width; `globals.css` lays the receipt out at it. */
const PAGE_WIDTH_MM = 72;
const PX_PER_MM = 96 / 25.4;

/**
 * Tells the print engine the page is exactly one receipt: 72 mm wide and as
 * tall as this receipt, written as an `@page` rule just before printing.
 *
 * It cannot live in `globals.css`. A static `size: 72mm auto` is invalid CSS
 * (`size` takes one or two lengths, or `auto` alone), so Chrome silently drops
 * the whole declaration, lays the slip out on whatever paper the dialog picked
 * and scales it to fit — on the pilot counter, a 50 mm bar printed 37 mm and
 * the slip sat on the left of the roll. A fixed height instead would split a
 * long receipt across pages or feed blank paper. So the height is measured.
 */
export function setReceiptPageSize(): void {
  const receipt = document.getElementById('printable-receipt');
  if (!receipt) {
    return;
  }
  // Measured off-screen at print width; the receipt sizes in px, so the
  // screen measure is the print measure.
  const previous = receipt.style.cssText;
  receipt.style.cssText = `display:block;position:fixed;left:-10000px;top:0;visibility:hidden;width:${PAGE_WIDTH_MM}mm;padding:0 1mm`;
  const heightMm = Math.ceil(receipt.getBoundingClientRect().height / PX_PER_MM) + 4;
  receipt.style.cssText = previous;

  let style = document.getElementById('receipt-page');
  if (!style) {
    style = document.createElement('style');
    style.id = 'receipt-page';
    document.head.appendChild(style);
  }
  style.textContent = `@page { size: ${PAGE_WIDTH_MM}mm ${heightMm}mm; margin: 0; }`;
}

export function usePrintReceipt() {
  const [receipt, setReceipt] = useState<ReceiptData | null>(null);

  const print = useCallback((data: ReceiptData) => {
    setReceipt(data);
    // Two ticks: React must commit the receipt into the DOM (mounted, but
    // display:none until print) before the browser's print engine walks it.
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        setReceiptPageSize();
        window.print();
      });
    });
  }, []);

  return { receipt, print };
}
