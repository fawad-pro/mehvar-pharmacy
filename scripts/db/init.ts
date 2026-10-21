/**
 * `npm run init` — provision a real pharmacy.
 *
 * The one door between a freshly migrated database and a shop that can sell.
 * `db:seed` is its sibling and stays what it is: a demo pharmacy, a build
 * artifact, staging's data. This one takes a real shop's details and creates
 * exactly what ADR-7's two login paths need and nothing more — a tenant, an
 * owner, and one counter device.
 *
 * The installer calls it (roadmap Phase 1, PCN-004). It is therefore written to
 * be run by a program on a machine with no developer present: every input comes
 * from the environment, every failure names what to do next, and it refuses
 * rather than guesses.
 *
 * Deliberately NOT a first-run wizard. The Settings screen already edits the
 * receipt header and footer; a guided flow becomes worth building at roadmap
 * Phase 2, when installs outrun the founder's presence. See
 * `docs/research/commercialization.md` §0.1 — build the simple thing, and check
 * the harder thing is still reachable from it.
 */
import 'dotenv/config';

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { hashPassword, hashPin } from '../../src/auth/pin';
import { generatePairingKey } from '../../src/auth/pairing-key';
import { currentRelease } from '../../src/lib/release';
import { isWellFormedPin, PIN_LENGTH } from '../../src/auth/pin-policy';
import { createTenant, listTenantIds } from '../../src/db/provisioning';
import { tenantScope } from '../../src/db/scoped';
import { devices, users, type TenantSettings } from '../../src/db/schema';
import { ensureInstallation, installationDir } from '../../src/lib/installation';
import { slugify } from '../../src/lib/slug';
import { uuidv7 } from '../../src/lib/uuid';

/** The first counter. `A` gives receipts `A-1`, `A-2`, … (Phase 9 §3). */
const FIRST_DEVICE_PREFIX = 'A';

interface InitInput {
  shopName: string;
  slug: string;
  ownerName: string;
  ownerPin: string;
  deviceName: string;
  address: string | undefined;
  phone: string | undefined;
  timeZone: string;
}

function required(name: string, value: string | undefined): string {
  if (value === undefined || value.trim() === '') {
    throw new Error(`${name} is required. The installer passes it; set it and re-run.`);
  }
  return value.trim();
}

function readInput(env: NodeJS.ProcessEnv): InitInput {
  const shopName = required('MEHVAR_SHOP_NAME', env.MEHVAR_SHOP_NAME);
  const ownerPin = required('MEHVAR_OWNER_PIN', env.MEHVAR_OWNER_PIN);

  if (!isWellFormedPin(ownerPin)) {
    throw new Error(`MEHVAR_OWNER_PIN must be exactly ${PIN_LENGTH} digits.`);
  }

  return {
    shopName,
    slug: env.MEHVAR_SHOP_SLUG?.trim() || slugify(shopName),
    ownerName: env.MEHVAR_OWNER_NAME?.trim() || 'Owner',
    ownerPin,
    deviceName: env.MEHVAR_DEVICE_NAME?.trim() || 'Counter 1',
    address: env.MEHVAR_SHOP_ADDRESS?.trim() || undefined,
    phone: env.MEHVAR_SHOP_PHONE?.trim() || undefined,
    timeZone: env.TENANT_TIME_ZONE?.trim() || 'Asia/Karachi',
  };
}

async function main(): Promise<void> {
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL is not set. The installer writes it; check the service config.');
  }

  /*
   * Idempotence guard. An installer that runs twice — a repair, a reinstall
   * over the top — must not create a second pharmacy beside the first. Every
   * query in the system is tenant-scoped, so a stray second tenant would not
   * corrupt anything; it would do something worse and quieter, which is send
   * the owner to a login that works and a shop with none of their stock in it.
   */
  const existing = await listTenantIds();
  if (existing.length > 0) {
    console.log('This database already has a pharmacy. Nothing to do.');
    console.log('To start over, the database must be reset deliberately — init will not do it.');
    return;
  }

  // Read only once there is a pharmacy to create. An upgrade or repair skips
  // the wizard's shop and PIN pages, so these arrive empty — and must not fail
  // a run that has nothing to do with them.
  const input = readInput(process.env);

  const tenantId = uuidv7();
  const ownerId = uuidv7();

  // Both ids are minted before either row exists: the chokepoint needs a tenant
  // and an acting user to construct, which is the one genuine chicken-and-egg
  // in the system. `db:seed` resolves it the same way.
  const scope = tenantScope({ tenantId, userId: ownerId });

  const headerLines = [input.shopName, input.address, input.phone].filter(
    (line): line is string => line !== undefined,
  );

  const settings: TenantSettings = {
    receiptHeader: headerLines.join('\n'),
    receiptFooter: 'Shukriya',
    timeZone: input.timeZone,
    expiryHorizonDays: [30, 60, 90],
  };

  await createTenant({ id: tenantId, slug: input.slug, name: input.shopName, settings });

  // ADR-7: the owner logs in remotely with a password; salesmen never do.
  // Generated rather than chosen, and surfaced below — a password invented at
  // install time and never shown is an owner who cannot log in remotely at all.
  const ownerPassword = generatePairingKey();

  await scope.insert(users, {
    id: ownerId,
    name: input.ownerName,
    role: 'owner',
    pinHash: await hashPin(input.ownerPin),
    passwordHash: await hashPassword(ownerPassword),
  });

  const pairingKey = generatePairingKey();
  await scope.insert(devices, {
    id: uuidv7(),
    name: input.deviceName,
    receiptPrefix: FIRST_DEVICE_PREFIX,
    pairingKeyHash: await hashPassword(pairingKey),
  });

  // The installed build, from the payload's VERSION file. It used to be
  // npm_package_version, which the installer (running node directly) never
  // sets — so every real installation recorded "unknown".
  const installation = ensureInstallation(currentRelease().build);

  /*
   * The counter needs the slug and the pairing key exactly once, and the person
   * doing the setup is standing at a machine with no terminal. Writing them
   * beside the installation record is what lets the installer show them.
   */
  const detailsFile = join(installationDir(), 'first-run.txt');
  mkdirSync(installationDir(), { recursive: true });
  writeFileSync(
    detailsFile,
    [
      `Pharmacy:     ${input.shopName}`,
      `Login as:     ${input.slug}`,
      `Pairing key:  ${pairingKey}`,
      `Owner password: ${ownerPassword}   (remote login — change it from Settings)`,
      `Counter:      ${input.deviceName} (receipts ${FIRST_DEVICE_PREFIX}-1, ${FIRST_DEVICE_PREFIX}-2, …)`,
      `Owner:        ${input.ownerName}`,
      `Installation: ${installation.installationId}`,
      '',
      'Enter the pairing key once, at this counter. Keep this file until then.',
      '',
    ].join('\n'),
    'utf8',
  );

  console.log(`\n  ${input.shopName} is ready.\n`);
  console.log(`  Login as     ${input.slug}`);
  console.log(`  Pairing key  ${pairingKey}`);
  console.log(`  Owner pass   ${ownerPassword}`);
  console.log(`  Counter      ${input.deviceName}`);
  console.log(`  Installation ${installation.installationId}`);
  console.log(`\n  Also written to ${detailsFile}\n`);
}

main()
  .then(() => process.exit(0))
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
