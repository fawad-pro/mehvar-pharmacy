import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';

import { currentSession, scopeFor } from '@/auth/session';
import { findSupplier, supplierBalance, supplierLedger } from '@/db/supplier-queries';
import { paisa } from '@/lib/branded';
import { formatPaisa } from '@/lib/money';
import { describeCounted } from '@/lib/quantity';
import { supplierReturnStockCosts } from '@/db/batch-cost-queries';
import { creditAgainstStockCost } from '@/domain/suppliers/supplier-return';
import type { Uuid } from '@/lib/uuid';

import { CancelEntryButton } from '@/components/cancel-entry-button';
import { ContactCorrections } from '@/components/contact-corrections';

import {
  cancelSupplierPaymentAction,
  editSupplierAction,
  removeSupplierAction,
  restoreSupplierAction,
} from '../actions';
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

  const [balancePaisa, ledger, stockCosts] = await Promise.all([
    supplierBalance(scope, supplierId as Uuid),
    supplierLedger(scope, supplierId as Uuid),
    supplierReturnStockCosts(scope),
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
      <Link href="/purchases/suppliers" className="text-blue-600 text-sm">
        ← Suppliers
      </Link>

      <header>
        <p className="text-ink-2 text-xs tracking-[0.14em] uppercase">Supplier account</p>
        <h1 className="text-navy text-2xl font-semibold">{supplier.name}</h1>
        {supplier.phone ? <p className="text-ink-2 text-sm">{supplier.phone}</p> : null}
      </header>

      <ContactCorrections
        kind="supplier"
        name={supplier.name}
        phone={supplier.phone}
        isActive={supplier.isActive}
        canRemove={session.userRole === 'owner'}
        save={editSupplierAction.bind(null, supplier.id as Uuid)}
        remove={removeSupplierAction.bind(null, supplier.id as Uuid)}
        restore={restoreSupplierAction.bind(null, supplier.id as Uuid)}
      />

      <div className="bg-surface shadow-card flex flex-col gap-3 rounded-card p-4">
        <SupplierPosition name={supplier.name} balancePaisa={balancePaisa} />
        {balancePaisa > 0 ? (
          <SupplierPayRow
            row={{ id: supplier.id, name: supplier.name, phone: null, balancePaisa }}
          />
        ) : null}
      </div>

      {rows.length === 0 ? (
        <p className="text-ink-2 p-8 text-center text-sm">
          No invoices or payments recorded with this supplier yet.
        </p>
      ) : (
        <div className="bg-surface shadow-card overflow-x-auto rounded-card">
          <table className="text-table w-full text-left text-sm">
            <thead className="bg-mist text-ink-2 text-xs">
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
                  <td className="text-ink-2 px-3 py-2 whitespace-nowrap">
                    {row.createdAt.toLocaleDateString('en-PK')}{' '}
                    <span className="text-ink-2 text-xs">
                      {row.createdAt.toLocaleTimeString('en-PK', {
                        hour: 'numeric',
                        minute: '2-digit',
                      })}
                    </span>
                  </td>
                  <td className="px-3 py-2">
                    <LedgerWhat
                      row={row}
                      stockCostPaisa={stockCosts.get(row.id)}
                      isOwner={session.userRole === 'owner'}
                    />
                  </td>
                  <td className="text-ink-2 px-3 py-2">{row.byName}</td>
                  <td
                    className={`numeral px-3 py-2 text-right ${row.amountPaisa > 0 ? 'text-amber-text' : 'text-navy'}`}
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
      <p className="text-ink-2 text-xs">
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
        <span className="text-ink-2">You owe {name}</span>
        <span className="text-amber-text numeral text-2xl font-semibold">
          {formatPaisa(paisa(balancePaisa), { withSymbol: true })}
        </span>
      </p>
    );
  }
  if (balancePaisa < 0) {
    return (
      <p className="flex flex-wrap items-baseline gap-x-3">
        <span className="text-ink-2">{name} holds credit for you</span>
        <span className="numeral text-2xl font-semibold">
          {formatPaisa(paisa(-balancePaisa), { withSymbol: true })}
        </span>
      </p>
    );
  }
  return <p className="text-green-700 text-lg font-medium">Settled — nothing owed</p>;
}

function RunningPosition({ balancePaisa }: { balancePaisa: number }) {
  if (balancePaisa > 0) {
    return <span className="text-amber-text">owe {formatPaisa(paisa(balancePaisa))}</span>;
  }
  if (balancePaisa < 0) {
    return <span>credit {formatPaisa(paisa(-balancePaisa))}</span>;
  }
  return <span className="text-green-700">settled</span>;
}

function LedgerWhat({
  row,
  stockCostPaisa,
  isOwner,
}: {
  row: Awaited<ReturnType<typeof supplierLedger>>[number];
  /** [PCN-012] For a return: what it took out of its batch, at cost. */
  stockCostPaisa: number | undefined;
  /** [PCN-013] Only the owner may cancel a payment. */
  isOwner: boolean;
}) {
  switch (row.kind) {
    case 'invoice':
      return (
        <>
          <Link href={`/purchases/${row.id}`} className="text-blue-600 hover:underline">
            Invoice{row.invoiceRef ? ` ${row.invoiceRef}` : ''}
          </Link>
          <span className="text-ink-2 ml-1 text-xs">
            {formatPaisa(paisa(row.invoiceTotalPaisa), { withSymbol: true })}, paid{' '}
            {formatPaisa(paisa(row.paidNowPaisa), { withSymbol: true })} on receiving
          </span>
        </>
      );
    case 'correction':
      return (
        <>
          Correction to{' '}
          <Link href={`/purchases/${row.purchaseId}`} className="text-blue-600 hover:underline">
            invoice{row.invoiceRef ? ` ${row.invoiceRef}` : ''}
          </Link>
          <span className="text-ink-2 ml-1 text-xs">“{row.note}”</span>
        </>
      );
    case 'return':
      return (
        <>
          Returned {describeCounted(row)} {row.productName}
          {stockCostPaisa !== undefined ? (
            <span className="text-ink-2 ml-1 text-xs">
              stock cost {formatPaisa(paisa(stockCostPaisa))}
              {creditAgainstStockCost(-row.amountPaisa, stockCostPaisa)
                ? ` · credit ${creditAgainstStockCost(-row.amountPaisa, stockCostPaisa)}`
                : ''}
            </span>
          ) : null}
          {row.note ? <span className="text-ink-2 ml-1 text-xs">“{row.note}”</span> : null}
        </>
      );
    case 'payment':
      return (
        <span className="inline-flex flex-wrap items-center gap-x-2">
          Payment
          {row.note ? <span className="text-ink-2 text-xs">“{row.note}”</span> : null}
          {row.reversed ? (
            <span className="text-ink-2 text-xs">— cancelled</span>
          ) : isOwner ? (
            <CancelEntryButton
              what={`the ${formatPaisa(paisa(-row.amountPaisa), { withSymbol: true })} payment`}
              run={cancelSupplierPaymentAction.bind(null, row.id as Uuid)}
            />
          ) : null}
        </span>
      );
    case 'payment_reversal':
      return (
        <>
          Payment cancelled
          {row.reversesPaidAt ? (
            <span className="text-ink-2 ml-1 text-xs">
              the one of {row.reversesPaidAt.toLocaleDateString('en-PK')}{' '}
              {row.reversesPaidAt.toLocaleTimeString('en-PK', {
                hour: 'numeric',
                minute: '2-digit',
              })}
            </span>
          ) : null}
        </>
      );
  }
}
