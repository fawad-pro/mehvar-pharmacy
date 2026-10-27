'use client';

/**
 * "The operator has asked to go somewhere" — so a background refresh must not
 * run now.
 *
 * `router.refresh()` issued while a navigation is in flight cancels that
 * navigation. `RefreshOnSync` refreshes the moment the outbox delivers a sale,
 * which is exactly when the operator presses the next key, so F5 or a link
 * right after a sale did nothing about one time in four. The page being
 * navigated to renders fresh anyway, so skipping the refresh loses nothing.
 *
 * Marked by the two ways the counter navigates by hand — a link click and a
 * global key — and cleared when the route changes or after a few seconds, so a
 * navigation that never happens cannot hold refreshes off for good.
 */

const STALE_AFTER_MS = 5_000;

let markedAt = 0;

export function markNavigationIntent(): void {
  markedAt = performance.now();
}

export function clearNavigationIntent(): void {
  markedAt = 0;
}

export function navigationPending(): boolean {
  return markedAt !== 0 && performance.now() - markedAt < STALE_AFTER_MS;
}

/** A click on an in-app link is a navigation about to start. */
export function watchLinkClicks(): () => void {
  const onClick = (event: MouseEvent) => {
    if (event.defaultPrevented || event.button !== 0) return;
    const anchor = event.target instanceof Element ? event.target.closest('a[href]') : null;
    const href = anchor?.getAttribute('href') ?? '';
    if (href.startsWith('/')) markNavigationIntent();
  };
  document.addEventListener('click', onClick, { capture: true });
  return () => {
    document.removeEventListener('click', onClick, { capture: true });
  };
}
