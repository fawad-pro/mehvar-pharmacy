'use client';

/**
 * The cart — Phase 10 §4's left zone, "a dense table (I7)".
 *
 *   "line = name + natural-language quantity ('1 strip + 4 tab', W5) + unit
 *    price + line total; selected line editable in place (arrow up into cart,
 *    +/− for qty, Delete removes…, price edit logged as override)."
 *
 * Every edit is keyboard-reachable, because I1 means the hands never leave the
 * keys during a sale. The mouse works too; it is just never required.
 *
 * A per-line DISCOUNT is the same posture: '%' on the selected line opens a
 * small inline field, fixed PKR ("50") or percentage ("10%"), that resolves
 * through `parseDiscountInput` into `CartLine.lineDiscountPaisa` — the one
 * discount model, never a parallel one. Nothing about it is a new screen or
 * a new workflow; it is one more in-place edit beside qty and unit level.
 */

import { useEffect, useRef, useState } from 'react';

import { nextUnitLevel, resolveQuantity } from '@/client/search/quantity-grammar';
import {
  isPriceOverridden,
  lineGrossPaisa,
  lineTotal,
  parseDiscountInput,
  type CartLine,
} from '@/domain/sales/cart';
import { baseQty, paisa } from '@/lib/branded';
import { formatPaisa } from '@/lib/money';
import { describeQuantity, unitLevels } from '@/lib/quantity';

export interface CartTableProps {
  lines: readonly CartLine[];
  selectedLineId: string | null;
  stockByProduct: Readonly<Record<string, number | null>>;
  /** PCN-008: expired stock on hand per product, from the index snapshot. */
  expiredByProduct?: Readonly<Record<string, { qtyBase: number; expiryDate: string } | null>>;
  onSelect: (lineId: string | null) => void;
  onChange: (lineId: string, patch: Partial<CartLine>) => void;
  onRemove: (lineId: string) => void;
  onLeaveCart: () => void;
  /** Phase 10 §4: "Space or F12 from cart" opens the payment overlay. */
  onPay?: () => void;
}

