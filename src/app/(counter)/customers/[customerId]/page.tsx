import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';

import { currentSession, scopeFor } from '@/auth/session';
import { BalanceFigure, BalanceInline } from '@/components/balance-figure';
import { customerBalance, customerLedger, findCustomer } from '@/db/udhaar-queries';
import { paisa } from '@/lib/branded';
import { formatPaisa } from '@/lib/money';

import { ContactCorrections } from '@/components/contact-corrections';

import { editCustomerAction, removeCustomerAction, restoreCustomerAction } from '../actions';
import { CancelPayment } from './cancel-payment';
import { SettleButton } from './settle-button';

/**
 * A customer's ledger — T4: "any derived figure can be expanded into the
 * transactions that produced it. Udhaar disputes end by showing the screen."
 *
 * The balance at the top and the running total in the table are the same
 * derivation (Phase 5 invariant 3) read two ways: once as a single number,
 * once walked transaction by transaction so a dispute has somewhere to land.
 */
export default async function CustomerDetailPage({
  params,
}: {
  params: Promise<{ customerId: string }>;
}) {
  const session = await currentSession();
  if (!session) {
    redirect('/login');
  }

  const { customerId } = await params;
  const scope = scopeFor(session);
  const customer = await findCustomer(scope, customerId);
  if (!customer) {
    notFound();
  }

  const [balancePaisa, ledger] = await Promise.all([
    customerBalance(scope, customerId),
    customerLedger(scope, customerId),
  ]);

  const rows = ledger.reduce<Array<(typeof ledger)[number] & { runningPaisa: number }>>(
    (accumulated, row) => {
      const previous = accumulated[accumulated.length - 1]?.runningPaisa ?? 0;
      return [...accumulated, { ...row, runningPaisa: previous + row.amountPaisa }];
    },
    [],
  );

  return (
    <section className="mx-auto flex max-w-3xl flex-col gap-4 p-4">
      <Link href="/customers" className="text-blue-600 text-sm">
        ← Customers
      </Link>

      <header>
        <h1 className="text-navy text-2xl font-semibold">{customer.name}</h1>
        {customer.phone ? <p className="text-ink-2 text-sm">{customer.phone}</p> : null}
      </header>

      {/* [PCN-013] A removed customer's balance is still settled here: removal
          is refused while one is owed, but a sale captured offline can arrive
          after it. */}
      <ContactCorrections
        kind="customer"
        name={customer.name}
        phone={customer.phone}
        isActive={customer.isActive}
        canRemove={session.userRole === 'owner'}
        save={editCustomerAction.bind(null, customer.id)}
        remove={removeCustomerAction.bind(null, customer.id)}
        restore={restoreCustomerAction.bind(null, customer.id)}
      />

      <div className="bg-surface shadow-card flex flex-wrap items-end justify-between gap-4 rounded-card p-4">
        {/* Never "-Rs 100". The direction is a word and the amount is positive
            — see domain/udhaar/position.ts. */}
        <BalanceFigure balancePaisa={balancePaisa} size="large" />
        {/* The udhaar loop closes here: the screen that shows the debt is the
            screen that takes the payment against it. */}
        <SettleButton
          customerId={customer.id}
          name={customer.name}
          phone={customer.phone}
          balancePaisa={balancePaisa}
        />
      </div>

      {rows.length === 0 ? (
        <p className="text-ink-2 p-8 text-center text-sm">No transactions yet.</p>
      ) : (
        <div className="bg-surface shadow-card overflow-x-auto rounded-card">
          <table className="text-table w-full text-left">
            <thead className="bg-mist text-ink-2 text-xs">
              <tr>
                <th className="px-3 py-2 font-medium">Date</th>
                <th className="px-3 py-2 font-medium">Receipt</th>
                <th className="px-3 py-2 font-medium">Kind</th>
                <th className="px-3 py-2 text-right font-medium">Amount</th>
                <th className="px-3 py-2 text-right font-medium">Running</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id} className="border-line border-t">
                  <td className="text-ink-2 px-3 py-2">
                    {row.createdAt.toLocaleDateString('en-PK')}
                  </td>
                  {/* T4 again, one level deeper: the balance expands into these
                      rows, and each row now expands into the receipt that
                      produced it. An udhaar dispute can be walked all the way
                      down to the items on the slip without leaving the screen
                      the customer is standing at. */}
                  <td className="px-3 py-2">
                    <Link
                      href={`/receipts/${encodeURIComponent(row.receiptNumber)}`}
                      className="numeral text-blue-600 hover:underline"
                    >
                      {row.receiptNumber}
                    </Link>
                  </td>
                  <td className="px-3 py-2">
                    {row.kind === 'sale' ? 'Udhaar sale' : null}
                    {row.kind === 'payment' ? (
                      <span className="inline-flex flex-wrap items-center gap-x-2">
                        Payment
                        {row.reversed ? (
                          <span className="text-ink-2 text-xs">— cancelled</span>
                        ) : null}
                        {session.userRole === 'owner' ? (
                          <CancelPayment
                            key={row.id}
                            paymentId={row.id}
                            amountPaisa={-row.amountPaisa}
                            customerName={customer.name}
                            reversed={row.reversed === true}
                          />
                        ) : null}
                      </span>
                    ) : null}
                    {row.kind === 'payment_reversal' ? (
                      <>
                        Payment cancelled
                        <span className="text-ink-2 ml-1 text-xs">
                          receipt{' '}
                          <Link
                            href={`/receipts/${encodeURIComponent(row.againstReceiptNumber ?? '')}`}
                            className="text-blue-600 hover:underline"
                          >
                            {row.againstReceiptNumber}
                          </Link>
                        </span>
                      </>
                    ) : null}
                    {row.kind === 'return' ? (
                      <>
                        Return
                        <span className="text-ink-2 ml-1 text-xs">
                          against{' '}
                          <Link
                            href={`/receipts/${encodeURIComponent(row.againstReceiptNumber ?? '')}`}
                            className="text-blue-600 hover:underline"
                          >
                            {row.againstReceiptNumber}
                          </Link>
                        </span>
                      </>
                    ) : null}
                  </td>
                  <td
                    className={`numeral px-3 py-2 ${row.amountPaisa > 0 ? 'text-amber-text' : 'text-navy'}`}
                  >
                    {row.amountPaisa > 0 ? '+' : '−'}
                    {formatPaisa(paisa(Math.abs(row.amountPaisa)))}
                  </td>
                  {/* The running balance is a position, so it speaks the same
                      vocabulary as the figure above the table — otherwise the
                      last row and the headline disagree in wording while
                      agreeing in value, which is exactly what an udhaar
                      dispute cannot survive (T4). */}
                  <td className="px-3 py-2 font-medium">
                    <BalanceInline balancePaisa={row.runningPaisa} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
