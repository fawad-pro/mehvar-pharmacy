'use client';

/**
 * Device-scoped receipt numbers — Phase 9 §3, resolving defect C1.
 *
 *   "`receipt_number` is client-generated and device-scoped (e.g. `A-1042`),
 *    unique per tenant, identical behavior online and offline."
 *
 * The counter mints these, not the server. That is not a convenience: ADR-3
 * requires a receipt to print from local state during a disruption, and a
 * receipt without a number is not a receipt. Server sequencing would make an
 * offline sale unnumberable, which is exactly the contradiction C1 recorded.
 *
 * So the sequence lives in `localStorage`, keyed by device, seeded from a server
 * hint the first time. Uniqueness is guaranteed by the `(tenant_id,
 * receipt_number)` index rather than by this counter being clever; a collision
 * is retried with the next number.
 *
 * Day 4 owns the printed receipt itself (ADR-6, Phase 10 §7). This is only the
 * number, because `sales.receipt_number` is NOT NULL and Day 3 has to commit.
 */

const STORAGE_PREFIX = 'mehvar.receipt.';

function storageKey(tenantId: string, devicePrefix: string): string {
  return `${STORAGE_PREFIX}${tenantId}.${devicePrefix}`;
}

function readCounter(key: string): number {
  try {
    const raw = window.localStorage.getItem(key);
    const value = raw === null ? 0 : Number(raw);
    return Number.isSafeInteger(value) && value >= 0 ? value : 0;
  } catch {
    // Private browsing, a locked profile, a full disk. None may stop a sale (P2).
    return 0;
  }
}

function writeCounter(key: string, value: number): void {
  try {
    window.localStorage.setItem(key, String(value));
  } catch {
    // The number is already in hand; failing to remember it costs a retry on
    // the next sale, not this one.
  }
}

/**
 * Raises the local counter to at least the server's highest known value.
 *
 * Called once when the sale screen loads. It matters for a re-imaged machine or
 * a cleared profile: without it the device would restart at 1 and collide with
 * every receipt it ever printed.
 */
export function seedReceiptCounter(
  tenantId: string,
  devicePrefix: string,
  serverHighest: number,
): void {
  const key = storageKey(tenantId, devicePrefix);
  if (serverHighest > readCounter(key)) {
    writeCounter(key, serverHighest);
  }
}

/** The next number for this device, consumed as it is handed out. */
export function nextReceiptNumber(tenantId: string, devicePrefix: string): string {
  const key = storageKey(tenantId, devicePrefix);
  const next = readCounter(key) + 1;
  writeCounter(key, next);
  return `${devicePrefix}-${next}`;
}

/**
 * Skips past a number that turned out to be taken.
 *
 * The server rejected it on the unique index — two devices sharing a prefix, or
 * a restored backup. The operator should never see this; they should see the
 * next receipt.
 */
export function skipReceiptNumber(tenantId: string, devicePrefix: string, taken: string): void {
  const counter = Number(taken.slice(devicePrefix.length + 1));
  const key = storageKey(tenantId, devicePrefix);
  if (Number.isSafeInteger(counter) && counter > readCounter(key)) {
    writeCounter(key, counter);
  }
}
