/**
 * `db:seed` — the demo pharmacy.
 *
 * Phase 11 §4: "`db:reset && db:migrate && db:seed` must always produce a
 * working demo pharmacy — the demo is a build artifact, always one command
 * away." Phase 13 Day 1 fixes the contents: ~50 curated products with real pack
 * structures, one customer with balance, opening batches.
 *
 * This is not a test fixture. It is also staging's data, which doubles as the
 * sales demo environment (Phase 12 §1, Phase 11 §5), and demos are the sales
 * channel (Phase 13 §1.2). Its quality is product quality.
 *
 * Runs as the application role, so it exercises the Phase 9 §5.1 grants on every
 * run: if a seed insert ever needs an UPDATE on an event table, the seed breaks
 * loudly rather than the guarantee eroding quietly.
 */
import 'dotenv/config';

import { eq } from 'drizzle-orm';

import { hashPassword, hashPin } from '../../src/auth/pin';
import { grantEntitlement, listEntitlements } from '../../src/db/entitlement-queries';
import { insertLicence, listLicences } from '../../src/db/licence-queries';
import { createTenant, findTenantBySlug } from '../../src/db/provisioning';
import { tenantScope, type TenantScope } from '../../src/db/scoped';
import { signPayload } from '../../src/domain/licensing/sign';
import { LICENCE_FORMAT_VERSION } from '../../src/domain/licensing/state';
import { ensureInstallation } from '../../src/lib/installation';
import { writeLicenceFile } from '../../src/lib/licence-file';
import { resolveDemoSigningKey } from './demo-licence-key';
import {
  adjustments,
  batches,
  cashMovements,
  customers,
  devices,
  productBarcodes,
  products,
  saleLineAllocations,
  saleLines,
  sales,
  suppliers,
  users,
  type TenantSettings,
} from '../../src/db/schema';
import { missingFromCatalog } from '../../src/domain/catalog/identity';
import { businessDayOf } from '../../src/lib/business-day';
import { uuidv7 } from '../../src/lib/uuid';
import { SEED_PRODUCTS } from './seed-data';

/** Demo credentials — printed at the end so the shell is one command from usable. */
const DEMO = {
  tenantSlug: 'demo',
  tenantName: 'Al-Shifa Medical Store',
  deviceName: 'Counter 1',
  pairingKey: 'counter-one-demo',
  owner: { name: 'Fawad', pin: '1234', password: 'owner-demo-password' },
  salesmen: [
    { name: 'Bilal', pin: '2345' },
    { name: 'Usman', pin: '3456' },
  ],
} as const;

/** PCN-019: a hosted deployment, where entitlement is a tenant record. */
function isCloud(): boolean {
  return process.env.MEHVAR_DEPLOYMENT === 'cloud';
}

/** Client schema version for seeded records (Phase 12 §2.6 / defect C4). */
const CLIENT_SCHEMA_VERSION = 1;

function daysFromNow(days: number): string {
  const date = new Date(Date.now() + days * 24 * 60 * 60 * 1000);
  return businessDayOf(date);
}

/**
 * Expiry spread. A pharmacy's shelf is never uniformly fresh, and the
 * near-expiry lists (W12, 30/60/90 horizons) are only meaningful against stock
 * that actually varies. Two products land inside 30 days on purpose.
 */
function expiryFor(index: number): string {
  if (index === 3) return daysFromNow(21);
  if (index === 9) return daysFromNow(48);
  if (index === 16) return daysFromNow(75);
  return daysFromNow(180 + ((index * 37) % 500));
}

/**
 * WHAT IS SAFELY REPEATABLE HERE, AND WHAT IS NOT.
 *
 * `db:seed` used to mean "create the demo pharmacy" and failed on the unique
 * slug if one already existed. That made it unusable as part of `db:setup`,
 * which is the supported way to bring a database — including a database
 * somebody has been developing against for weeks — to the current state. One
 * aborted step took the whole chain with it, and the catalogue step behind it
 * never ran.
 *
 * So it now means "make sure the demo pharmacy exists and its catalogue is
 * current", and the two halves are treated differently on purpose:
 *
 *   REPEATABLE — the tenant's product catalogue. Missing seed products are
 *   added, matched on medicine identity so a differently-typed duplicate is
 *   never created. Existing products are left exactly as they are: a developer
 *   may have edited a price to test something, and silently rewriting it is the
 *   tenant-data equivalent of the thing P8 forbids.
 *
 *   NOT REPEATABLE — sales, batches, cash movements, customers with balances,
 *   users and devices. Re-running those against a live database would double
 *   the stock on every shelf and invent sales that never happened. They are
 *   created once, on a database that has no demo tenant, and never again.
 *   `db:reset` is how you ask for a fresh one.
 *
 * The distinction is the whole design. "Idempotent" here does not mean "runs
 * the same statements twice safely"; it means "reaching the same end state is
 * safe to ask for repeatedly".
 */
