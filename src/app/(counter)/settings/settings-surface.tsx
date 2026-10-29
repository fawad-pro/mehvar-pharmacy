'use client';

/**
 * Settings — Phase 10 §2 surface 9: "receipt header/footer, users & PINs,
 * printer setup guide, export (Phase 3 §5.2 lives here, owner-only)."
 */

import { useEffect, useState } from 'react';

import { testReceipt } from '@/client/print/receipt';
import { usePrintReceipt } from '@/client/print/use-print-receipt';
import { useReceiptContext } from '@/client/receipt/receipt-context';
import { LoadFailed, NO_ANSWER } from '@/components/load-failed';
import { ReceiptView } from '@/components/receipt-view';
import { DEFAULT_BILL_DISCOUNT_CAP_PERCENT } from '@/domain/sales/cart';
import type { UserListItem } from '@/db/auth-queries';

import { LicenceSection } from './licence-section';
import {
  addSalesmanAction,
  currentTenantSettingsAction,
  listUsersAction,
  resetUserPinAction,
  setUserActiveAction,
  updateReceiptSettingsAction,
  updateSellingSettingsAction,
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
      <h1 className="text-navy text-2xl font-semibold">Settings</h1>
      <ReceiptSettingsForm />
      <SellingSettings />
      <UsersAndPins />
      <PrinterGuide />
      <LicenceSection />
      <ExportSection />
    </section>
  );
}

/**
 * [PCN-012, as amended 2026-10-26] Which unit a sale line starts in for a
 * product this counter has not sold before. Every unit stays one tap away on
 * the line; this only saves that tap for the shop's usual case. It applies to
 * every product at once, existing ones included.
 */
