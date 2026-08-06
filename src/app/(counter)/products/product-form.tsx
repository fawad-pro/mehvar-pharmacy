'use client';

/**
 * Create and edit a product — Phase 10 §2 surface 5.
 *
 * One form for both, because the fields are the same and two nearly-identical
 * forms drift apart. Prices are entered in rupees and converted once, at the
 * server-action boundary (Phase 9 §1: money is integer paisa everywhere else).
 */

import { useActionState, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

import { DuplicateNotice } from '@/components/duplicate-notice';

import { saveProduct, type ActionState } from './actions';
import { exceedsMrp, parsePackLevels } from '@/domain/catalog/product';
import type { PackLevel } from '@/lib/quantity';

export interface ProductFormValues {
  id: string | null;
  name: string;
  manufacturer: string;
  form: string;
  strength: string;
  formulaText: string;
  baseUnitName: string;
  packLevels: string;
  priceRupees: string;
  mrpRupees: string;
  minStock: string;
  needsCompletion: boolean;
}

export function ProductForm({ initial }: { initial: ProductFormValues }) {
  const router = useRouter();
  const [state, action, pending] = useActionState<ActionState, FormData>(
    saveProduct.bind(null, initial.id),
    { status: 'idle' },
  );

  // Watched so the duplicate check answers while the operator types, rather
  // than after they have saved and created the split.
  const [name, setName] = useState(initial.name);
  const [strength, setStrength] = useState(initial.strength);
  const [form, setForm] = useState(initial.form);
  const [manufacturer, setManufacturer] = useState(initial.manufacturer);
  const [formulaText, setFormulaText] = useState(initial.formulaText);

  const [price, setPrice] = useState(initial.priceRupees);
  const [mrp, setMrp] = useState(initial.mrpRupees);
  const [baseUnit, setBaseUnit] = useState(initial.baseUnitName);
  const [packLevels, setPackLevels] = useState(initial.packLevels);

  useEffect(() => {
    if (state.status === 'saved') {
      router.push('/products');
      router.refresh();
    }
  }, [state, router]);

  // D4 — the warning shows as it is typed, and never blocks: "the pack in hand
  // is authoritative, not our data".
  const overMrp = exceedsMrp(
    Math.round(Number(price) * 100),
    mrp === '' ? null : Math.round(Number(mrp) * 100),
  );
  const parsed = parsePackLevels(packLevels);

  return (
    <form action={action} className="flex flex-col gap-5">
      <Section title="What it is">
        <Field
          name="name"
          label="Name"
          value={name}
          onChange={setName}
          required
          autoFocus
        />
        <Field
          name="strength"
          label="Strength"
          hint="e.g. 500mg, 125mg/5ml, 500mg+65mg"
          value={strength}
          onChange={setStrength}
        />
        <Field
          name="form"
          label="Form"
          hint="e.g. Tablet, Syrup"
          value={form}
          onChange={setForm}
        />
        <Field
          name="manufacturer"
          label="Manufacturer"
          value={manufacturer}
          onChange={setManufacturer}
        />
        <Field
          name="formulaText"
          label="Salt / formula"
          hint="What it contains. This is how substitutes are found."
          value={formulaText}
          onChange={setFormulaText}
        />

        {/* Said while it is being typed, never after saving — by then the
            duplicate exists and its stock has started splitting. */}
        <DuplicateNotice
          candidate={{
            id: initial.id,
            name,
            strength,
            form,
            manufacturer,
            formulaText,
          }}
        />
      </Section>

      <Section title="How it is sold">
        <Field
          name="baseUnitName"
          label="Base unit"
          hint="The smallest thing you sell — tab, bottle, piece"
          value={baseUnit}
          onChange={setBaseUnit}
          required
        />
        <Field
          name="packLevels"
          label="Pack levels"
          hint="Bigger units, smallest first: strip:10, box:200"
          value={packLevels}
          onChange={setPackLevels}
        />
        <PackLevelPreview baseUnit={baseUnit} levels={parsed} />
      </Section>

      <Section title="Price">
        <Field
          name="price"
          label={`Selling price per ${baseUnit || 'unit'}`}
          hint="In rupees"
          type="number"
          step="0.01"
          value={price}
          onChange={setPrice}
          required
        />
        <Field
          name="mrp"
          label="MRP printed on the pack"
          hint="In rupees. Optional."
          type="number"
          step="0.01"
          value={mrp}
          onChange={setMrp}
        />
        {overMrp ? (
          <p className="text-amber text-sm">
            This is above the MRP you recorded. That is allowed — the pack in hand is what counts.
          </p>
        ) : null}
        <Field
          name="minStock"
          label="Low-stock level"
          hint={`In ${baseUnit || 'base units'}. Optional — drives the low-stock list.`}
          type="number"
          defaultValue={initial.minStock}
        />
      </Section>

      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" name="needsCompletion" defaultChecked={initial.needsCompletion} />
        Still needs completing
      </label>

      {state.status === 'error' ? (
        <p className="text-red text-sm" role="alert">
          {state.message}
        </p>
      ) : null}

      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={pending}
          className="bg-green-600 text-paper min-h-touch rounded px-6 font-medium disabled:opacity-40"
        >
          {pending ? 'Saving…' : 'Save product'}
        </button>
        <button
          type="button"
          onClick={() => {
            router.push('/products');
          }}
          className="text-ink/60 text-sm"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}

/**
 * Shows what the pack structure means in plain words before it is saved.
 *
 * Pack factors are the one input on this form that corrupts stock silently when
 * wrong (Phase 5 §2), so the owner sees the consequence — "1 box = 200 tab" —
 * rather than trusting the notation.
 */
function PackLevelPreview({ baseUnit, levels }: { baseUnit: string; levels: PackLevel[] }) {
  if (levels.length === 0) {
    return <p className="text-ink/50 text-sm">Sold only as single {baseUnit || 'units'}.</p>;
  }

  return (
    <ul className="text-ink/60 flex flex-wrap gap-x-4 text-sm">
      {levels.map((level, index) => (
        <li key={`${level.name}-${index}`}>
          1 {level.name} ={' '}
          <span className="numeral font-medium">
            {Number.isFinite(level.factor) ? level.factor : '?'}
          </span>{' '}
          {baseUnit || 'units'}
        </li>
      ))}
    </ul>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <fieldset className="border-line flex flex-col gap-3 rounded border p-4">
      <legend className="text-ink/50 px-1 text-xs tracking-[0.14em] uppercase">{title}</legend>
      {children}
    </fieldset>
  );
}

function Field({
  name,
  label,
  hint,
  type = 'text',
  step,
  required = false,
  autoFocus = false,
  defaultValue,
  value,
  onChange,
}: {
  name: string;
  label: string;
  hint?: string;
  type?: string;
  step?: string;
  required?: boolean;
  autoFocus?: boolean;
  defaultValue?: string;
  value?: string;
  onChange?: (next: string) => void;
}) {
  const hintId = `${name}-hint`;
  return (
    <div>
      <label htmlFor={name} className="text-ink block text-sm font-medium">
        {label}
      </label>
      {hint ? (
        <p id={hintId} className="text-ink/60 mt-0.5 text-sm leading-snug">
          {hint}
        </p>
      ) : null}
      <input
        id={name}
        name={name}
        type={type}
        step={step}
        required={required}
        autoFocus={autoFocus}
        autoComplete="off"
        {...(hint ? { 'aria-describedby': hintId } : {})}
        {...(onChange
          ? {
              value: value ?? '',
              onChange: (event: React.ChangeEvent<HTMLInputElement>) => {
                onChange(event.target.value);
              },
            }
          : { defaultValue })}
        className="border-line focus:border-green-600 h-touch mt-1.5 w-full rounded border px-3 outline-none"
      />
    </div>
  );
}
