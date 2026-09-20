/**
 * The L1 capture seam (PCN-006), as a pure policy so it can be tested without
 * rendering the pump.
 *
 * ## Where enforcement lives, and why here
 *
 * A restricted installation (unauthorized / unbound / invalid / revoked) may not
 * start NEW business. The one place that can tell "new" from "already captured"
 * is capture itself: `deliverRecords` — the sync INGEST — stays deliberately
 * ungated so a sale captured while licensed always drains, even if the licence
 * lapses before delivery. Gating the ingest would strand already-captured sales
 * in the browser forever (Invariant L1, P2). So new business is withheld at
 * capture, and only at capture.
 *
 * ## What is withheld, and what is not
 *
 * `sale`, `quick_item` and `customer` are new business and are blocked while
 * restricted. `settlement` is the carve-out — collecting an EXISTING udhaar
 * closes out business already done and never creates any, so it is always
 * permitted, in every state. Delivery of anything already queued is never
 * affected by this policy.
 */

import type { RecordKind } from './records';

/** New business the restricted tier withholds at capture. Settlement is exempt. */
export const RESTRICTED_CAPTURE_KINDS: ReadonlySet<RecordKind> = new Set([
  'sale',
  'quick_item',
  'customer',
]);

export const CAPTURE_BLOCKED_MESSAGE =
  'This installation’s licence is not active, so new sales are paused. ' +
  'Settling udhaar, printing receipts and exporting your data still work. ' +
  'Open Settings → Licence to activate.';

/**
 * Thrown by `capture()` when a restricted installation tries to start new
 * business. Callers already treat a capture throw as "the sale did not happen",
 * so the receipt is never printed; they check for this type to show the licence
 * reason rather than the generic "this machine could not save it".
 */
export class CaptureBlockedError extends Error {
  constructor(message: string = CAPTURE_BLOCKED_MESSAGE) {
    super(message);
    this.name = 'CaptureBlockedError';
  }
}

/** Whether a capture of `kind` must be refused given the installation's state. */
export function captureBlockedFor(restricted: boolean, kind: RecordKind): boolean {
  return restricted && RESTRICTED_CAPTURE_KINDS.has(kind);
}