async function main(): Promise<void> {
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL is not set. Copy .env.example to .env first.');
  }

  const existing = await findDemoTenant();
  if (existing) {
    await topUpCatalog(existing);
    // An older dev database may predate perpetual licensing; make sure the demo
    // is authorized on this machine rather than sitting lapsed.
    const licenceOutcome = await ensureDemoLicence(
      tenantScope({ tenantId: existing.tenantId, userId: existing.ownerId }),
    );
    const lines = licenceOutcomeLines(licenceOutcome);
    if (lines.length > 0) console.log(lines.join('\n'));
    return;
  }

  const tenantId = uuidv7();
  const ownerId = uuidv7();

  // The scope needs a tenant and an acting user before either row exists, which
  // is the one genuine chicken-and-egg in the system. Both ids are minted here
  // and used consistently; the chokepoint's contract is satisfied throughout.
  const scope = tenantScope({ tenantId, userId: ownerId });

  const settings: TenantSettings = {
    // PCN-019: the demo tenant is labelled as one wherever it is shown — on a
    // cloud deployment it is the only thing there until the go-live gate passes.
    receiptHeader: `${isCloud() ? 'DEMO — not a real pharmacy\n' : ''}${DEMO.tenantName}\nMain Bazaar, Lahore\n0300-1234567`,
    receiptFooter: 'Shukriya — phir tashreef laaiye',
    timeZone: process.env.TENANT_TIME_ZONE ?? 'Asia/Karachi',
    expiryHorizonDays: [30, 60, 90],
  };

  // The tenant row is the one thing a tenant scope cannot write (it has no
  // tenant_id — it is the tenant). Provisioning has its own door.
  await createTenant({
    id: tenantId,
    slug: DEMO.tenantSlug,
    name: DEMO.tenantName,
    settings,
  });

  /* -- Users: one owner, two salesmen (ADR-7's PIN switching needs a choice) -- */
  await scope.insert(users, {
    id: ownerId,
    name: DEMO.owner.name,
    role: 'owner',
    pinHash: await hashPin(DEMO.owner.pin),
    passwordHash: await hashPassword(DEMO.owner.password),
  });

  for (const salesman of DEMO.salesmen) {
    await scope.insert(users, {
      id: uuidv7(),
      name: salesman.name,
      role: 'salesman',
      pinHash: await hashPin(salesman.pin),
      passwordHash: null,
    });
  }

  /* -- The counter device: receipt prefix `A` gives receipts `A-1`, `A-2`, … -- */
  await scope.insert(devices, {
    id: uuidv7(),
    name: DEMO.deviceName,
    receiptPrefix: 'A',
    pairingKeyHash: await hashPassword(DEMO.pairingKey),
  });

  /* -- A perpetual licence, when a real signing key is available (PCN-006) --- */
  const licenceOutcome = await ensureDemoLicence(scope);

  /* -- Suppliers ------------------------------------------------------------ */
  const supplierIds = await Promise.all(
    ['Muller & Phipps', 'Bilal Distributors', 'United Pharma Agency'].map(async (name) => {
      const [row] = await scope.insert(suppliers, { id: uuidv7(), name, phone: null });
      return row?.id;
    }),
  );

  /* -- Catalog -------------------------------------------------------------- */
  const productIds: string[] = [];
  for (const seed of SEED_PRODUCTS) {
    const productId = uuidv7();
    productIds.push(productId);

    await scope.insert(products, {
      id: productId,
      globalProductId: null,
      name: seed.name,
      manufacturer: seed.manufacturer,
      form: seed.form,
      strength: seed.strength,
      formulaText: seed.formula,
      baseUnitName: seed.baseUnit,
      packLevels: seed.packLevels,
      defaultPricePerBaseUnit: seed.price,
      currentMrpPerBaseUnit: seed.mrp,
      minStockBaseUnits: seed.minStock ?? null,
      needsCompletion: false,
    });

    if (seed.barcode) {
      // Barcodes map to a unit level: a box barcode and a strip barcode differ
      // (Phase 5 §2). These seeded ones are pack-level codes.
      const level = seed.packLevels[0]?.name ?? seed.baseUnit;
      await scope.insert(productBarcodes, {
        id: uuidv7(),
        productId,
        barcode: seed.barcode,
        unitLevelName: level,
      });
    }
  }

  /* -- Opening stock (W9): reason-coded adjustments materializing batches ---- */
  const openingBatches: Array<{ id: string; productId: string; price: number; qty: number }> = [];

  for (const [index, seed] of SEED_PRODUCTS.entries()) {
    const productId = productIds[index];
    if (!productId) continue;

    // A plausible shelf: a couple of products deliberately at zero so the
    // low-stock list (W12) has something to say on day one — but never the
    // demo's headline products, which are the first thing anyone searches for.
    const packSize = seed.packLevels[0]?.factor ?? 1;
    const outOfStock = index === 13 || index === 29;
    const qty = outOfStock ? 0 : packSize * (3 + (index % 9));
    if (qty === 0) continue;

    const [adjustment] = await scope.insert(adjustments, {
      id: uuidv7(),
      productId,
      batchId: null,
      qtyBaseDelta: qty,
      reason: 'opening_stock',
      note: 'Opening stock entered during onboarding',
    });
    if (!adjustment) continue;

    const [batch] = await scope.insert(batches, {
      id: uuidv7(),
      productId,
      source: 'adjustment',
      sourceId: adjustment.id,
      batchNumber: `OPEN-${String(index + 1).padStart(3, '0')}`,
      expiryDate: expiryFor(index),
      // Opening stock has no invoice; cost is estimated at 80% of selling price
      // so margin reporting has a plausible basis until real purchases land.
      unitCostPaisa: Math.round(seed.price * 0.8),
      pricePerBaseUnitPaisa: seed.price,
      qtyReceivedBase: qty,
      qtyRemainingBase: qty,
    });
    if (batch) {
      openingBatches.push({ id: batch.id, productId, price: seed.price, qty });
    }
  }

  /* -- A customer with a balance (T4's expansion view needs something to show) */
  const [customer] = await scope.insert(customers, {
    id: uuidv7(),
    name: 'Rashid Sahib',
    phone: '0301-2345678',
  });

  if (customer) {
    // One udhaar sale, written directly. Day 3's `commitSale` supersedes this
    // path entirely; until it exists, the seed writes the same rows the domain
    // writer will, and Day 3's rebuild-equivalence suite will hold this data to
    // the same standard as anything the application produces.
    // Deliberately not the first batch: the udhaar sale must not empty the
    // shelf of the product every demo starts by searching for.
    const batch = openingBatches[5] ?? openingBatches[0];
    if (batch) {
      const qty = 10;
      const unitPrice = batch.price;
      const total = qty * unitPrice;

      const saleId = uuidv7();
      await scope.insert(sales, {
        id: saleId,
        receiptNumber: 'A-1',
        customerId: customer.id,
        subtotalPaisa: total,
        invoiceDiscountPaisa: 0,
        totalPaisa: total,
        cashPaisa: 0,
        creditPaisa: total,
        changePaisa: 0,
        origin: 'online',
        clientSchemaVersion: CLIENT_SCHEMA_VERSION,
        clientCommittedAt: new Date(),
      });

      const [line] = await scope.insert(saleLines, {
        id: uuidv7(),
        saleId,
        productId: batch.productId,
        qtyBase: qty,
        enteredUnitLevel: 'strip',
        unitPricePaisa: unitPrice,
        lineDiscountPaisa: 0,
        priceOverridden: false,
      });

      if (line) {
        await scope.insert(saleLineAllocations, {
          id: uuidv7(),
          saleLineId: line.id,
          batchId: batch.id,
          qtyBase: qty,
          unitCostPaisa: Math.round(unitPrice * 0.8),
        });

        // ADR-8's single transactional cache, decremented by the consumption
        // just recorded. The derivation contract (Phase 9 §4) must hold from the
        // very first row, or the verifier's first run is a false alarm.
        await scope.update(
          batches,
          { qtyRemainingBase: batch.qty - qty },
          eq(batches.id, batch.id),
        );
      }
    }
  }

  /* -- Drawer float, so "expected cash" is a real number from day one (W10) -- */
  await scope.insert(cashMovements, {
    id: uuidv7(),
    direction: 'in',
    amountPaisa: 500_000,
    reason: 'opening_float',
    note: 'Morning float',
  });

  const stocked = openingBatches.length;
  console.log(
    [
      '',
      `Seeded ${DEMO.tenantName} (slug: ${DEMO.tenantSlug})`,
      `  ${SEED_PRODUCTS.length} products, ${stocked} opening batches, ${supplierIds.length} suppliers`,
      `  1 customer with an udhaar balance, opening float Rs 5,000`,
      '',
      ...licenceOutcomeLines(licenceOutcome),
      'Device login:',
      `  tenant   ${DEMO.tenantSlug}`,
      `  device   ${DEMO.deviceName}`,
      `  key      ${DEMO.pairingKey}`,
      '',
      'PINs:',
      `  ${DEMO.owner.name} (owner)     ${DEMO.owner.pin}`,
      ...DEMO.salesmen.map((s) => `  ${s.name} (salesman)   ${s.pin}`),
      '',
    ].join('\n'),
  );
}

