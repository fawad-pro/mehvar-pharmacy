import { redirect } from 'next/navigation';

import { loginDeviceAction } from '@/auth/actions';
import { currentSession } from '@/auth/session';
import { PIN_LENGTH } from '@/auth/pin-policy';

/**
 * Device login — ADR-7, performed once per counter machine during assisted
 * setup (Phase 12 §6 step 5) and then effectively never again. The session is
 * long-lived precisely so the shop opens without a login ritual every morning
 * (P8: the counter works every morning, unconditionally).
 *
 * Day-to-day identity is the PIN switch, not this screen.
 *
 * The copy here carries one job beyond labelling the inputs: all three values
 * come from the same place — the setup sheet handed over during onboarding
 * (Phase 3's assisted setup) — and saying that once, up front, removes the real
 * uncertainty. Three fields read as three mysteries otherwise. I5 applies to
 * getting things right, not only to errors: prevent the wrong state rather than
 * explain it afterwards.
 */

const MESSAGES: Record<string, string> = {
  unknown_device:
    'No counter with that name at that pharmacy. Check the pharmacy code and counter name against your setup sheet.',
  bad_pairing_key: 'That setup key is not right. Copy it again from your setup sheet.',
  device_inactive: 'This counter has been turned off. The owner can switch it back on in Settings.',
  tenant_suspended: 'This pharmacy’s account is on hold. Contact support to reactivate it.',
  no_owner: 'This pharmacy has no owner account yet. Contact support.',
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  if (await currentSession()) {
    redirect('/sale');
  }

  const { error } = await searchParams;
  const message = error ? (MESSAGES[error] ?? 'That did not work. Try again.') : null;

  return (
    <main className="flex min-h-screen items-start justify-center p-6 sm:items-center">
      <form action={loginDeviceAction} className="w-full max-w-md">
        <p className="text-blue-600 text-xs font-medium tracking-[0.18em] uppercase">Mehvar</p>
        <h1 className="text-navy mt-1 text-2xl font-semibold">Set up this counter</h1>
        <p className="text-ink-2 mt-2 leading-relaxed">
          This links this machine to your pharmacy. You do this once, on this machine.
        </p>

        {/* Where every value comes from, and who has it — said once, not three
            times. This single sentence is the point of the redesign. */}
        <div className="bg-page mt-5 rounded-card p-3">
          <p className="text-navy text-sm font-medium">
            All three are on your setup sheet from Mehvar.
          </p>
          <p className="text-ink-2 mt-0.5 text-sm">
            Don’t have it? Ask the owner — or message us on WhatsApp.
          </p>
        </div>

        <div className="mt-5 flex flex-col gap-4">
          <Field
            name="tenantSlug"
            label="Pharmacy code"
            hint="Your pharmacy’s short name in Mehvar, e.g. al-shifa"
            autoFocus
          />
          <Field
            name="deviceName"
            label="Counter name"
            hint="Names this machine in reports, e.g. Counter 1"
          />
          {/*
            `one-time-code`, not `off`, and not `current-password`.

            This form is a device pairing, not a login: nothing here is a
            reusable credential and none of it should ever be offered back. But
            it LOOKS like a login to Chrome — two text fields followed by a
            password field — so Chrome offered to save it, and saved the
            "Counter name" as the username.

            The consequence showed up on a completely different screen. Pressing
            F10 mounts the PIN overlay, whose lone password input reads to
            Chrome as another login form; Chrome then filled the saved username
            into the nearest text field, which is the counter's product search
            box. The operator saw "Counter 1" typed into the search box by
            itself, with the quick-item row beneath it offering to create a
            product by that name — one Enter away from a junk product in the
            catalog.

            `autoComplete="off"` does not prevent any of this; Chrome ignores it
            on credential fields. `one-time-code` does, because a one-time code
            is by definition not worth storing.
          */}
          <Field
            name="pairingKey"
            label="Setup key"
            // The likeliest wrong entry is someone's PIN, so rule it out here
            // rather than in an error message afterwards (I5).
            hint="The one-time key on the sheet — not anyone’s PIN"
            type="password"
            autoComplete="one-time-code"
          />
        </div>

        {message ? (
          <p className="text-red mt-4 text-sm" role="alert">
            {message}
          </p>
        ) : null}

        <button
          type="submit"
          className="bg-blue-600 text-surface hover:bg-blue-700 font-semibold min-h-touch mt-5 w-full rounded-control"
        >
          Set up counter
        </button>

        {/* The reassurance that matters most to the person who will actually use
            this machine every day, and who is probably not the person holding
            the sheet. */}
        <p className="text-ink-2 border-line mt-5 border-t pt-4 text-sm leading-relaxed">
          After this, the counter stays signed in. Every day you just tap your name and type your{' '}
          {PIN_LENGTH}-digit PIN.
        </p>
      </form>
    </main>
  );
}

function Field({
  name,
  label,
  hint,
  type = 'text',
  autoComplete = 'off',
  autoFocus = false,
}: {
  name: string;
  label: string;
  hint: string;
  type?: string;
  /**
   * Explicit, because `autoComplete="off"` does not stop Chrome's password
   * manager — it has been ignored for credential-looking fields for a decade.
   * See the note on the pairing key below; this is the field that has to opt
   * out with a token Chrome actually honours.
   */
  autoComplete?: string;
  autoFocus?: boolean;
}) {
  const hintId = `${name}-hint`;

  return (
    <div>
      <label htmlFor={name} className="text-navy block text-sm font-medium">
        {label}
      </label>
      {/* Hint above the input, not below it: it is read before typing, and it
          keeps the validation message the only thing that ever appears under a
          field. */}
      <p id={hintId} className="text-ink-2 mt-0.5 text-sm leading-snug">
        {hint}
      </p>
      <input
        id={name}
        name={name}
        type={type}
        required
        autoFocus={autoFocus}
        autoComplete={autoComplete}
        aria-describedby={hintId}
        className="border-border focus:border-blue-600 h-touch mt-1.5 w-full rounded-control border px-3"
      />
    </div>
  );
}
