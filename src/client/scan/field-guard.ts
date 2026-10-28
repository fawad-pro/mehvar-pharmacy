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
 *
 * A scan that lands on no text field at all — the page, or a button just
 * tapped, as it always is on a tablet — went nowhere, and its Enter pressed
 * whatever button had focus (on Receive Stock, the Supplier button opened its
 * picker with the code in it). Now such a scan goes to the screen's own scan
 * field, `data-scan-home`, exactly as if the cursor had been there: "scan
 * anywhere adds the item" (I1). With a dialog open, or no scan field on the
 * screen, it is put back like any other, and its Enter presses nothing.
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

function isTextField(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLTextAreaElement ||
    (target instanceof HTMLInputElement && !NON_TEXT_INPUTS.has(target.type)) ||
    (target instanceof HTMLElement && target.isContentEditable)
  );
}

/** The screen's own field for scans, when one is showing. */
function scanHome(): HTMLInputElement | null {
  for (const field of document.querySelectorAll<HTMLInputElement>('input[data-scan-home]')) {
    if (!field.disabled && field.getClientRects().length > 0) return field;
  }
  return null;
}

/**
 * Puts a scan where it belongs and finishes it there: in a form, the form
 * submits, as Enter would; otherwise the field gets the scanner's Enter.
 *
 * The field works out its results from what it holds, and it can be a frame
 * or two behind the code just put in it (it also refreshes the catalogue as
 * it takes focus). An Enter that arrived first found nothing to take — about
 * one scan in twelve on Receive Stock. So the Enter waits two frames, and is
 * given again while the code is still sitting there unused: a scan the field
 * took has cleared it, so a used scan is never taken twice.
 */
function deliver(field: HTMLInputElement, code: string): void {
  field.focus();
  restoreValue(field, code);
  if (field.form) {
    const form = field.form;
    requestAnimationFrame(() => requestAnimationFrame(() => form.requestSubmit()));
    return;
  }
  let tries = 0;
  const press = (): void => {
    if (!field.isConnected || field.value !== code) return;
    field.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }),
    );
    tries += 1;
    if (tries < MAX_ENTER_TRIES) window.setTimeout(press, RETRY_ENTER_MS);
  };
  requestAnimationFrame(() => requestAnimationFrame(press));
}

/** How often, and how far apart, a delivered scan's Enter is given. */
const MAX_ENTER_TRIES = 4;
const RETRY_ENTER_MS = 120;

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
  /** Keys that landed on no text field, since the last Enter. */
  let loose: KeyStroke[] = [];

  const onLooseKey = (event: KeyboardEvent): void => {
    const at = event.timeStamp;
    if (event.key === 'Enter') {
      const typed = loose;
      loose = [];
      const candidates = scanCandidates(typed, at);
      if (!candidates) {
        return;
      }
      // The scanner's Enter presses nothing where it landed.
      event.preventDefault();
      event.stopImmediatePropagation();
      const home = document.querySelector('[aria-modal="true"]') ? null : scanHome();
      if (home) {
        deliver(home, candidates[0]!);
      } else {
        window.dispatchEvent(new CustomEvent(SCAN_BLOCKED_EVENT));
      }
      return;
    }
    if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
      loose.push({ key: event.key, at });
    }
  };

  const reset = () => {
    field = null;
    strokes = [];
    before = [];
  };

  const onKeyDown = (event: KeyboardEvent) => {
    // Browser autofill (Chrome filling a saved PIN or password) sends a bare
    // "keydown" Event with no key at all. It is not a keystroke, so it is not
    // part of a scan — and reading `.length` off it threw on every autofill.
    if (typeof event.key !== 'string') {
      return;
    }
    if (!isTextField(event.target)) {
      reset();
      onLooseKey(event);
      return;
    }
    loose = [];
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
