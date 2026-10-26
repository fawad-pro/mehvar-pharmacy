/**
 * [PCN-012] What a purchase line cost, in SQL — the one expression every
 * invoice total, supplier balance and purchase list sums.
 *
 * A line bought per pack stores its exact cost (`line_cost_paisa`, count ×
 * cost per pack, checked by the database). A line from before PCN-012 cost
 * `qty_base × unit_cost_paisa` exactly, which is what it invoiced. Summing
 * `qty_base × unit_cost_paisa` for a pack line would multiply back a rounded
 * per-tablet figure and misstate what the shop owes.
 */

import { sql } from 'drizzle-orm';

import { purchaseLines } from './schema';

export const purchaseLineCostSql = sql<number>`coalesce(${purchaseLines.lineCostPaisa}, ${purchaseLines.qtyBase} * ${purchaseLines.unitCostPaisa})`;
