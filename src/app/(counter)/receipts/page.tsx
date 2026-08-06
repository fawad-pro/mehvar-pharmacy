import { redirect } from 'next/navigation';

import { currentSession, scopeFor } from '@/auth/session';
import { listReceipts } from '@/db/receipt-queries';

import { ReceiptsSurface } from './receipts-surface';

/**
 * Receipts — the place to look at what has already happened.
 *
 * The product now separates doing from reviewing, and this is the review side
 * for everything that produced a receipt number. It exists because there was
 * nowhere else: to see a completed sale you had to open Returns and search for
 * it, so checking what a customer bought looked and felt exactly like starting
 * to refund them. The Day screen's "See the sales" link pointed there too, and
 * dropped an owner reviewing the day straight into a refund workflow.
 *
 * Nothing on this surface or its detail pages changes anything. A return is
 * still started deliberately, from a button that says so.
 */
export default async function ReceiptsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const session = await currentSession();
  if (!session) {
    redirect('/login');
  }

  const { q } = await searchParams;
  const page = await listReceipts(scopeFor(session), { search: q ?? '' });

  return (
    <ReceiptsSurface
      search={q ?? ''}
      hasMore={page.hasMore}
      rows={page.items.map((row) => ({
        receiptNumber: row.receiptNumber,
        kind: row.kind,
        customerName: row.customerName,
        salesmanName: row.salesmanName,
        amountPaisa: row.amountPaisa,
        createdAt: row.createdAt,
        onCredit: row.onCredit,
        hasReturns: row.hasReturns,
      }))}
    />
  );
}
