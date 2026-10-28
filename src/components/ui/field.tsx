/**
 * Field, AmountField and Select — the design system's `mv-field`,
 * `mv-amount` and `mv-select` (PCN-016).
 *
 * The label is nested around the control, so it labels it without an id
 * (Day 6), and is one line of at most 14 characters. An error is a 2 px red
 * edge plus the next step in words beneath. The words beneath sit outside
 * the label and describe the control, so they are never part of its name
 * ("Discount on the bill" must not also answer to "Cash tendered").
 */

import { useId } from 'react';

export const inputClass =
  'h-touch w-full rounded-control border border-border bg-surface px-3.5 text-control font-normal text-navy placeholder:text-ink-2 enabled:hover:border-navy focus:border-blue-600 disabled:cursor-not-allowed disabled:bg-mist disabled:opacity-50 aria-invalid:border-2 aria-invalid:border-red';

export const selectClass = `${inputClass} cursor-pointer appearance-none bg-[length:12px_8px] bg-[position:right_14px_center] bg-no-repeat pr-10 bg-[image:var(--chevron)]`;

export function FieldLabel({ children }: { children: React.ReactNode }) {
  return (
    <span className="h-label text-label block truncate whitespace-nowrap text-ink-2">
      {children}
    </span>
  );
}

export function FieldMessage({
  id,
  help,
  error,
}: {
  id?: string;
  help?: React.ReactNode;
  error?: React.ReactNode;
}) {
  if (error)
    return (
      <span id={id} className="text-body-sm font-medium text-red">
        {error}
      </span>
    );
  if (help)
    return (
      <span id={id} className="text-body-sm text-ink-2">
        {help}
      </span>
    );
  return null;
}

export function Field({
  label,
  help,
  error,
  className = '',
  autoComplete,
  ...input
}: React.ComponentProps<'input'> & {
  /** Required: Chrome fills a saved login into any field that does not opt out. */
  autoComplete: string;
  label: React.ReactNode;
  help?: React.ReactNode;
  error?: React.ReactNode;
}) {
  const messageId = useId();
  return (
    <div className={`flex min-w-0 flex-col gap-1.5 ${className}`}>
      <label className="flex min-w-0 flex-col gap-1.5">
        <FieldLabel>{label}</FieldLabel>
        <input
          className={inputClass}
          autoComplete={autoComplete}
          aria-invalid={error ? true : undefined}
          aria-describedby={help || error ? messageId : undefined}
          {...input}
        />
      </label>
      <FieldMessage id={messageId} help={help} error={error} />
    </div>
  );
}

/** Money in: `Rs` before, right-aligned, tabular, 18 px. */
export function AmountField({
  label,
  help,
  error,
  className = '',
  autoComplete,
  ...input
}: React.ComponentProps<'input'> & {
  /** Required: Chrome fills a saved login into any field that does not opt out. */
  autoComplete: string;
  label: React.ReactNode;
  help?: React.ReactNode;
  error?: React.ReactNode;
}) {
  const messageId = useId();
  return (
    <div className={`flex min-w-0 flex-col gap-1.5 ${className}`}>
      <label className="flex min-w-0 flex-col gap-1.5">
        <FieldLabel>{label}</FieldLabel>
        <span className="relative block">
          <span
            aria-hidden="true"
            className="text-body-sm pointer-events-none absolute inset-y-0 left-3.5 flex items-center text-ink-2"
          >
            Rs
          </span>
          <input
            autoComplete={autoComplete}
            inputMode="decimal"
            className={`${inputClass} numeral text-field-lg pl-11 font-medium`}
            aria-invalid={error ? true : undefined}
            aria-describedby={help || error ? messageId : undefined}
            {...input}
          />
        </span>
      </label>
      <FieldMessage id={messageId} help={help} error={error} />
    </div>
  );
}

export function Select({
  label,
  help,
  error,
  className = '',
  children,
  ...select
}: React.ComponentProps<'select'> & {
  label: React.ReactNode;
  help?: React.ReactNode;
  error?: React.ReactNode;
}) {
  const messageId = useId();
  return (
    <div className={`flex min-w-0 flex-col gap-1.5 ${className}`}>
      <label className="flex min-w-0 flex-col gap-1.5">
        <FieldLabel>{label}</FieldLabel>
        <select
          className={selectClass}
          aria-invalid={error ? true : undefined}
          aria-describedby={help || error ? messageId : undefined}
          {...select}
        >
          {children}
        </select>
      </label>
      <FieldMessage id={messageId} help={help} error={error} />
    </div>
  );
}
