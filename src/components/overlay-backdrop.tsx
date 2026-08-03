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
 */

import { useRef } from 'react';

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
