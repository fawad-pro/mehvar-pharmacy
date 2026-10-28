import { redirect } from 'next/navigation';

import { loginOwnerAction } from '@/auth/actions';
import { currentSession } from '@/auth/session';

/**
 * Owner remote login — W11, ADR-7's "owner logs in normally from any device".
 *
 * Unlike `/login` this is not a one-time setup ritual: the session is
 * short-lived (`OWNER_SESSION_TTL_MS`, Phase 12 §5), so the owner signs in
 * again from their phone whenever they check the shop — "any time", per W11's
 * trigger.
 */

const MESSAGES: Record<string, string> = {
  no_owner: 'No owner account for that pharmacy code. Check it against your setup sheet.',
  tenant_suspended: 'This pharmacy’s account is on hold. Contact support to reactivate it.',
  no_password_set: 'This owner account has no password set yet. Contact support.',
  bad_password: 'That password is not right. Try again.',
};

export default async function OwnerLoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const session = await currentSession();
  if (session && session.userRole === 'owner') {
    redirect('/owner');
  }

  const { error } = await searchParams;
  const message = error ? (MESSAGES[error] ?? 'That did not work. Try again.') : null;

  return (
    <main className="flex min-h-screen items-start justify-center p-6 sm:items-center">
      <form action={loginOwnerAction} className="w-full max-w-sm">
        <p className="text-blue-600 text-xs font-medium tracking-[0.18em] uppercase">Mehvar</p>
        <h1 className="text-navy mt-1 text-2xl font-semibold">Check your shop</h1>
        <p className="text-ink-2 mt-2 leading-relaxed">
          Today’s numbers, exceptions, and stock — from anywhere.
        </p>

        <div className="mt-5 flex flex-col gap-4">
          <div>
            <label htmlFor="tenantSlug" className="text-navy block text-sm font-medium">
              Pharmacy code
            </label>
            <input
              id="tenantSlug"
              name="tenantSlug"
              type="text"
              required
              autoFocus
              autoComplete="off"
              className="border-border focus:border-blue-600 h-touch mt-1.5 w-full rounded-control border px-3"
            />
          </div>
          <div>
            <label htmlFor="password" className="text-navy block text-sm font-medium">
              Password
            </label>
            <input
              id="password"
              name="password"
              type="password"
              required
              autoComplete="current-password"
              className="border-border focus:border-blue-600 h-touch mt-1.5 w-full rounded-control border px-3"
            />
          </div>
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
          Sign in
        </button>
      </form>
    </main>
  );
}
