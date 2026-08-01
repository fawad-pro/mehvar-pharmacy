/**
 * Auth-related reads and writes.
 *
 * Lives inside `src/db` because Phase 9 §5.2 puts every query here: "one
 * data-access module owns every query… no raw queries outside it." `src/auth`
 * orchestrates policy and cookies; the SQL is all in this file.
 *
 * Most of these go through `TenantScope`. The two that cannot are marked, and
 * the reason is structural: resolving a session and finding a tenant by slug are
 * what *establish* tenant context, so they necessarily run before it exists.
 * Confining them here — two named functions, both returning a single row keyed
 * by a high-entropy token or a unique slug — is what keeps ADR-2's chokepoint
 * honest rather than merely nominal.
 */

import 'server-only';

import { and, eq } from 'drizzle-orm';

import type { Uuid } from '@/lib/uuid';

import { globalCatalog, type TenantScope } from './scoped';
import { devices, sessions, tenants, users } from './schema';

export interface SessionRow {
  sessionId: Uuid;
  kind: 'device' | 'owner_remote';
  expiresAt: Date;
  revokedAt: Date | null;
  tenantId: Uuid;
  tenantName: string;
  tenantSlug: string;
  tenantStatus: 'active' | 'suspended';
  deviceId: Uuid | null;
  deviceName: string | null;
  receiptPrefix: string | null;
  userId: Uuid;
  userName: string;
  userRole: 'owner' | 'salesman';
  userActive: boolean;
}

/** Pre-tenant-context by necessity: this lookup is what establishes the context. */
export async function findSessionByTokenHash(tokenHash: string): Promise<SessionRow | undefined> {
  const rows = await globalCatalog()
    .select({
      sessionId: sessions.id,
      kind: sessions.kind,
      expiresAt: sessions.expiresAt,
      revokedAt: sessions.revokedAt,
      tenantId: tenants.id,
      tenantName: tenants.name,
      tenantSlug: tenants.slug,
      tenantStatus: tenants.status,
      deviceId: devices.id,
      deviceName: devices.name,
      receiptPrefix: devices.receiptPrefix,
      userId: users.id,
      userName: users.name,
      userRole: users.role,
      userActive: users.isActive,
    })
    .from(sessions)
    .innerJoin(tenants, eq(sessions.tenantId, tenants.id))
    .innerJoin(users, eq(sessions.userId, users.id))
    .leftJoin(devices, eq(sessions.deviceId, devices.id))
    .where(eq(sessions.tokenHash, tokenHash))
    .limit(1);

  return rows[0];
}

export interface DeviceLoginRow {
  tenantId: Uuid;
  tenantStatus: 'active' | 'suspended';
  deviceId: Uuid;
  deviceName: string;
  pairingKeyHash: string;
  deviceActive: boolean;
}

/** Pre-tenant-context by necessity: the slug is how a device names its tenant. */
export async function findDeviceForLogin(
  tenantSlug: string,
  deviceName: string,
): Promise<DeviceLoginRow | undefined> {
  const rows = await globalCatalog()
    .select({
      tenantId: tenants.id,
      tenantStatus: tenants.status,
      deviceId: devices.id,
      deviceName: devices.name,
      pairingKeyHash: devices.pairingKeyHash,
      deviceActive: devices.isActive,
    })
    .from(devices)
    .innerJoin(tenants, eq(devices.tenantId, tenants.id))
    .where(and(eq(tenants.slug, tenantSlug), eq(devices.name, deviceName)))
    .limit(1);

  return rows[0];
}

export interface OwnerLoginRow {
  tenantId: Uuid;
  tenantStatus: 'active' | 'suspended';
  userId: Uuid;
  userName: string;
  passwordHash: string | null;
  userActive: boolean;
}

/**
 * Pre-tenant-context by necessity, same reason `findDeviceForLogin` is: the
 * slug is how the owner names their tenant, logging in "normally from any
 * device" (ADR-7) rather than by pairing.
 */
