'use client';

/**
 * Settings — Phase 10 §2 surface 9: "receipt header/footer, users & PINs,
 * printer setup guide, export (Phase 3 §5.2 lives here, owner-only)."
 */

import { useEffect, useState } from 'react';

import type { UserListItem } from '@/db/auth-queries';

import {
  addSalesmanAction,
  currentTenantSettingsAction,
  listUsersAction,
  resetUserPinAction,
  setUserActiveAction,
  updateReceiptSettingsAction,
} from './actions';

/** Just the two fields this screen edits — see actions.ts for why this is not
 * `TenantSettings` imported from `@/db/schema`. */
interface ReceiptSettings {
  receiptHeader: string;
  receiptFooter: string;
  autoPrintReceipt: boolean;
}

export function SettingsSurface() {
  return (
    <section className="mx-auto flex max-w-2xl flex-col gap-8 p-4">
      <h1 className="text-green-900 text-2xl font-semibold">Settings</h1>
      <ReceiptSettingsForm />
      <UsersAndPins />
      <PrinterGuide />
      <ExportSection />
    </section>
  );
}

function ReceiptSettingsForm() {
  const [settings, setSettings] = useState<ReceiptSettings | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);

  useEffect(() => {
    void currentTenantSettingsAction().then((current) => {
      if (current) {
        setSettings({
          receiptHeader: current.receiptHeader,
          receiptFooter: current.receiptFooter,
          autoPrintReceipt: current.autoPrintReceipt ?? true,
        });
      }
    });
  }, []);

  async function save(): Promise<void> {
    if (!settings || busy) {
      return;
    }
    setBusy(true);
    setDone(null);
    const outcome = await updateReceiptSettingsAction(settings);
    setBusy(false);
    setDone(outcome.ok ? 'Saved.' : outcome.message);
  }

  return (
    <div className="border-line rounded border p-4">
      <h2 className="text-green-900 mb-2 font-medium">Receipt</h2>
      {!settings ? (
        <p className="text-ink/50 text-sm">Loading…</p>
      ) : (
        <div className="flex flex-col gap-3">
          <div>
            <label className="text-ink/60 mb-1 block text-xs" htmlFor="receipt-header">
              Header (printed at the top, one line per row)
            </label>
            <textarea
              id="receipt-header"
              value={settings.receiptHeader}
              onChange={(event) => {
                setSettings({ ...settings, receiptHeader: event.target.value });
                setDone(null);
              }}
              rows={3}
              className="border-line focus:border-green-600 w-full rounded border px-3 py-2 outline-none"
            />
          </div>
          <div>
            <label className="text-ink/60 mb-1 block text-xs" htmlFor="receipt-footer">
              Footer (thank-you line)
            </label>
            <input
              id="receipt-footer"
              value={settings.receiptFooter}
              onChange={(event) => {
                setSettings({ ...settings, receiptFooter: event.target.value });
                setDone(null);
              }}
              className="border-line focus:border-green-600 h-touch w-full rounded border px-3 outline-none"
            />
          </div>
          {/* Some shops hand a receipt over only when it is asked for. The
              sale never depended on printing; this makes the paper optional
              too, without taking it away — it stays one key from the last
              sale on the counter screen. */}
          <label className="flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              checked={settings.autoPrintReceipt}
              onChange={(event) => {
                setSettings({ ...settings, autoPrintReceipt: event.target.checked });
                setDone(null);
              }}
              className="mt-1"
            />
            <span>
              Print a receipt for every sale
              <span className="text-ink/50 block text-xs">
                Off: nothing prints unless you press Print receipt.
              </span>
            </span>
          </label>

          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => void save()}
              disabled={busy}
              className="bg-green-600 text-paper min-h-touch rounded px-5 font-medium disabled:opacity-40"
            >
              {busy ? 'Saving…' : 'Save'}
            </button>
            {done ? (
              <p className="text-green-900 text-sm" role="status">
                {done}
              </p>
            ) : null}
          </div>
        </div>
      )}
    </div>
  );
}