/**
 * Operator-facing lines for how the demo's licence ended up, or didn't.
 *
 * `skipped` is the expected, healthy state on a developer machine with no
 * `MEHVAR_LICENCE_SIGNING_KEY` — the demo simply runs its 30-day evaluation
 * with full functionality, so this says that plainly rather than looking like
 * a missing step.
 */
function licenceOutcomeLines(outcome: 'issued' | 'already' | 'skipped' | 'entitled'): string[] {
  switch (outcome) {
    case 'entitled':
      return ['Entitlement: granted the demo tenant a demo entitlement (cloud mode).', ''];
    case 'issued':
      return ['Licence: issued a perpetual licence, bound to this machine.', ''];
    case 'already':
      return [];
    case 'skipped':
      return [
        'Licence: no MEHVAR_LICENCE_SIGNING_KEY configured, so none was issued.',
        '  The demo runs on its 30-day evaluation instead — full functionality either way.',
        '',
      ];
  }
}

/**
 * Give the demo a perpetual licence bound to THIS machine, when there is a
 * real key to sign it with (PCN-006).
 *
 * The demo is a working, authorized pharmacy out of the box wherever a real
 * signing key is available — a lapsed-looking demo was the exact confusion
 * this session started from. Signing with the committed DEVELOPMENT key would
 * "fix" that only in appearance: the moment `mehvar-1`/`mehvar-2` were
 * provisioned in `domain/trust/keys.ts`, `composeTrustRoot` correctly dropped
 * the dev key from the trust root, so a dev-signed "perpetual" licence now
 * verifies against nothing and resolves to `invalid` forever — worse than no
 * licence at all. `resolveDemoSigningKey` returns `null` in exactly that case,
 * and this function's answer to `null` is to issue NOTHING and say so: an
 * unlicensed installation already runs a fully-functional 30-day evaluation
 * (PCN-006), which is the correct fallback, not a broken perpetual one.
 *
 * When a real key IS configured (`MEHVAR_LICENCE_SIGNING_KEY`, e.g. on the
 * founder's own machine), the issued licence is bound to the machine's own
 * installation id, so the app reads `authorized` here and a *copied* database
 * reads `unbound` — the testable copy path, exactly as a real licence behaves.
 *
 * Idempotent: `insertLicence` is `onConflictDoNothing` on (tenant, licence,
 * installation), and this issues nothing when the demo already holds a licence
 * bound to this machine. Evaluation and unauthorized states stay reachable
 * through any tenant WITHOUT a licence — every provisioned test tenant is one.
 */
