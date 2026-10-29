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

import {
  isPriceOverridden,
  lineGrossPaisa,
  lineTotal,
  parseDiscountInput,
  type CartLine,
  type updateLine,
} from '@/domain/sales/cart';
import { paisa } from '@/lib/branded';
import { formatExpiry } from '@/lib/expiry';
import { formatPaisa } from '@/lib/money';

export interface CartTableProps {
  lines: readonly CartLine[];
  selectedLineId: string | null;
  stockByProduct: Readonly<Record<string, number | null>>;
  /** PCN-008: expired stock on hand per product, from the index snapshot. */
  expiredByProduct?: Readonly<Record<string, { qtyBase: number; expiryDate: string } | null>>;
  onSelect: (lineId: string | null) => void;
  onChange: (lineId: string, patch: Parameters<typeof updateLine>[2]) => void;
  onRemove: (lineId: string) => void;
  onLeaveCart: () => void;
  /**
   * The line the controls show on while nothing is selected: the last one
   * added, so a finger changes it without first tapping to select it.
   */
  activeLineId?: string | null;
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
  activeLineId = null,
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

  function handleKey(event: React.KeyboardEvent<HTMLTableRowElement>, line: CartLine): void {
    const index = lines.findIndex((candidate) => candidate.lineId === line.lineId);

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
        onChange(line.lineId, { unitCount: line.unitCount + 1 });
        break;
      }
      case '-': {
        event.preventDefault();
        if (line.unitCount <= 1) {
          onRemove(line.lineId);
        } else {
          onChange(line.lineId, { unitCount: line.unitCount - 1 });
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
        // Cycles the unit and keeps the count, so Tab on "2 strip" reads
        // "2 box" at the box's own price (PCN-012), never 20 tablets.
        if (event.shiftKey) {
          return;
        }
        event.preventDefault();
        const at = line.units.findIndex((unit) => unit.key === line.unitKey);
        const target = line.units[(at + 1) % line.units.length];
        if (target) {
          onChange(line.lineId, { unitKey: target.key });
        }
        break;
      }
      default:
        break;
    }
  }

  /** The open discount field and its Apply, beside the cell it edits. */
  function discountEditor(line: CartLine): React.ReactNode {
    if (editingDiscount?.lineId !== line.lineId) return null;
    return (
      <span className="bg-surface shadow-pop absolute top-full right-2 z-10 mt-1 flex w-56 items-center gap-2 rounded-control p-2">
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
          className="numeral border-border text-body-sm h-touch min-w-0 flex-1 rounded-control border px-2.5 text-right focus:border-blue-600"
        />
        {/* Enter applies and leaving the field cancels; a tablet's
          natural way to finish is to tap elsewhere, which threw
          the discount away with nothing on screen to apply it.
          Pressing here must not blur the field first, or the
          blur's cancel would beat the tap. */}
        <button
          type="button"
          aria-label={`Apply discount on ${line.name}`}
          onMouseDown={(event) => {
            event.preventDefault();
          }}
          onClick={() => {
            commitDiscount(line);
          }}
          className="bg-blue-600 text-surface text-body-sm min-h-touch min-w-touch rounded-control px-3 font-semibold hover:bg-blue-700"
        >
          Apply
        </button>
      </span>
    );
  }

  const shownLineId = selectedLineId ?? activeLineId;

  return (
    <div className="bg-surface shadow-card overflow-x-auto rounded-card">
      <table className="text-table w-full table-fixed border-collapse text-left">
        <colgroup>
          <col />
          {/* From tablet up the quantity cell holds a button per unit plus − n +,
              so its column is sized to the most units any line offers; a fixed
              width let the controls run over the Price column. On a phone the
              units fold into one button and the narrow width stands. */}
          <col
            className="w-[164px] md:w-(--qty-col)"
            style={{ '--qty-col': `${quantityColumnPx(lines)}px` } as React.CSSProperties}
          />
          <col className="w-[84px] max-md:hidden lg:w-[100px]" />
          <col className="w-[72px] max-md:hidden lg:w-[112px]" />
          <col className="w-[100px] md:w-[110px]" />
        </colgroup>
        <thead className="bg-page text-ink-2 text-label">
          <tr>
            <th className="px-3.5 py-2.5 font-medium max-md:pl-2.5">Item</th>
            <th className="px-3.5 py-2.5 font-medium max-md:px-1">
              <span className="max-md:hidden">Quantity</span>
              <span className="md:hidden">Qty</span>
            </th>
            <th className="px-2 py-2.5 text-right font-medium max-md:hidden lg:px-3.5">Price</th>
            <th className="px-2 py-2.5 text-right font-medium max-md:hidden lg:px-3.5">Discount</th>
            <th className="px-3.5 py-2.5 text-right font-medium max-md:pr-2.5">Amount</th>
          </tr>
        </thead>
        <tbody ref={container}>
          {lines.map((line) => {
            const selected = line.lineId === selectedLineId;
            // The line the controls sit on: the selected one, or while the
            // cursor is in the search, the last one added — the line ↑ goes
            // to. A finger changes it without a tap to select it first.
            const shown = line.lineId === shownLineId;
            const stock = stockByProduct[line.productId] ?? null;
            // D2: the line proceeds; the badge is exposure, not a block.
            const short = stock !== null && stock < line.qtyBase;
            // PCN-008: allocation reaches expired batches only after every
            // unexpired one, so the line touches expired stock exactly when it
            // asks for more than the unexpired part. Warned, never blocked.
            const expired = expiredByProduct[line.productId] ?? null;
            const fromExpired =
              expired !== null && stock !== null && line.qtyBase > stock - expired.qtyBase;
            const discounted = line.lineDiscountPaisa > 0;
            const editing = editingDiscount?.lineId === line.lineId;

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
                className={[
                  'border-line border-t first:border-t-0 [&>td]:h-11',
                  selected ? 'bg-blue-50' : 'hover:bg-page',
                ].join(' ')}
              >
                <td className="px-3.5 max-md:pr-2 max-md:pl-2.5">
                  {/* One line: the name and strength, never cut (it wraps in
                      this row only), then a badge only when something needs
                      attention (PCN-016). */}
                  <div className="flex min-h-5 flex-wrap items-center gap-x-2 gap-y-0.5 py-1">
                    <span className="text-body-sm lg:text-table min-w-0 font-medium break-words">
                      {line.name}
                      {line.strength ? (
                        <span className="text-ink-2 font-normal"> {line.strength}</span>
                      ) : null}
                    </span>
                    {fromExpired ? (
                      <span role="alert" className={cartBadge('refused')}>
                        {expired !== null && stock !== null && stock - expired.qtyBase <= 0
                          ? 'Expired'
                          : 'Part expired'}{' '}
                        {formatExpiry(expired?.expiryDate ?? '')}
                      </span>
                    ) : null}
                    {short ? (
                      <span className={cartBadge('attention')}>
                        {stock !== null && stock <= 0 ? 'Not in stock' : 'More than in stock'}
                      </span>
                    ) : null}
                    {isPriceOverridden(line) ? (
                      <span className={cartBadge('attention')}>Price changed</span>
                    ) : null}
                  </div>
                </td>
                <td className="px-3.5 max-md:px-1">
                  {shown ? (
                    <QuantityControl
                      line={line}
                      onUnit={(unitKey) => {
                        onSelect(line.lineId);
                        onChange(line.lineId, { unitKey });
                      }}
                      onStep={(delta) => {
                        onSelect(line.lineId);
                        if (line.unitCount + delta < 1) {
                          onRemove(line.lineId);
                        } else {
                          onChange(line.lineId, { unitCount: line.unitCount + delta });
                        }
                      }}
                    />
                  ) : (
                    // W5: always natural language — "2 strip", never a bare "2".
                    <span className="numeral text-body-sm lg:text-table whitespace-nowrap">
                      {line.unitCount} {line.enteredUnitLevel}
                    </span>
                  )}
                </td>
                <td className="numeral text-body-sm lg:text-table px-2 text-right whitespace-nowrap max-md:hidden lg:px-3.5">
                  {formatPaisa(paisa(line.pricePerUnitPaisa), { withSymbol: true })}
                </td>
                <td className="numeral text-body-sm lg:text-table relative px-2 text-right whitespace-nowrap max-md:hidden lg:px-3.5">
                  {shown ? (
                    <DiscountButton line={line} onOpen={openDiscountEditor} />
                  ) : discounted ? (
                    formatPaisa(paisa(line.lineDiscountPaisa), { withSymbol: true })
                  ) : (
                    <span className="text-ink-2">—</span>
                  )}
                </td>
                <td className="numeral text-body-sm lg:text-table relative px-3.5 text-right font-semibold whitespace-nowrap max-md:pr-2.5 max-md:pl-1">
                  {/* On a phone there is no Discount column: the selected
                      line's amount is its discount's button. */}
                  {shown ? (
                    <span className="md:hidden">
                      <DiscountButton line={line} onOpen={openDiscountEditor} amount />
                    </span>
                  ) : null}
                  {/* One field at every width, opening beneath the line's
                      amount — on a phone there is no Discount column. */}
                  {editing ? discountEditor(line) : null}
                  <span className={shown ? 'max-md:hidden' : ''}>
                    {formatPaisa(lineTotal(line), { withSymbol: true })}
                  </span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {/* Beneath the table, not a row in it: a cell spanning columns the
          phone hides would set the columns' widths. */}
      {lines.length === 0 ? (
        <p className="text-body-sm text-ink-2 m-0 px-3.5 py-7 text-center">
          Scan a barcode or type a name — Enter puts it on the bill.
        </p>
      ) : null}
    </div>
  );
}

/**
 * Width of the quantity column from tablet up: the cell's padding (28), the
 * − count + stepper (44 + 22 + 44 + gaps), and ~56 for each unit's button. A
 * product with one unit shows no toggle.
 */
function quantityColumnPx(lines: readonly CartLine[]): number {
  const units = Math.max(1, ...lines.map((line) => line.units.length));
  return 28 + 130 + (units > 1 ? units * 56 + 4 : 0);
}

/** The cart's badges are the design system's, one size down to keep the row at 44 px. */
function cartBadge(tone: 'attention' | 'refused'): string {
  return [
    'text-caption inline-flex h-5 shrink-0 items-center gap-1 rounded-pill px-2 whitespace-nowrap',
    'before:size-[5px] before:rounded-full',
    tone === 'refused'
      ? 'bg-red-50 text-red before:bg-red'
      : 'bg-amber-50 text-amber-text before:bg-amber',
  ].join(' ');
}


/**
 * The selected line's discount, as something to press. Every button in the
 * row keeps focus where it was (`onMouseDown` prevented) and is out of the
 * tab order, so the row stays the one keyboard target.
 */
function DiscountButton({
  line,
  onOpen,
  amount = false,
}: {
  line: CartLine;
  onOpen: (line: CartLine) => void;
  /** Phone: the button shows the line's amount, with a % mark. */
  amount?: boolean;
}) {
  const discounted = line.lineDiscountPaisa > 0;
  return (
    <button
      type="button"
      tabIndex={-1}
      // Named for what it does: its text is a figure, or a mark.
      aria-label={discounted ? `Change discount on ${line.name}` : `Add a discount on ${line.name}`}
      onMouseDown={(event) => {
        // Clicking must not first move focus to the button — that fires a
        // focus event on the row before the click's own state update, and the
        // two together can race with the effect that syncs row focus, closing
        // the editor the same click just opened.
        event.preventDefault();
      }}
      onClick={(event) => {
        event.stopPropagation();
        onOpen(line);
      }}
      className="border-border bg-surface text-navy text-body-sm hover:border-navy min-h-touch min-w-touch ml-auto inline-flex items-center justify-end gap-1 rounded-control border px-2.5 font-medium max-md:gap-0.5 max-md:px-1.5"
    >
      {amount ? formatPaisa(lineTotal(line), { withSymbol: true }) : null}
      {amount ? null : discounted ? (
        formatPaisa(paisa(line.lineDiscountPaisa), { withSymbol: true })
      ) : (
        <span className="text-ink-2">—</span>
      )}
      {amount ? (
        <span aria-hidden="true" className="text-caption font-semibold text-blue-600">
          %
        </span>
      ) : null}
    </button>
  );
}

/**
 * The selected line's quantity — Phase 10 §4 as amended by PCN-012 and
 * PCN-016: the unit toggle, − count +, because a tablet has no Tab key and
 * no plus key. The keyboard path is unchanged (the row's own keys); these are
 * the same edits for a finger or a mouse. On a phone the toggle folds into
 * the count: one button, "1 box", that steps to the next unit.
 *
 * Every button keeps focus where it was (`onMouseDown` prevented) and is out
 * of the tab order, so the row stays the one keyboard target, exactly as the
 * Discount cell does.
 */
function QuantityControl({
  line,
  onUnit,
  onStep,
}: {
  line: CartLine;
  onUnit: (unitKey: string) => void;
  onStep: (delta: 1 | -1) => void;
}) {
  const offered = line.units;
  const keepFocus = (event: React.MouseEvent) => {
    event.preventDefault();
  };
  const button =
    'border-border bg-surface text-navy text-body-sm h-11 shrink-0 rounded-control border hover:border-navy';
  const step = `${button} w-11 text-lg leading-none`;
  const at = offered.findIndex((unit) => unit.key === line.unitKey);
  const next = offered[(at + 1) % offered.length];

  return (
    <div className="flex items-center gap-1">
      {offered.length > 1 ? (
        <div role="group" aria-label={`Unit for ${line.name}`} className="flex max-md:hidden">
          {offered.map((unit, index) => {
            const chosen = unit.key === line.unitKey;
            return (
              <button
                key={unit.key}
                type="button"
                tabIndex={-1}
                aria-pressed={chosen}
                onMouseDown={keepFocus}
                onClick={(event) => {
                  event.stopPropagation();
                  if (!chosen) onUnit(unit.key);
                }}
                className={[
                  'border-border text-body-sm relative h-11 min-w-11 border px-2.5',
                  index === 0 ? 'rounded-l-control' : '-ml-px',
                  index === offered.length - 1 ? 'rounded-r-control' : '',
                  chosen
                    ? 'text-navy z-[1] border-blue-600 bg-blue-50 font-semibold'
                    : 'bg-surface text-navy hover:bg-page',
                ].join(' ')}
              >
                {unit.name}
              </button>
            );
          })}
        </div>
      ) : null}
      <button
        type="button"
        tabIndex={-1}
        aria-label={
          line.unitCount <= 1 ? `Remove ${line.name}` : `One ${line.enteredUnitLevel} less`
        }
        onMouseDown={keepFocus}
        onClick={(event) => {
          event.stopPropagation();
          onStep(-1);
        }}
        className={step}
      >
        −
      </button>
      {/* W5: always natural language. Where the pressed unit already says it,
          the unit beside the count is said only to a screen reader. */}
      <span className="numeral text-body-sm min-w-[22px] text-center max-md:hidden">
        {line.unitCount}
        <span className={offered.length > 1 ? 'sr-only' : 'text-ink-2'}>
          {' '}
          {line.enteredUnitLevel}
        </span>
      </span>
      {offered.length > 1 && next ? (
        <button
          type="button"
          tabIndex={-1}
          aria-label={`${line.unitCount} ${line.enteredUnitLevel}. Change to ${next.name}`}
          onMouseDown={keepFocus}
          onClick={(event) => {
            event.stopPropagation();
            onUnit(next.key);
          }}
          className={`${button} numeral px-2.5 md:hidden`}
        >
          {line.unitCount} {line.enteredUnitLevel}
        </button>
      ) : (
        <span className="numeral text-body-sm px-1 md:hidden">
          {line.unitCount} {line.enteredUnitLevel}
        </span>
      )}
      <button
        type="button"
        tabIndex={-1}
        aria-label={`One ${line.enteredUnitLevel} more`}
        onMouseDown={keepFocus}
        onClick={(event) => {
          event.stopPropagation();
          onStep(1);
        }}
        className={step}
      >
        +
      </button>
    </div>
  );
}
