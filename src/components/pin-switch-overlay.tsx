'use client';

/**
 * The PIN-switch overlay — F10, ADR-7's central interaction.
 *
 * "The counter is a shared terminal — the real auth act is 'which person is
 * acting now'." Pick a name, type four digits, and every record from here on
 * carries that person (T1).
 *
 * Errors follow I5: say what to do next, plainly, without blame. A locked
 * account says when it will free itself, because "try again later" without a
 * number is the kind of message that makes someone call the founder.
 */

import { useEffect, useRef, useState } from 'react';

import { switchUser, type AuthResult } from '@/auth/actions';
import { PIN_LENGTH } from '@/auth/pin-policy';
import { OverlayBackdrop } from '@/components/overlay-backdrop';

export interface SwitchableUser {
  id: string;
  name: string;
  role: string;
}

function messageFor(result: Extract<AuthResult, { ok: false }>): string {
  switch (result.reason) {
    case 'bad_pin':
      return 'That PIN is not right. Try again.';
    case 'locked_out': {
      const minutes = Math.max(1, Math.ceil((result.retryAfterMs ?? 0) / 60_000));
      return `Too many tries. This user can sign in again in ${minutes} minute${minutes === 1 ? '' : 's'}, or the owner can unlock it.`;
    }
    case 'unknown_user':
      return 'That user is no longer active. Pick another name.';
    case 'no_session':
      return 'This device needs to sign in again.';
    default:
      return 'That did not work. Try again.';
  }
}

export function PinSwitchOverlay({
  users,
  currentUserId,
  onClose,
  onSwitched,
}: {
  users: SwitchableUser[];
  currentUserId: string;
  onClose: () => void;
  onSwitched: () => void;
}) {
  const [selectedId, setSelectedId] = useState(
    () => users.find((user) => user.id !== currentUserId)?.id ?? currentUserId,
  );
  const [pin, setPin] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const pinField = useRef<HTMLInputElement>(null);

  useEffect(() => {
    pinField.current?.focus();
  }, []);

  async function submit(): Promise<void> {
    if (pin.length !== PIN_LENGTH || busy) {
      return;
    }
    setBusy(true);
    setError(null);

    const result = await switchUser({ userId: selectedId, pin });
    setBusy(false);

    if (result.ok) {
      onSwitched();
      return;
    }
    setError(messageFor(result));
    setPin('');
    pinField.current?.focus();
  }

  return (
    <OverlayBackdrop label="Switch user" onDismiss={onClose}>
      {/* The card never grows past the screen: the list of names scrolls, so
          the PIN field and Switch stay in reach however many users a shop has. */}
      <div className="bg-paper flex max-h-full w-full max-w-sm flex-col rounded-lg p-5 shadow-xl">
        <h2 className="text-green-900 mb-4 text-lg font-semibold">Who is at the counter?</h2>

        <div className="mb-4 flex min-h-0 flex-col gap-1 overflow-y-auto">
          {users.map((user) => (
            <button
              key={user.id}
              type="button"
              onClick={() => {
                setSelectedId(user.id);
                pinField.current?.focus();
              }}
              className={[
                'flex min-h-touch items-center justify-between rounded px-3 text-left',
                user.id === selectedId ? 'bg-green-100 text-green-900' : 'hover:bg-green-100/50',
              ].join(' ')}
            >
              <span className="font-medium">{user.name}</span>
              <span className="text-ink/50 text-xs capitalize">{user.role}</span>
            </button>
          ))}
        </div>

        <label className="text-ink/60 mb-1 block text-xs" htmlFor="pin">
          PIN
        </label>
        <input
          id="pin"
          ref={pinField}
          value={pin}
          inputMode="numeric"
          // A PIN is a one-time code, and saying so is what stops Chrome
          // treating this overlay as a login form. It used to: a lone password
          // input is enough, and Chrome answered by autofilling the username it
          // had saved from the pairing screen into the nearest text field on
          // the page — the product search box behind this overlay. Pressing F10
          // appeared to type "Counter 1" into the counter, with the quick-item
          // row offering to create a product by that name. `autoComplete="off"`
          // is ignored on credential fields; `one-time-code` is not.
          autoComplete="one-time-code"
          type="password"
          maxLength={PIN_LENGTH}
          onChange={(event) => {
            setPin(event.target.value.replace(/\D/g, ''));
            setError(null);
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              void submit();
            }
            if (event.key === 'Escape') {
              onClose();
            }
          }}
          className="border-line focus:border-green-600 h-touch w-full rounded border px-3 text-2xl tracking-[0.5em] outline-none"
        />

        {error ? (
          <p className="text-red mt-2 text-sm" role="alert">
            {error}
          </p>
        ) : null}

        <div className="mt-4 flex items-center justify-between">
          <button type="button" onClick={onClose} className="text-ink/60 text-sm">
            Esc to cancel
          </button>
          <button
            type="button"
            onClick={() => void submit()}
            disabled={pin.length !== PIN_LENGTH || busy}
            className="bg-green-600 text-paper min-h-touch rounded px-5 font-medium disabled:opacity-40"
          >
            Switch
          </button>
        </div>
      </div>
    </OverlayBackdrop>
  );
}
