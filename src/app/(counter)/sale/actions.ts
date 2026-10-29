'use server';

/**
 * The Sale surface's server needs.
 *
 * After Day 5 there is no commit action here: a sale is captured into the
 * outbox and delivered by `sync/actions.ts`, because ADR-3 makes W1 and W2 work
 * through a disruption and Phase 7 rule 3 forbids the receipt waiting on a
 * server. What the surface still needs from the server is the context it cannot
 * derive locally — where this device's receipt counter should resume, and the
 * tenant's own receipt header and footer.
 *
 * Every export in a `'use server'` file is a callable endpoint, so the commit
 * action the queue replaced was deleted rather than left behind.
 */

import { approveAsOwner } from '@/auth/owner-approval';
import { currentSession, scopeFor } from '@/auth/session';
import { highestReceiptCounterAcrossReceipts } from '@/db/udhaar-queries';
import { tenantSettings } from '@/db/provisioning';
import { DEFAULT_BILL_DISCOUNT_CAP_PERCENT } from '@/domain/sales/cart';

export interface SaleContext {
  receiptPrefix: string;
  highestReceiptCounter: number;
  tenantHeaderLines: string[];
  tenantFooterLine: string;
  salesmanName: string;
  /** Whether a committed sale prints without being asked (Settings). */
  autoPrintReceipt: boolean;
  /** PCN-012: a product's first line starts in its loose unit (Settings). */
  saleStartsLoose: boolean;
  /** Whether this shop sells on udhaar (Settings). */
  udhaarEnabled: boolean;
  /** PCN-014: all discounts together, as a % of the bill, before the owner's PIN. */
  billDiscountCapPercent: number;
}

/**
 * Everything the client needs once, before the first sale: where the device's
 * receipt counter should resume (PCN-002: shared with settlements), and the
 * tenant's own receipt header/footer for printing (Phase 10 §7).
 */
export async function saleContext(): Promise<SaleContext | null> {
  const session = await currentSession();
  if (!session?.receiptPrefix) {
    return null;
  }

  const [highest, settings] = await Promise.all([
    highestReceiptCounterAcrossReceipts(scopeFor(session), session.receiptPrefix),
    tenantSettings(session.tenantId),
  ]);

  return {
    receiptPrefix: session.receiptPrefix,
    highestReceiptCounter: highest,
    tenantHeaderLines: (settings?.receiptHeader ?? session.tenantName).split('\n'),
    tenantFooterLine: settings?.receiptFooter ?? '',
    salesmanName: session.userName,
    // Absent means on: an existing tenant keeps the behaviour it had.
    autoPrintReceipt: settings?.autoPrintReceipt ?? true,
    saleStartsLoose: settings?.saleStartsLoose ?? false,
    udhaarEnabled: settings?.udhaarEnabled ?? true,
    billDiscountCapPercent: settings?.billDiscountCapPercent ?? DEFAULT_BILL_DISCOUNT_CAP_PERCENT,
  };
}

export type BillDiscountApproval =
  { ok: true; ownerId: string; ownerName: string } | { ok: false; message: string };

/**
 * [PCN-014] The owner's PIN for a bill discount over the shop's limit. The
 * signed-in salesperson stays signed in; the sale records the owner who
 * approved. Needs the server — a thrown fetch on the counter means offline.
 */
export async function approveBillDiscountAction(pin: string): Promise<BillDiscountApproval> {
  const session = await currentSession();
  if (!session) {
    return { ok: false, message: 'This device needs to sign in again.' };
  }
  const result = await approveAsOwner(scopeFor(session), pin);
  if (result.ok) {
    return { ok: true, ownerId: result.ownerId, ownerName: result.ownerName };
  }
  return {
    ok: false,
    message:
      result.reason === 'locked_out'
        ? `Too many wrong PINs. Try again in ${Math.ceil(result.retryAfterMs / 60_000)} minute(s).`
        : 'That is not the owner’s PIN.',
  };
}
