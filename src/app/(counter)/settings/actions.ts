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
import { tenantSettings, updateTenantSettings } from '@/db/provisioning';
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