function UsersAndPins() {
  const [users, setUsers] = useState<UserListItem[]>([]);
  const [name, setName] = useState('');
  const [pin, setPin] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function refresh(): void {
    void listUsersAction().then(setUsers);
  }

  useEffect(refresh, []);

  async function addUser(): Promise<void> {
    if (busy) {
      return;
    }
    setBusy(true);
    setError(null);
    const outcome = await addSalesmanAction({ name, pin });
    setBusy(false);
    if (!outcome.ok) {
      setError(outcome.message);
      return;
    }
    setName('');
    setPin('');
    refresh();
  }

  async function toggleActive(user: UserListItem): Promise<void> {
    await setUserActiveAction(user.id, !user.isActive);
    refresh();
  }

  async function resetPin(user: UserListItem): Promise<void> {
    const newPin = window.prompt(`New PIN for ${user.name}`);
    if (!newPin) {
      return;
    }
    const outcome = await resetUserPinAction(user.id, newPin);
    if (!outcome.ok) {
      window.alert(outcome.message);
    }
  }

  return (
    <div className="border-line rounded border p-4">
      <h2 className="text-green-900 mb-2 font-medium">Users & PINs</h2>

      <ul className="border-line divide-line divide-y rounded border text-sm">
        {users.map((user) => (
          <li key={user.id} className="flex items-center justify-between px-3 py-2">
            <span>
              <span className="font-medium">{user.name}</span>
              <span className="text-ink/60 ml-2">{user.role}</span>
              {!user.isActive ? <span className="text-ink/40 ml-2 text-xs">inactive</span> : null}
            </span>
            {user.role === 'salesman' ? (
              <span className="flex gap-3">
                <button
                  type="button"
                  onClick={() => void resetPin(user)}
                  className="text-ink/60 text-xs"
                >
                  Reset PIN
                </button>
                <button
                  type="button"
                  onClick={() => void toggleActive(user)}
                  className="text-ink/60 text-xs"
                >
                  {user.isActive ? 'Deactivate' : 'Reactivate'}
                </button>
              </span>
            ) : null}
          </li>
        ))}
      </ul>

      <div
        className="mt-3 flex flex-wrap items-end gap-3"
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault();
            void addUser();
          }
        }}
      >
        <div className="min-w-40">
          <label className="text-ink/60 mb-1 block text-xs" htmlFor="new-user-name">
            New salesman&rsquo;s name
          </label>
          <input
            id="new-user-name"
            value={name}
            onChange={(event) => {
              setName(event.target.value);
            }}
            className="border-line focus:border-green-600 h-touch w-full rounded border px-3 outline-none"
          />
        </div>
        <div className="w-32">
          <label className="text-ink/60 mb-1 block text-xs" htmlFor="new-user-pin">
            PIN
          </label>
          <input
            id="new-user-pin"
            value={pin}
            inputMode="numeric"
            type="password"
            onChange={(event) => {
              setPin(event.target.value);
            }}
            className="border-line focus:border-green-600 numeral h-touch w-full rounded border px-3 outline-none"
          />
        </div>
        <button
          type="button"
          onClick={() => void addUser()}
          disabled={busy || name.trim() === '' || pin === ''}
          className="bg-green-600 text-paper min-h-touch rounded px-5 font-medium disabled:opacity-40"
        >
          Add — Enter
        </button>
      </div>
      {error ? (
        <p className="text-red mt-2 text-sm" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}

function PrinterGuide() {
  return (
    <div className="border-line rounded border p-4">
      <h2 className="text-green-900 mb-2 font-medium">Printer setup</h2>
      <ol className="text-ink/70 list-inside list-decimal space-y-1 text-sm">
        <li>Connect the receipt printer and set it as the default printer.</li>
        <li>
          Launch the browser with kiosk printing so a receipt prints silently:{' '}
          <code className="bg-green-100/60 rounded px-1">--kiosk-printing</code>.
        </li>
        <li>Print a test sale (F1) and confirm the receipt number and totals line up.</li>
      </ol>
    </div>
  );
}

function ExportSection() {
  return (
    <div className="border-line rounded border p-4">
      <h2 className="text-green-900 mb-2 font-medium">Export your data</h2>
      <p className="text-ink/70 mb-3 text-sm">
        Every table, filtered to this pharmacy, as one CSV per table in a zip. Available any time —
        even if the account is on hold.
      </p>
      <a
        href="/api/export"
        className="bg-green-600 text-paper min-h-touch inline-flex items-center rounded px-5 font-medium"
      >
        Download export
      </a>
    </div>
  );
}
