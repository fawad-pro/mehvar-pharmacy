'use client';

/**
 * [PCN-012] The last unit each product was sold in at this counter — the
 * Sale screen's default for the next line of that product.
 *
 * Per counter by design: one counter sells loose tablets to walk-ins while
 * another sells boxes to a clinic. `localStorage` because losing it costs one
 * Tab press, never a sale; every access is guarded for the same reason.
 */

const STORAGE_KEY = 'mehvar.last-sale-unit';

function readAll(): Record<string, string> {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : {};
    return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, string>)
      : {};
  } catch {
    return {};
  }
}

export function lastSaleUnit(productId: string): string | null {
  const value = readAll()[productId];
  return typeof value === 'string' ? value : null;
}

export function rememberSaleUnit(productId: string, unitKey: string): void {
  try {
    const all = readAll();
    if (all[productId] === unitKey) {
      return;
    }
    all[productId] = unitKey;
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(all));
  } catch {
    // Private window or full storage: the next line starts at the default.
  }
}
