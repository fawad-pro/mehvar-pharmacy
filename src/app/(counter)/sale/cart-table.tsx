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
 */

import { useEffect, useRef } from 'react';

import { nextUnitLevel, resolveQuantity } from '@/client/search/quantity-grammar';
import { isPriceOverridden, lineTotal, type CartLine } from '@/domain/sales/cart';
import { baseQty, paisa } from '@/lib/branded';
import { formatPaisa } from '@/lib/money';
import { describeQuantity, unitLevels } from '@/lib/quantity';

export interface CartTableProps {
  lines: readonly CartLine[];
  selectedLineId: string | null;
  stockByProduct: Readonly<Record<string, number | null>>;
  onSelect: (lineId: string | null) => void;
  onChange: (lineId: string, patch: Partial<CartLine>) => void;
  onRemove: (lineId: string) => void;
  onLeaveCart: () => void;
}

export function CartTable({
  lines,
  selectedLineId,
  stockByProduct,
  onSelect,
  onChange,
  onRemove,
  onLeaveCart,
}: CartTableProps) {
  const container = useRef<HTMLTableSectionElement>(null);

  useEffect(() => {
    if (selectedLineId === null) {
      return;
    }
    container.current
      ?.querySelector<HTMLTableRowElement>(`[data-line-id="${selectedLineId}"]`)
      ?.focus();
  }, [selectedLineId]);

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
          <th className="px-3 py-2 text-right font-medium">Amount</th>
        </tr>
      </thead>
      <tbody ref={container}>
        {lines.map((line) => {
          const selected = line.lineId === selectedLineId;
          const stock = stockByProduct[line.productId] ?? null;
          // D2: the line proceeds; the chip is exposure, not a block.
          const short = stock !== null && stock < line.qtyBase;

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
                    +/− · Tab {line.enteredUnitLevel} · Del
                  </span>
                ) : null}
              </td>
              <td className="numeral px-3 py-1.5">{formatPaisa(paisa(line.unitPricePaisa))}</td>
              <td className="numeral px-3 py-1.5 font-medium">{formatPaisa(lineTotal(line))}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
