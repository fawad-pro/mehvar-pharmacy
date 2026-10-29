/**
 * `npm run tenant:provision` — create one cloud pharmacy (PCN-019).
 *
 *   MEHVAR_SHOP_NAME="Al-Shifa Medical Store" MEHVAR_OWNER_PIN=4821 \
 *     npm run tenant:provision
 *
 * The cloud sibling of `init`: `init` provisions the single pharmacy of a local
 * install and refuses once one exists; this adds a tenant to a shared database
 * and refuses only a login name already taken. Same door (`provisioning.ts`),
 * same chokepoint, no `if (cloud)` anywhere in `domain/`.
 *
 * Prints the pairing key and owner password ONCE. Both are stored only as
 * hashes, so a lost one is re-issued, never recovered.
 */
import 'dotenv/config';

import { findTenantBySlug, provisionTenant } from '../../src/db/provisioning';
import type { TenantSettings } from '../../src/db/schema';

import { readProvisionInput } from './provision-input';

/** The first counter. `A` gives receipts `A-1`, `A-2`, … (Phase 9 §3). */
const FIRST_DEVICE_PREFIX = 'A';

async function main(): Promise<void> {
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL is not set.');
  }

  const input = readProvisionInput(process.env);

  if ((await findTenantBySlug(input.slug)) !== undefined) {
    throw new Error(
      `A pharmacy with the login name "${input.slug}" already exists. Nothing was changed. ` +
        'Set MEHVAR_SHOP_SLUG to a different name.',
    );
  }

  const headerLines = [input.shopName, input.address, input.phone].filter(
    (line): line is string => line !== undefined,
  );
  const settings: TenantSettings = {
    receiptHeader: headerLines.join('\n'),
    receiptFooter: 'Shukriya',
    timeZone: input.timeZone,
    expiryHorizonDays: [30, 60, 90],
  };

  const { tenantId, pairingKey, ownerPassword } = await provisionTenant({
    slug: input.slug,
    name: input.shopName,
    settings,
    ownerName: input.ownerName,
    ownerPin: input.ownerPin,
    deviceName: input.deviceName,
    devicePrefix: FIRST_DEVICE_PREFIX,
    plan: input.plan,
    entitlementEndsAt: input.entitlementEndsAt,
  });

  const ends = input.entitlementEndsAt?.toISOString().slice(0, 10) ?? 'no end date';
  console.log(`\n  ${input.shopName} is ready.\n`);
  console.log(`  Tenant id      ${tenantId}`);
  console.log(`  Login as       ${input.slug}`);
  console.log(`  Pairing key    ${pairingKey}`);
  console.log(`  Owner password ${ownerPassword}`);
  console.log(`  Counter        ${input.deviceName} (receipts ${FIRST_DEVICE_PREFIX}-1, …)`);
  console.log(`  Entitlement    ${input.plan}, ${ends}`);
  console.log('\n  The pairing key and owner password are shown once and cannot be recovered.\n');
}

main()
  .then(() => process.exit(0))
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
