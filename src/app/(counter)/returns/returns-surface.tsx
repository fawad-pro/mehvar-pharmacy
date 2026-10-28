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
import { LoadFailed } from '@/components/load-failed';
import { ReceiptView } from '@/components/receipt-view';
import { formatPaisa } from '@/lib/money';
import { baseQty, paisa } from '@/lib/branded';
import { describeQuantity, levelToBaseUnits } from '@/lib/quantity';
import { uuidv7 } from '@/lib/uuid';

import { commitReturnAction, findSaleForReturnAction, returnableLinesAction } from './actions';

type RefundMethod = 'cash' | 'credit';

interface LineDraft {
  /** A count of `unitKey`, as typed. */
  qty: string;
  unitKey: string;
  restockBatchId: string | null;
}

/**
 * [PCN-012] The typed count in base units, with the unit it was counted in;
 * null when nothing usable is typed.
 */
function countedOf(
  line: ReturnableLineRow,
  draft: LineDraft | undefined,
): { qtyBase: number; unit: { key: string; name: string; factor: number }; count: number } | null {
  const count = Number(draft?.qty ?? '');
  if (!draft || !Number.isSafeInteger(count) || count <= 0) {
    return null;
  }
  const unit = line.units.find((candidate) => candidate.key === draft.unitKey) ?? line.units[0];
  if (!unit) {
    return null;
  }
  return { qtyBase: levelToBaseUnits(count, unit), unit, count };
}

