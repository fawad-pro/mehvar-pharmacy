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
  /*
   * F7 is Receipts, not Returns — a deliberate swap, recorded here because it
   * changes a printed shortcut.
   *
   * The two acts are not peers. Looking a receipt up happens many times a day
   * ("what did she buy?", "is this our slip?", "did that sale go through?");
   * a refund happens rarely and always *about* a specific receipt. Giving the
   * key to the frequent, harmless act and reaching the rare, consequential one
   * from the record it applies to is the same principle the whole receipts
   * surface exists for: a clear place to do something, a separate obvious
   * place to review what already happened.
   *
   * `/returns` keeps its route and its own search — a customer arriving with
   * goods and no slip still works. It is linked from Receipts so it has a
   * visible entry point (Day 8: a workflow nothing links to is not built).
   */
  { key: 'F7', label: 'Receipts', href: '/receipts' },
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
