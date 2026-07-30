import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';

import { currentSession, scopeFor } from '@/auth/session';
import { customerBalance, customerLedger, findCustomer } from '@/db/udhaar-queries';
import { paisa } from '@/lib/branded';
import { formatPaisa } from '@/lib/money';

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
      <Link href="/customers" className="text-green-600 text-sm">
        ← Customers
      </Link>

      <header>
        <h1 className="text-green-900 text-2xl font-semibold">{customer.name}</h1>
        {customer.phone ? <p className="text-ink/50 text-sm">{customer.phone}</p> : null}
      </header>

      <div className="border-line bg-green-100/50 rounded border p-4">
        <p className="text-ink/50 text-xs tracking-[0.14em] uppercase">Balance</p>
        <p
          className={`numeral text-total leading-none font-semibold ${balancePaisa > 0 ? 'text-amber' : 'text-green-900'}`}
        >
          {formatPaisa(paisa(balancePaisa), { withSymbol: true })}
        </p>
      </div>

      {rows.length === 0 ? (
        <p className="text-ink/50 p-8 text-center text-sm">No transactions yet.</p>
      ) : (
        <div className="border-line overflow-x-auto rounded border">
          <table className="text-table w-full text-left">
            <thead className="bg-green-100/50 text-ink/60 text-xs">
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
                  <td className="text-ink/70 px-3 py-2">
                    {row.createdAt.toLocaleDateString('en-PK')}
                  </td>
                  <td className="text-ink/70 px-3 py-2">{row.receiptNumber}</td>
                  <td className="px-3 py-2 capitalize">
                    {row.kind === 'sale' ? 'Udhaar sale' : 'Payment'}
                  </td>
                  <td
                    className={`numeral px-3 py-2 ${row.amountPaisa > 0 ? 'text-amber' : 'text-green-900'}`}
                  >
                    {row.amountPaisa > 0 ? '+' : '−'}
                    {formatPaisa(paisa(Math.abs(row.amountPaisa)))}
                  </td>
                  <td className="numeral px-3 py-2 font-medium">
                    {formatPaisa(paisa(row.runningPaisa))}
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
