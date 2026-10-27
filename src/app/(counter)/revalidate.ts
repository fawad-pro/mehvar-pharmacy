/**
 * What a write invalidates — declared once, in one table.
 *
 * THE PROBLEM THIS SOLVES
 *
 * Before this existed, exactly one of the eleven writing server actions called
 * `revalidatePath`. Everything else left the screens showing pre-write state
 * until somebody pressed F5: a recorded cash movement did not appear in the
 * day's exceptions, a received purchase did not move the stock list, an
 * adjustment did not change the figure it had just adjusted. The shop's
 * workaround was to reload the browser, which is the exact class of thinking
 * the product exists to remove.
 *
 * Ad-hoc `revalidatePath` calls at each call site would fix today's eleven and
 * lose the twelfth. The failure is silent by nature — nothing errors, a number
 * is just old — so it needs to be a declaration rather than a habit: an action
 * names the AREA it changed, and the mapping from area to surfaces lives here
 * where it can be read whole and reviewed when a surface is added.
 *
 * The counterpart for offline-captured writes is `client/sync/refresh-on-sync`:
 * those reach the database through the outbox pump rather than a server action,
 * so the pump announces them and the shell re-renders. Between the two, every
 * path that changes the database also refreshes what is on screen.
 *
 * Not a `'use server'` file — it is called BY actions, and a plain module can
 * export types (the trap recorded on Day 4 and again on Day 6).
 */

import { revalidatePath } from 'next/cache';

/**
 * The kinds of change a counter action can make.
 *
 * Coarse on purpose. A finer taxonomy would be more precise and would be got
 * wrong: the cost of revalidating one surface too many is a re-render nobody
 * notices, and the cost of one too few is a wrong number on a screen the owner
 * is trusting.
 */
export type Area =
  | 'catalog'
  | 'stock'
  | 'money'
  | 'customers'
  | 'purchases'
  | 'receipts'
  | 'settings';

/**
 * `/sale` appears under catalog and stock because the counter reads both: the
 * search index is seeded server-side and the shortfall warnings come from the
 * stock map.
 *
 * `/day` appears under almost everything because the three numbers and the
 * exception list are derived from every event kind there is — which is what
 * makes it the screen most likely to be quietly stale.
 */
const SURFACES: Record<Area, readonly string[]> = {
  catalog: ['/products', '/sale'],
  stock: ['/stock', '/stock/adjust', '/products', '/sale', '/day'],
  money: ['/day'],
  customers: ['/customers', '/day'],
  purchases: ['/purchases', '/purchases/suppliers', '/stock', '/day'],
  receipts: ['/receipts', '/returns', '/day'],
  settings: ['/settings'],
};

/**
 * Dynamic segments cannot be revalidated by their concrete path without
 * knowing every id, so they are revalidated by route pattern — which covers
 * every instance, including the one the operator is looking at.
 */
const DYNAMIC: Record<Area, readonly string[]> = {
  catalog: ['/products/[productId]'],
  stock: ['/products/[productId]'],
  money: [],
  customers: ['/customers/[customerId]'],
  purchases: ['/purchases/[purchaseId]', '/purchases/suppliers/[supplierId]'],
  receipts: ['/receipts/[receiptNumber]', '/customers/[customerId]'],
  settings: [],
};

/** Marks every surface the given areas can be seen through as needing a re-read. */
export function revalidateAfter(...areas: readonly Area[]): void {
  const paths = new Set<string>();
  const patterns = new Set<string>();

  for (const area of areas) {
    for (const path of SURFACES[area]) paths.add(path);
    for (const pattern of DYNAMIC[area]) patterns.add(pattern);
  }

  for (const path of paths) revalidatePath(path);
  for (const pattern of patterns) revalidatePath(pattern, 'page');
}
