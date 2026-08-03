'use client';

/**
 * Record a payment from the customer's own page — W3, reached from where the
 * debt is actually being looked at.
 *
 * F8 already opens Settle Udhaar globally, but from here it would ask which
 * customer while their name and balance fill the screen. Same overlay, same
 * writer, same receipt — only the question that has already been answered is
 * skipped.
 */

import { useState } from 'react';
import { useRouter } from 'next/navigation';

import { SettleUdhaarOverlay } from '@/components/settle-udhaar-overlay';

export function SettleButton({
  customerId,
  name,
  phone,
  balancePaisa,
}: {
  customerId: string;
  name: string;
  phone: string | null;
  balancePaisa: number;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setOpen(true);
        }}
        className="bg-green-600 text-paper min-h-touch rounded px-5 font-medium"
      >
        Record a payment
      </button>

      {open ? (
        <SettleUdhaarOverlay
          initialCustomer={{ id: customerId, name, phone, balancePaisa }}
          onClose={() => {
            setOpen(false);
            // The ledger and the balance above it are server-rendered, and a
            // settlement just changed both.
            router.refresh();
          }}
        />
      ) : null}
    </>
  );
}
