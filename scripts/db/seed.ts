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
import { createTenant } from '../../src/db/provisioning';
import { tenantScope } from '../../src/db/scoped';
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

async function main(): Promise<void> {
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL is not set. Copy .env.example to .env first.');
  }

  const tenantId = uuidv7();
  const ownerId = uuidv7();

  // The scope needs a tenant and an acting user before either row exists, which
  // is the one genuine chicken-and-egg in the system. Both ids are minted here
  // and used consistently; the chokepoint's contract is satisfied throughout.
  const scope = tenantScope({ tenantId, userId: ownerId });

  const settings: TenantSettings = {
    receiptHeader: `${DEMO.tenantName}\nMain Bazaar, Lahore\n0300-1234567`,
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

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
