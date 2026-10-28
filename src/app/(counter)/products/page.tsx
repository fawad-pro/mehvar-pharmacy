import Link from 'next/link';
import { redirect } from 'next/navigation';

import { currentSession, scopeFor } from '@/auth/session';
import { countNeedingCompletion, listProducts } from '@/db/catalog-queries';
import { formatForm } from '@/domain/catalog/form';
import { formatPackLevels } from '@/domain/catalog/product';
import { baseQty, paisa } from '@/lib/branded';
import { formatPaisa } from '@/lib/money';
import { describeQuantity } from '@/lib/quantity';

/**
 * The catalog list — Phase 10 §2 surface 5.
 *
 * Paginated in SQL rather than filtered in the browser. The counter's search is
 * the client index (ADR-4); this is the admin view, and an admin view that loads
 * 3,000 rows to render 50 is a page that works right up until the catalog is
 * real.
 */
export default async function ProductsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; page?: string; queue?: string; removed?: string }>;
}) {
  const session = await currentSession();
  if (!session) {
    redirect('/login');
  }

  const params = await searchParams;
  const scope = scopeFor(session);
  const onlyQueue = params.queue === '1';
  const showRemoved = params.removed === '1';

  const [page, queueCount] = await Promise.all([
    listProducts(scope, {
      search: params.q,
      needsCompletion: onlyQueue,
      includeInactive: showRemoved,
      page: Number(params.page ?? 1),
    }),
    countNeedingCompletion(scope),
  ]);

  return (
    <section className="mx-auto flex max-w-5xl flex-col gap-4 p-4">
      <header className="flex flex-wrap items-center gap-3">
        <h1 className="text-navy text-2xl font-semibold">Products</h1>
        <span className="text-ink-2 text-sm">{page.total.toLocaleString()} products you stock</span>
        <Link
          href="/products/new"
          className="bg-blue-600 text-surface hover:bg-blue-700 font-semibold min-h-touch ml-auto flex items-center rounded-control px-4"
        >
          Add product
        </Link>
      </header>

      <form className="flex flex-wrap items-center gap-2" action="/products">
        <input
          autoComplete="off"
          name="q"
          defaultValue={params.q ?? ''}
          placeholder="Search name, salt or maker — or scan"
          aria-label="Search the catalog"
          // Arriving here is to look something up: the cursor starts in it.
          autoFocus
          // A scan finds its product here (by barcode), including one that
          // landed with nothing in focus (the scan guard's home).
          data-scan-target=""
          data-scan-home=""
          className="border-border focus:border-blue-600 h-touch min-w-64 flex-1 rounded-control border px-3"
        />
        {onlyQueue ? <input type="hidden" name="queue" value="1" /> : null}
        {showRemoved ? <input type="hidden" name="removed" value="1" /> : null}
        <button type="submit" className="border-border min-h-touch rounded-control border px-4">
          Search
        </button>
        <Link
          href={removedToggleHref(params, !showRemoved)}
          className="text-blue-600 min-h-touch flex items-center px-2 text-sm"
        >
          {showRemoved ? 'Hide removed products' : 'Show removed products'}
        </Link>
      </form>

      {/* D3 — quick items cannot be silently forgotten; the queue nags until
          they are enriched (W6's guardrail). */}
      {queueCount > 0 ? (
        <Link
          href={onlyQueue ? '/products' : '/products?queue=1'}
          className="border-amber bg-amber-50 text-amber-text flex items-center gap-2 rounded border px-3 py-2 text-sm"
        >
          {onlyQueue
            ? `Showing ${queueCount} product${queueCount === 1 ? '' : 's'} that need completing — show all`
            : `${queueCount} product${queueCount === 1 ? '' : 's'} need completing`}
        </Link>
      ) : null}

      {page.items.length === 0 ? (
        <p className="text-ink-2 p-8 text-center text-sm">
          {params.q ? 'Nothing matched that search.' : 'No products yet. Add your first one.'}
        </p>
      ) : (
        <div className="bg-surface shadow-card overflow-x-auto rounded-card">
          <table className="text-table w-full text-left">
            <thead className="bg-mist text-ink-2 text-xs">
              <tr>
                <th className="px-3 py-2 font-medium">Name</th>
                <th className="px-3 py-2 font-medium">Salt</th>
                <th className="px-3 py-2 font-medium">Sold as</th>
                <th className="px-3 py-2 text-right font-medium">On hand</th>
                <th className="px-3 py-2 text-right font-medium">Price</th>
                <th className="px-3 py-2 text-right font-medium">Codes</th>
              </tr>
            </thead>
            <tbody>
              {page.items.map((item) => (
                <tr key={item.id} className="border-line border-t">
                  <td className="px-3 py-2">
                    <Link href={`/products/${item.id}`} className="text-navy font-medium">
                      {item.name}
                      {item.strength ? (
                        <span className="numeral text-ink-2 font-normal"> {item.strength}</span>
                      ) : null}
                    </Link>
                    {item.needsCompletion ? (
                      <span className="text-amber-text ml-2 text-xs">needs completing</span>
                    ) : null}
                    {!item.isActive ? (
                      <span className="text-ink-2 ml-2 text-xs">removed</span>
                    ) : null}
                    {/* Strength and form carried on their own line, always.
                        Two Panadols differing only in milligrams are the
                        commonest thing in a real catalogue, and a row where
                        that difference is buried in a subtitle is a row an
                        operator picks the wrong one from. */}
                    <span className="text-ink-2 block text-xs">
                      {[formatForm(item.form), item.manufacturer].filter(Boolean).join(' · ') ||
                        'No form or maker recorded'}
                    </span>
                  </td>
                  <td className="text-ink-2 px-3 py-2">{item.formulaText ?? '—'}</td>
                  <td className="text-ink-2 px-3 py-2">
                    {[item.baseUnitName, formatPackLevels(item.packLevels)]
                      .filter(Boolean)
                      .join(', ')}
                  </td>
                  {/* The most-asked question about a medicine, on the screen
                      where it is already being looked up. Never stocked reads
                      as "—", which is not the same as none left. */}
                  <td className="numeral px-3 py-2">
                    {item.stockBase === null ? (
                      <span className="text-ink-2">—</span>
                    ) : (
                      <span className={item.stockBase <= 0 ? 'text-amber-text' : ''}>
                        {describeQuantity(
                          baseQty(item.stockBase),
                          item.baseUnitName,
                          item.packLevels,
                        )}
                      </span>
                    )}
                  </td>
                  <td className="numeral px-3 py-2">
                    {formatPaisa(paisa(item.pricePaisa), { withSymbol: true })}
                    <span className="text-ink-2 block text-xs">per {item.baseUnitName}</span>
                  </td>
                  <td className="numeral text-ink-2 px-3 py-2">{item.barcodeCount || '—'}</td>
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
          <span className="text-ink-2">
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
  params: { q?: string; queue?: string; removed?: string };
  page: number;
  disabled: boolean;
  children: React.ReactNode;
}) {
  if (disabled) {
    return <span className="text-ink-2">{children}</span>;
  }
  const query = new URLSearchParams();
  if (params.q) query.set('q', params.q);
  if (params.queue) query.set('queue', params.queue);
  if (params.removed) query.set('removed', params.removed);
  query.set('page', String(page));

  return (
    <Link
      href={`/products?${query.toString()}`}
      className="text-blue-600 inline-flex min-h-touch min-w-touch items-center px-3"
    >
      {children}
    </Link>
  );
}

function removedToggleHref(params: { q?: string; queue?: string }, show: boolean): string {
  const query = new URLSearchParams();
  if (params.q) query.set('q', params.q);
  if (params.queue) query.set('queue', params.queue);
  if (show) query.set('removed', '1');
  const text = query.toString();
  return text ? `/products?${text}` : '/products';
}