export async function findOwnerForLogin(tenantSlug: string): Promise<OwnerLoginRow | undefined> {
  const rows = await globalCatalog()
    .select({
      tenantId: tenants.id,
      tenantStatus: tenants.status,
      userId: users.id,
      userName: users.name,
      passwordHash: users.passwordHash,
      userActive: users.isActive,
    })
    .from(users)
    .innerJoin(tenants, eq(users.tenantId, tenants.id))
    .where(and(eq(tenants.slug, tenantSlug), eq(users.role, 'owner')))
    .limit(1);

  return rows[0];
}

/** The default acting user a freshly paired device starts as: the tenant's owner. */
export async function findOwnerUserId(tenantId: Uuid): Promise<Uuid | undefined> {
  const rows = await globalCatalog()
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.tenantId, tenantId), eq(users.role, 'owner'), eq(users.isActive, true)))
    .limit(1);

  return rows[0]?.id;
}

/* -------------------------------------------------------------------------- */
/* Scoped: everything below runs with tenant context established               */
/* -------------------------------------------------------------------------- */

export interface SwitchableUser {
  id: Uuid;
  name: string;
  role: 'owner' | 'salesman';
  failedPinAttempts: number;
  pinLockedUntil: Date | null;
  pinHash: string;
}

/** Users this device may switch between (Phase 10 §1's active-user chip). */
export async function listSwitchableUsers(scope: TenantScope): Promise<SwitchableUser[]> {
  const rows = await scope.select(users, eq(users.isActive, true));
  return rows
    .map((row) => ({
      id: row.id,
      name: row.name,
      role: row.role,
      failedPinAttempts: row.failedPinAttempts,
      pinLockedUntil: row.pinLockedUntil,
      pinHash: row.pinHash,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export async function findUser(
  scope: TenantScope,
  userId: Uuid,
): Promise<SwitchableUser | undefined> {
  const row = await scope.selectOne(users, eq(users.id, userId), eq(users.isActive, true));
  if (!row) {
    return undefined;
  }
  return {
    id: row.id,
    name: row.name,
    role: row.role,
    failedPinAttempts: row.failedPinAttempts,
    pinLockedUntil: row.pinLockedUntil,
    pinHash: row.pinHash,
  };
}

export async function recordPinAttempt(
  scope: TenantScope,
  userId: Uuid,
  state: { failedPinAttempts: number; pinLockedUntil: Date | null },
): Promise<void> {
  await scope.update(users, state, eq(users.id, userId));
}

export interface UserListItem {
  id: Uuid;
  name: string;
  role: 'owner' | 'salesman';
  isActive: boolean;
}

/** Settings screen's "users & PINs" list — every user, active or not. */
export async function listUsers(scope: TenantScope): Promise<UserListItem[]> {
  const rows = await scope.select(users);
  return rows
    .map((row) => ({ id: row.id, name: row.name, role: row.role, isActive: row.isActive }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** Adds a salesman (W8's "salesman may adjust" already assumes this role exists). */
export async function insertSalesman(
  scope: TenantScope,
  row: { id: Uuid; name: string; pinHash: string },
): Promise<void> {
  await scope.insert(users, { ...row, role: 'salesman' });
}

export async function setUserActive(
  scope: TenantScope,
  userId: Uuid,
  isActive: boolean,
): Promise<void> {
  await scope.update(users, { isActive }, eq(users.id, userId));
}

/** Owner override (Phase 12 §5) — a new PIN, and lockout cleared with it. */
export async function resetUserPin(scope: TenantScope, userId: Uuid, pinHash: string): Promise<void> {
  await scope.update(
    users,
    { pinHash, failedPinAttempts: 0, pinLockedUntil: null },
    eq(users.id, userId),
  );
}

export async function insertSession(
  scope: TenantScope,
  row: {
    id: Uuid;
    kind: 'device' | 'owner_remote';
    deviceId: Uuid | null;
    userId: Uuid;
    tokenHash: string;
    expiresAt: Date;
  },
): Promise<void> {
  await scope.insert(sessions, row);
}

export async function setSessionUser(
  scope: TenantScope,
  sessionId: Uuid,
  userId: Uuid,
): Promise<void> {
  await scope.update(sessions, { userId }, eq(sessions.id, sessionId));
}

export async function revokeSession(scope: TenantScope, sessionId: Uuid): Promise<void> {
  await scope.update(sessions, { revokedAt: new Date() }, eq(sessions.id, sessionId));
}
