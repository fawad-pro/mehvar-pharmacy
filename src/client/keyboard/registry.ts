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
  /**
   * What a routeless key MEANS, for the handler to dispatch on.
   *
   * The handler used to branch on the literal strings 'F8' and 'F10', which
   * quietly made the registry a half-truth: "add a key in one place" was true
   * for anything with an href and false for everything else, and reordering the
   * bar would have sent Udhaar's dispatch to whatever key happened to land on
   * F8. Binding by meaning is what makes the one-array rule actually hold.
   */
  readonly dispatch?: 'udhaar' | 'switch-user';
  /** Owner-only surfaces are dimmed for a salesman rather than hidden (T1 over P5). */
  readonly ownerOnly?: boolean;
  /**
   * Which band of the day this key belongs to. The bar draws a divider between
   * bands so the grouping is visible rather than merely intended — a rationale
   * nobody can see is not a design, it is a comment.
   */
  readonly group: 'counter' | 'goods' | 'owner';
}

export const GLOBAL_KEYS: readonly GlobalKey[] = [
  /*
   * ORDERED BY HOW CLOSE THE TASK IS TO THE CUSTOMER, IN THREE GROUPS.
   *
   * The old order was arbitrary — Purchases, a back-office task done once a
   * week when a delivery arrives, sat at F2 beside Sale, while Receipts was at
   * F7 and Stock at F6 with Day wedged between them. Ten keys with no pattern
   * is ten things to memorise. Three groups of three or four is a shape you
   * learn once:
   *
   *   F1-F4  at the counter, with a customer in front of you
   *   F5-F8  about goods, walking the shop
   *   F9-F10 the owner's view, and whose hands are on the keyboard
   *
   * Frequency falls off left to right, which also means the keys nearest the
   * hand are the ones pressed all day.
   */

  // — At the counter ——————————————————————————————————————————————
  { key: 'F1', label: 'Sale', href: '/sale', group: 'counter' },
  { key: 'F2', label: 'Receipts', href: '/receipts', group: 'counter' },
  { key: 'F3', label: 'Customers', href: '/customers', group: 'counter' },
  // F8-turned-F4 is deliberately contextual (defect C5's resolution): with
  // items in the cart it attaches a customer for udhaar (W2); with an empty
  // cart it opens Settle Udhaar (W3). One key, two contexts, both meaning
  // "customer + money" — which is why it now sits beside Customers rather than
  // stranded between Receipts and Adjust.
  { key: 'F4', label: 'Udhaar', href: null, dispatch: 'udhaar', group: 'counter' },

  // — About goods —————————————————————————————————————————————————
  { key: 'F5', label: 'Products', href: '/products', group: 'goods' },
  { key: 'F6', label: 'Stock', href: '/stock', group: 'goods' },
  { key: 'F7', label: 'Purchases', href: '/purchases', group: 'goods' },
  { key: 'F8', label: 'Adjust', href: '/stock/adjust', group: 'goods' },

  // — The owner, and the device ———————————————————————————————————
  { key: 'F9', label: 'Day', href: '/day', ownerOnly: true, group: 'owner' },
  { key: 'F10', label: 'Switch user', href: null, dispatch: 'switch-user', group: 'owner' },
] as const;

/** Esc returns to Sale, or closes the overlay on top of it (Phase 10 §1). */
export const BACK_KEY = 'Escape';

export const HOME_ROUTE = '/sale';

/**
 * The printed key for a routeless key's MEANING — `keyFor('udhaar')` → `'F4'`.
 *
 * Every on-screen hint that tells the operator which key does something must
 * call this rather than write the letter itself. A hardcoded "F8" is exactly
 * what survived the Udhaar → F4 reorder in every hint that said it: nothing
 * connected that text back to the registry, so the bar moved and the hints
 * did not. `hint-sourcing.test.ts` polices the rest of the source tree — no
 * other file may spell a dispatch key's letter out loud.
 */
export function keyFor(dispatch: NonNullable<GlobalKey['dispatch']>): string {
  const binding = GLOBAL_KEYS.find((candidate) => candidate.dispatch === dispatch);
  if (!binding) {
    throw new Error(`No key in GLOBAL_KEYS dispatches '${dispatch}'.`);
  }
  return binding.key;
}
