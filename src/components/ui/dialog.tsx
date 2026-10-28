/**
 * Dialog — one decision: a title, the facts needed, a field or two, and one
 * primary action bottom-right (PCN-016). Below 768 px it is a bottom sheet:
 * `OverlayBackdrop` aligns it to the bottom edge and the panel squares its
 * lower corners and stacks its actions full width.
 *
 * Every modal is an `OverlayBackdrop` (selling hardening part 3); this only
 * draws the panel, so the focus trap and Esc stay decided in one place.
 */

import { OverlayBackdrop } from '../overlay-backdrop';

export const dialogPanelClass =
  'flex max-h-full w-full max-w-[400px] flex-col gap-4 overflow-auto rounded-dialog bg-surface p-6 text-navy shadow-dialog max-md:max-w-none max-md:rounded-b-none max-md:px-4 max-md:pt-5';

export function Dialog({
  title,
  onDismiss,
  onEscape,
  actions,
  className = '',
  children,
}: {
  title: string;
  onDismiss?: (() => void) | undefined;
  onEscape?: (() => void) | undefined;
  /** Rendered last; the primary action goes at the end. */
  actions?: React.ReactNode;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <OverlayBackdrop label={title} onDismiss={onDismiss} onEscape={onEscape}>
      <div className={`${dialogPanelClass} ${className}`}>
        <h2 className="text-heading m-0">{title}</h2>
        {children}
        {actions ? (
          <div className="mt-1 flex flex-wrap items-center justify-end gap-2 max-md:flex-col-reverse max-md:items-stretch">
            {actions}
          </div>
        ) : null}
      </div>
    </OverlayBackdrop>
  );
}
