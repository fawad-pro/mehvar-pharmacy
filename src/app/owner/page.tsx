import { redirect } from 'next/navigation';

import { currentSession, scopeFor } from '@/auth/session';
import { lowStockProducts, nearExpiryBatches, pendingIncidents } from '@/db/adjustment-queries';
import { threeNumbers } from '@/db/reporting-queries';
import { listCustomers } from '@/db/udhaar-queries';
import { businessDayBounds, businessDayOf } from '@/lib/business-day';

import { baseQty } from '@/lib/branded';
import { describeQuantity, type PackLevel } from '@/lib/quantity';

import { OwnerSurface } from './owner-surface';

/**
 * Owner remote view — W11, Phase 10 §2's owner phone surface.
 *
 *   "Today (three numbers + exceptions), Stock (low/near-expiry counts and
 *    lists), Udhaar (balances, largest first). Bottom-tab navigation,
 *    numerals huge (I6). Read-only in V1."
 *
 * Server-fetched once per load rather than per tab: this is a phone checking
 * in, not a counter running all day — there is no keyboard path to protect
 * and no reason to hold a live connection open.
 */
export default async function OwnerPage() {
  const session = await currentSession();
  if (!session) {
    redirect('/owner/login');
  }
  if (session.userRole !== 'owner') {
    redirect('/owner/login');
  }

  const scope = scopeFor(session);
  const { start, end } = businessDayBounds(businessDayOf(new Date()));

  const [numbers, lowStock, expiring, incidents, udhaar] = await Promise.all([
    threeNumbers(scope, start, end),
    lowStockProducts(scope),
    nearExpiryBatches(scope, 30),
    pendingIncidents(scope),
    listCustomers(scope, { pageSize: 20 }),
  ]);

  return (
    <OwnerSurface
      tenantName={session.tenantName}
      numbers={numbers}
      lowStock={lowStock.map((row) => ({
        productName: row.productName,
        onHandBase: row.onHandBase,
        minStockBaseUnits: row.minStockBaseUnits,
        baseUnitName: row.baseUnitName,
        // [PCN-012] Worded here, in the product's own units.
        onHand: describeQuantity(
          baseQty(row.onHandBase),
          row.baseUnitName,
          (row.packLevels as PackLevel[] | null) ?? [],
        ),
      }))}
      expiring={expiring.map((row) => ({
        batchId: row.batchId,
        productName: row.productName,
        expiryDate: row.expiryDate,
        qtyRemainingBase: row.qtyRemainingBase,
        baseUnitName: row.baseUnitName,
        amount: describeQuantity(baseQty(row.qtyRemainingBase), row.baseUnitName, row.packLevels),
      }))}
      incidents={incidents.map((row) => ({
        productName: row.productName,
        pendingBase: row.pendingBase,
        baseUnitName: row.baseUnitName,
        amount: describeQuantity(baseQty(row.pendingBase), row.baseUnitName, row.packLevels),
      }))}
      customers={udhaar.items}
    />
  );
}
