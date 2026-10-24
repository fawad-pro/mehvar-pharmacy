'use client';

/**
 * The quick item — W6, D3.
 *
 *   "Trigger: shelf item not in catalog; customer waiting. Path: from an empty
 *    search result, one key → name + price → line lands in cart, sale
 *    continues. Speed: under 10 seconds."
 *
 * Two fields, and the name arrives pre-filled from whatever was typed into
 * search — which is the difference between ten seconds and thirty. The operator
 * types a price and presses Enter.
 *
 * Everything the form does *not* ask for is the design: no manufacturer, no
 * pack structure, no strength. Those are exactly the fields that get guessed
 * wrong with a customer waiting, and a wrong pack factor corrupts stock
 * silently (Phase 5 §2). They belong to the completion queue, where there is
 * time to be right — which is what `needsCompletion` buys, and why D3's
 * guardrail is that the queue nags until someone enriches it.
 */

import { useEffect, useRef, useState } from 'react';

import { paisaFromRupeeInput } from '@/domain/sales/cart';
import { OverlayBackdrop } from '@/components/overlay-backdrop';

export interface QuickItemDraft {
  name: string;
  pricePaisa: number;
  baseUnitName: string;
}

/** The unit a shelf item is sold in when nobody has said otherwise. */
const DEFAULT_BASE_UNIT = 'item';

export function QuickItemForm({
  initialName,
  onCreate,
  onCancel,
}: {
  initialName: string;
  onCreate: (draft: QuickItemDraft) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(initialName);
  const [price, setPrice] = useState('');
  const [unit, setUnit] = useState(DEFAULT_BASE_UNIT);
  const priceField = useRef<HTMLInputElement>(null);
  const nameField = useRef<HTMLInputElement>(null);

  // A typed name is already right, so focus starts on the one thing still
  // unknown. With no name — the form was opened from an unknown scanned code,
  // which is never offered as a name — focus starts on the name.
  useEffect(() => {
    (initialName.trim() === '' ? nameField : priceField).current?.focus();
    // Once, on open: the starting focus does not follow later typing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const pricePaisa = paisaFromRupeeInput(price);
  const ready = name.trim() !== '' && pricePaisa > 0;

  function submit(): void {
    if (!ready) {
      return;
    }
    onCreate({
      name: name.trim(),
      pricePaisa,
      baseUnitName: unit.trim() === '' ? DEFAULT_BASE_UNIT : unit.trim(),
    });
  }

  function onKeyDown(event: React.KeyboardEvent): void {
    if (event.key === 'Enter') {
      event.preventDefault();
      submit();
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      onCancel();
    }
  }

  return (
    <OverlayBackdrop label="Quick item" onDismiss={onCancel}>
      <div className="bg-paper w-full max-w-sm rounded-lg p-5 shadow-xl" onKeyDown={onKeyDown}>
        <h2 className="text-green-900 mb-1 text-lg font-semibold">Add it now</h2>
        <p className="text-ink/60 mb-4 text-sm">
          Name and price is enough. The owner completes the rest later.
        </p>

        <label className="text-ink/60 mb-1 block text-xs" htmlFor="quick-name">
          Name
        </label>
        <input
          ref={nameField}
          id="quick-name"
          value={name}
          onChange={(event) => {
            setName(event.target.value);
          }}
          autoComplete="off"
          className="border-line focus:border-green-600 h-touch mb-3 w-full rounded border px-3 text-lg outline-none"
        />

        <div className="mb-4 flex gap-2">
          <div className="flex-1">
            <label className="text-ink/60 mb-1 block text-xs" htmlFor="quick-price">
              Price
            </label>
            <input
              id="quick-price"
              ref={priceField}
              value={price}
              inputMode="decimal"
              onChange={(event) => {
                setPrice(event.target.value);
              }}
              placeholder="0"
              className="border-line focus:border-green-600 numeral h-touch w-full rounded border px-3 text-lg outline-none"
            />
          </div>
          <div className="w-28">
            <label className="text-ink/60 mb-1 block text-xs" htmlFor="quick-unit">
              Sold as
            </label>
            <input
              id="quick-unit"
              value={unit}
              onChange={(event) => {
                setUnit(event.target.value);
              }}
              autoComplete="off"
              className="border-line focus:border-green-600 h-touch w-full rounded border px-3 outline-none"
            />
          </div>
        </div>

        <div className="flex items-center justify-between">
          <button type="button" onClick={onCancel} className="text-ink/60 text-sm">
            Esc to cancel
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={!ready}
            className="bg-green-600 text-paper min-h-touch rounded px-5 font-medium disabled:opacity-40"
          >
            Add to sale — Enter
          </button>
        </div>
      </div>
    </OverlayBackdrop>
  );
}
