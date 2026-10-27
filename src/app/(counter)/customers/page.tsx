import Link from 'next/link';
import { redirect } from 'next/navigation';

import { currentSession, scopeFor } from '@/auth/session';
import { BalanceInline } from '@/components/balance-figure';
import { listCustomers } from '@/db/udhaar-queries';
import { paisa } from '@/lib/branded';
import { formatPaisa } from '@/lib/money';

/**
 * Customers — Phase 10 §2: "list with balances, largest first" (W11's phone
 * view shares this same ordering). Balances are derived (Phase 5 invariant 3),
 * never stored, so this page reads sales and payments fresh every time.
 */
export default async function CustomersPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; page?: string; removed?: string }>;
}) {
  const session = await currentSession();
  if (!session) {
    redirect('/login');
  }

  const params = await searchParams;
  const showRemoved = params.removed === '1';
  const page = await listCustomers(scopeFor(session), {
    search: params.q,
    includeRemoved: showRemoved,
    page: Number(params.page ?? 1),
  });

  return (
    <section className="mx-auto flex max-w-3xl flex-col gap-4 p-4">
      <header className="flex flex-wrap items-baseline gap-3">
        <h1 className="text-green-900 text-2xl font-semibold">Customers</h1>
        <span className="text-ink/50 text-sm">{page.total.toLocaleString()} on the book</span>
        {/* The owner's question on this screen is the same one Day & Reports
            answers with "Owed to you" — and the two now share `summariseBook`,
            which is what makes showing it in both places safe. They used to
            floor differently and label identically. */}
        {page.outstandingPaisa > 0 ? (
          <span className="text-amber numeral ml-auto text-sm font-medium">
            {formatPaisa(paisa(page.outstandingPaisa), { withSymbol: true })} owed in total
          </span>
        ) : null}
        {/* Advances are never netted against the debt above, so they are stated
            beside it rather than folded into it — and only when there are any. */}
        {page.advancesPaisa > 0 ? (
          <span className="text-ink/60 numeral text-sm">
            {formatPaisa(paisa(page.advancesPaisa), { withSymbol: true })} paid in advance
          </span>
        ) : null}
      </header>

      <form className="flex flex-wrap items-center gap-2" action="/customers">
        <input
          autoComplete="off"
          name="q"
          defaultValue={params.q ?? ''}
          placeholder="Search name or phone"
          aria-label="Search customers"
          className="border-line focus:border-green-600 h-touch min-w-64 flex-1 rounded border px-3 outline-none"
        />
        {showRemoved ? <input type="hidden" name="removed" value="1" /> : null}
        <button type="submit" className="border-line min-h-touch rounded border px-4">
          Search
        </button>
        <Link
          href={removedToggleHref(params, !showRemoved)}
          className="text-green-600 min-h-touch flex items-center px-2 text-sm"
        >
          {showRemoved ? 'Hide removed customers' : 'Show removed customers'}
        </Link>
      </form>

      {page.items.length === 0 ? (
        <p className="text-ink/50 p-8 text-center text-sm">
          {params.q
            ? 'Nothing matched that search.'
            : 'No customers yet. A customer is added the first time you put a sale on udhaar.'}
        </p>
      ) : (
        <div className="border-line overflow-x-auto rounded border">
          <table className="text-table w-full text-left">
            <thead className="bg-green-100/50 text-ink/60 text-xs">
              <tr>
                <th className="px-3 py-2 font-medium">Name</th>
                <th className="px-3 py-2 font-medium">Phone</th>
                <th className="px-3 py-2 text-right font-medium">Balance</th>
              </tr>
            </thead>
            <tbody>
              {page.items.map((item) => (
                <tr key={item.id} className="border-line border-t">
                  <td className="px-3 py-2">
                    <Link href={`/customers/${item.id}`} className="text-green-900 font-medium">
                      {item.name}
                    </Link>
                    {!item.isActive ? (
                      <span className="text-ink/40 ml-2 text-xs">removed</span>
                    ) : null}
                  </td>
                  <td className="text-ink/70 px-3 py-2">{item.phone ?? '—'}</td>
                  {/* The same vocabulary as the customer page and the
                      settlement slip — never a minus sign on a balance. */}
                  <td className="px-3 py-2 text-right font-medium">
                    <BalanceInline balancePaisa={item.balancePaisa} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {page.pageCount > 1 ? (
        <nav className="flex items-center justify-between text-sm" aria-label="Pagination">
          <PageLink params={params} page={page.page - 1} disabled={page.page <= 1}>
            Previous
          </PageLink>
          <span className="text-ink/50">
            Page {page.page} of {page.pageCount}
          </span>
          <PageLink params={params} page={page.page + 1} disabled={page.page >= page.pageCount}>
            Next
          </PageLink>
        </nav>
      ) : null}
    </section>
  );
}

function PageLink({
  params,
  page,
  disabled,
  children,
}: {
  params: { q?: string; removed?: string };
  page: number;
  disabled: boolean;
  children: React.ReactNode;
}) {
  if (disabled) {
    return <span className="text-ink/30">{children}</span>;
  }
  const query = new URLSearchParams();
  if (params.q) query.set('q', params.q);
  if (params.removed) query.set('removed', params.removed);
  query.set('page', String(page));

  return (
    <Link href={`/customers?${query.toString()}`} className="text-green-600">
      {children}
    </Link>
  );
}

function removedToggleHref(params: { q?: string }, show: boolean): string {
  const query = new URLSearchParams();
  if (params.q) query.set('q', params.q);
  if (show) query.set('removed', '1');
  const text = query.toString();
  return text ? `/customers?${text}` : '/customers';
}
