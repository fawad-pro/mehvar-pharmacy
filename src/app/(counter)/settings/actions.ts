'use server';

/**
 * Settings actions — Phase 10 §2 surface 9. Owner-only throughout: receipt
 * config and user management are sensitive acts, gated by permission here
 * rather than only by visibility (T1's usual posture is deliberately not
 * applied to this screen, the way it is to W8's adjustments — a salesman
 * adding their own PIN account is not something visibility alone should let
 * happen).
 */

import { currentSession, scopeFor, type ActiveSession } from '@/auth/session';
import { hashPin, InvalidPinFormatError } from '@/auth/pin';
import {
  insertSalesman,
  listUsers,
  resetUserPin,
  setUserActive,
  type UserListItem,
} from '@/db/auth-queries';
import { insertLicence, licenceStanding } from '@/db/licence-queries';
import { forgetLicenceState, resolveLicence } from '@/db/licence-state-queries';
import { tenantSettings, updateTenantSettings } from '@/db/provisioning';
import { CAPABILITY_LABELS, withheldBy } from '@/domain/licensing/capabilities';
import { REBIND_ALLOWANCE, verifyToken } from '@/domain/licensing/verify';
import { readInstallation } from '@/lib/installation';
import { writeLicenceFile } from '@/lib/licence-file';
import type { TenantSettings } from '@/db/schema';
import { uuidv7 } from '@/lib/uuid';

import { revalidateAfter } from '../revalidate';

// Neither `UserListItem` nor the receipt-settings shape is re-exported here —
// a type-only re-export inside a `'use server'` file does not survive Next's
// server-actions transform (CLAUDE.md, Day 4/6/7), even though importing them
// for this file's own internal use, as below, is perfectly safe. The screen
// imports `UserListItem` straight from `@/db/auth-queries` and declares its
// own narrow shape for the two receipt fields it actually edits.

export type SettingsOutcome = { ok: true } | { ok: false; message: string };

function requireOwner(
  session: ActiveSession | undefined,
): session is ActiveSession & { userRole: 'owner' } {
  return session !== undefined && session.userRole === 'owner';
}

export async function currentTenantSettingsAction(): Promise<TenantSettings | null> {
  const session = await currentSession();
  if (!requireOwner(session)) {
    return null;
  }
  return (await tenantSettings(session.tenantId)) ?? null;
}

export async function updateReceiptSettingsAction(input: {
  receiptHeader: string;
  receiptFooter: string;
  autoPrintReceipt: boolean;
}): Promise<SettingsOutcome> {
  const session = await currentSession();
  if (!requireOwner(session)) {
    return { ok: false, message: 'Only the owner can change this.' };
  }
  const current = await tenantSettings(session.tenantId);
  if (!current) {
    return { ok: false, message: 'Could not load current settings.' };
  }
  await updateTenantSettings(session.tenantId, {
    ...current,
    receiptHeader: input.receiptHeader,
    receiptFooter: input.receiptFooter,
    autoPrintReceipt: input.autoPrintReceipt,
  });
  revalidateAfter('settings');
  return { ok: true };
}

export async function listUsersAction(): Promise<UserListItem[]> {
  const session = await currentSession();
  if (!requireOwner(session)) {
    return [];
  }
  return listUsers(scopeFor(session));
}

export async function addSalesmanAction(input: {
  name: string;
  pin: string;
}): Promise<SettingsOutcome> {
  const session = await currentSession();
  if (!requireOwner(session)) {
    return { ok: false, message: 'Only the owner can add a user.' };
  }
  const name = input.name.trim();
  if (name === '') {
    return { ok: false, message: 'Enter a name.' };
  }

  let pinHash: string;
  try {
    pinHash = await hashPin(input.pin);
  } catch (error) {
    if (error instanceof InvalidPinFormatError) {
      return { ok: false, message: error.message };
    }
    throw error;
  }

  await insertSalesman(scopeFor(session), { id: uuidv7(), name, pinHash });
  revalidateAfter('settings');
  return { ok: true };
}

export async function setUserActiveAction(
  userId: string,
  isActive: boolean,
): Promise<SettingsOutcome> {
  const session = await currentSession();
  if (!requireOwner(session)) {
    return { ok: false, message: 'Only the owner can change this.' };
  }
  await setUserActive(scopeFor(session), userId, isActive);
  revalidateAfter('settings');
  return { ok: true };
}

export async function resetUserPinAction(userId: string, pin: string): Promise<SettingsOutcome> {
  const session = await currentSession();
  if (!requireOwner(session)) {
    return { ok: false, message: 'Only the owner can change this.' };
  }
  let pinHash: string;
  try {
    pinHash = await hashPin(pin);
  } catch (error) {
    if (error instanceof InvalidPinFormatError) {
      return { ok: false, message: error.message };
    }
    throw error;
  }
  await resetUserPin(scopeFor(session), userId, pinHash);
  revalidateAfter('settings');
  return { ok: true };
}

/* ------------------------------------------------------------------ */
/* Licence (PCN-005)                                                   */
/* ------------------------------------------------------------------ */

/**
 * The shape the screen renders. Declared here rather than imported from
 * `@/db/licence-state-queries`, because a client component must never name a
 * module that reaches the database — the erasure argument is exactly the one
 * this rule exists to refuse (CLAUDE.md, Day 7).
 */