async function ensureDemoLicence(
  scope: TenantScope,
): Promise<'issued' | 'already' | 'skipped' | 'entitled'> {
  // PCN-019: on a cloud deployment the question is answered by the tenant's
  // entitlement record, not a file bound to this machine, so there is no
  // licence to sign and no installation to bind it to.
  if (isCloud()) {
    if ((await listEntitlements(scope)).length > 0) return 'already';
    await grantEntitlement(scope, {
      plan: 'demo',
      note: 'Demo tenant. Wiped before the pilot’s real data goes online (PCN-019 gate).',
    });
    return 'entitled';
  }

  const installation = ensureInstallation('db:seed');
  const existing = await listLicences(scope);
  if (existing.some((row) => row.installationId === installation.installationId)) {
    return 'already';
  }

  const signing = resolveDemoSigningKey();
  if (signing === null) {
    return 'skipped';
  }

  const licenceId = uuidv7();
  const issuedAt = new Date();
  const token = signPayload(
    {
      v: LICENCE_FORMAT_VERSION,
      kid: signing.kid,
      licenceId,
      tenantSlug: DEMO.tenantSlug,
      customerName: DEMO.tenantName,
      plan: 'standard',
      branches: 1,
      issuedAt: issuedAt.toISOString(),
    },
    signing.key,
  );

  await insertLicence(scope, {
    id: uuidv7(),
    token,
    licenceId,
    issuedAt,
    installationId: installation.installationId,
  });
  // Kept on disk too, so a boot after a database restore refills from it.
  writeLicenceFile(token);
  return 'issued';
}