export function ReturnsSurface({ prefillReceipt }: { prefillReceipt?: string }) {
  const receiptContext = useReceiptContext();
  const { receipt, print } = usePrintReceipt();

  const [query, setQuery] = useState('');
  const [results, setResults] = useState<FoundSale[]>([]);
  /** What `results` answers: Enter acts only on the answer for what is typed. */
  const answeredFor = useRef<string | null>(null);
  /** The term an Enter is waiting on, until its answer arrives. */
  const enterFor = useRef<string | null>(null);
  const searchTimer = useRef<number | undefined>(undefined);
  /** The line whose quantity takes focus once the sale's lines are drawn. */
  const focusLine = useRef<string | null>(null);
  const [sale, setSale] = useState<FoundSale | null>(null);
  const [lines, setLines] = useState<ReturnableLineRow[]>([]);
  const [drafts, setDrafts] = useState<Record<string, LineDraft>>({});
  const [refundMethod, setRefundMethod] = useState<RefundMethod>('cash');
  const [reasonNote, setReasonNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  /** A search that got no answer — not the same as one that found nothing. */
  const [searchFailed, setSearchFailed] = useState(false);
  const searchRef = useRef<HTMLInputElement | null>(null);
  // Which sale the screen is showing now. A lines answer for any earlier pick
  // arrives too late to matter and is dropped — otherwise it overwrites the
  // sale on screen, or resets quantities the operator has already typed.
  const selection = useRef(0);

  const search = useCallback((term: string) => {
    findSaleForReturnAction(term).then(
      (found) => {
        setResults(found);
        setSearchFailed(false);
        answeredFor.current = term.trim();
        if (enterFor.current === term.trim()) {
          enterFor.current = null;
          openFromSearch(found, term.trim());
        }
      },
      () => {
        setSearchFailed(true);
      },
    );
    // `openFromSearch` only reads its arguments and stable setters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /**
   * Enter in the search: the sale whose receipt number was typed or scanned,
   * or the only one found. A receipt number + Enter used to do nothing; the
   * placeholder says "Scan", and a scan ends in Enter.
   */
  function openFromSearch(found: readonly FoundSale[], term: string): void {
    const exact = found.find((row) => row.receiptNumber.toLowerCase() === term.toLowerCase());
    const only = found.length === 1 ? found[0] : undefined;
    const pick = exact ?? only;
    if (pick) void selectSale(pick);
  }

  // Recent sales on mount — "search recent sales" is the default, not an
  // empty state the operator has to escape from.
  //
  // Unless a receipt was named. Receipts are now the place you *look* at a
  // sale, and "Start a return" hands off from there — so arriving with a
  // receipt number means the decision to return has already been made, and
  // asking the operator to search for the sale they just had open would be
  // making them do the same work twice. The handoff lands on the sale itself.
  useEffect(() => {
    if (prefillReceipt) {
      let cancelled = false;
      findSaleForReturnAction(prefillReceipt).then(
        (found) => {
          if (cancelled) {
            return;
          }
          const exact = found.find((row) => row.receiptNumber === prefillReceipt);
          if (exact) {
            void selectSale(exact);
          } else {
            // The number did not resolve — fall back to the normal search rather
            // than stranding the operator on an empty screen (P2).
            setQuery(prefillReceipt);
            setResults(found);
            searchRef.current?.focus();
          }
        },
        () => {
          if (cancelled) return;
          setQuery(prefillReceipt);
          setSearchFailed(true);
        },
      );
      return () => {
        cancelled = true;
      };
    }
    search('');
    searchRef.current?.focus();
  }, [search, prefillReceipt]);

  async function selectSale(found: FoundSale): Promise<void> {
    const mine = ++selection.current;
    setSale(found);
    setRefundMethod('cash');
    setReasonNote('');
    setError(null);
    setDone(null);
    // Another sale's lines must never stand under this sale's heading.
    setLines([]);
    setDrafts({});
    const rows = await returnableLinesAction(found.saleId).catch(() => null);
    if (mine !== selection.current) {
      return;
    }
    if (rows === null) {
      setError(
        'This sale’s items did not load — the shop’s computer did not answer. Pick it again.',
      );
      return;
    }
    setLines(rows);
    // Straight to the first quantity: the next thing typed is how many came
    // back. Focus used to fall to the page, and that number went nowhere.
    focusLine.current =
      rows.find((row) => row.qtyBase - row.alreadyReturnedBase > 0)?.saleLineId ?? null;
    setDrafts(
      Object.fromEntries(
        rows.map((row) => [
          row.saleLineId,
          {
            qty: '',
            unitKey: row.soldUnitKey,
            restockBatchId: row.sourceBatches[0]?.batchId ?? null,
          },
        ]),
      ),
    );
  }

  useEffect(() => {
    if (focusLine.current === null) return;
    document.getElementById(`return-qty-${focusLine.current}`)?.focus();
    focusLine.current = null;
  }, [lines]);

  function backToSearch(): void {
    selection.current += 1;
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
      const counted = countedOf(line, drafts[line.saleLineId]);
      if (counted) {
        total += refundForLine(line, counted.qtyBase);
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
        const counted = countedOf(line, draft);
        if (!counted) {
          return null;
        }
        return {
          saleLineId: line.saleLineId,
          qtyBase: counted.qtyBase,
          restockBatchId: draft?.restockBatchId ?? null,
          entered: {
            unitKey: counted.unit.key,
            unitName: counted.unit.name,
            unitCount: counted.count,
          },
        };
      })
      .filter((line): line is NonNullable<typeof line> => line !== null);

    if (chosenLines.length === 0) {
      setError('Enter how many are being returned.');
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
      refund: { againstReceiptNumber: sale.receiptNumber },
      lines: chosenLines.map((chosen) => {
        const original = lines.find((line) => line.saleLineId === chosen.saleLineId)!;
        return {
          name: original.productName,
          // As counted: a strip returned prints 1, like the sale slip.
          quantity: chosen.entered.unitCount,
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
            autoComplete="off"
            id="return-search"
            ref={searchRef}
            value={query}
            onChange={(event) => {
              const term = event.target.value;
              setQuery(term);
              // A pause after the last key: Next sends server actions one at a
              // time, so a search per keystroke queues behind itself.
              window.clearTimeout(searchTimer.current);
              searchTimer.current = window.setTimeout(() => search(term), 200);
            }}
            onKeyDown={(event) => {
              if (event.key !== 'Enter') return;
              event.preventDefault();
              const term = query.trim();
              if (answeredFor.current === term) {
                openFromSearch(results, term);
              } else {
                // Not answered yet: act the moment it is, on that answer.
                enterFor.current = term;
              }
            }}
            placeholder="Scan or search…"
            data-scan-target=""
            className="border-line focus:border-green-600 h-touch w-full rounded border px-3 outline-none"
          />

          {searchFailed ? (
            <LoadFailed
              what="The sales"
              onRetry={() => {
                setSearchFailed(false);
                search(query);
              }}
            />
          ) : (
            <ul className="border-line divide-line divide-y rounded border">
              {results.length === 0 ? (
                <li className="text-ink/50 px-3 py-3 text-sm">No sales found.</li>
              ) : (
                results.map((found) => (
                  <li key={found.saleId}>
                    <button
                      type="button"
                      onClick={() => void selectSale(found)}
                      className="hover:bg-green-100/50 flex min-h-touch w-full items-center justify-between px-3 text-left"
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
          )}
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
            <button
              type="button"
              onClick={backToSearch}
              className="text-ink/60 min-h-touch px-2 text-sm"
            >
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
                  const amount = (qty: number) =>
                    describeQuantity(baseQty(qty), line.baseUnitName, line.packLevels);
                  return (
                    <tr key={line.saleLineId} className="border-line border-t">
                      <td className="px-3 py-2 font-medium">{line.productName}</td>
                      <td className="numeral px-3 py-2 text-right">{amount(line.qtyBase)}</td>
                      <td className="numeral px-3 py-2 text-right">{amount(remaining)}</td>
                      <td className="px-3 py-2">
                        <div className="flex items-center gap-2">
                          {line.units.length > 1 ? (
                            <div
                              role="group"
                              aria-label={`Return ${line.productName} in`}
                              className="flex"
                            >
                              {line.units.map((unit, index) => {
                                const pressed = unit.key === draft?.unitKey;
                                return (
                                  <button
                                    key={unit.key}
                                    type="button"
                                    aria-pressed={pressed}
                                    disabled={remaining <= 0}
                                    onClick={() => {
                                      setDrafts((current) => ({
                                        ...current,
                                        [line.saleLineId]: {
                                          ...current[line.saleLineId]!,
                                          unitKey: unit.key,
                                        },
                                      }));
                                    }}
                                    className={[
                                      'border-line h-touch min-w-11 border px-3 text-sm capitalize disabled:opacity-40',
                                      index === 0 ? 'rounded-l' : '-ml-px',
                                      index === line.units.length - 1 ? 'rounded-r' : '',
                                      pressed
                                        ? 'bg-green-600 text-paper border-green-600 font-medium'
                                        : 'bg-paper text-ink hover:bg-green-100',
                                    ].join(' ')}
                                  >
                                    {unit.name}
                                  </button>
                                );
                              })}
                            </div>
                          ) : null}
                          <label className="sr-only" htmlFor={`return-qty-${line.saleLineId}`}>
                            Return quantity for {line.productName}
                          </label>
                          <input
                            autoComplete="off"
                            id={`return-qty-${line.saleLineId}`}
                            value={draft?.qty ?? ''}
                            inputMode="numeric"
                            disabled={remaining <= 0}
                            onKeyDown={(event) => {
                              if (event.key === 'Enter') {
                                event.preventDefault();
                                void confirm();
                              }
                            }}
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
                        </div>
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
                autoComplete="off"
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
                {busy ? 'Saving…' : 'Confirm return — Enter'}
              </button>
            </div>
          </div>
        </div>
      )}

      {receipt ? <ReceiptView receipt={receipt} /> : null}
    </section>
  );
}
