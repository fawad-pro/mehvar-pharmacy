'use client';

/**
 * Barcode management for one product — Phase 10 §2 surface 5.
 *
 * A code maps to a *unit level*: "a box barcode and a strip barcode differ"
 * (Phase 5 §2), and getting that wrong sells a box at a strip's price. So the
 * level is a required choice, offered as the product's own levels rather than
 * free text.
 *
 * The input is scanner-first (I1: "the scanner is a keyboard"). Focus lands
 * here, a scan fills it, and Enter submits.
 */

import { useActionState, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';

import { useCatalog } from '@/client/search/provider';
import { unitLevels, type PackLevel } from '@/lib/quantity';

import { saveBarcode, unlinkBarcode, type ActionState } from '../actions';

export interface BarcodeRow {
  id: string;
  barcode: string;
  unitLevelName: string;
}

export function BarcodePanel({
  productId,
  baseUnitName,
  packLevels,
  barcodes,
}: {
  productId: string;
  baseUnitName: string;
  packLevels: PackLevel[];
  barcodes: BarcodeRow[];
}) {
  const router = useRouter();
  const [state, action, pending] = useActionState<ActionState, FormData>(
    saveBarcode.bind(null, productId),
    { status: 'idle' },
  );
  const field = useRef<HTMLInputElement>(null);
  const [unlinkFailed, setUnlinkFailed] = useState(false);
  const { refresh: refreshCatalog } = useCatalog();

  useEffect(() => {
    if (state.status === 'saved') {
      // Clear for the next scan; a counter links several codes in a row.
      field.current?.form?.reset();
      field.current?.focus();
      router.refresh();
      // The counter's search index is client state, not a server page:
      // revalidating does not reach it. Without this, the code just linked
      // scans as unknown until the page is reloaded.
      refreshCatalog();
    }
  }, [state, router, refreshCatalog]);

  const levels = unitLevels(baseUnitName, packLevels);

  return (
    <section className="border-line flex flex-col gap-3 rounded border p-4">
      <h2 className="text-green-900 font-semibold">Barcodes</h2>

      {barcodes.length === 0 ? (
        <p className="text-ink/50 text-sm">
          None yet. Scan a pack below — codes build up as you sell.
        </p>
      ) : (
        <ul className="flex flex-col gap-1">
          {barcodes.map((code) => (
            <li key={code.id} className="flex items-center gap-3 text-sm">
              <span className="numeral font-medium">{code.barcode}</span>
              <span className="text-ink/50 text-xs">per {code.unitLevelName}</span>
              <button
                type="button"
                onClick={() => {
                  setUnlinkFailed(false);
                  unlinkBarcode(productId, code.id).then(
                    () => {
                      router.refresh();
                    },
                    () => {
                      setUnlinkFailed(true);
                    },
                  );
                }}
                className="text-ink/50 hover:text-red ml-auto text-xs"
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}
      {unlinkFailed ? (
        <p className="text-red text-sm" role="alert">
          That code was not removed — the shop&rsquo;s computer did not answer. Try again.
        </p>
      ) : null}

      <form action={action} className="flex flex-wrap items-end gap-2">
        <div className="min-w-48 flex-1">
          <label htmlFor="barcode" className="text-ink/60 block text-xs">
            Scan or type a code
          </label>
          <input
            id="barcode"
            name="barcode"
            ref={field}
            data-scan-target=""
            autoComplete="off"
            className="border-line focus:border-green-600 h-touch mt-1 w-full rounded border px-3 outline-none"
          />
        </div>

        <div>
          <label htmlFor="unitLevelName" className="text-ink/60 block text-xs">
            This code is for one
          </label>
          <select
            id="unitLevelName"
            name="unitLevelName"
            defaultValue={levels[levels.length - 1]?.name ?? baseUnitName}
            className="border-line focus:border-green-600 h-touch mt-1 rounded border px-3 outline-none"
          >
            {levels.map((level) => (
              <option key={level.name} value={level.name}>
                {level.name}
                {level.factor > 1 ? ` (${level.factor} ${baseUnitName})` : ''}
              </option>
            ))}
          </select>
        </div>

        <button
          type="submit"
          disabled={pending}
          className="border-line min-h-touch rounded border px-4 disabled:opacity-40"
        >
          Link
        </button>
      </form>

      {state.status === 'error' ? (
        <p className="text-red text-sm" role="alert">
          {state.message}
        </p>
      ) : null}
    </section>
  );
}
