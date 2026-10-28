'use client';

/**
 * [PCN-013] Corrections to a customer or a supplier: fix a typed name or phone,
 * remove one added by mistake, put a removed one back.
 *
 * One panel for both because they are the same thing to the shop — a name and
 * a phone number attached to money. The server actions arrive bound to the
 * record, so this file knows nothing about which kind it is editing. Removal
 * takes two steps, so a stray Enter removes nothing, and is refused by the
 * server while money is still owed either way; the refusal is shown as said.
 */

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { NO_ANSWER } from './load-failed';

type Outcome = { ok: true } | { ok: false; message: string };

export function ContactCorrections({
  kind,
  name,
  phone,
  isActive,
  canRemove,
  save,
  remove,
  restore,
}: {
  /** "customer" or "supplier", for the words on the buttons. */
  kind: string;
  name: string;
  phone: string | null;
  isActive: boolean;
  /** Owner only; the server checks again. */
  canRemove: boolean;
  save: (draft: { name: string; phone: string }) => Promise<Outcome>;
  remove: () => Promise<Outcome>;
  restore: () => Promise<Outcome>;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [draftName, setDraftName] = useState(name);
  const [draftPhone, setDraftPhone] = useState(phone ?? '');
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run(action: () => Promise<Outcome>, after: () => void) {
    setBusy(true);
    setError(null);
    const outcome = await action().catch((): Outcome => ({ ok: false, message: NO_ANSWER }));
    setBusy(false);
    // Answered either way: a refusal left on "Yes, remove" invites a second
    // press that cannot succeed.
    setConfirming(false);
    if (!outcome.ok) {
      setError(outcome.message);
      return;
    }
    after();
    router.refresh();
  }

  if (!isActive) {
    return (
      <div className="border-line flex flex-wrap items-center gap-3 rounded border px-3 py-2">
        <p className="text-sm">Removed — not offered when picking a {kind}.</p>
        {canRemove ? (
          <button
            type="button"
            onClick={() => void run(restore, () => undefined)}
            disabled={busy}
            className="border-line min-h-touch ml-auto rounded border px-4"
          >
            Restore
          </button>
        ) : null}
        {error ? (
          <p role="alert" className="text-red w-full text-sm">
            {error}
          </p>
        ) : null}
      </div>
    );
  }

  return (
    <div className="border-line flex flex-col gap-2 rounded border p-3">
      {editing ? (
        <form
          className="flex flex-wrap items-end gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            void run(
              () => save({ name: draftName, phone: draftPhone }),
              () => setEditing(false),
            );
          }}
        >
          <label className="text-ink/70 flex flex-col text-xs">
            Name
            <input
              autoComplete="off"
              autoFocus
              value={draftName}
              onChange={(event) => setDraftName(event.target.value)}
              className="border-line focus:border-green-600 h-touch min-w-56 rounded border px-3 text-base outline-none"
            />
          </label>
          <label className="text-ink/70 flex flex-col text-xs">
            Phone
            <input
              autoComplete="off"
              inputMode="tel"
              value={draftPhone}
              onChange={(event) => setDraftPhone(event.target.value)}
              className="border-line focus:border-green-600 h-touch min-w-40 rounded border px-3 text-base outline-none"
            />
          </label>
          <button
            type="submit"
            disabled={busy}
            className="bg-green-600 text-paper min-h-touch rounded px-4 font-medium"
          >
            Save
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              setEditing(false);
              setDraftName(name);
              setDraftPhone(phone ?? '');
              setError(null);
            }}
            className="border-line min-h-touch rounded border px-4"
          >
            Cancel
          </button>
        </form>
      ) : confirming ? (
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-sm">
            Remove {name}? They stop being offered when picking a {kind}. Their history stays.
          </p>
          <button
            type="button"
            autoFocus
            onClick={() => void run(remove, () => undefined)}
            disabled={busy}
            className="bg-red text-paper min-h-touch rounded px-4 font-medium"
          >
            Yes, remove
          </button>
          <button
            type="button"
            onClick={() => setConfirming(false)}
            disabled={busy}
            className="border-line min-h-touch rounded border px-4"
          >
            Cancel
          </button>
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => {
              setError(null);
              setEditing(true);
            }}
            className="border-line min-h-touch rounded border px-4"
          >
            Edit name or phone
          </button>
          {canRemove ? (
            <button
              type="button"
              onClick={() => {
                setError(null);
                setConfirming(true);
              }}
              className="border-line min-h-touch rounded border px-4"
            >
              Remove {kind}
            </button>
          ) : null}
        </div>
      )}
      {error ? (
        <p role="alert" className="text-red text-sm">
          {error}
        </p>
      ) : null}
    </div>
  );
}