export function CartTable({
  lines,
  selectedLineId,
  stockByProduct,
  expiredByProduct = {},
  onSelect,
  onChange,
  onRemove,
  onLeaveCart,
  onPay,
}: CartTableProps) {
  const container = useRef<HTMLTableSectionElement>(null);
  /** The one line, if any, with its discount field open — never more than one. */
  const [editingDiscount, setEditingDiscount] = useState<{
    lineId: string;
    text: string;
  } | null>(null);

  useEffect(() => {
    if (selectedLineId === null) {
      return;
    }
    // Selecting a line while its discount field is open (e.g. a mouse click
    // on the Discount cell selects the row AND opens the editor in the same
    // event) must not steal focus back to the row — that would blur the
    // input and close the editor it just opened.
    if (editingDiscount?.lineId === selectedLineId) {
      return;
    }
    container.current
      ?.querySelector<HTMLTableRowElement>(`[data-line-id="${selectedLineId}"]`)
      ?.focus();
  }, [selectedLineId, editingDiscount]);

  function focusRow(lineId: string): void {
    container.current?.querySelector<HTMLTableRowElement>(`[data-line-id="${lineId}"]`)?.focus();
  }

  function openDiscountEditor(line: CartLine): void {
    // Opens the same small field whether the line already carries a discount
    // or not; a discount already on the line is offered back in rupees as the
    // starting text, so adjusting it re-reads as one edit rather than a fresh
    // guess at what was there.
    onSelect(line.lineId);
    setEditingDiscount({
      lineId: line.lineId,
      text: line.lineDiscountPaisa > 0 ? (line.lineDiscountPaisa / 100).toString() : '',
    });
  }

  function commitDiscount(line: CartLine): void {
    const text = editingDiscount?.lineId === line.lineId ? editingDiscount.text : '';
    setEditingDiscount(null);
    onChange(line.lineId, { lineDiscountPaisa: parseDiscountInput(text, lineGrossPaisa(line)) });
    focusRow(line.lineId);
  }

  /**
   * Closes the field without applying anything. Safe to call from `onBlur`
   * even after `commitDiscount` already closed it (Enter's own refocus of the
   * row blurs this input too) — the guard makes that a no-op rather than a
   * second, redundant refocus.
   */
  function cancelDiscount(line: CartLine): void {
    setEditingDiscount((current) => {
      if (current?.lineId !== line.lineId) {
        return current;
      }
      focusRow(line.lineId);
      return null;
    });
  }

  function discountKeyDown(event: React.KeyboardEvent<HTMLInputElement>, line: CartLine): void {
    // Never let a keystroke meant for this text field also reach the row's
    // own handler — Backspace/Delete would otherwise remove the whole line
    // while the operator is just editing a number.
    event.stopPropagation();
    if (event.key === 'Enter') {
      event.preventDefault();
      commitDiscount(line);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      cancelDiscount(line);
    }
  }

  if (lines.length === 0) {
    return (
      <div className="text-ink/40 flex h-full items-center justify-center p-8 text-sm">
        Search above to start a sale.
      </div>
    );
  }

  function handleKey(event: React.KeyboardEvent<HTMLTableRowElement>, line: CartLine): void {
    const index = lines.findIndex((candidate) => candidate.lineId === line.lineId);
    const levels = unitLevels(line.baseUnitName, [...line.packLevels]);
    const level = levels.find((candidate) => candidate.name === line.enteredUnitLevel) ?? levels[0];
    const step = level?.factor ?? 1;

    switch (event.key) {
      case 'ArrowDown': {
        event.preventDefault();
        const next = lines[index + 1];
        if (next) {
          onSelect(next.lineId);
        } else {
          // Falling off the bottom returns to search — home position (rule 1).
          onLeaveCart();
        }
        break;
      }
      case 'ArrowUp': {
        event.preventDefault();
        const previous = lines[index - 1];
        if (previous) {
          onSelect(previous.lineId);
        } else {
          onLeaveCart();
        }
        break;
      }
      case '+':
      case '=': {
        event.preventDefault();
        // Steps by the entered unit: pressing + on a strip line adds a strip,
        // not a tablet. That is what the operator means.
        onChange(line.lineId, { qtyBase: baseQty(line.qtyBase + step) });
        break;
      }
      case '-': {
        event.preventDefault();
        const reduced = line.qtyBase - step;
        if (reduced <= 0) {
          onRemove(line.lineId);
        } else {
          onChange(line.lineId, { qtyBase: baseQty(reduced) });
        }
        break;
      }
      case 'Delete':
      case 'Backspace': {
        event.preventDefault();
        onRemove(line.lineId);
        break;
      }
      case '%': {
        event.preventDefault();
        openDiscountEditor(line);
        break;
      }
      case ' ': {
        event.preventDefault();
        onPay?.();
        break;
      }
      case 'Tab': {
        // Cycles the unit level and re-expresses the same count at the new one,
        // so Tab on "2 strip" reads "2 box" rather than silently changing 20 to 2.
        if (event.shiftKey) {
          return;
        }
        event.preventDefault();
        const target = nextUnitLevel(line.enteredUnitLevel, line.baseUnitName, [
          ...line.packLevels,
        ]);
        const count = Math.max(1, Math.round(line.qtyBase / step));
        onChange(line.lineId, {
          enteredUnitLevel: target,
          qtyBase: resolveQuantity(count, target, line.baseUnitName, [...line.packLevels]),
        });
        break;
      }
      default:
        break;
    }
  }

  return (
    <table className="text-table w-full">
      <thead className="bg-green-100/50 text-ink/60 sticky top-0 text-xs">
        <tr>
          <th className="px-3 py-2 text-left font-medium">Item</th>
          <th className="px-3 py-2 text-left font-medium">Quantity</th>
          <th className="px-3 py-2 text-right font-medium">Price</th>
          <th className="px-3 py-2 text-right font-medium">Discount</th>
          <th className="px-3 py-2 text-right font-medium">Amount</th>
        </tr>
      </thead>
      <tbody ref={container}>
        {lines.map((line) => {
          const selected = line.lineId === selectedLineId;
          const stock = stockByProduct[line.productId] ?? null;
          // D2: the line proceeds; the chip is exposure, not a block.
          const short = stock !== null && stock < line.qtyBase;
          // PCN-008: allocation reaches expired batches only after every
          // unexpired one, so the line touches expired stock exactly when it
          // asks for more than the unexpired part. Warned, never blocked.
          const expired = expiredByProduct[line.productId] ?? null;
          const fromExpired =
            expired !== null && stock !== null && line.qtyBase > stock - expired.qtyBase;

          return (
            <tr
              key={line.lineId}
              data-line-id={line.lineId}
              tabIndex={-1}
              aria-selected={selected}
              onFocus={() => {
                onSelect(line.lineId);
              }}
              onClick={() => {
                onSelect(line.lineId);
              }}
              onKeyDown={(event) => {
                handleKey(event, line);
              }}
              className={['border-line border-t outline-none', selected ? 'bg-green-100' : ''].join(
                ' ',
              )}
            >
              <td className="px-3 py-1.5">
                <span className="font-medium">{line.name}</span>
                {isPriceOverridden(line) ? (
                  <span className="text-amber ml-2 text-xs">price changed</span>
                ) : null}
                {fromExpired ? (
                  <span className="text-amber ml-2 text-xs font-medium" role="alert">
                    {expired !== null && stock !== null && stock - expired.qtyBase <= 0
                      ? 'only expired stock left'
                      : 'part from expired stock'}{' '}
                    — expired {expired?.expiryDate}
                  </span>
                ) : null}
                {short ? (
                  <span className="text-amber ml-2 text-xs">
                    {stock !== null && stock <= 0 ? 'not in stock' : 'more than in stock'}
                  </span>
                ) : null}
              </td>
              <td className="px-3 py-1.5">
                {/* W5: always natural language, never database thinking. */}
                {describeQuantity(line.qtyBase, line.baseUnitName, [...line.packLevels])}
                {selected ? (
                  <span className="text-ink/40 ml-2 text-xs">
                    +/− · Tab {line.enteredUnitLevel} · % disc · Del
                  </span>
                ) : null}
              </td>
              <td className="numeral px-3 py-1.5 text-right">
                {formatPaisa(paisa(line.unitPricePaisa))}
              </td>
              <td className="numeral px-3 py-1.5 text-right">
                {editingDiscount?.lineId === line.lineId ? (
                  <input
                    type="text"
                    inputMode="decimal"
                    aria-label={`Discount for ${line.name}`}
                    autoFocus
                    value={editingDiscount.text}
                    onFocus={(event) => {
                      event.currentTarget.select();
                    }}
                    onChange={(event) => {
                      setEditingDiscount({ lineId: line.lineId, text: event.target.value });
                    }}
                    onKeyDown={(event) => {
                      discountKeyDown(event, line);
                    }}
                    onBlur={() => {
                      cancelDiscount(line);
                    }}
                    placeholder="e.g. 50 or 10%"
                    autoComplete="off"
                    className="numeral border-line focus:border-green-600 w-full rounded border px-1.5 py-0.5 text-right text-sm outline-none"
                  />
                ) : (
                  <button
                    type="button"
                    onMouseDown={(event) => {
                      // Clicking this cell must not first move focus to the
                      // button — that fires a focus event on the row before
                      // the click's own state update, and the two together
                      // can race with the effect that syncs row focus,
                      // closing the editor the same click just opened it.
                      event.preventDefault();
                    }}
                    onClick={() => {
                      openDiscountEditor(line);
                    }}
                    className={[
                      'w-full text-right',
                      line.lineDiscountPaisa > 0 ? 'text-green-700' : 'text-ink/30',
                    ].join(' ')}
                  >
                    {line.lineDiscountPaisa > 0
                      ? `−${formatPaisa(paisa(line.lineDiscountPaisa))}`
                      : '—'}
                  </button>
                )}
              </td>
              <td className="numeral px-3 py-1.5 font-medium">{formatPaisa(lineTotal(line))}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
