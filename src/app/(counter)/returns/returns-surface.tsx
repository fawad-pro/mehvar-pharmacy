'use client';

/**
 * Returns — W4.
 *
 *   "Path: returns key → find sale (scan receipt number, or search recent
 *    sales) → select lines/quantities → confirm → stock restores to source
 *    batch, cash-out recorded or credit reduced (compensating record, T2)."
 *
 * Two steps, in the order the workflow names them. The search box doubles as
 * a barcode-style scan target — a receipt number pasted or scanned narrows to
 * one result the same way a product barcode does in Sale.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type { FoundSale, ReturnableLineRow } from '@/domain/sales/return-command';
import { refundForLine } from '@/domain/sales/return-command';
import { useReceiptContext } from '@/client/receipt/receipt-context';
import { usePrintReceipt } from '@/client/print/use-print-receipt';
import { ReceiptView } from '@/components/receipt-view';
import { formatPaisa } from '@/lib/money';
import { paisa } from '@/lib/branded';
import { uuidv7 } from '@/lib/uuid';

import { commitReturnAction, findSaleForReturnAction, returnableLinesAction } from './actions';

type RefundMethod = 'cash' | 'credit';

interface LineDraft {
  qty: string;
  restockBatchId: string | null;
}

export function ReturnsSurface() {
  const receiptContext = useReceiptContext();
  const { receipt, print } = usePrintReceipt();

  const [query, setQuery] = useState('');
  const [results, setResults] = useState<FoundSale[]>([]);
  const [sale, setSale] = useState<FoundSale | null>(null);
  const [lines, setLines] = useState<ReturnableLineRow[]>([]);
  const [drafts, setDrafts] = useState<Record<string, LineDraft>>({});
  const [refundMethod, setRefundMethod] = useState<RefundMethod>('cash');
  const [reasonNote, setReasonNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const searchRef = useRef<HTMLInputElement | null>(null);

  const search = useCallback((term: string) => {
    void findSaleForReturnAction(term).then(setResults);
  }, []);

  // Recent sales on mount — "search recent sales" is the default, not an
  // empty state the operator has to escape from.
  useEffect(() => {
    search('');
    searchRef.current?.focus();
  }, [search]);

  async function selectSale(found: FoundSale): Promise<void> {
    setSale(found);
    setRefundMethod('cash');
    setReasonNote('');
    setError(null);
    setDone(null);
    const rows = await returnableLinesAction(found.saleId);
    setLines(rows);
    setDrafts(
      Object.fromEntries(
        rows.map((row) => [
          row.saleLineId,
          { qty: '', restockBatchId: row.sourceBatches[0]?.batchId ?? null },
        ]),
      ),
    );
  }

  function backToSearch(): void {
    setSale(null);
    setLines([]);
    setDrafts({});
    setError(null);
    setDone(null);
    search(query);
    searchRef.current?.focus();
  }

  const totalRefundPaisa = useMemo(() => {
    let total = 0;
    for (const line of lines) {
      const qty = Number(drafts[line.saleLineId]?.qty ?? '');
      if (Number.isSafeInteger(qty) && qty > 0) {
        total += refundForLine(line, qty);
      }
    }
    return total;
  }, [lines, drafts]);

  async function confirm(): Promise<void> {
    if (!sale || busy || !receiptContext) {
      return;
    }
    const chosenLines = lines
      .map((line) => {
        const draft = drafts[line.saleLineId];
        const qty = Number(draft?.qty ?? '');
        if (!Number.isSafeInteger(qty) || qty <= 0) {
          return null;
        }
        return {
          saleLineId: line.saleLineId,
          qtyBase: qty,
          restockBatchId: draft?.restockBatchId ?? null,
        };
      })
      .filter((line): line is NonNullable<typeof line> => line !== null);

    if (chosenLines.length === 0) {
      setError('Enter how many units are being returned.');
      return;
    }

    setBusy(true);
    setError(null);
    const receiptNumber = receiptContext.nextReceiptNumber();

    const outcome = await commitReturnAction({
      returnId: uuidv7(),
      saleId: sale.saleId,
      receiptNumber,
      lines: chosenLines,
      refundMethod,
      reasonNote: reasonNote.trim() === '' ? null : reasonNote.trim(),
    }).catch(() => ({
      ok: false as const,
      message: 'Needs internet — selling keeps working.',
    }));

    setBusy(false);
    if (!outcome.ok) {
      receiptContext.skipReceiptNumber(receiptNumber);
      setError(outcome.message);
      return;
    }

    setDone(`Returned — ${formatPaisa(paisa(outcome.totalRefundPaisa))}`);

    print({
      receiptNumber,
      dateTime: new Date(),
      salesmanName: receiptContext.salesmanName,
      tenantHeaderLines: receiptContext.tenantHeaderLines,
      tenantFooterLine: receiptContext.tenantFooterLine,
      ...(sale.customerName ? { customerName: sale.customerName } : {}),
      lines: chosenLines.map((chosen) => {
        const original = lines.find((line) => line.saleLineId === chosen.saleLineId)!;
        return {
          name: original.productName,
          quantityLabel: `${chosen.qtyBase} ${original.baseUnitName}`,
          amountPaisa: -refundForLine(original, chosen.qtyBase),
        };
      }),
      totalPaisa: -outcome.totalRefundPaisa,
      ...(outcome.cashOutPaisa > 0 ? { cashPaisa: -outcome.cashOutPaisa } : {}),
      ...(outcome.creditReducedPaisa > 0 ? { creditPaisa: -outcome.creditReducedPaisa } : {}),
      ...(outcome.balanceBeforePaisa !== undefined
        ? {
            miniStatement: {
              previousBalancePaisa: outcome.balanceBeforePaisa,
              amountPaisa: -outcome.creditReducedPaisa,
              newBalancePaisa: outcome.balanceBeforePaisa - outcome.creditReducedPaisa,
            },
          }
        : {}),
    });
  }

  return (
    <section className="mx-auto flex max-w-3xl flex-col gap-4 p-4">
      <h1 className="text-green-900 text-2xl font-semibold">Returns</h1>

      {!sale ? (
        <>
          <label className="text-ink/60 text-sm" htmlFor="return-search">
            Receipt number or customer name
          </label>
          <input
            id="return-search"
            ref={searchRef}
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              search(event.target.value);
            }}
            placeholder="Scan or search…"
            className="border-line focus:border-green-600 h-touch w-full rounded border px-3 outline-none"
          />

          <ul className="border-line divide-line divide-y rounded border">
            {results.length === 0 ? (
              <li className="text-ink/50 px-3 py-3 text-sm">No sales found.</li>
            ) : (
              results.map((found) => (
                <li key={found.saleId}>
                  <button
                    type="button"
                    onClick={() => void selectSale(found)}
                    className="hover:bg-green-100/50 flex w-full items-center justify-between px-3 py-2 text-left"
                  >
                    <span>
                      <span className="font-medium">{found.receiptNumber}</span>
                      {found.customerName ? (
                        <span className="text-ink/60 ml-2 text-sm">{found.customerName}</span>
                      ) : null}
                    </span>
                    <span className="numeral text-sm">
                      {formatPaisa(paisa(found.totalPaisa))}
                      <span className="text-ink/40 ml-2 text-xs">
                        {found.createdAt.toLocaleDateString('en-PK')}
                      </span>
                    </span>
                  </button>
                </li>
              ))
            )}
          </ul>
        </>
      ) : (
        <div className="flex flex-col gap-3">
          <div className="border-line flex items-center justify-between rounded border p-3">
            <div>
              <p className="font-medium">{sale.receiptNumber}</p>
              {sale.customerName ? (
                <p className="text-ink/60 text-sm">{sale.customerName}</p>
              ) : null}
            </div>
            <button type="button" onClick={backToSearch} className="text-ink/60 text-sm">
              ← Find a different sale
            </button>
          </div>

          <div className="border-line overflow-x-auto rounded border">
            <table className="text-table w-full text-left">
              <thead className="bg-green-100/50 text-ink/60 text-xs">
                <tr>
                  <th className="px-3 py-2 font-medium">Item</th>
                  <th className="px-3 py-2 text-right font-medium">Sold</th>
                  <th className="px-3 py-2 text-right font-medium">Returnable</th>
                  <th className="px-3 py-2 font-medium">Return qty</th>
                  <th className="px-3 py-2 font-medium">Restock to</th>
                </tr>
              </thead>
              <tbody>
                {lines.map((line) => {
                  const remaining = line.qtyBase - line.alreadyReturnedBase;
                  const draft = drafts[line.saleLineId];
                  return (
                    <tr key={line.saleLineId} className="border-line border-t">
                      <td className="px-3 py-2 font-medium">{line.productName}</td>
                      <td className="numeral px-3 py-2 text-right">{line.qtyBase}</td>
                      <td className="numeral px-3 py-2 text-right">{remaining}</td>
                      <td className="px-3 py-2">
                        <label className="sr-only" htmlFor={`return-qty-${line.saleLineId}`}>
                          Return quantity for {line.productName}
                        </label>
                        <input
                          id={`return-qty-${line.saleLineId}`}
                          value={draft?.qty ?? ''}
                          inputMode="numeric"
                          disabled={remaining <= 0}
                          onChange={(event) => {
                            setDrafts((current) => ({
                              ...current,
                              [line.saleLineId]: {
                                ...current[line.saleLineId]!,
                                qty: event.target.value,
                              },
                            }));
                          }}
                          className="border-line focus:border-green-600 numeral h-touch w-20 rounded border px-2 outline-none disabled:opacity-40"
                        />
                      </td>
                      <td className="px-3 py-2">
                        <label className="sr-only" htmlFor={`return-batch-${line.saleLineId}`}>
                          Restock batch for {line.productName}
                        </label>
                        <select
                          id={`return-batch-${line.saleLineId}`}
                          value={draft?.restockBatchId ?? ''}
                          onChange={(event) => {
                            setDrafts((current) => ({
                              ...current,
                              [line.saleLineId]: {
                                ...current[line.saleLineId]!,
                                restockBatchId:
                                  event.target.value === '' ? null : event.target.value,
                              },
                            }));
                          }}
                          className="border-line focus:border-green-600 h-touch rounded border px-2 outline-none"
                        >
                          <option value="">Write off (no restock)</option>
                          {line.sourceBatches.map((batch) => (
                            <option key={batch.batchId} value={batch.batchId}>
                              expires {batch.expiryDate ?? '—'}
                            </option>
                          ))}
                        </select>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="flex flex-wrap items-end gap-4">
            <div>
              <p className="text-ink/60 mb-1 text-xs">Refund method</p>
              <div className="flex gap-2" role="group" aria-label="Refund method">
                {(['cash', 'credit'] as const).map((option) => (
                  <button
                    key={option}
                    type="button"
                    disabled={option === 'credit' && !sale.customerId}
                    onClick={() => {
                      setRefundMethod(option);
                    }}
                    aria-pressed={refundMethod === option}
                    className={[
                      'min-h-touch rounded border px-4 text-sm disabled:opacity-40',
                      refundMethod === option
                        ? 'border-green-600 bg-green-100 text-green-900 font-medium'
                        : 'border-line text-ink/60',
                    ].join(' ')}
                  >
                    {option === 'cash' ? 'Cash out' : 'Reduce credit'}
                  </button>
                ))}
              </div>
            </div>

            <div className="min-w-48 flex-1">
              <label className="text-ink/60 mb-1 block text-xs" htmlFor="return-reason">
                Reason (optional)
              </label>
              <input
                id="return-reason"
                value={reasonNote}
                onChange={(event) => {
                  setReasonNote(event.target.value);
                }}
                className="border-line focus:border-green-600 h-touch w-full rounded border px-3 outline-none"
              />
            </div>
          </div>

          {error ? (
            <p className="text-red text-sm" role="alert">
              {error}
            </p>
          ) : null}

          {done ? (
            <p className="text-green-900 text-sm" role="status">
              {done}
            </p>
          ) : null}

          <div className="flex items-center justify-between">
            {/* The idea is worth saying on this screen; the identifier is not. */}
            <p className="text-ink/50 text-xs">
              The original sale is never changed — this is recorded against it.
            </p>
            <div className="flex items-center gap-3">
              <span className="numeral text-green-900 text-lg font-semibold">
                {formatPaisa(paisa(totalRefundPaisa), { withSymbol: true })}
              </span>
              <button
                type="button"
                onClick={() => void confirm()}
                disabled={busy || totalRefundPaisa <= 0 || !receiptContext}
                className="bg-green-600 text-paper min-h-touch rounded px-5 font-medium disabled:opacity-40"
              >
                {busy ? 'Saving…' : 'Confirm return'}
              </button>
            </div>
          </div>
        </div>
      )}

      {receipt ? <ReceiptView receipt={receipt} /> : null}
    </section>
  );
}