/** The demo tenant, if this database already has one. */
async function findDemoTenant(): Promise<{ tenantId: string; ownerId: string } | null> {
  const tenant = await findTenantBySlug(DEMO.tenantSlug);
  if (!tenant) return null;

  /*
   * Any owner will do as the acting user — `TenantScope` needs one to stamp
   * `created_by`, and a catalogue top-up is attributed to whoever set the shop
   * up. If there is no owner the database is in a state seed cannot reason
   * about, so say that rather than invent a user.
   */
  const scope = tenantScope({ tenantId: tenant.id, userId: tenant.id });
  const [owner] = await scope.db
    .select({ id: users.id })
    .from(users)
    .where(scope.scopeOf(users, eq(users.role, 'owner')))
    .limit(1);

  if (!owner) {
    throw new Error(
      `The demo tenant exists but has no owner user. This database is in a state ` +
        `seed cannot safely extend — use \`npm run db:reset\` to start over.`,
    );
  }

  return { tenantId: tenant.id, ownerId: owner.id };
}

/**
 * Adds seed products the demo pharmacy does not have yet.
 *
 * Matched on `identityKey` — brand + strength + form + manufacturer — rather
 * than on name, so a product the developer typed by hand is recognised as the
 * same medicine and not duplicated beside it. Nothing existing is modified.
 */
async function topUpCatalog({
  tenantId,
  ownerId,
}: {
  tenantId: string;
  ownerId: string;
}): Promise<void> {
  const scope = tenantScope({ tenantId, userId: ownerId });

  const mine = await scope.select(products);

  const missing = missingFromCatalog(
    SEED_PRODUCTS,
    mine.map((row) => ({
      name: row.name,
      strength: row.strength,
      form: row.form,
      manufacturer: row.manufacturer,
      formulaText: row.formulaText,
    })),
    (seed) => ({
      name: seed.name,
      strength: seed.strength,
      form: seed.form,
      manufacturer: seed.manufacturer,
      formulaText: seed.formula,
    }),
  );

  for (const seed of missing) {
    const productId = uuidv7();
    await scope.insert(products, {
      id: productId,
      globalProductId: null,
      name: seed.name,
      manufacturer: seed.manufacturer,
      form: seed.form,
      strength: seed.strength,
      formulaText: seed.formula,
      baseUnitName: seed.baseUnit,
      packLevels: seed.packLevels,
      defaultPricePerBaseUnit: seed.price,
      currentMrpPerBaseUnit: seed.mrp,
      minStockBaseUnits: seed.minStock ?? null,
      needsCompletion: false,
    });

    if (seed.barcode) {
      const level = seed.packLevels[0]?.name ?? seed.baseUnit;
      await scope.insert(productBarcodes, {
        id: uuidv7(),
        productId,
        barcode: seed.barcode,
        unitLevelName: level,
      });
    }
  }

  console.log(
    [
      '',
      `${DEMO.tenantName} (slug: ${DEMO.tenantSlug}) is already set up — keeping it.`,
      missing.length === 0
        ? `  Its catalogue already has all ${SEED_PRODUCTS.length} seed products.`
        : `  Added ${missing.length} seed product(s) it was missing: ${missing
            .map((seed) => seed.name)
            .join(', ')}.`,
      missing.length === 0
        ? ''
        : '  They arrive with no opening stock — inventing batches on a database you have',
      missing.length === 0
        ? ''
        : '  been using would corrupt the figures you have been testing against.',
      '',
      '  Sales, batches, cash movements and customers were NOT re-created.',
      '  For a fresh demo pharmacy: npm run db:reset && npm run db:setup',
      '',
    ]
      .filter((line, index, all) => line !== '' || all[index - 1] !== '')
      .join('\n'),
  );
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
