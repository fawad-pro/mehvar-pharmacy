'use client';

/**
 * The shared modal backdrop.
 *
 * `onDismiss` is deliberately optional, and the choice is per-overlay rather
 * than global:
 *
 * - A **picker** — supplier, customer, user — is a non-destructive selection.
 *   Clicking away is what everyone expects, and the cost of a stray click is
 *   re-opening it. These pass `onDismiss`.
 * - The **payment overlay** does not. It sits mid-transaction with a figure
 *   already typed and a customer waiting; a stray click that discarded it
 *   would cost a re-key at the worst possible moment. Esc, deliberately
 *   pressed, is the only way out of that one.
 *
 * Only a click that both starts and ends on the backdrop dismisses — otherwise
 * releasing a text selection outside the dialog closes it, which feels like
 * the software throwing the work away.
 *
 * Every overlay goes through here, the payment and settlement ones included,
 * so what a modal means is decided once.
 */

import { useRef } from 'react';

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Tab stays inside the dialog. It walked out into the screen behind — the
 * key bar under the payment overlay — where an Enter navigated away with the
 * sale still open. A modal (`aria-modal`) means the rest is out of reach.
 */
function keepTabInside(event: React.KeyboardEvent<HTMLDivElement>): void {
  if (event.key !== 'Tab') return;
  const inside = [...event.currentTarget.querySelectorAll<HTMLElement>(FOCUSABLE)];
  const first = inside[0];
  const last = inside.at(-1);
  if (!first || !last) return;
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}

export function OverlayBackdrop({
  label,
  onDismiss,
  children,
}: {
  label: string;
  onDismiss?: (() => void) | undefined;
  children: React.ReactNode;
}) {
  const pressedOnBackdrop = useRef(false);

  return (
    <div
      onKeyDown={keepTabInside}
      className="bg-ink/40 fixed inset-0 z-50 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-label={label}
      onMouseDown={(event) => {
        pressedOnBackdrop.current = event.target === event.currentTarget;
      }}
      onClick={(event) => {
        if (onDismiss && pressedOnBackdrop.current && event.target === event.currentTarget) {
          onDismiss();
        }
        pressedOnBackdrop.current = false;
      }}
    >
      {children}
    </div>
  );
}
