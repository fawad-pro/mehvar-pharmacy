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
import { Banner } from '@/components/ui/banner';
import { Button, Kbd } from '@/components/ui/button';
import { dialogPanelClass } from '@/components/ui/dialog';
import { FieldLabel, inputClass } from '@/components/ui/field';

export interface SwitchableUser {
  id: string;
  name: string;
  role: string;
}

/** Why a switch was refused. A lockout is said as a banner; the rest beneath the PIN. */
interface Refusal {
  kind: 'locked' | 'other';
  text: string;
}

function messageFor(result: Extract<AuthResult, { ok: false }>, name: string): Refusal {
  switch (result.reason) {
    case 'bad_pin':
      return { kind: 'other', text: 'That PIN is not right. Try again.' };
    case 'locked_out': {
      const minutes = Math.max(1, Math.ceil((result.retryAfterMs ?? 0) / 60_000));
      return {
        kind: 'locked',
        text: `${name} can sign in again in ${minutes} minute${minutes === 1 ? '' : 's'}, or the owner can unlock them now.`,
      };
    }
    case 'unknown_user':
      return { kind: 'other', text: 'That user is no longer active. Pick another name.' };
    case 'no_session':
      return { kind: 'other', text: 'This device needs to sign in again.' };
    default:
      return { kind: 'other', text: 'That did not work. Try again.' };
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
  const [error, setError] = useState<Refusal | null>(null);
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
    setError(messageFor(result, users.find((user) => user.id === selectedId)?.name ?? 'This user'));
    setPin('');
    pinField.current?.focus();
  }

  const selected = users.find((user) => user.id === selectedId);

  return (
    <OverlayBackdrop label="Switch user" onDismiss={onClose}>
      {/* The card never grows past the screen: the list of names scrolls, so
          the PIN field and Switch stay in reach however many users a shop has. */}
      <div className={dialogPanelClass}>
        <h2 className="text-heading m-0">Who is at the counter?</h2>

        {/* A lockout is a refusal, said above the names: the way on is
            another name, or the owner. */}
        {error?.kind === 'locked' ? (
          <Banner tone="refused" role="alert" lead="Too many tries.">
            {error.text}
          </Banner>
        ) : null}

        <ul
          className="bg-page m-0 flex min-h-0 list-none flex-col overflow-y-auto rounded-card p-0"
          role="listbox"
          aria-label="Users"
        >
          {users.map((user, index) => (
            <li key={user.id} role="option" aria-selected={user.id === selectedId}>
              <button
                type="button"
                onClick={() => {
                  setSelectedId(user.id);
                  setError(null);
                  pinField.current?.focus();
                }}
                className={[
                  'border-line flex min-h-touch w-full items-center justify-between gap-3 px-4 py-2 text-left',
                  index === 0 ? '' : 'border-t',
                  user.id === selectedId ? 'bg-blue-50' : 'hover:bg-mist',
                ].join(' ')}
              >
                <span className="text-control font-medium">{user.name}</span>
                <span className="text-label text-ink-2 font-normal">
                  {roleLabel(user.role)}
                  {user.id === currentUserId ? ' · now' : ''}
                </span>
              </button>
            </li>
          ))}
        </ul>

        <div className="flex flex-col gap-1.5">
          <label className="flex flex-col gap-1.5">
            <FieldLabel>{selected ? `${selected.name}’s PIN` : 'PIN'}</FieldLabel>
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
              aria-invalid={error?.kind === 'other' ? true : undefined}
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
              className={`${inputClass} numeral text-center text-2xl tracking-[0.5em]`}
            />
          </label>
          {error?.kind === 'other' ? (
            <span className="text-body-sm text-red font-medium" role="alert">
              {error.text}
            </span>
          ) : null}
          {error?.kind === 'locked' ? (
            <span className="text-body-sm text-ink-2">Pick another name to switch now.</span>
          ) : null}
        </div>

        <div className="mt-1 flex flex-wrap items-center justify-end gap-2 max-md:flex-col-reverse max-md:items-stretch">
          <Button kind="quiet" onClick={onClose}>
            Cancel <Kbd>Esc</Kbd>
          </Button>
          <Button
            kind="primary"
            onClick={() => void submit()}
            disabled={pin.length !== PIN_LENGTH || busy}
          >
            Switch <Kbd>Enter</Kbd>
          </Button>
        </div>
      </div>
    </OverlayBackdrop>
  );
}

function roleLabel(role: string): string {
  return role === 'owner' ? 'Owner' : role === 'salesman' ? 'Salesman' : role;
}
