/**
 * The global key map — Phase 10 §3, as ONE registry (Phase 11 §1).
 *
 * "Shortcuts are printed on the interface itself, not hidden in help" (I1). The
 * key bar renders this array and the key handler binds this array, so the
 * printed shortcut and the bound behaviour cannot drift apart. That is the whole
 * reason this is data rather than a switch statement: a salesman trusts the foot
 * rail because it has never once been wrong.
 *
 * Letters were chosen for reach; function keys for surfaces (Phase 10 §3).
 */

export interface GlobalKey {
  /** `event.key` value. */
  readonly key: string;
  /** What the key bar prints. */
  readonly label: string;
  /** Route it navigates to, or null for keys handled contextually. */
  readonly href: string | null;
  /** Owner-only surfaces are dimmed for a salesman rather than hidden (T1 over P5). */
  readonly ownerOnly?: boolean;
}

export const GLOBAL_KEYS: readonly GlobalKey[] = [
  { key: 'F1', label: 'Sale', href: '/sale' },
  { key: 'F2', label: 'Purchases', href: '/purchases' },
  { key: 'F3', label: 'Products', href: '/products' },
  { key: 'F4', label: 'Customers', href: '/customers' },
  { key: 'F5', label: 'Day', href: '/day', ownerOnly: true },
  { key: 'F6', label: 'Stock', href: '/stock' },
  { key: 'F7', label: 'Returns', href: '/returns' },
  // F8 is deliberately contextual (defect C5's resolution): with items in the
  // cart it attaches a customer for udhaar (W2); with an empty cart it opens
  // Settle Udhaar (W3). One key, two contexts, both meaning "customer + money".
  { key: 'F8', label: 'Udhaar', href: null },
  { key: 'F9', label: 'Adjust', href: '/stock/adjust' },
  { key: 'F10', label: 'Switch user', href: null },
] as const;

/** Esc returns to Sale, or closes the overlay on top of it (Phase 10 §1). */
export const BACK_KEY = 'Escape';

export const HOME_ROUTE = '/sale';
