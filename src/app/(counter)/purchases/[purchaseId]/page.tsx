import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';

import { currentSession, scopeFor } from '@/auth/session';
import {
  batchesForPurchase,
  correctionsForPurchase,
  supplierReturnsForBatches,
} from '@/db/correction-queries';
import { findPurchase } from '@/db/purchase-queries';
import { supplierBalance } from '@/db/supplier-queries';
import { baseQty, paisa } from '@/lib/branded';
import { formatPaisa } from '@/lib/money';
import { describeQuantity } from '@/lib/quantity';
import type { Uuid } from '@/lib/uuid';

/**
 * One received invoice, expanded.
 *
 * The "Received recently" list showed a supplier, a date and a total and
 * stopped there, so the question an owner actually asks of a delivery — what
 * came in, at what cost, expiring when — had no answer anywhere in the
 * product. Same shape of gap as receipts, same fix, same principle: the place
 * you *do* the receiving is `/purchases`, and this is the place you review
 * what was received. Nothing here changes anything.
 *
 * Purchases stay off `/receipts` on purpose. There is no receipt number and
 * nothing was handed to a customer; folding supplier invoices into the
 * customer-facing sequence would blur two different things that happen to
 * both be documents.
 */
export default async function PurchaseDetailPage({
  params,
}: {
  params: Promise<{ purchaseId: string }>;
}) {
  const session = await currentSession();
  if (!session) {
    redirect('/login');
  }

  const { purchaseId } = await params;
  const scope = scopeFor(session);
  const purchase = await findPurchase(scope, purchaseId);
  if (!purchase) {
    notFound();
  }
  // [PCN-009] What has been corrected or sent back since, shown beside the
  // invoice as entered — never instead of it (T2).
  const [corrections, lineBatches, accountPaisa] = await Promise.all([
    correctionsForPurchase(scope, purchaseId),
    batchesForPurchase(scope, purchaseId),
    // Where the supplier's account stands NOW. "On credit" below is what this
    // invoice left owing when it arrived; payments made since are against the
    // account, so the invoice says where to see them rather than going stale.
    purchase.supplierId && purchase.creditTracked
      ? supplierBalance(scope, purchase.supplierId as Uuid)
      : Promise.resolve(null),
  ]);
  const returns = await supplierReturnsForBatches(
    scope,
    lineBatches.map((batch) => batch.batchId),
  );
  const correctedDeltaPaisa = corrections.reduce((sum, row) => sum + row.invoiceDeltaPaisa, 0);

  /*
   * Invoiced cost, not effective cost.
   *
   * This is the figure that reconciles against the paper invoice in the
   * operator's hand — bonus units are free and change the per-unit cost
   * without changing what was paid. `domain/purchases/costing.ts` owns the
   * effective figure; showing it here would silently disagree with the
   * distributor's total and make a correct invoice look wrong.
   */
  const totalCostPaisa = purchase.lines.reduce(
    (sum, line) => sum + line.qtyBase * line.unitCostPaisa,
    0,
  );
  const bonusBase = purchase.lines.reduce((sum, line) => sum + line.bonusQtyBase, 0);
  // [PCN-007] What was still owed to the supplier when this invoice was
  // received. A negative would be an overpayment; clamped, since "on credit"
  // never means the supplier owes us on a single invoice.
  // Untracked (entered before supplier credit existed): nothing was recorded
  // about payment, so nothing is shown as owed.
  const creditPaisa = purchase.creditTracked
    ? Math.max(0, totalCostPaisa + correctedDeltaPaisa - purchase.cashPaidPaisa)
    : 0;

  return (
    <section className="mx-auto flex max-w-4xl flex-col gap-4 p-4">
      <Link href="/purchases" className="text-green-600 text-sm">
        ← Purchases
      </Link>

      <header>
        <p className="text-ink/50 text-xs tracking-[0.14em] uppercase">Received</p>
        <h1 className="text-green-900 text-2xl font-semibold">
          {purchase.supplierName ?? 'No supplier'}
        </h1>
        <p className="text-ink/60 mt-1 text-sm">
          {purchase.invoiceRef ? (
            <>
              Invoice <span className="numeral">{purchase.invoiceRef}</span> ·{' '}
            </>
          ) : null}
          {purchase.invoiceDate ?? purchase.createdAt.toLocaleDateString('en-PK')} ·{' '}
          {purchase.receivedByName}
        </p>
        {purchase.note ? <p className="text-ink/60 mt-1 text-sm">{purchase.note}</p> : null}
      </header>

      <div className="border-line overflow-x-auto rounded border">
        <table className="text-table w-full text-left">
          <thead className="bg-green-100/50 text-ink/60 text-xs">
            <tr>
              <th className="px-3 py-2 font-medium">Item</th>
              <th className="px-3 py-2 font-medium">Received</th>
              <th className="px-3 py-2 font-medium">Batch / expiry</th>
              <th className="px-3 py-2 text-right font-medium">Unit cost</th>
              <th className="px-3 py-2 text-right font-medium">Sells at</th>
              <th className="px-3 py-2 text-right font-medium">Line cost</th>
            </tr>
          </thead>
          <tbody>
            {purchase.lines.map((line) => (
              <tr key={line.lineId} className="border-line border-t align-top">
                <td className="px-3 py-2">
                  <Link
                    href={`/products/${line.productId}`}
                    className="text-green-700 hover:underline"
                  >
                    {line.productName}
                  </Link>
                </td>
                <td className="text-ink/70 px-3 py-2">
                  {describeQuantity(baseQty(line.qtyBase), line.baseUnitName, line.packLevels)}
                  {/* Bonus is stated separately, never folded into the quantity:
                      it arrived free, and an owner comparing this screen to the
                      distributor's invoice needs the two numbers to match. */}
                  {line.bonusQtyBase > 0 ? (
                    <p className="text-green-700 text-xs">
                      +{' '}
                      {describeQuantity(
                        baseQty(line.bonusQtyBase),
                        line.baseUnitName,
                        line.packLevels,
                      )}{' '}
                      bonus
                    </p>
                  ) : null}
                </td>
                <td className="text-ink/70 px-3 py-2 text-sm">
                  {line.batchNumber ? <span className="numeral">{line.batchNumber}</span> : '—'}
                  {line.expiryDate ? (
                    <p className="text-ink/50 numeral text-xs">exp {line.expiryDate}</p>
                  ) : null}
                </td>
                <td className="numeral px-3 py-2 text-right">
                  {formatPaisa(paisa(line.unitCostPaisa))}
                </td>
                <td className="numeral px-3 py-2 text-right">
                  {formatPaisa(paisa(line.priceAtReceivingPaisa))}
                  {line.mrpAtReceivingPaisa ? (
                    <p className="text-ink/50 text-xs">
                      MRP {formatPaisa(paisa(line.mrpAtReceivingPaisa))}
                    </p>
                  ) : null}
                </td>
                <td className="numeral px-3 py-2 text-right">
                  {formatPaisa(paisa(line.qtyBase * line.unitCostPaisa))}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="border-line bg-green-100/50 flex flex-col gap-1 rounded border p-4 text-sm">
        <div className="flex justify-between font-semibold">
          <span>Invoice total{correctedDeltaPaisa !== 0 ? ' as entered' : ''}</span>
          <span className="numeral">
            {formatPaisa(paisa(totalCostPaisa), { withSymbol: true })}
          </span>
        </div>
        {/* [PCN-009] The corrected figure sits beneath the entered one, so the
            paper invoice and the correction can both be checked against it. */}
        {correctedDeltaPaisa !== 0 ? (
          <div className="flex justify-between font-semibold">
            <span>Invoice total as corrected</span>
            <span className="numeral">
              {formatPaisa(paisa(totalCostPaisa + correctedDeltaPaisa), { withSymbol: true })}
            </span>
          </div>
        ) : null}
        {/* [PCN-007] Paid vs owed — shown only when the invoice was not settled
            in full, so an ordinary cash purchase reads exactly as before. */}
        {creditPaisa > 0 ? (
          <>
            <div className="text-ink/70 flex justify-between">
              <span>Paid now</span>
              <span className="numeral">
                {formatPaisa(paisa(purchase.cashPaidPaisa), { withSymbol: true })}
              </span>
            </div>
            <div className="text-amber flex justify-between font-medium">
              <span>
                On credit{purchase.supplierName ? ` — owed to ${purchase.supplierName}` : ''}
              </span>
              <span className="numeral">
                {formatPaisa(paisa(creditPaisa), { withSymbol: true })}
              </span>
            </div>
          </>
        ) : null}
        {accountPaisa !== null && purchase.supplierId ? (
          <p className="text-ink/70 border-line mt-1 flex flex-wrap justify-between gap-x-3 border-t pt-2">
            <span>
              {purchase.supplierName} account today:{' '}
              <span className={accountPaisa > 0 ? 'text-amber font-medium' : 'font-medium'}>
                {accountPaisa > 0
                  ? `you owe ${formatPaisa(paisa(accountPaisa), { withSymbol: true })}`
                  : accountPaisa < 0
                    ? `they hold ${formatPaisa(paisa(-accountPaisa), { withSymbol: true })} credit for you`
                    : 'settled'}
              </span>
            </span>
            <Link
              href={`/purchases/suppliers/${purchase.supplierId}`}
              className="text-green-600 hover:underline"
            >
              Payments and account →
            </Link>
          </p>
        ) : null}
        {purchase.creditTracked ? null : (
          <p className="text-ink/60 text-xs">
            Payment not recorded — this invoice was entered before Mehvar tracked supplier credit,
            so it is not counted in what is owed to suppliers.
          </p>
        )}
        {bonusBase > 0 ? (
          <p className="text-ink/60 text-xs">
            Includes bonus stock received free — it lowers the effective cost per unit without
            changing what was paid.
          </p>
        ) : null}
      </div>

      {corrections.length > 0 || returns.length > 0 ? (
        <div className="border-line rounded border p-4 text-sm">
          <h2 className="text-green-900 mb-2 font-medium">Corrections and returns</h2>
          <ul className="divide-line divide-y">
            {corrections.map((row) => (
              <li key={row.id} className="flex flex-wrap gap-x-3 py-1.5">
                <span className="font-medium">{row.productName}</span>
                <span className="text-ink/70">
                  {[
                    row.qtyDeltaBase !== 0
                      ? `quantity ${row.qtyDeltaBase > 0 ? '+' : ''}${row.qtyDeltaBase}`
                      : null,
                    row.bonusDeltaBase !== 0
                      ? `bonus ${row.bonusDeltaBase > 0 ? '+' : ''}${row.bonusDeltaBase}`
                      : null,
                    row.correctedUnitCostPaisa !== null
                      ? `cost now ${formatPaisa(paisa(row.correctedUnitCostPaisa))}`
                      : null,
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </span>
                <span className="text-ink/50">“{row.note}”</span>
                <span className="text-ink/40 ml-auto text-xs">
                  {row.byName} · {row.createdAt.toLocaleDateString('en-PK')}
                </span>
              </li>
            ))}
            {returns.map((row) => (
              <li key={row.id} className="flex flex-wrap gap-x-3 py-1.5">
                <span className="font-medium">{row.productName}</span>
                <span className="text-ink/70">
                  {row.qtyBase} {row.baseUnitName} returned to {row.supplierName}, credit{' '}
                  {formatPaisa(paisa(row.creditPaisa))}
                </span>
                {row.note ? <span className="text-ink/50">“{row.note}”</span> : null}
                <span className="text-ink/40 ml-auto text-xs">
                  {row.byName} · {row.createdAt.toLocaleDateString('en-PK')}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {/* The one control on this review page that changes something, and it
          says so and goes elsewhere to do it (Day 9). Owner-only. */}
      {session.userRole === 'owner' ? (
        <Link
          href={`/purchases/${purchaseId}/correct`}
          className="text-green-700 self-start text-sm hover:underline"
        >
          Correct this invoice or return goods to the supplier →
        </Link>
      ) : null}
    </section>
  );
}
