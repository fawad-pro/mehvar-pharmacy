'use client';

/**
 * Settings → Licence (PCN-006).
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

import { useEffect, useRef, useState } from 'react';

import { LoadFailed, NO_ANSWER } from '@/components/load-failed';

import {
  installLicenceAction,
  licencePanelAction,
  rebindLicenceAction,
  type LicencePanel,
  type SettingsOutcome,
} from './actions';

export function LicenceSection() {
  const [panel, setPanel] = useState<LicencePanel | null>(null);
  const [token, setToken] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);

  // The latest request's answer wins: a slow first load landing after a
  // licence was pasted put the old state back beside "Licence installed."
  const latest = useRef(0);
  async function refresh(): Promise<void> {
    const mine = ++latest.current;
    await licencePanelAction().then(
      (current) => {
        if (mine !== latest.current) return;
        setPanel(current);
        setLoadFailed(current === null);
      },
      () => {
        if (mine === latest.current) setLoadFailed(true);
      },
    );
  }

  useEffect(() => {
    // The load is a promise the effect starts, not a setState it performs.
    void refresh();
  }, []);

  /** A change's answer, or the plain fact that none came. */
  async function change(run: () => Promise<SettingsOutcome>, said: string): Promise<boolean> {
    setBusy(true);
    let ok = false;
    try {
      const result = await run();
      ok = result.ok;
      setMessage(result.ok ? said : result.message);
    } catch {
      setMessage(NO_ANSWER);
    } finally {
      setBusy(false);
    }
    await refresh();
    return ok;
  }

  async function paste(): Promise<void> {
    if (await change(() => installLicenceAction(token), 'Licence installed.')) setToken('');
  }

  async function moveHere(): Promise<void> {
    await change(rebindLicenceAction, 'Licence moved to this computer.');
  }

  return (
    <div className="bg-surface shadow-card rounded-card p-4">
      <h2 className="text-navy mb-2 font-medium">Licence</h2>

      {panel === null && loadFailed ? (
        <LoadFailed what="The licence" onRetry={() => void refresh()} />
      ) : panel === null ? (
        <p className="text-ink-2 text-sm">Loading…</p>
      ) : (
        <>
          <Standing panel={panel} />

          {panel.canRebind ? (
            <button
              type="button"
              onClick={() => void moveHere()}
              disabled={busy}
              className="bg-blue-600 text-surface hover:bg-blue-700 font-semibold min-h-touch mb-3 inline-flex items-center rounded-control px-5"
            >
              Move the licence to this computer
            </button>
          ) : null}

          <label className="mb-1 block text-sm">
            <span className="text-ink-2 mb-1 block">
              Paste a licence from Mehvar — the whole line, in one go.
            </span>
            <textarea
              autoComplete="off"
              value={token}
              onChange={(event) => {
                setToken(event.target.value);
              }}
              rows={3}
              spellCheck={false}
              className="bg-surface shadow-card w-full rounded-card p-2 font-mono text-xs"
              placeholder="MEHVAR1.…"
            />
          </label>

          <button
            type="button"
            onClick={() => void paste()}
            disabled={busy || token.trim() === ''}
            className="bg-blue-600 text-surface hover:bg-blue-700 font-semibold min-h-touch mt-2 inline-flex items-center rounded-control px-5 disabled:opacity-40"
          >
            Install licence
          </button>

          {message === null ? null : (
            <p className="text-ink-2 mt-2 text-sm" role="status">
              {message}
            </p>
          )}

          {panel.installationId === null ? null : (
            <p className="text-ink-2 mt-3 font-mono text-xs">
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
        <p className="text-ink-2 text-sm">Licensed to {panel.customerName}</p>
      )}
      {panel.withheld.length === 0 ? null : (
        // Amber, never red (I7): this is the caution family, alongside
        // near-expiry and unsynced. An authorization state is not an alarm.
        <p className="text-amber-text mt-1 text-sm">
          Paused until activated: {panel.withheld.join(', ')}.
        </p>
      )}
      <p className="text-ink-2 mt-1 text-sm">
        Settling udhaar, printing receipts and exporting your data always keep working.
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
    <p className="text-amber-text mt-2 text-sm">
      {panel.clock === 'system_ahead'
        ? `This computer's date reads ${system}, which is far ahead of everything else Mehvar has recorded. If that date is wrong, fix it in Windows and this will clear itself.`
        : `This computer's date reads ${system}, but Mehvar has previously recorded dates as late as ${recorded}. One of them is wrong — send a support bundle and we will fix it.`}
    </p>
  );
}

function headline(panel: LicencePanel): string {
  switch (panel.status) {
    case 'authorized':
      return 'Licensed — this installation is authorized. A Mehvar licence never expires.';
    case 'evaluation':
      return `Evaluation — ${panel.daysRemaining ?? 0} day(s) left, until ${panel.evaluationEndsOn ?? ''}. Activate a licence any time.`;
    case 'unauthorized':
      return `The 30-day evaluation ended on ${panel.evaluationEndsOn ?? ''}. Paste a licence to authorize this installation.`;
    case 'unbound':
      return 'This licence is registered to a different computer.';
    case 'revoked':
      return 'This licence has been revoked. Contact Mehvar support.';
    default:
      return 'This licence could not be verified.';
  }
}
