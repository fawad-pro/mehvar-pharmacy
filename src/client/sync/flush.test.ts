/**
 * The flush decisions — the part of the sync layer that can be wrong in a way
 * that costs money or tells the owner something untrue.
 *
 * Phase 11 §3: "no unit-test theater around framework glue." IndexedDB and
 * `fetch` are the glue and are proven in the E2E disruption spec; these four
 * functions are the judgement.
 */

import { describe, expect, it } from 'vitest';

import {
  backoffMs,
  failuresAfterAnswer,
  originFor,
  readyToFlush,
  retryRead,
  withReceiptNumber,
} from './flush';
import type { OutboxRecord } from './records';

describe('originFor', () => {
  it('calls a record captured and delivered with the network there an online sale', () => {
    // After Day 5 every sale is captured locally first, so this is the common
    // case. Labelling it `offline_sync` would make the column meaningless.
    expect(originFor({ capturedOffline: false, attempts: 0 })).toBe('online');
  });

  it('calls a record captured while cut off an offline sale', () => {
    expect(originFor({ capturedOffline: true, attempts: 0 })).toBe('offline_sync');
  });

  it('calls a record that failed to deliver an offline sale, even if it looked online', () => {
    // `navigator.onLine` lies through a captive portal or a dead upstream. A
    // failed attempt is harder evidence than the flag.
    expect(originFor({ capturedOffline: false, attempts: 1 })).toBe('offline_sync');
  });
});

describe('failuresAfterAnswer', () => {
  it('clears the count once something was delivered', () => {
    expect(failuresAfterAnswer(4, true)).toBe(0);
  });

  it('backs off when the server answered but nothing moved', () => {
    // The laptop whose database missed two migrations: every sale came back
    // `retry`, the count reset to zero on every answer, and the same three
    // records went out every 250ms. The delay must grow instead.
    let failures = 0;
    const delays: number[] = [];
    for (let attempt = 0; attempt < 6; attempt += 1) {
      failures = failuresAfterAnswer(failures, false);
      delays.push(backoffMs(failures));
    }
    expect(delays).toEqual([1_000, 2_000, 4_000, 8_000, 16_000, 30_000]);
  });
});

describe('retryRead', () => {
  it('returns what the read returned, retrying a transient failure', async () => {
    let calls = 0;
    const read = async (): Promise<string[]> => {
      calls += 1;
      if (calls < 3) throw new Error('AbortError: The transaction was aborted');
      return ['customer', 'sale'];
    };
    expect(await retryRead(read, 3, 0)).toEqual(['customer', 'sale']);
    expect(calls).toBe(3);
  });

  it('says it could not read — never "nothing queued" — when every attempt fails', async () => {
    // The pilot's offline test: the outbox read aborted, came back as [], and
    // the badge dropped to zero over two queued records.
    const read = async (): Promise<string[]> => {
      throw new Error('AbortError');
    };
    expect(await retryRead(read, 3, 0)).toBeNull();
  });
});

describe('backoffMs', () => {
  it('does not wait before the first attempt', () => {
    expect(backoffMs(0)).toBe(0);
  });

  it('doubles per consecutive failure', () => {
    expect(backoffMs(1)).toBe(1_000);
    expect(backoffMs(2)).toBe(2_000);
    expect(backoffMs(3)).toBe(4_000);
    expect(backoffMs(4)).toBe(8_000);
  });

  it('caps, so a broken server is never hammered', () => {
    expect(backoffMs(20)).toBe(30_000);
    expect(backoffMs(1_000)).toBe(30_000);
  });
});

describe('readyToFlush', () => {
  it('is false with nothing queued', () => {
    expect(readyToFlush(false, 0, null, 1_000)).toBe(false);
  });

  it('is true when nothing has been attempted yet', () => {
    expect(readyToFlush(true, 0, null, 1_000)).toBe(true);
  });

  it('waits out the backoff earned by consecutive failures', () => {
    // two failures → 2s.
    expect(readyToFlush(true, 2, 10_000, 11_000)).toBe(false);
    expect(readyToFlush(true, 2, 10_000, 12_000)).toBe(true);
  });

  it('goes immediately once the failure count is cleared, however long the outage was', () => {
    // What a reconnect does: the counter traded through a long outage and
    // earned the ceiling, but the network is back, so the queue drains now
    // rather than serving out a delay the outage earned.
    expect(readyToFlush(true, 40, 10_000, 11_000)).toBe(false);
    expect(readyToFlush(true, 0, 10_000, 11_000)).toBe(true);
  });
});

describe('withReceiptNumber', () => {
  const base = {
    id: 'id-1',
    tenantId: 'tenant-1',
    queuedAt: '2026-07-30T10:00:00.000Z',
    capturedOffline: false,
    attempts: 1,
  };

  it('re-mints a sale’s number without touching anything else', () => {
    const record = {
      ...base,
      kind: 'sale',
      payload: {
        saleId: 'id-1',
        receiptNumber: 'A-7',
        customerId: null,
        lines: [],
        invoiceDiscountPaisa: 0,
        cashPaisa: 0,
        creditPaisa: 0,
        changePaisa: 0,
        clientCommittedAt: '2026-07-30T10:00:00.000Z',
      },
    } as OutboxRecord;

    const renumbered = withReceiptNumber(record, 'A-9');

    expect(renumbered.kind).toBe('sale');
    if (renumbered.kind === 'sale') {
      expect(renumbered.payload.receiptNumber).toBe('A-9');
      expect(renumbered.payload.saleId).toBe('id-1');
      expect(renumbered.payload.clientCommittedAt).toBe('2026-07-30T10:00:00.000Z');
    }
  });

  it('re-mints a settlement’s number', () => {
    const record = {
      ...base,
      kind: 'settlement',
      payload: {
        paymentId: 'id-1',
        receiptNumber: 'A-7',
        customerId: 'customer-1',
        amountPaisa: 500,
        clientCommittedAt: '2026-07-30T10:00:00.000Z',
      },
    } as OutboxRecord;

    const renumbered = withReceiptNumber(record, 'A-9');
    if (renumbered.kind === 'settlement') {
      expect(renumbered.payload.receiptNumber).toBe('A-9');
      expect(renumbered.payload.amountPaisa).toBe(500);
    }
  });

  it('leaves a record that has no receipt number alone', () => {
    const record = {
      ...base,
      kind: 'quick_item',
      payload: { id: 'id-1', name: 'Shelf item', pricePaisa: 100, baseUnitName: 'item' },
    } as OutboxRecord;

    expect(withReceiptNumber(record, 'A-9')).toBe(record);
  });
});
