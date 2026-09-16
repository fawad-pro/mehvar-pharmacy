'use client';

/**
 * Settings → Licence (PCN-005).
 *
 * Reachable in **every** licence state, including `invalid` (Invariant L4). A
 * bad licence must never lock the owner out of the one screen where licences
 * are fixed — Day 5's rule that a wall the operator cannot see or clear is
 * worse than an outage.
 *
 * `LicencePanel` is imported as a type from the action module, which is a
 * `'use server'` file — safe, because it is only imported here for this file's
 * own use and never re-exported from there (CLAUDE.md, Day 4/6/7).
 */

import { useEffect, useState } from 'react';

import {
  installLicenceAction,
  licencePanelAction,
  rebindLicenceAction,
  type LicencePanel,
} from './actions';

export function LicenceSection() {
  const [panel, setPanel] = useState<LicencePanel | null>(null);
  const [token, setToken] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function refresh(): Promise<void> {
    setPanel(await licencePanelAction());
  }

  useEffect(() => {
    // Same shape as `ReceiptSettingsForm` above it: the load is a promise the
    // effect starts, not a setState the effect performs.
    void licencePanelAction().then((current) => {
      setPanel(current);
    });
  }, []);

  async function paste(): Promise<void> {
    setBusy(true);
    const result = await installLicenceAction(token);
    setBusy(false);
    setMessage(result.ok ? 'Licence installed.' : result.message);
    if (result.ok) setToken('');
    await refresh();
  }

  async function moveHere(): Promise<void> {
    setBusy(true);
    const result = await rebindLicenceAction();
    setBusy(false);
    setMessage(result.ok ? 'Licence moved to this computer.' : result.message);
    await refresh();
  }

  return (
    <div className="border-line rounded border p-4">
      <h2 className="text-green-900 mb-2 font-medium">Licence</h2>

      {panel === null ? (
        <p className="text-ink/60 text-sm">Loading…</p>
      ) : (
        <>
          <Standing panel={panel} />

          {panel.canRebind ? (
            <button
              type="button"
              onClick={() => void moveHere()}
              disabled={busy}
              className="bg-green-600 text-paper min-h-touch mb-3 inline-flex items-center rounded px-5 font-medium"
            >
              Move the licence to this computer
            </button>
          ) : null}

          <label className="mb-1 block text-sm">
            <span className="text-ink/70 mb-1 block">
              Paste a licence from Mehvar — the whole line, in one go.
            </span>
            <textarea
              value={token}
              onChange={(event) => {
                setToken(event.target.value);
              }}
              rows={3}
              spellCheck={false}
              className="border-line w-full rounded border p-2 font-mono text-xs"
              placeholder="MEHVAR1.…"
            />
          </label>

          <button
            type="button"
            onClick={() => void paste()}
            disabled={busy || token.trim() === ''}
            className="bg-green-600 text-paper min-h-touch mt-2 inline-flex items-center rounded px-5 font-medium disabled:opacity-40"
          >
            Install licence
          </button>

          {message === null ? null : (
            <p className="text-ink/70 mt-2 text-sm" role="status">
              {message}
            </p>
          )}

          {panel.installationId === null ? null : (
            <p className="text-ink/40 mt-3 font-mono text-xs">
              This computer: {panel.installationId}
            </p>
          )}
        </>
      )}
    </div>
  );
}

function Standing({ panel }: { panel: LicencePanel }): React.ReactElement {
  return (
    <div className="mb-3">
      <p className="text-sm">
        <span className="font-medium">{headline(panel)}</span>
      </p>
      {panel.customerName === null ? null : (
        <p className="text-ink/70 text-sm">Licensed to {panel.customerName}</p>
      )}
      {panel.withheld.length === 0 ? null : (
        // Amber, never red (I7): this is the caution family, alongside
        // near-expiry and unsynced. A billing state is not an alarm.
        <p className="text-amber mt-1 text-sm">
          Paused until renewed: {panel.withheld.join(', ')}.
        </p>
      )}
      <p className="text-ink/60 mt-1 text-sm">
        Selling, printing receipts and exporting your data always keep working.
      </p>
      {panel.clock === 'none' ? null : <ClockNotice panel={panel} />}
    </div>
  );
}

/**
 * The two dates, stated plainly.
 *
 * `system_behind` has two causes that are genuinely indistinguishable here — a
 * clock that was turned back, and a witness poisoned by a past fault — so the
 * screen reports what it can see instead of guessing (decision D5e). The
 * support bundle's observation histogram is what separates them, and a person
 * reads it.
 */
function ClockNotice({ panel }: { panel: LicencePanel }): React.ReactElement {
  const system = panel.systemNow.slice(0, 10);
  const recorded = panel.businessNow.slice(0, 10);

  return (
    <p className="text-amber mt-2 text-sm">
      {panel.clock === 'system_ahead'
        ? `This computer's date reads ${system}, which is far ahead of everything else Mehvar has recorded. If that date is wrong, fix it in Windows and this will clear itself.`
        : `This computer's date reads ${system}, but Mehvar has previously recorded dates as late as ${recorded}. One of them is wrong — send a support bundle and we will fix it.`}
    </p>
  );
}

function headline(panel: LicencePanel): string {
  switch (panel.status) {
    case 'trial':
      return `Trial — ${panel.daysRemaining ?? 0} day(s) left, until ${panel.trialEndsOn ?? ''}.`;
    case 'licensed':
      return `Licensed until ${panel.entitlementEndsOn ?? ''}.`;
    case 'expiring':
      return `Renewal due — ${panel.daysRemaining ?? 0} day(s) left, until ${panel.entitlementEndsOn ?? ''}.`;
    case 'grace':
      return `Overdue since ${panel.entitlementEndsOn ?? ''}. Everything still works until ${panel.graceEndsOn ?? ''}.`;
    case 'stale':
      return `Licensed until ${panel.entitlementEndsOn ?? ''}. Mehvar has not been able to check in recently.`;
    case 'lapsed':
      return panel.entitlementEndsOn === null
        ? 'The trial has ended.'
        : `The licence ran out on ${panel.graceEndsOn ?? panel.entitlementEndsOn}.`;
    case 'unbound':
      return 'This licence is registered to a different computer.';
    default:
      return 'This licence could not be verified.';
  }
}
