'use client';

import { useRouter } from 'next/navigation';

import { SupplierCreditRow } from '../../supplier-credit-panel';

/**
 * The Purchases screen's Pay control, on the account it pays into — the screen
 * that shows the debt takes the payment against it, as a customer's does. The
 * account re-renders after, so the new payment appears in the table beneath.
 */
export function SupplierPayRow(props: {
  row: { id: string; name: string; phone: string | null; balancePaisa: number };
}) {
  const router = useRouter();
  return (
    <ul className="bg-surface shadow-card rounded-card text-sm">
      <SupplierCreditRow
        row={props.row}
        onAccountPage
        onSettled={() => {
          router.refresh();
        }}
      />
    </ul>
  );
}
