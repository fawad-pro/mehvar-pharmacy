import Link from 'next/link';
import { redirect } from 'next/navigation';

import { currentSession, scopeFor } from '@/auth/session';
import { listSuppliers } from '@/db/supplier-queries';
import { paisa } from '@/lib/branded';
import { formatPaisa } from '@/lib/money';

/**
 * [PCN-013] Every supplier, by name — the way to one with nothing owed.
 *
 * The Purchases panel lists only open balances (PCN-007, PCN-011), so a
 * supplier added by mistake, which owes and is owed nothing, had no page. The
 * balance column speaks as that panel does: owed, credit held, or nothing.
 */
export default async function SuppliersPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; removed?: string }>;
}) {
  const session = await currentSession();
  if (!session) {
    redirect('/login');
  }

  const params = await searchParams;
  const showRemoved = params.removed === '1';
  const rows = await listSuppliers(scopeFor(session), {
    search: params.q,
    includeRemoved: showRemoved,
  });

  const toggle = new URLSearchParams();
  if (params.q) toggle.set('q', params.q);
  if (!showRemoved) toggle.set('removed', '1');
  const toggleHref = toggle.toString() ? `/purchases/suppliers?${toggle}` : '/purchases/suppliers';

  return (
    <section className="mx-auto flex max-w-3xl flex-col gap-4 p-4">
      <Link href="/purchases" className="text-green-600 text-sm">
        ← Purchases
      </Link>
      <header className="flex flex-wrap items-baseline gap-3">
        <h1 className="text-green-900 text-2xl font-semibold">Suppliers</h1>
        <span className="text-ink/50 text-sm">{rows.length.toLocaleString()} listed</span>
      </header>

      <form className="flex flex-wrap items-center gap-2" action="/purchases/suppliers">
        <input
          autoComplete="off"
          name="q"
          defaultValue={params.q ?? ''}
          placeholder="Search name or phone"
          aria-label="Search suppliers"
          className="border-line focus:border-green-600 h-touch min-w-64 flex-1 rounded border px-3 outline-none"
        />
        {showRemoved ? <input type="hidden" name="removed" value="1" /> : null}
        <button type="submit" className="border-line min-h-touch rounded border px-4">
          Search
        </button>
        <Link
          href={toggleHref}
          className="text-green-600 min-h-touch flex items-center px-2 text-sm"
        >
          {showRemoved ? 'Hide removed suppliers' : 'Show removed suppliers'}
        </Link>
      </form>

      {rows.length === 0 ? (
        <p className="text-ink/50 p-8 text-center text-sm">
          {params.q
            ? 'Nothing matched that search.'
            : 'No suppliers yet. One is added when you pick it while receiving stock.'}
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
              {rows.map((row) => (
                <tr key={row.id} className="border-line border-t">
                  <td className="px-3 py-2">
                    <Link
                      href={`/purchases/suppliers/${row.id}`}
                      className="text-green-900 font-medium"
                    >
                      {row.name}
                    </Link>
                    {!row.isActive ? (
                      <span className="text-ink/40 ml-2 text-xs">removed</span>
                    ) : null}
                  </td>
                  <td className="text-ink/70 px-3 py-2">{row.phone ?? '—'}</td>
                  {/* Never a minus sign (PCN-011): the direction is a word. */}
                  <td className="numeral px-3 py-2 text-right">
                    {row.balancePaisa > 0 ? (
                      <span className="text-amber font-medium">
                        {formatPaisa(paisa(row.balancePaisa), { withSymbol: true })} owed
                      </span>
                    ) : row.balancePaisa < 0 ? (
                      <span>
                        {formatPaisa(paisa(-row.balancePaisa), { withSymbol: true })} credit held
                      </span>
                    ) : (
                      <span className="text-ink/40">Settled</span>
                    )}
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
