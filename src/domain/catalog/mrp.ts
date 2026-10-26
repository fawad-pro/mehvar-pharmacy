/**
 * [PCN-012] The MRP a product has on record, stated for one of its units — pure.
 *
 * D4: MRP is printed on the pack and the pack in hand is authoritative. When a
 * delivery's pack shows a different MRP from the one on record, the owner is
 * offered the update rather than having it applied silently (Session 2 scope).
 * This answers "what does the record say for this unit?" so the screen can tell
 * whether the pack disagrees.
 *
 * A product records its MRP either for a named unit (`mrpUnit`, set from a
 * delivery) or, from before PCN-012, per base unit. Converting between units
 * goes through `lib/quantity`, the one place pack sizes are multiplied.
 */

import { packFactor, paisa } from '@/lib/branded';
import { scalePriceBetweenUnits } from '@/lib/quantity';

import type { ProductUnit } from './units';

export interface RecordedMrp {
  /** Per base unit, from before PCN-012. */
  readonly mrpPaisa: number | null;
  /** For the unit it is printed on. Wins when present. */
  readonly mrpUnit?: { readonly key: string; readonly paisa: number } | null;
  readonly units: readonly ProductUnit[];
}

/**
 * The recorded MRP for one `unit`, or null when nothing is recorded. Exact
 * when recorded for that unit or for a smaller one it is made of; scaled down
 * to a smaller unit it rounds up, as every suggested price does.
 */
export function recordedMrpFor(product: RecordedMrp, unit: ProductUnit): number | null {
  const named = product.mrpUnit
    ? product.units.find((candidate) => candidate.key === product.mrpUnit?.key)
    : undefined;
  if (product.mrpUnit && named) {
    return scalePriceBetweenUnits(
      paisa(product.mrpUnit.paisa),
      packFactor(named.factor),
      packFactor(unit.factor),
    );
  }
  if (product.mrpPaisa !== null) {
    return scalePriceBetweenUnits(paisa(product.mrpPaisa), packFactor(1), packFactor(unit.factor));
  }
  return null;
}
