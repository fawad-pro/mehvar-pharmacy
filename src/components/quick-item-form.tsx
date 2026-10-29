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
import { Banner } from '@/components/ui/banner';
import { Button, Kbd } from '@/components/ui/button';
import { dialogPanelClass } from '@/components/ui/dialog';
import { AmountField, Field } from '@/components/ui/field';
import { needsClickToCommit } from '@/client/scan/amount-guard';

export interface QuickItemDraft {
  name: string;
  pricePaisa: number;
  baseUnitName: string;
  /** The scanned code the new product keeps; null when typed, or when it clashes. */
  barcode: string | null;
}

/** The unit a shelf item is sold in when nobody has said otherwise. */
const DEFAULT_BASE_UNIT = 'item';

export function QuickItemForm({
  initialName,
  barcode = null,
  owner = null,
  onSellOwner,
  onCreate,
  onCancel,
}: {
  initialName: string;
  /** The unknown code this item was added from, saved with it. */
  barcode?: string | null;
  /**
   * The product that already owns `barcode`, when one does. The code is then
   * never put on the new product: the operator sells the owner instead, or
   * saves the new product without the code.
   */
  owner?: { name: string } | null;
  onSellOwner?: (() => void) | undefined;
  onCreate: (draft: QuickItemDraft) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(initialName);
  const [price, setPrice] = useState('');
  const [unit, setUnit] = useState(DEFAULT_BASE_UNIT);
  const priceField = useRef<HTMLInputElement>(null);
  const nameField = useRef<HTMLInputElement>(null);
  const unitField = useRef<HTMLInputElement>(null);
  const [showUnit, setShowUnit] = useState(false);
  const unitName = unit.trim() === '' ? DEFAULT_BASE_UNIT : unit.trim();

  // Focus from an effect, once the field has rendered (the keyboard walks).
  useEffect(() => {
    if (showUnit) unitField.current?.focus();
  }, [showUnit]);
  /** Why Enter did not save: a price too large to be real (see amount-guard). */
  const [notice, setNotice] = useState<string | null>(null);

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
      // A code another product owns is never attached here.
      barcode: owner ? null : barcode,
    });
  }

  function onKeyDown(event: React.KeyboardEvent): void {
    // A button's own Enter presses that button (More details, Sell instead).
    if (event.key === 'Enter' && event.target instanceof HTMLButtonElement) return;
    if (event.key === 'Enter') {
      event.preventDefault();
      if (needsClickToCommit(pricePaisa)) {
        setNotice('That price looks like a barcode. If it is right, click the button.');
        return;
      }
      submit();
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      onCancel();
    }
  }

  return (
    <OverlayBackdrop label="Quick item" onDismiss={onCancel}>
      <div className={dialogPanelClass} onKeyDown={onKeyDown}>
        <div className="flex flex-col gap-1">
          <h2 className="text-heading m-0">Not in the list — sell it now</h2>
          <p className="text-body-sm text-ink-2 m-0">
            Name and price are enough. The owner fills in the rest later.
          </p>
        </div>

        {barcode && owner ? (
          <Banner tone="attention" role="alert" lead={`This barcode is already on ${owner.name}.`}>
            It will not be added to a second product.
            {onSellOwner ? (
              <>
                {' '}
                <button
                  type="button"
                  onClick={onSellOwner}
                  className="min-h-touch font-medium text-blue-600 underline underline-offset-2"
                >
                  Sell {owner.name} instead
                </button>
              </>
            ) : null}
          </Banner>
        ) : barcode ? (
          <p className="text-body-sm text-ink-2 m-0">
            Barcode <span className="numeral text-navy">{barcode}</span> — saved with this product,
            so the next scan adds it directly.
          </p>
        ) : null}

        <Field
          ref={nameField}
          id="quick-name"
          label="Name"
          value={name}
          onChange={(event) => {
            setName(event.target.value);
            setNotice(null);
          }}
          autoComplete="off"
        />

        <AmountField
          autoComplete="off"
          id="quick-price"
          ref={priceField}
          label="Price"
          value={price}
          onChange={(event) => {
            setPrice(event.target.value);
            setNotice(null);
          }}
          placeholder="0.00"
          className="[&_input]:text-right"
          help={`Type the price for one ${unitName} to add it.`}
          error={notice ? <span role="alert">{notice}</span> : null}
        />

        {/* The unit is almost always "item"; it is there to change, out of
            the way of the two fields that matter. */}
        {showUnit ? (
          <Field
            ref={unitField}
            id="quick-unit"
            label="Sold as"
            value={unit}
            onChange={(event) => {
              setUnit(event.target.value);
              setNotice(null);
            }}
            autoComplete="off"
          />
        ) : (
          <Button
            kind="quiet"
            aria-expanded={false}
            className="-ml-3 self-start"
            onClick={() => {
              setShowUnit(true);
            }}
          >
            More details — sold as “{unitName}”
          </Button>
        )}

        <div className="mt-1 flex flex-wrap items-center justify-end gap-2 max-md:flex-col-reverse max-md:items-stretch">
          <Button kind="quiet" onClick={onCancel}>
            Cancel <Kbd>Esc</Kbd>
          </Button>
          <Button kind="primary" onClick={submit} disabled={!ready}>
            {barcode && owner ? 'Save without the barcode' : 'Add to bill'} <Kbd>Enter</Kbd>
          </Button>
        </div>
      </div>
    </OverlayBackdrop>
  );
}