function SellingSettings() {
  const receiptContext = useReceiptContext();
  const [startsLoose, setStartsLoose] = useState<boolean | null>(null);
  const [udhaar, setUdhaar] = useState(true);
  /** [PCN-014] As typed; checked on Save. */
  const [cap, setCap] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    // A late answer must never overwrite what the owner has already changed:
    // development runs this effect twice, and the second load landing after a
    // click silently saved the old value back. Only the live load applies.
    let cancelled = false;
    currentTenantSettingsAction().then(
      (current) => {
        if (cancelled) return;
        if (!current) {
          setLoadFailed(true);
          return;
        }
        setStartsLoose(current.saleStartsLoose ?? false);
        setUdhaar(current.udhaarEnabled ?? true);
        setCap(String(current.billDiscountCapPercent ?? DEFAULT_BILL_DISCOUNT_CAP_PERCENT));
      },
      () => {
        if (!cancelled) setLoadFailed(true);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [attempt]);

  async function save(): Promise<void> {
    if (startsLoose === null || busy) {
      return;
    }
    setBusy(true);
    setDone(null);
    setProblem(null);
    const capPercent = /^\d{1,3}$/.test(cap.trim()) ? Number(cap.trim()) : Number.NaN;
    try {
      const outcome = await updateSellingSettingsAction({
        saleStartsLoose: startsLoose,
        udhaarEnabled: udhaar,
        billDiscountCapPercent: capPercent,
      });
      // The counter holds its settings for the session, as with the receipt.
      if (outcome.ok) {
        await receiptContext?.reload();
        setDone('Saved.');
      } else {
        setProblem(outcome.message);
      }
    } catch {
      setProblem(NO_ANSWER);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="bg-surface shadow-card rounded-card p-4">
      <h2 className="text-navy mb-2 font-medium">Selling</h2>
      {startsLoose === null && loadFailed ? (
        <LoadFailed
          what="The selling settings"
          onRetry={() => {
            setLoadFailed(false);
            setAttempt((current) => current + 1);
          }}
        />
      ) : startsLoose === null ? (
        <p className="text-ink-2 text-sm">Loading…</p>
      ) : (
        <div className="flex flex-col gap-3">
          <label className="flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              checked={startsLoose}
              onChange={(event) => {
                setStartsLoose(event.target.checked);
                setDone(null);
              }}
              className="mt-1"
            />
            <span>
              Start sales in loose tablets/capsules
              <span className="text-ink-2 block text-xs">
                Off: a sale starts in the strip (the smallest pack). Either way every unit is one
                tap away on the line, and each product starts in the unit it was last sold in.
              </span>
            </span>
          </label>
          <label className="flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              checked={udhaar}
              onChange={(event) => {
                setUdhaar(event.target.checked);
                setDone(null);
              }}
              className="mt-1"
            />
            <span>
              Sell on udhaar
              <span className="text-ink-2 block text-xs">
                Off: the sale screen and the key bar have no udhaar controls, and every sale is paid
                in full. Existing customer accounts and their balances are kept and stay on the
                Customers screen.
              </span>
            </span>
          </label>
          <div className="flex flex-col gap-1 text-sm">
            <label htmlFor="bill-discount-cap">Discount limit without the owner (%)</label>
            <input
              id="bill-discount-cap"
              autoComplete="off"
              inputMode="numeric"
              aria-describedby="bill-discount-cap-help"
              value={cap}
              onChange={(event) => {
                setCap(event.target.value);
                setDone(null);
              }}
              className="border-border focus:border-blue-600 h-touch w-24 rounded-control border px-3"
            />
            {/* Described, not part of the label: a label is the field's name,
                and this one would otherwise be called "…owner's PIN…". */}
            <p id="bill-discount-cap-help" className="text-ink-2 text-xs">
              All discounts on a bill together — item discounts and the bill discount — as a share
              of the bill before any discount. A bill discount over this needs the owner&rsquo;s
              PIN. 0 means every bill discount does.
            </p>
          </div>
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => void save()}
              aria-label="Save selling setting"
              disabled={busy}
              className="bg-blue-600 text-surface hover:bg-blue-700 font-semibold min-h-touch rounded-control px-5 disabled:opacity-40"
            >
              {busy ? 'Saving…' : 'Save'}
            </button>
            <SaveResult done={done} problem={problem} />
          </div>
        </div>
      )}
    </div>
  );
}

/** A save's answer: confirmed quietly, refused in red (I7). */
function SaveResult({ done, problem }: { done: string | null; problem: string | null }) {
  if (problem) {
    return (
      <p className="text-red text-sm" role="alert">
        {problem}
      </p>
    );
  }
  return done ? (
    <p className="text-green-700 text-sm" role="status">
      {done}
    </p>
  ) : null;
}

function ReceiptSettingsForm() {
  const receiptContext = useReceiptContext();
  const [settings, setSettings] = useState<ReceiptSettings | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    // See `SellingSettings`: only the live load may fill the form.
    let cancelled = false;
    currentTenantSettingsAction().then(
      (current) => {
        if (cancelled) return;
        if (!current) {
          setLoadFailed(true);
          return;
        }
        setSettings({
          receiptHeader: current.receiptHeader,
          receiptFooter: current.receiptFooter,
          autoPrintReceipt: current.autoPrintReceipt ?? true,
        });
      },
      () => {
        if (!cancelled) setLoadFailed(true);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [attempt]);

  async function save(): Promise<void> {
    if (!settings || busy) {
      return;
    }
    setBusy(true);
    setDone(null);
    setProblem(null);
    try {
      const outcome = await updateReceiptSettingsAction(settings);
      // The counter holds these settings for the whole session; without this
      // the change took effect only after a restart.
      if (outcome.ok) {
        await receiptContext?.reload();
        setDone('Saved.');
      } else {
        setProblem(outcome.message);
      }
    } catch {
      setProblem(NO_ANSWER);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="bg-surface shadow-card rounded-card p-4">
      <h2 className="text-navy mb-2 font-medium">Receipt</h2>
      {!settings && loadFailed ? (
        <LoadFailed
          what="The receipt settings"
          onRetry={() => {
            setLoadFailed(false);
            setAttempt((current) => current + 1);
          }}
        />
      ) : !settings ? (
        <p className="text-ink-2 text-sm">Loading…</p>
      ) : (
        <div className="flex flex-col gap-3">
          <div>
            <label className="text-ink-2 mb-1 block text-xs" htmlFor="receipt-header">
              Header (printed at the top, one line per row)
            </label>
            <textarea
              autoComplete="off"
              id="receipt-header"
              value={settings.receiptHeader}
              onChange={(event) => {
                setSettings({ ...settings, receiptHeader: event.target.value });
                setDone(null);
              }}
              rows={3}
              className="border-border focus:border-blue-600 w-full rounded border px-3 py-2"
            />
          </div>
          <div>
            <label className="text-ink-2 mb-1 block text-xs" htmlFor="receipt-footer">
              Footer (thank-you line)
            </label>
            <input
              autoComplete="off"
              id="receipt-footer"
              value={settings.receiptFooter}
              onChange={(event) => {
                setSettings({ ...settings, receiptFooter: event.target.value });
                setDone(null);
              }}
              className="border-border focus:border-blue-600 h-touch w-full rounded-control border px-3"
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
              <span className="text-ink-2 block text-xs">
                Off: nothing prints unless you press Print receipt.
              </span>
            </span>
          </label>

          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => void save()}
              disabled={busy}
              className="bg-blue-600 text-surface hover:bg-blue-700 font-semibold min-h-touch rounded-control px-5 disabled:opacity-40"
            >
              {busy ? 'Saving…' : 'Save'}
            </button>
            <SaveResult done={done} problem={problem} />
          </div>
        </div>
      )}
    </div>
  );
}

function UsersAndPins() {
  /** Null until the list has answered: an empty list is not "no users". */
  const [users, setUsers] = useState<UserListItem[] | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [name, setName] = useState('');
  const [pin, setPin] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function refresh(): void {
    listUsersAction().then(
      (list) => {
        setUsers(list);
        setLoadFailed(false);
      },
      () => {
        setLoadFailed(true);
      },
    );
  }

  useEffect(refresh, []);

  async function addUser(): Promise<void> {
    if (busy) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const outcome = await addSalesmanAction({ name, pin });
      if (!outcome.ok) {
        setError(outcome.message);
        return;
      }
      setName('');
      setPin('');
      refresh();
    } catch {
      setError(NO_ANSWER);
    } finally {
      setBusy(false);
    }
  }

  async function toggleActive(user: UserListItem): Promise<void> {
    setError(null);
    try {
      await setUserActiveAction(user.id, !user.isActive);
      refresh();
    } catch {
      setError(NO_ANSWER);
    }
  }

  async function resetPin(user: UserListItem): Promise<void> {
    const newPin = window.prompt(`New PIN for ${user.name}`);
    if (!newPin) {
      return;
    }
    setError(null);
    try {
      const outcome = await resetUserPinAction(user.id, newPin);
      if (!outcome.ok) {
        window.alert(outcome.message);
      }
    } catch {
      setError(NO_ANSWER);
    }
  }

  return (
    <div className="bg-surface shadow-card rounded-card p-4">
      <h2 className="text-navy mb-2 font-medium">Users & PINs</h2>

      {users === null ? (
        loadFailed ? (
          <LoadFailed what="The list of users" onRetry={refresh} />
        ) : (
          <p className="text-ink-2 text-sm">Loading…</p>
        )
      ) : (
        <ul className="border-line divide-line divide-y rounded border text-sm">
          {users.map((user) => (
            <li key={user.id} className="flex items-center justify-between px-3 py-2">
              <span>
                <span className="font-medium">{user.name}</span>
                <span className="text-ink-2 ml-2">{user.role}</span>
                {!user.isActive ? <span className="text-ink-2 ml-2 text-xs">inactive</span> : null}
              </span>
              {user.role === 'salesman' ? (
                <span className="flex gap-3">
                  <button
                    type="button"
                    onClick={() => void resetPin(user)}
                    className="text-ink-2 text-xs"
                  >
                    Reset PIN
                  </button>
                  <button
                    type="button"
                    onClick={() => void toggleActive(user)}
                    className="text-ink-2 text-xs"
                  >
                    {user.isActive ? 'Deactivate' : 'Reactivate'}
                  </button>
                </span>
              ) : null}
            </li>
          ))}
        </ul>
      )}

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
          <label className="text-ink-2 mb-1 block text-xs" htmlFor="new-user-name">
            New salesman&rsquo;s name
          </label>
          <input
            id="new-user-name"
            value={name}
            autoComplete="off"
            onChange={(event) => {
              setName(event.target.value);
            }}
            className="border-border focus:border-blue-600 h-touch w-full rounded-control border px-3"
          />
        </div>
        <div className="w-32">
          <label className="text-ink-2 mb-1 block text-xs" htmlFor="new-user-pin">
            PIN
          </label>
          <input
            id="new-user-pin"
            value={pin}
            inputMode="numeric"
            type="password"
            // A name field then a password field reads to Chrome as a login:
            // it filled the device's saved login into the new salesman's name
            // and PIN. `one-time-code` is a token it honours; `off` is not
            // (see password-autofill.test.ts).
            autoComplete="one-time-code"
            onChange={(event) => {
              setPin(event.target.value);
            }}
            className="border-border focus:border-blue-600 numeral h-touch w-full rounded-control border px-3"
          />
        </div>
        <button
          type="button"
          onClick={() => void addUser()}
          disabled={busy || name.trim() === '' || pin === ''}
          className="bg-blue-600 text-surface hover:bg-blue-700 font-semibold min-h-touch rounded-control px-5 disabled:opacity-40"
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
  const receiptContext = useReceiptContext();
  const { receipt, print } = usePrintReceipt();

  return (
    <div className="bg-surface shadow-card rounded-card p-4">
      <h2 className="text-navy mb-2 font-medium">Printer setup</h2>
      <ol className="text-ink-2 list-inside list-decimal space-y-1 text-sm">
        <li>
          Connect the receipt printer and set it as the Windows default printer — not
          &ldquo;Microsoft Print to PDF&rdquo;, which saves a file instead of printing.
        </li>
        <li>
          Launch the browser with kiosk printing so a receipt prints silently:{' '}
          <code className="bg-mist rounded px-1">--kiosk-printing</code>.
        </li>
        <li>Print a test receipt and check that it comes out of the receipt printer.</li>
      </ol>
      <button
        type="button"
        onClick={() => {
          if (!receiptContext) {
            return;
          }
          print(
            testReceipt({
              tenantHeaderLines: receiptContext.tenantHeaderLines,
              tenantFooterLine: receiptContext.tenantFooterLine,
              salesmanName: receiptContext.salesmanName,
              now: new Date(),
            }),
          );
        }}
        disabled={!receiptContext}
        className="border-border hover:bg-blue-50 min-h-touch mt-3 rounded-control border px-5 font-medium disabled:opacity-40"
      >
        Print test receipt
      </button>
      {receipt ? <ReceiptView receipt={receipt} /> : null}
    </div>
  );
}

function ExportSection() {
  return (
    <div className="bg-surface shadow-card rounded-card p-4">
      <h2 className="text-navy mb-2 font-medium">Export your data</h2>
      <p className="text-ink-2 mb-3 text-sm">
        Every table, filtered to this pharmacy, as one CSV per table in a zip. Available any time —
        even if the account is on hold.
      </p>
      <a
        href="/api/export"
        className="bg-blue-600 text-surface hover:bg-blue-700 font-semibold min-h-touch inline-flex items-center rounded-control px-5"
      >
        Download export
      </a>
    </div>
  );
}
