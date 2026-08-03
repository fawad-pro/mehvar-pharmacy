import Link from 'next/link';
import { redirect } from 'next/navigation';

import { currentSession, scopeFor } from '@/auth/session';
import {
  lowStockProducts,
  nearExpiryBatches,
  pendingIncidents,
  recentAdjustments,
} from '@/db/adjustment-queries';
import { baseQty, paisa } from '@/lib/branded';
import { formatPaisa } from '@/lib/money';
import { describeQuantity, type PackLevel } from '@/lib/quantity';

/**
 * Stock — W12 and D2's exception surface, Phase 10 §2 surface 7.
 *
 *   "Near-expiry list (30/60/90-day horizons) → act per batch: return to
 *    distributor (W8 reason-coded) or write off. Low-stock list from minimum
 *    levels where set; the list is phone-readable because reordering happens on
 *    WhatsApp with distributors — **we produce the list, not the order**."
 *
 * The pending-incident list is D2's promise kept: "negative stock is a visible
 * exception state, never a silent one". It clears itself when a purchase or a
 * count correction accounts for the shortfall (Day 6's resolution path), so an
 * empty list here is real news rather than a missing feature.
 */
const HORIZONS = [30, 60, 90] as const;

export default async function StockPage({
  searchParams,
}: {
  searchParams: Promise<{ within?: string }>;
}) {
  const session = await currentSession();
  if (!session) {
    redirect('/login');
  }

  const params = await searchParams;
  const requested = Number(params.within ?? 30);
  const within = HORIZONS.includes(requested as (typeof HORIZONS)[number]) ? requested : 30;

  const scope = scopeFor(session);
  const [expiring, lowStock, incidents, adjustments] = await Promise.all([
    nearExpiryBatches(scope, within),
    lowStockProducts(scope),
    pendingIncidents(scope),
    recentAdjustments(scope, 15),
  ]);

  return (
    <section className="mx-auto flex max-w-4xl flex-col gap-6 p-4">
      <header className="flex flex-wrap items-center gap-3">
        <h1 className="text-green-900 text-2xl font-semibold">Stock</h1>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          {/* W9's guided flow was reachable only by typing `?opening=1`. It is
              the first thing a new pharmacy does and it had no door. */}
          <Link
            href="/stock/adjust?opening=1"
            className="border-line hover:bg-green-100 min-h-touch flex items-center rounded border px-4 text-sm"
          >
            Enter opening stock
          </Link>
          <Link
            href="/stock/adjust"
            className="border-line hover:bg-green-100 min-h-touch flex items-center rounded border px-4 text-sm"
          >
            Adjust stock — F9
          </Link>
        </div>
      </header>

      {/* D2 first: a shortfall is the only thing here that means the numbers
          and the shelf currently disagree. */}
      {incidents.length > 0 ? (
        <div
          className="border-amber/40 bg-amber/10 rounded border p-3"
          role="region"
          aria-label="Sold more than the system had"
        >
          <h2 className="text-amber mb-2 font-medium">Sold more than the system had</h2>
          <p className="text-ink/70 mb-3 text-sm">
            These went out before the stock was entered. Receiving the delivery or correcting the
            count clears them.
          </p>
          {/* The two fixes named above, as the two things you can press. The
              sentence described a workflow that lived on two other screens;
              this makes it one step from the row that reports the problem. */}
          <ul className="flex flex-col gap-1 text-sm">
            {incidents.map((incident) => (
              <li key={incident.productId} className="flex flex-wrap items-baseline gap-x-3">
                <span className="font-medium">{incident.productName}</span>
                <span className="numeral text-amber">
                  {incident.pendingBase} {incident.baseUnitName}
                </span>
                <span className="text-ink/50 text-xs">
                  since {incident.oldestAt.toLocaleDateString('en-PK')}
                </span>
                <span className="ml-auto flex gap-3">
                  <Link
                    href="/purchases"
                    className="text-green-600 text-xs underline-offset-2 hover:underline"
                  >
                    Receive delivery
                  </Link>
                  <Link
                    href="/stock/adjust"
                    className="text-green-600 text-xs underline-offset-2 hover:underline"
                  >
                    Correct the count
                  </Link>
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {/* Near expiry — W12's horizons. */}
      <div>
        <div className="mb-2 flex flex-wrap items-center gap-3">
          <h2 className="text-green-900 font-medium">Expiring soon</h2>
          <nav className="flex gap-1" aria-label="Expiry horizon">
            {HORIZONS.map((days) => (
              <Link
                key={days}
                href={`/stock?within=${days}`}
                aria-current={days === within ? 'page' : undefined}
                className={[
                  'rounded px-3 py-1 text-sm',
                  days === within ? 'bg-green-100 text-green-900 font-medium' : 'text-ink/60',
                ].join(' ')}
              >
                {days} days
              </Link>
            ))}
          </nav>
        </div>

        {expiring.length === 0 ? (
          <p className="text-ink/50 text-sm">Nothing expiring within {within} days.</p>
        ) : (
          <div className="border-line overflow-x-auto rounded border">
            <table className="text-table w-full text-left">
              <thead className="bg-green-100/50 text-ink/60 text-xs">
                <tr>
                  <th className="px-3 py-2 font-medium">Item</th>
                  <th className="px-3 py-2 font-medium">Batch</th>
                  <th className="px-3 py-2 font-medium">Expires</th>
                  <th className="px-3 py-2 text-right font-medium">On hand</th>
                  <th className="px-3 py-2 text-right font-medium">Value</th>
                </tr>
              </thead>
              <tbody>
                {expiring.map((row) => {
                  const expired = row.expiryDate < new Date().toISOString().slice(0, 10);
                  return (
                    <tr key={row.batchId} className="border-line border-t">
                      <td className="px-3 py-2 font-medium">{row.productName}</td>
                      <td className="text-ink/60 px-3 py-2">{row.batchNumber ?? '—'}</td>
                      <td
                        className={`px-3 py-2 ${expired ? 'text-red font-medium' : 'text-amber'}`}
                      >
                        {row.expiryDate}
                        {expired ? ' — expired' : ''}
                      </td>
                      <td className="numeral px-3 py-2">
                        {row.qtyRemainingBase} {row.baseUnitName}
                      </td>
                      <td className="numeral px-3 py-2">
                        {formatPaisa(paisa(row.qtyRemainingBase * row.pricePerBaseUnitPaisa))}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Low stock — only where a minimum is set (Phase 5 §6's boundary). */}
      <div>
        <h2 className="text-green-900 mb-2 font-medium">Running low</h2>
        {lowStock.length === 0 ? (
          <p className="text-ink/50 text-sm">
            Nothing below its minimum. Set minimum levels on a product (F3) to see it here.
          </p>
        ) : (
          <ul className="border-line divide-line divide-y rounded border">
            {lowStock.map((row) => (
              <li key={row.productId} className="flex items-baseline justify-between px-3 py-2">
                <span className="font-medium">{row.productName}</span>
                <span className="numeral text-sm">
                  {describeQuantity(
                    baseQty(row.onHandBase),
                    row.baseUnitName,
                    (row.packLevels as PackLevel[] | null) ?? [],
                  )}
                  <span className="text-ink/50 ml-2 text-xs">
                    min {row.minStockBaseUnits} {row.baseUnitName}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* T1 — every adjustment is visible, without exception. */}
      <div>
        <h2 className="text-green-900 mb-2 font-medium">Recent adjustments</h2>
        {adjustments.length === 0 ? (
          <p className="text-ink/50 text-sm">No stock adjustments yet.</p>
        ) : (
          <ul className="border-line divide-line divide-y rounded border text-sm">
            {adjustments.map((row) => (
              <li key={row.id} className="flex flex-wrap items-baseline gap-2 px-3 py-2">
                <span className="font-medium">{row.productName}</span>
                <span
                  className={`numeral ${row.qtyBaseDelta < 0 ? 'text-amber' : 'text-green-900'}`}
                >
                  {row.qtyBaseDelta > 0 ? '+' : ''}
                  {row.qtyBaseDelta} {row.baseUnitName}
                </span>
                <span className="text-ink/60">{row.reason.replaceAll('_', ' ')}</span>
                {row.note ? <span className="text-ink/50 text-xs">“{row.note}”</span> : null}
                <span className="text-ink/40 ml-auto text-xs">
                  {row.byName} · {row.createdAt.toLocaleDateString('en-PK')}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
