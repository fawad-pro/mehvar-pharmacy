import { redirect } from 'next/navigation';

import { loginDeviceAction } from '@/auth/actions';
import { currentSession } from '@/auth/session';

/**
 * Device login — ADR-7, performed once per counter machine during assisted
 * setup (Phase 12 §6 step 5) and then effectively never again. The session is
 * long-lived precisely so the shop opens without a login ritual every morning
 * (P8: the counter works every morning, unconditionally).
 *
 * Day-to-day identity is the PIN switch, not this screen.
 */

const MESSAGES: Record<string, string> = {
  unknown_device: 'No counter with that name at that pharmacy. Check both, then try again.',
  bad_pairing_key: 'That setup key is not right. Check the setup sheet.',
  device_inactive: 'This counter has been deactivated. The owner can re-enable it.',
  tenant_suspended: 'This pharmacy’s account is on hold. Contact support to reactivate it.',
  no_owner: 'This pharmacy has no active owner account yet. Contact support.',
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
    <main className="flex min-h-screen items-center justify-center p-6">
      <form action={loginDeviceAction} className="flex w-full max-w-sm flex-col gap-4">
        <div>
          <p className="text-green-600 text-xs font-medium tracking-[0.18em] uppercase">Mehvar</p>
          <h1 className="text-green-900 text-2xl font-semibold">Set up this counter</h1>
          <p className="text-ink/60 mt-1 text-sm">
            One time only. After this, sign in with your PIN.
          </p>
        </div>

        <Field name="tenantSlug" label="Pharmacy code" autoFocus />
        <Field name="deviceName" label="Counter name" />
        <Field name="pairingKey" label="Setup key" type="password" />

        {message ? (
          <p className="text-red text-sm" role="alert">
            {message}
          </p>
        ) : null}

        <button type="submit" className="bg-green-600 text-paper min-h-touch rounded font-medium">
          Set up counter
        </button>
      </form>
    </main>
  );
}

function Field({
  name,
  label,
  type = 'text',
  autoFocus = false,
}: {
  name: string;
  label: string;
  type?: string;
  autoFocus?: boolean;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-ink/60 text-xs">{label}</span>
      <input
        name={name}
        type={type}
        required
        autoFocus={autoFocus}
        autoComplete="off"
        className="border-line focus:border-green-600 h-touch rounded border px-3 outline-none"
      />
    </label>
  );
}
