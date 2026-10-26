'use client';

/**
 * A barcode scanned into any field that is not meant for one never reaches
 * the screen as data — the whole counter, every field, present and future.
 *
 * A keyboard-wedge scanner (I1) types into whatever has the cursor and ends
 * with Enter, and most of Mehvar's forms commit on Enter. Patching fields one
 * at a time kept finding the next one: Cash tendered printed "Paid
 * 8,964,000,101,018.00", a supplier payment recorded billions, Paid now
 * silently became credit, a GS1 code crashed the Pay row. So the guard sits
 * on the window, ahead of every screen's own handlers:
 *
 *  - each printable key in a text field is recorded with the field's value
 *    as it stood before the key;
 *  - on Enter, if the keys were a scan (`burst.ts`: barcode-long, a scanner's
 *    typical gap), the Enter is swallowed before any screen sees it, the
 *    field is put back as it was, and one notice says what happened.
 *
 * Fields that exist to receive scans opt out by sitting inside an element
 * with `data-scan-target` — the product search, the Returns search, a
 * product's barcode field, the Receive Stock line (which routes a scan to the
 * next product itself).
 */

import { scanCandidates, type KeyStroke } from './burst';

/** Dispatched on `window` when a scan was put back. */
export const SCAN_BLOCKED_EVENT = 'mehvar:scan-blocked';

type TextField = HTMLInputElement | HTMLTextAreaElement;

const NON_TEXT_INPUTS = new Set([
  'checkbox',
  'radio',
  'button',
  'submit',
  'reset',
  'file',
  'color',
  'range',
  'hidden',
  'image',
]);

function guardedField(target: EventTarget | null): TextField | null {
  if (target instanceof HTMLTextAreaElement) {
    return target.closest('[data-scan-target]') ? null : target;
  }
  if (target instanceof HTMLInputElement && !NON_TEXT_INPUTS.has(target.type)) {
    return target.closest('[data-scan-target]') ? null : target;
  }
  return null;
}

/**
 * Sets a field's value so React sees it: through the native setter, then an
 * input event — React ignores a plain `.value =` on a controlled field.
 */
function restoreValue(field: TextField, value: string): void {
  const prototype =
    field instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(prototype, 'value')?.set?.call(field, value);
  field.dispatchEvent(new Event('input', { bubbles: true }));
}

/** Installs the guard; returns its removal. One per page. */
export function installScanFieldGuard(): () => void {
  let field: TextField | null = null;
  let strokes: KeyStroke[] = [];
  let before: string[] = [];

  const reset = () => {
    field = null;
    strokes = [];
    before = [];
  };

  const onKeyDown = (event: KeyboardEvent) => {
    const target = guardedField(event.target);
    if (target === null) {
      reset();
      return;
    }
    if (target !== field) {
      reset();
      field = target;
    }
    // When the key was pressed, not when this handler ran (see `burst.ts`).
    const at = event.timeStamp;

    if (event.key === 'Enter') {
      const typed = strokes;
      const snapshots = before;
      reset();
      const candidates = scanCandidates(typed, at);
      if (!candidates) {
        return;
      }
      event.preventDefault();
      event.stopImmediatePropagation();
      restoreValue(target, snapshots[typed.length - candidates[0]!.length] ?? snapshots[0] ?? '');
      window.dispatchEvent(new CustomEvent(SCAN_BLOCKED_EVENT));
      return;
    }
    if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
      // Keydown runs before the field changes: this is the value as it stood.
      before.push(target.value);
      strokes.push({ key: event.key, at });
    }
  };

  window.addEventListener('keydown', onKeyDown, { capture: true });
  return () => {
    window.removeEventListener('keydown', onKeyDown, { capture: true });
  };
}