export interface LicencePanel {
  readonly status: string;
  readonly tier: 'full' | 'full_notice' | 'restricted';
  readonly customerName: string | null;
  readonly entitlementEndsOn: string | null;
  readonly graceEndsOn: string | null;
  readonly daysRemaining: number | null;
  readonly trialEndsOn: string | null;
  readonly invalidReason: string | null;
  readonly withheld: readonly string[];
  readonly rebindsUsed: number;
  readonly rebindAllowance: number;
  readonly canRebind: boolean;
  readonly installationId: string | null;
  readonly clock: 'none' | 'system_ahead' | 'system_behind';
  readonly systemNow: string;
  readonly businessNow: string;
}

export async function licencePanelAction(): Promise<LicencePanel | null> {
  const session = await currentSession();
  if (!requireOwner(session)) return null;
  return buildPanel(session);
}

/**
 * Install a pasted licence.
 *
 * Owner-only, and reachable in **every** licence state including `invalid`
 * (Invariant L4): a bad licence must never lock the owner out of the one screen
 * where licences are fixed. That is why `manage_settings` is permitted in every
 * tier rather than gated like receiving is.
 */
export async function installLicenceAction(token: string): Promise<SettingsOutcome> {
  const session = await currentSession();
  if (!requireOwner(session)) {
    return { ok: false, message: 'Only the owner can change the licence.' };
  }

  const installationId = readInstallation()?.installationId;
  if (installationId === undefined) {
    return {
      ok: false,
      message: 'This computer has no installation record yet. Restart Mehvar and try again.',
    };
  }

  const verified = verifyToken(token, { expectedTenantSlug: session.tenantSlug });
  if (!verified.ok) {
    return { ok: false, message: licenceRefusalMessage(verified.reason) };
  }

  const { payload } = verified.licence;
  await insertLicence(scopeFor(session), {
    id: uuidv7(),
    token: verified.licence.token,
    licenceId: payload.licenceId,
    issuedAt: new Date(payload.issuedAt),
    entitlementEndsAt: new Date(payload.entitlementEndsAt),
    tokenExpiresAt: new Date(payload.expiresAt),
    graceDays: payload.graceDays,
    warnDays: payload.warnDays,
    installationId,
  });

  // Kept on disk too, so a database restored from an old dump does not lose a
  // licence the machine already had. Boot reconciles the two by union.
  writeLicenceFile(verified.licence.token);

  // Without this the owner pastes a valid licence, the banner persists for a
  // minute, and they reasonably conclude it did not work.
  forgetLicenceState(session.tenantId);
  revalidateAfter('settings');
  return { ok: true };
}

/**
 * Move a licence to this computer.
 *
 * Self-service up to the allowance, because the day a customer's disk dies is
 * the worst possible day to make them phone support. Past the allowance the
 * screen asks them to get in touch — and the message never accuses.
 */
export async function rebindLicenceAction(): Promise<SettingsOutcome> {
  const session = await currentSession();
  if (!requireOwner(session)) {
    return { ok: false, message: 'Only the owner can move the licence.' };
  }

  const installationId = readInstallation()?.installationId;
  if (installationId === undefined) {
    return { ok: false, message: 'This computer has no installation record yet.' };
  }

  const standing = await licenceStanding(scopeFor(session), installationId, new Date());
  if (standing.effective === undefined) {
    return { ok: false, message: 'There is no licence on this pharmacy to move.' };
  }
  if (standing.boundHere) {
    return { ok: true };
  }
  if (standing.rebindsUsed >= REBIND_ALLOWANCE) {
    return {
      ok: false,
      message:
        'This licence has already moved computer a few times this year, so we need to ' +
        'do the next one together. Send Mehvar support a support bundle and we will ' +
        'sort it out.',
    };
  }

  return installLicenceAction(standing.effective.token);
}

function licenceRefusalMessage(reason: string): string {
  switch (reason) {
    case 'wrong_pharmacy':
      return 'That licence belongs to a different pharmacy. Check you pasted the right one.';
    case 'format_too_new':
      return 'That licence needs a newer version of Mehvar. Update Mehvar, then paste it again.';
    case 'unknown_key':
      return 'This copy of Mehvar does not recognise the key that signed that licence. Contact support.';
    case 'malformed':
      return 'That does not look like a Mehvar licence. Paste the whole line, all in one go.';
    default:
      return 'That licence could not be verified. Contact Mehvar support.';
  }
}

async function buildPanel(session: ActiveSession): Promise<LicencePanel> {
  const resolved = await resolveLicence(
    session.tenantId,
    session.userId,
    session.tenantSlug,
    (await tenantSettings(session.tenantId))?.timeZone,
  );
  const { state } = resolved;

  return {
    status: state.status,
    tier: state.tier,
    customerName: state.customerName ?? null,
    entitlementEndsOn: state.entitlementEndsOn ?? null,
    graceEndsOn: state.graceEndsOn ?? null,
    daysRemaining: state.daysRemaining ?? null,
    trialEndsOn: state.trialEndsOn ?? null,
    invalidReason: state.invalidReason ?? null,
    withheld: withheldBy(state.tier).map((capability) => CAPABILITY_LABELS[capability]),
    rebindsUsed: resolved.rebindsUsed,
    rebindAllowance: REBIND_ALLOWANCE,
    canRebind: state.status === 'unbound' && resolved.rebindsUsed < REBIND_ALLOWANCE,
    installationId: resolved.installationId ?? null,
    clock: resolved.clock,
    systemNow: resolved.systemNow.toISOString(),
    businessNow: resolved.businessNow.toISOString(),
  };
}
