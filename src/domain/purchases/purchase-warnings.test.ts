/**
 * The warnings Receive Stock shows on a line — never blocks (T1). PCN-016
 * adds "Expires soon" for stock arriving inside W12's widest horizon.
 */

import { describe, expect, it } from 'vitest';

import {
  EXPIRES_SOON_DAYS,
  purchaseWarnings,
  type PurchaseCommand,
  type PurchaseLineCommand,
} from './purchase-command';
import { uuidv7 } from '@/lib/uuid';

function withExpiry(expiryDate: string | null): PurchaseCommand {
  const line: PurchaseLineCommand = {
    lineId: uuidv7(),
    productId: uuidv7(),
    qtyBase: 10,
    bonusQtyBase: 0,
    unitCostPaisa: 300,
    expiryDate,
    batchNumber: null,
    mrpAtReceivingPaisa: null,
    priceAtReceivingPaisa: 350,
  };
  return {
    purchaseId: uuidv7(),
    supplierId: null,
    invoiceRef: null,
    invoiceDate: null,
    note: null,
    lines: [line],
  };
}

const TODAY = '2026-10-29';
const kinds = (expiry: string | null) =>
  purchaseWarnings(withExpiry(expiry), TODAY).map((warning) => warning.kind);

describe('purchaseWarnings — expiry', () => {
  it('says "expires soon" up to and including the horizon, and not after', () => {
    expect(EXPIRES_SOON_DAYS).toBe(90);
    expect(kinds('2026-10-29')).toEqual(['expiry_soon']);
    expect(kinds('2027-01-27')).toEqual(['expiry_soon']); // day 90
    expect(kinds('2027-01-28')).toEqual([]); // day 91
  });

  it('keeps expired and missing as their own, stronger words', () => {
    expect(kinds('2026-10-28')).toEqual(['expiry_in_past']);
    expect(kinds(null)).toEqual(['expiry_missing']);
  });
});
