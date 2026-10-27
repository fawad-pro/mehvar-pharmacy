'use client';

/**
 * The one place on a receipt where something can change.
 *
 * Reviewing and acting are separated everywhere in this product now, and this
 * component is where the boundary is drawn on a receipt: everything else on
 * the page shows, this offers to do. So the return action is a link that says
 * "Start a return" and navigates to the returns workflow — it does not open an
 * inline form, and nothing here mutates. A pharmacist who came to check what a
 * customer bought cannot accidentally begin refunding them.
 *
 * Only sales get it. A payment has nothing to return, and a return is already
 * the record of one.
 */

import Link from 'next/link';

type ReceiptKind = 'sale' | 'settlement' | 'payment_cancelled' | 'return';

export function ReceiptActions({
  kind,
  receiptNumber,
  saleId,
}: {
  kind: ReceiptKind;
  receiptNumber: string;
  saleId: string | null;
}) {
  if (kind !== 'sale' || !saleId) {
    return null;
  }

  return (
    <Link
      href={`/returns?receipt=${encodeURIComponent(receiptNumber)}`}
      className="border-line min-h-touch text-ink hover:bg-green-100/50 inline-flex items-center rounded border px-4 font-medium"
    >
      Start a return
    </Link>
  );
}
