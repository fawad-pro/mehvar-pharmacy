import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';

import { currentSession, scopeFor } from '@/auth/session';
import { findSupplier, supplierBalance, supplierLedger } from '@/db/supplier-queries';
import { paisa } from '@/lib/branded';
import { formatPaisa } from '@/lib/money';
import type { Uuid } from '@/lib/uuid';

import { SupplierPayRow } from './pay-row';

/**
 * A supplier's account — T4, the payable mirror of a customer's ledger.
 *
 * "Owed to suppliers" showed one number per distributor and took payments
 * against it, but nothing showed the payments: pay the last Rs 500 of an
 * invoice and the balance dropped with no record anywhere of when, how much,
 * or who. Here the balance expands into every invoice, correction, return and
 * payment that produced it, and the running total ends on the figure above.
 */
export default async function SupplierAccountPage({
  params,
}: {
  params: Promise<{ supplierId: string }>;
}) {
  const session = await currentSession();
  if (!session) {
    redirect('/login');
  }

  const { supplierId } = await params;
  const scope = scopeFor(session);
  const supplier = await findSupplier(scope, supplierId as Uuid);
  if (!supplier) {
    notFound();
  }

  const [balancePaisa, ledger] = await Promise.all([
    supplierBalance(scope, supplierId as Uuid),
    supplierLedger(scope, supplierId as Uuid),
  ]);

  const rows = ledger.reduce<Array<(typeof ledger)[number] & { runningPaisa: number }>>(
    (accumulated, row) => {
      const previous = accumulated[accumulated.length - 1]?.runningPaisa ?? 0;
      return [...accumulated, { ...row, runningPaisa: previous + row.amountPaisa }];
    },
    [],
  );

  return (
    <section className="mx-auto flex max-w-4xl flex-col gap-4 p-4">
      <Link href="/purchases" className="text-green-600 text-sm">
        ← Purchases
      </Link>

      <header>
        <p className="text-ink/50 text-xs tracking-[0.14em] uppercase">Supplier account</p>
        <h1 className="text-green-900 text-2xl font-semibold">{supplier.name}</h1>
      </header>

      <div className="border-line bg-green-100/50 flex flex-col gap-3 rounded border p-4">
        <SupplierPosition name={supplier.name} balancePaisa={balancePaisa} />
        {balancePaisa > 0 ? (
          <SupplierPayRow
            row={{ id: supplier.id, name: supplier.name, phone: null, balancePaisa }}
          />
        ) : null}
      </div>

      {rows.length === 0 ? (
        <p className="text-ink/50 p-8 text-center text-sm">
          No invoices or payments recorded with this supplier yet.
        </p>
      ) : (
        <div className="border-line overflow-x-auto rounded border">
          <table className="text-table w-full text-left text-sm">
            <thead className="bg-green-100/50 text-ink/60 text-xs">
              <tr>
                <th className="px-3 py-2 font-medium">Date</th>
                <th className="px-3 py-2 font-medium">What</th>
                <th className="px-3 py-2 font-medium">By</th>
                <th className="px-3 py-2 text-right font-medium">Amount</th>
                <th className="px-3 py-2 text-right font-medium">Balance</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id} className="border-line border-t align-top">
                  {/* The time too: "when was the rest paid?" is the question this
                      page exists to answer, and two payments can share a day. */}
                  <td className="text-ink/70 px-3 py-2 whitespace-nowrap">
                    {row.createdAt.toLocaleDateString('en-PK')}{' '}
                    <span className="text-ink/40 text-xs">
                      {row.createdAt.toLocaleTimeString('en-PK', {
                        hour: 'numeric',
                        minute: '2-digit',
                      })}
                    </span>
                  </td>
                  <td className="px-3 py-2">
                    <LedgerWhat row={row} />
                  </td>
                  <td className="text-ink/70 px-3 py-2">{row.byName}</td>
                  <td
                    className={`numeral px-3 py-2 text-right ${row.amountPaisa > 0 ? 'text-amber' : 'text-green-900'}`}
                  >
                    {row.amountPaisa === 0 ? '—' : row.amountPaisa > 0 ? '+' : '−'}
                    {row.amountPaisa === 0 ? null : formatPaisa(paisa(Math.abs(row.amountPaisa)))}
                  </td>
                  <td className="numeral px-3 py-2 text-right font-medium">
                    <RunningPosition balancePaisa={row.runningPaisa} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="text-ink/60 text-xs">
        + adds to what you owe; − is paid, returned or credited. Invoices entered before Mehvar
        tracked supplier credit are not part of this account.
      </p>
    </section>
  );
}

/** Direction in words, amount always positive (PCN-011's vocabulary). */
function SupplierPosition({ name, balancePaisa }: { name: string; balancePaisa: number }) {
  if (balancePaisa > 0) {
    return (
      <p className="flex flex-wrap items-baseline gap-x-3">
        <span className="text-ink/70">You owe {name}</span>
        <span className="text-amber numeral text-2xl font-semibold">
          {formatPaisa(paisa(balancePaisa), { withSymbol: true })}
        </span>
      </p>
    );
  }
  if (balancePaisa < 0) {
    return (
      <p className="flex flex-wrap items-baseline gap-x-3">
        <span className="text-ink/70">{name} holds credit for you</span>
        <span className="numeral text-2xl font-semibold">
          {formatPaisa(paisa(-balancePaisa), { withSymbol: true })}
        </span>
      </p>
    );
  }
  return <p className="text-green-900 text-lg font-medium">Settled — nothing owed</p>;
}

function RunningPosition({ balancePaisa }: { balancePaisa: number }) {
  if (balancePaisa > 0) {
    return <span className="text-amber">owe {formatPaisa(paisa(balancePaisa))}</span>;
  }
  if (balancePaisa < 0) {
    return <span>credit {formatPaisa(paisa(-balancePaisa))}</span>;
  }
  return <span className="text-green-900">settled</span>;
}

function LedgerWhat({ row }: { row: Awaited<ReturnType<typeof supplierLedger>>[number] }) {
  switch (row.kind) {
    case 'invoice':
      return (
        <>
          <Link href={`/purchases/${row.id}`} className="text-green-700 hover:underline">
            Invoice{row.invoiceRef ? ` ${row.invoiceRef}` : ''}
          </Link>
          <span className="text-ink/50 ml-1 text-xs">
            {formatPaisa(paisa(row.invoiceTotalPaisa), { withSymbol: true })}, paid{' '}
            {formatPaisa(paisa(row.paidNowPaisa), { withSymbol: true })} on receiving
          </span>
        </>
      );
    case 'correction':
      return (
        <>
          Correction to{' '}
          <Link href={`/purchases/${row.purchaseId}`} className="text-green-700 hover:underline">
            invoice{row.invoiceRef ? ` ${row.invoiceRef}` : ''}
          </Link>
          <span className="text-ink/50 ml-1 text-xs">“{row.note}”</span>
        </>
      );
    case 'return':
      return (
        <>
          Returned {row.qtyBase} {row.baseUnitName} {row.productName}
          {row.note ? <span className="text-ink/50 ml-1 text-xs">“{row.note}”</span> : null}
        </>
      );
    case 'payment':
      return (
        <>
          Payment
          {row.note ? <span className="text-ink/50 ml-1 text-xs">“{row.note}”</span> : null}
        </>
      );
  }
}
