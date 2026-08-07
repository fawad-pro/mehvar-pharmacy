import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';

import { currentSession, scopeFor } from '@/auth/session';
import { findPurchase } from '@/db/purchase-queries';
import { baseQty, paisa } from '@/lib/branded';
import { formatPaisa } from '@/lib/money';
import { describeQuantity } from '@/lib/quantity';

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
  const purchase = await findPurchase(scopeFor(session), purchaseId);
  if (!purchase) {
    notFound();
  }

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
          <span>Invoice total</span>
          <span className="numeral">
            {formatPaisa(paisa(totalCostPaisa), { withSymbol: true })}
          </span>
        </div>
        {bonusBase > 0 ? (
          <p className="text-ink/60 text-xs">
            Includes bonus stock received free — it lowers the effective cost per unit without
            changing what was paid.
          </p>
        ) : null}
      </div>
    </section>
  );
}
