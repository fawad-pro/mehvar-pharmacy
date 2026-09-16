/**
 * Drizzle schema — Phase 9, verbatim.
 *
 * Conventions (Phase 9 §1), applied without exception:
 *   IDs         — UUIDv7 primary keys. `sales` and `payments` carry the CLIENT-
 *                 generated id as the primary key, which is what makes offline
 *                 sync idempotent by construction (ADR-3).
 *   Tenancy     — `tenant_id` on every tenant-owned row. Global catalog tables
 *                 (§6) carry none.
 *   Attribution — `created_by` + `created_at` on every business row (T1).
 *                 Immutable tables have NO `updated_at`: there are no updates.
 *   Money       — integer paisa, `bigint`. No floats anywhere near money.
 *   Quantities  — integer base units (Phase 5 §2). Presentation converts.
 *   Immutability— event tables accept INSERT only, enforced by REVOKE (§5.1,
 *                 applied by `src/db/grants.sql`).
 *   Soft archive— reference entities carry `is_active`; nothing is deleted.
 *
 * Where a column is NOT in Phase 9's list, it is marked `[mechanical]` (a
 * convention column Phase 9's preamble sanctions) or `[PCN-001]` (an addition
 * raised as a plan-change note, see docs/PLAN_CHANGE_NOTES.md). Nothing else was
 * added — Day 1's risk note is that schema churn later is expensive, so Phase 9
 * is implemented as written, not improvised.
 */

import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  check,
  date,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import type { PackLevel } from '@/lib/quantity';

/* ========================================================================== */
/* Enums                                                                       */
/* ========================================================================== */

export const tenantStatus = pgEnum('tenant_status', ['active', 'suspended']);
export const userRole = pgEnum('user_role', ['owner', 'salesman']);
export const sessionKind = pgEnum('session_kind', ['device', 'owner_remote']);
export const saleOrigin = pgEnum('sale_origin', ['online', 'offline_sync']);
export const paymentMethod = pgEnum('payment_method', ['cash']);
export const batchSource = pgEnum('batch_source', ['purchase_line', 'adjustment']);

export const adjustmentReason = pgEnum('adjustment_reason', [
  'damage',
  'expiry_writeoff',
  'distributor_return',
  'count_correction',
  'opening_stock',
]);

export const cashDirection = pgEnum('cash_direction', ['in', 'out']);
export const cashReason = pgEnum('cash_reason', [
  'opening_float',
  'owner_withdrawal',
  'expense',
  'over_short',
]);

export const catalogQuality = pgEnum('catalog_quality', ['verified', 'reference']);
export const catalogSource = pgEnum('catalog_source', ['drap_seed', 'curated', 'promoted']);
export const proposalType = pgEnum('proposal_type', ['barcode', 'new_product', 'mrp_signal']);
export const proposalStatus = pgEnum('proposal_status', ['pending', 'accepted', 'rejected']);

/* ========================================================================== */
/* Shared column builders                                                      */
/* ========================================================================== */

const createdAt = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow();

/**
 * [mechanical] Modification timestamp for MUTABLE reference entities only.
 *
 * Immutable event tables never get this — Phase 9 §1: "Immutable tables have no
 * `updated_at`: there are no updates." Reference entities are editable, so a
 * modification timestamp is a convention column of the kind Phase 9's preamble
 * sanctions.
 *
 * It earns its place by making the ADR-4 client index refreshable incrementally:
 * the counter asks for rows changed since its last sync instead of re-downloading
 * a 3,000-product catalog whenever one price is corrected. `TenantScope.update`
 * stamps it, so no writer can forget to.
 */
const updatedAt = () => timestamp('updated_at', { withTimezone: true }).notNull().defaultNow();

/** Tenant settings (Phase 9 §2): receipt header/footer, timezone, expiry horizons. */
export interface TenantSettings {
  receiptHeader: string;
  receiptFooter: string;
  timeZone: string;
  /** Near-expiry horizons in days — Phase 10 §2 renders these as 30/60/90 tabs. */
  expiryHorizonDays: number[];
  /**
   * Whether a committed sale prints paper without being asked.
   *
   * The *transaction* has never depended on printing (ADR-3: the receipt
   * prints from local state, never from a server response) — but the paper
   * was unconditional, and plenty of shops hand a receipt over only when it
   * is asked for. Optional so an existing tenant row keeps today's behaviour;
   * absent reads as on.
   */
  autoPrintReceipt?: boolean;
}

/* ========================================================================== */
/* §2 Reference tables                                                         */
/* ========================================================================== */

export const tenants = pgTable('tenants', {
  id: uuid('id').primaryKey(),
  /** [PCN-001] Login identity — a single domain serves every tenant (Phase 4 §6). */
  slug: text('slug').notNull().unique(),
  name: text('name').notNull(),
  status: tenantStatus('status').notNull().default('active'),
  settings: jsonb('settings').$type<TenantSettings>().notNull(),
  createdAt: createdAt(),
});

export const users = pgTable(
  'users',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),
    name: text('name').notNull(),
    role: userRole('role').notNull(),
    pinHash: text('pin_hash').notNull(),
    /** Owner remote login; null for salesmen (Phase 9 §2). */
    passwordHash: text('password_hash'),
    isActive: boolean('is_active').notNull().default(true),

    /** [PCN-001] Phase 12 §5: PINs are rate-limited, with lockout after repeated
        failures and owner override. Lockout state is settings, not derived data. */
    failedPinAttempts: integer('failed_pin_attempts').notNull().default(0),
    pinLockedUntil: timestamp('pin_locked_until', { withTimezone: true }),

    createdAt: createdAt(),
  },
  (table) => [
    index('users_tenant_idx').on(table.tenantId),
    // Owner remote login identifies a person within a tenant by name (Phase 9 §2
    // carries no email column, by charter data-minimization).
    uniqueIndex('users_tenant_name_key').on(table.tenantId, table.name),
  ],
);

/**
 * [PCN-001] Counter devices.
 *
 * ADR-7's "tenant device login (long-lived session on the counter machine)" and
 * Phase 9 §3's device-scoped receipt number (`A-1042`) both presuppose a device
 * record. This is its home: the receipt prefix lives here so it is assigned
 * once, at setup (Phase 12 §6 step 5), and cannot collide within a tenant.
 */
export const devices = pgTable(
  'devices',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),
    name: text('name').notNull(),
    /** Short prefix for receipt numbers — the `A` in `A-1042`. */
    receiptPrefix: text('receipt_prefix').notNull(),
    /** Argon2id hash of the pairing key entered once at setup. */
    pairingKeyHash: text('pairing_key_hash').notNull(),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: createdAt(),
  },
  (table) => [
    uniqueIndex('devices_tenant_prefix_key').on(table.tenantId, table.receiptPrefix),
    index('devices_tenant_idx').on(table.tenantId),
  ],
);

/** [mechanical] Session storage for ADR-7. Posture per Phase 12 §5. */
export const sessions = pgTable(
  'sessions',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),
    kind: sessionKind('kind').notNull(),
    /** Set for counter sessions; null for owner remote logins. */
    deviceId: uuid('device_id').references(() => devices.id),
    /** The acting user — changed in place by a PIN switch (ADR-7). */
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    tokenHash: text('token_hash').notNull().unique(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (table) => [index('sessions_tenant_idx').on(table.tenantId)],
);

export const products = pgTable(
  'products',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),
    globalProductId: uuid('global_product_id').references(() => globalProducts.id),
    name: text('name').notNull(),
    manufacturer: text('manufacturer'),
    form: text('form'),
    strength: text('strength'),
    formulaText: text('formula_text'),
    baseUnitName: text('base_unit_name').notNull(),
    /** Ordered levels, factors in base units — read whole, written rarely,
        never queried relationally (Phase 9 §2's note on why this is JSONB). */
    packLevels: jsonb('pack_levels').$type<PackLevel[]>().notNull().default([]),
    defaultPricePerBaseUnit: bigint('default_price_per_base_unit', { mode: 'number' }).notNull(),
    /** Reference ceiling, D4: the pack in hand is authoritative, not our data. */
    currentMrpPerBaseUnit: bigint('current_mrp_per_base_unit', { mode: 'number' }),
    minStockBaseUnits: integer('min_stock_base_units'),
    /** D3 — quick items are real products flagged for enrichment. */
    needsCompletion: boolean('needs_completion').notNull().default(false),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    index('products_tenant_idx').on(table.tenantId),
    index('products_tenant_name_idx').on(table.tenantId, table.name),
    // ADR-4's incremental index refresh reads this range. Without it, every
    // catalog change costs a full-catalog download at 3,000 products.
    index('products_tenant_updated_idx').on(table.tenantId, table.updatedAt),
    // Phase 9 §5.5 — partial index feeding the completion queue.
    index('products_needs_completion_idx')
      .on(table.tenantId)
      .where(sql`${table.needsCompletion}`),
  ],
);

export const productBarcodes = pgTable(
  'product_barcodes',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),
    productId: uuid('product_id')
      .notNull()
      .references(() => products.id),
    barcode: text('barcode').notNull(),
    /** A box barcode and a strip barcode differ (Phase 5 §2). */
    unitLevelName: text('unit_level_name').notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    uniqueIndex('product_barcodes_tenant_barcode_key').on(table.tenantId, table.barcode),
    index('product_barcodes_product_idx').on(table.tenantId, table.productId),
    index('product_barcodes_tenant_updated_idx').on(table.tenantId, table.updatedAt),
  ],
);

/** A name and a phone number attached to a debt. Nothing else, by charter boundary. */
export const customers = pgTable(
  'customers',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),
    name: text('name').notNull(),
    phone: text('phone'),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: createdAt(),
  },
  (table) => [
    index('customers_tenant_idx').on(table.tenantId),
    index('customers_tenant_name_idx').on(table.tenantId, table.name),
  ],
);

export const suppliers = pgTable(
  'suppliers',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),
    name: text('name').notNull(),
    phone: text('phone'),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: createdAt(),
  },
  (table) => [index('suppliers_tenant_idx').on(table.tenantId)],
);

/* ========================================================================== */
/* §4 Batches — the single ADR-8 transactional cache lives here                */
/* ========================================================================== */

export const batches = pgTable(
  'batches',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),
    productId: uuid('product_id')
      .notNull()
      .references(() => products.id),
    /** Polymorphic by Phase 9 §4's own wording: `source` + `source_id`. */
    source: batchSource('source').notNull(),
    sourceId: uuid('source_id').notNull(),
    batchNumber: text('batch_number'),
    /** Nullable only for non-perishables (Phase 9 §4). */
    expiryDate: date('expiry_date'),
    unitCostPaisa: bigint('unit_cost_paisa', { mode: 'number' }).notNull(),
    pricePerBaseUnitPaisa: bigint('price_per_base_unit_paisa', { mode: 'number' }).notNull(),
    qtyReceivedBase: integer('qty_received_base').notNull(),
    /**
     * THE single ADR-8 transactional cache. Everything else computes on read.
     *
     * Derivation contract (Phase 9 §4):
     *   qty_remaining = qty_received − Σ allocations − Σ negative batch adjustments
     *                   + Σ restocked returns
     * The rebuild/verifier routine recomputes and compares; a mismatch is sev-1.
     */
    qtyRemainingBase: integer('qty_remaining_base').notNull(),
    createdAt: createdAt(),
  },
  (table) => [
    // FEFO order is expiry_date ASC NULLS LAST, created_at ASC (Phase 9 §4).
    index('batches_fefo_idx').on(table.tenantId, table.productId, table.expiryDate),
    index('batches_tenant_created_idx').on(table.tenantId, table.createdAt),
    check('batches_qty_remaining_nonneg', sql`${table.qtyRemainingBase} >= 0`),
    check('batches_qty_received_positive', sql`${table.qtyReceivedBase} > 0`),
  ],
);

/* ========================================================================== */
/* §3 Event tables (append-only)                                               */
/* ========================================================================== */

export const purchases = pgTable(
  'purchases',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),
    supplierId: uuid('supplier_id').references(() => suppliers.id),
    invoiceRef: text('invoice_ref'),
    invoiceDate: date('invoice_date'),
    note: text('note'),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => users.id),
    createdAt: createdAt(),
  },
  (table) => [index('purchases_tenant_created_idx').on(table.tenantId, table.createdAt)],
);

export const purchaseLines = pgTable(
  'purchase_lines',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),
    purchaseId: uuid('purchase_id')
      .notNull()
      .references(() => purchases.id),
    productId: uuid('product_id')
      .notNull()
      .references(() => products.id),
    qtyBase: integer('qty_base').notNull(),
    /** The "10+1" scheme units — received free, kept distinct so margin
        reporting is honest. Zero cost by derivation, not by column (Phase 9 §3). */
    bonusQtyBase: integer('bonus_qty_base').notNull().default(0),
    unitCostPaisa: bigint('unit_cost_paisa', { mode: 'number' }).notNull(),
    expiryDate: date('expiry_date'),
    batchNumber: text('batch_number'),
    mrpAtReceivingPaisa: bigint('mrp_at_receiving_paisa', { mode: 'number' }),
    priceAtReceivingPaisa: bigint('price_at_receiving_paisa', { mode: 'number' }).notNull(),
    createdAt: createdAt(),
  },
  (table) => [
    index('purchase_lines_purchase_idx').on(table.tenantId, table.purchaseId),
    index('purchase_lines_tenant_created_idx').on(table.tenantId, table.createdAt),
    check('purchase_lines_qty_positive', sql`${table.qtyBase} > 0`),
    check('purchase_lines_bonus_nonneg', sql`${table.bonusQtyBase} >= 0`),
  ],
);

export const sales = pgTable(
  'sales',
  {
    /** Client-generated (ADR-3): idempotent sync by construction. */
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),
    /**
     * Client-generated at commit, device-scoped: prefix + per-device counter,
     * e.g. `A-1042`. Unique per tenant; works identically offline — this is the
     * resolution of defect C1 (server sequencing vs. ADR-3's print-from-local).
     */
    receiptNumber: text('receipt_number').notNull(),
    customerId: uuid('customer_id').references(() => customers.id),
    subtotalPaisa: bigint('subtotal_paisa', { mode: 'number' }).notNull(),
    invoiceDiscountPaisa: bigint('invoice_discount_paisa', { mode: 'number' }).notNull().default(0),
    totalPaisa: bigint('total_paisa', { mode: 'number' }).notNull(),
    cashPaisa: bigint('cash_paisa', { mode: 'number' }).notNull().default(0),
    creditPaisa: bigint('credit_paisa', { mode: 'number' }).notNull().default(0),
    changePaisa: bigint('change_paisa', { mode: 'number' }).notNull().default(0),
    origin: saleOrigin('origin').notNull(),
    /** C4's resolution: ingestion accepts prior-version payloads (Phase 12 §2.6). */
    clientSchemaVersion: integer('client_schema_version').notNull(),
    clientCommittedAt: timestamp('client_committed_at', { withTimezone: true }).notNull(),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => users.id),
    createdAt: createdAt(),
  },
  (table) => [
    uniqueIndex('sales_tenant_receipt_key').on(table.tenantId, table.receiptNumber),
    index('sales_tenant_created_idx').on(table.tenantId, table.createdAt),
    index('sales_tenant_customer_idx').on(table.tenantId, table.customerId),
    // Phase 9 §3's stated CHECKs, plus Phase 5 invariant 4's first half.
    check(
      'sales_split_equals_total',
      sql`${table.cashPaisa} + ${table.creditPaisa} = ${table.totalPaisa}`,
    ),
    check(
      'sales_credit_requires_customer',
      sql`${table.creditPaisa} = 0 OR ${table.customerId} IS NOT NULL`,
    ),
    check(
      'sales_total_is_subtotal_less_discount',
      sql`${table.totalPaisa} = ${table.subtotalPaisa} - ${table.invoiceDiscountPaisa}`,
    ),
  ],
);

export const saleLines = pgTable(
  'sale_lines',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),
    saleId: uuid('sale_id')
      .notNull()
      .references(() => sales.id),
    productId: uuid('product_id')
      .notNull()
      .references(() => products.id),
    qtyBase: integer('qty_base').notNull(),
    /** As entered, for display and receipt (W5's natural language). */
    enteredUnitLevel: text('entered_unit_level').notNull(),
    unitPricePaisa: bigint('unit_price_paisa', { mode: 'number' }).notNull(),
    lineDiscountPaisa: bigint('line_discount_paisa', { mode: 'number' }).notNull().default(0),
    /** T1 exposure — surfaces in the owner's daily view. */
    priceOverridden: boolean('price_overridden').notNull().default(false),
    createdAt: createdAt(),
  },
  (table) => [
    index('sale_lines_sale_idx').on(table.tenantId, table.saleId),
    index('sale_lines_tenant_created_idx').on(table.tenantId, table.createdAt),
    check('sale_lines_qty_positive', sql`${table.qtyBase} > 0`),
  ],
);

/**
 * The D1/D2 mechanism. Server-side FEFO writes one row per consumed batch
 * (ADR-5); `batch_id NULL` rows are the pending layer.
 *
 * These are the only "mutable" business rows in the system, and only their
 * resolution fields may be set — once, forward-only (Phase 9 §3).
 */
export const saleLineAllocations = pgTable(
  'sale_line_allocations',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),
    saleLineId: uuid('sale_line_id')
      .notNull()
      .references(() => saleLines.id),
    /** NULL = the pending layer (D2): stock the system didn't have. */
    batchId: uuid('batch_id').references(() => batches.id),
    qtyBase: integer('qty_base').notNull(),
    /** From the batch; null while pending. */
    unitCostPaisa: bigint('unit_cost_paisa', { mode: 'number' }),
    /**
     * Phase 9 §3 specifies "resolved_by (nullable FK to the purchase_line or
     * adjustment that later resolved it)". Rendered as two nullable FKs rather
     * than an untyped id so referential integrity survives; at most one is set.
     */
    resolvedByPurchaseLineId: uuid('resolved_by_purchase_line_id').references(
      () => purchaseLines.id,
    ),
    resolvedByAdjustmentId: uuid('resolved_by_adjustment_id').references(() => adjustments.id),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (table) => [
    index('allocations_sale_line_idx').on(table.tenantId, table.saleLineId),
    index('allocations_batch_idx').on(table.tenantId, table.batchId),
    // The pending-layer backlog is a churn signal the founder watches (Phase 12 §4).
    index('allocations_pending_idx')
      .on(table.tenantId)
      .where(sql`${table.batchId} IS NULL AND ${table.resolvedAt} IS NULL`),
    check('allocations_qty_positive', sql`${table.qtyBase} > 0`),
    check(
      'allocations_single_resolver',
      sql`num_nonnulls(${table.resolvedByPurchaseLineId}, ${table.resolvedByAdjustmentId}) <= 1`,
    ),
    check(
      'allocations_pending_has_no_cost',
      sql`${table.batchId} IS NOT NULL OR ${table.unitCostPaisa} IS NULL`,
    ),
  ],
);

export const payments = pgTable(
  'payments',
  {
    /** Client-generated (ADR-3). */
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),
    customerId: uuid('customer_id')
      .notNull()
      .references(() => customers.id),
    amountPaisa: bigint('amount_paisa', { mode: 'number' }).notNull(),
    method: paymentMethod('method').notNull().default('cash'),
    /** Set when part of a sale commit; standalone = settlement (W3). */
    saleId: uuid('sale_id').references(() => sales.id),
    /**
     * [PCN-002] Client-generated, device-scoped, identical in shape to
     * `sales.receipt_number` — Phase 10 §7 requires a settlement receipt to
     * print a footer with one, and Phase 9 §3 named no column for it. The
     * device's local counter (Phase 9 §3, built for `sales`) is shared with
     * this table rather than kept separate: one receipt book, one sequence,
     * regardless of what the slip records.
     */
    receiptNumber: text('receipt_number').notNull(),
    origin: saleOrigin('origin').notNull(),
    clientSchemaVersion: integer('client_schema_version').notNull(),
    clientCommittedAt: timestamp('client_committed_at', { withTimezone: true }).notNull(),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => users.id),
    createdAt: createdAt(),
  },
  (table) => [
    index('payments_tenant_created_idx').on(table.tenantId, table.createdAt),
    index('payments_tenant_customer_idx').on(table.tenantId, table.customerId),
    uniqueIndex('payments_tenant_receipt_key').on(table.tenantId, table.receiptNumber),
    check('payments_amount_positive', sql`${table.amountPaisa} > 0`),
  ],
);

export const saleReturns = pgTable(
  'sale_returns',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),
    saleId: uuid('sale_id')
      .notNull()
      .references(() => sales.id),
    /**
     * [PCN-003] Same gap as PCN-002, found again: Phase 10 §7 requires a
     * receipt for every money event — "sale, return, settlement" — and Phase 9
     * §3 named no column for this table either. Client-generated, device-scoped,
     * identical in shape and derivation to `sales.receipt_number`, sharing the
     * same device counter — one receipt book, one sequence.
     */
    receiptNumber: text('receipt_number').notNull(),
    cashOutPaisa: bigint('cash_out_paisa', { mode: 'number' }).notNull().default(0),
    creditReducedPaisa: bigint('credit_reduced_paisa', { mode: 'number' }).notNull().default(0),
    reasonNote: text('reason_note'),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => users.id),
    createdAt: createdAt(),
  },
  (table) => [
    index('sale_returns_tenant_created_idx').on(table.tenantId, table.createdAt),
    uniqueIndex('sale_returns_tenant_receipt_key').on(table.tenantId, table.receiptNumber),
  ],
);

export const saleReturnLines = pgTable(
  'sale_return_lines',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),
    saleReturnId: uuid('sale_return_id')
      .notNull()
      .references(() => saleReturns.id),
    saleLineId: uuid('sale_line_id')
      .notNull()
      .references(() => saleLines.id),
    qtyBase: integer('qty_base').notNull(),
    /** Known source batch, or null for a write-off. */
    restockBatchId: uuid('restock_batch_id').references(() => batches.id),
    createdAt: createdAt(),
  },
  (table) => [
    index('sale_return_lines_return_idx').on(table.tenantId, table.saleReturnId),
    check('sale_return_lines_qty_positive', sql`${table.qtyBase} > 0`),
  ],
);

export const adjustments = pgTable(
  'adjustments',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),
    productId: uuid('product_id')
      .notNull()
      .references(() => products.id),
    batchId: uuid('batch_id').references(() => batches.id),
    qtyBaseDelta: integer('qty_base_delta').notNull(),
    reason: adjustmentReason('reason').notNull(),
    note: text('note'),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => users.id),
    createdAt: createdAt(),
  },
  (table) => [
    index('adjustments_tenant_created_idx').on(table.tenantId, table.createdAt),
    index('adjustments_product_idx').on(table.tenantId, table.productId),
    check('adjustments_delta_nonzero', sql`${table.qtyBaseDelta} <> 0`),
    /**
     * Phase 9 §5.4 — "signed-delta reason consistency". Stock leaves for damage,
     * expiry and distributor returns; opening stock only ever adds; a count
     * correction may go either way.
     */
    check(
      'adjustments_reason_sign',
      sql`(${table.reason} IN ('damage', 'expiry_writeoff', 'distributor_return') AND ${table.qtyBaseDelta} < 0)
          OR (${table.reason} = 'opening_stock' AND ${table.qtyBaseDelta} > 0)
          OR ${table.reason} = 'count_correction'`,
    ),
  ],
);

export const cashMovements = pgTable(
  'cash_movements',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),
    direction: cashDirection('direction').notNull(),
    amountPaisa: bigint('amount_paisa', { mode: 'number' }).notNull(),
    reason: cashReason('reason').notNull(),
    note: text('note'),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => users.id),
    createdAt: createdAt(),
  },
  (table) => [
    index('cash_movements_tenant_created_idx').on(table.tenantId, table.createdAt),
    check('cash_movements_amount_positive', sql`${table.amountPaisa} > 0`),
  ],
);

/* ========================================================================== */
/* §6 Global catalog (tenant-free; Phase 6)                                    */
/*                                                                             */
/* Identity only — no tenant pricing, no sales data, ever. This is the line the */
/* trust posture (T3) does not permit crossing.                                */
/* ========================================================================== */

export const globalProducts = pgTable(
  'global_products',
  {
    id: uuid('id').primaryKey(),
    name: text('name').notNull(),
    manufacturer: text('manufacturer'),
    formulaText: text('formula_text'),
    form: text('form'),
    strength: text('strength'),
    packLevels: jsonb('pack_levels').$type<PackLevel[]>().notNull().default([]),
    referenceMrpPaisa: bigint('reference_mrp_paisa', { mode: 'number' }),
    quality: catalogQuality('quality').notNull(),
    source: catalogSource('source').notNull(),
    /**
     * `identityKey()` from `domain/catalog/identity.ts` — brand + strength +
     * form + manufacturer, normalised.
     *
     * UNIQUE, so the database is the last line of defence against the same
     * medicine entering the global catalogue twice. Importers are idempotent on
     * this column: re-applying a pack updates rather than duplicates, which is
     * what lets a pack be re-imported safely after a partial run.
     */
    identityKey: text('identity_key').notNull(),
    /**
     * `equivalenceKey()` — formula + strength + form, no brand.
     *
     * Emphatically NOT unique: everything sharing it is an alternative a
     * pharmacy may legitimately stock side by side. Indexed because "what else
     * is this?" is a question the counter asks.
     */
    equivalenceKey: text('equivalence_key'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    uniqueIndex('global_products_identity_key').on(table.identityKey),
    index('global_products_equivalence_idx').on(table.equivalenceKey),
    index('global_products_name_idx').on(table.name),
  ],
);

/**
 * Which catalogue packs this installation has applied.
 *
 * Append-only, like every other record of something that happened: an import is
 * an event, and the history of what was applied and when is exactly what a
 * support call needs ("which catalogue is this shop on?"). The newest row by
 * `catalogVersion` is the current catalogue.
 */
export const catalogVersions = pgTable('catalog_versions', {
  id: uuid('id').primaryKey(),
  catalogVersion: text('catalog_version').notNull(),
  packFormat: integer('pack_format').notNull(),
  productCount: integer('product_count').notNull(),
  /** Rows the import actually created and updated — rarely equal to the above. */
  insertedCount: integer('inserted_count').notNull(),
  updatedCount: integer('updated_count').notNull(),
  generatedAt: text('generated_at'),
  /** Where it came from: the installer's bundled pack, or a file someone chose. */
  origin: text('origin').notNull(),
  appliedAt: createdAt(),
});

export const globalBarcodes = pgTable(
  'global_barcodes',
  {
    id: uuid('id').primaryKey(),
    globalProductId: uuid('global_product_id')
      .notNull()
      .references(() => globalProducts.id),
    barcode: text('barcode').notNull(),
    unitLevelName: text('unit_level_name').notNull(),
    createdAt: createdAt(),
  },
  (table) => [uniqueIndex('global_barcodes_barcode_key').on(table.barcode)],
);

export const catalogProposals = pgTable(
  'catalog_proposals',
  {
    id: uuid('id').primaryKey(),
    /** Provenance only — kept per contribution (Phase 6 §6). */
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),
    type: proposalType('type').notNull(),
    payload: jsonb('payload').notNull(),
    status: proposalStatus('status').notNull().default('pending'),
    reviewedAt: timestamp('reviewed_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (table) => [index('catalog_proposals_status_idx').on(table.status)],
);

/* ========================================================================== */
/* §7 Licensing (PCN-005)                                                      */
/*                                                                             */
/* `licences` is tenant-scoped: a licence is bought by a pharmacy. The other    */
/* two are tenant-FREE, because they are facts about the machine — one Node can */
/* serve many tenants when a pharmacy is cloud-hosted, and conflating machine   */
/* identity with business identity is what makes "the customer replaced their   */
/* PC" an unanswerable support ticket (commercialization.md Part 1 §5).         */
/* ========================================================================== */

/**
 * [PCN-005] Every licence token ever installed on this tenant. Append-only.
 *
 * In `EVENT_TABLES`, which is the point: the app role holds SELECT and INSERT
 * and an explicit REVOKE of UPDATE and DELETE, so the record of what this
 * pharmacy is entitled to is something the running application physically
 * cannot rewrite or erase. ADR-1's guarantee, applied to licensing rather than
 * bolted beside it.
 *
 * Renewing is a row. Rebinding is a row. Nothing updates:
 *
 *   - the effective licence is derived per Invariant L2 (group by `licence_id`,
 *     newest `issued_at` within a group, then greatest `entitlement_ends_at`
 *     across groups);
 *   - the binding is derived per Invariant L3 (does ANY row for the effective
 *     licence carry this machine's id);
 *   - the rebind count is derived from the distinct installation ids.
 *
 * The unique index carries `issued_at` as well as tenant, licence and
 * installation, and all four are load-bearing:
 *
 *   - re-pasting the SAME token on the SAME machine collapses onto the existing
 *     row (same issued_at) — idempotent, as a paste should be;
 *   - a RENEWAL shares its `licence_id` by design (L2 supersedes within a
 *     licence by `issued_at`) and is usually on the same machine, so without
 *     `issued_at` in the key it would conflict and be silently dropped — a
 *     pharmacy that paid and could not be renewed;
 *   - a REBIND carries the same token to a NEW machine and gets its own row.
 */
export const licences = pgTable(
  'licences',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),

    /** The signed token verbatim — re-verifiable, re-exportable, re-writable. */
    token: text('token').notNull(),

    /** Denormalised from the VERIFIED payload, so queries need no crypto. */
    licenceId: uuid('licence_id').notNull(),
    issuedAt: timestamp('issued_at', { withTimezone: true }).notNull(),
    entitlementEndsAt: timestamp('entitlement_ends_at', { withTimezone: true }).notNull(),
    tokenExpiresAt: timestamp('token_expires_at', { withTimezone: true }).notNull(),
    graceDays: integer('grace_days').notNull(),
    warnDays: integer('warn_days').notNull(),

    /** The machine this token was verified on. Never rewritten. */
    installationId: uuid('installation_id').notNull(),

    createdBy: uuid('created_by')
      .notNull()
      .references(() => users.id),
    createdAt: createdAt(),
  },
  (table) => [
    uniqueIndex('licences_tenant_licence_installation_issued_key').on(
      table.tenantId,
      table.licenceId,
      table.installationId,
      table.issuedAt,
    ),
    index('licences_tenant_idx').on(table.tenantId),
  ],
);

/**
 * [PCN-005] Machine identity — the database half of `installation.json`.
 *
 * Mutable, and deliberately not an event table: `last_version` and
 * `last_hostname` move with every release and every rename. `id` and
 * `first_seen_at` are never updated by any writer.
 *
 * Its real job is that boot can **restore** the installation id when
 * `%ProgramData%` has been cleaned, rather than minting a fresh one and
 * silently unbinding a paying customer. It is also one of the four sources the
 * trial anchor takes a `min()` over, which is what stops a deleted file from
 * resetting a trial.
 */
export const installations = pgTable('installations', {
  id: uuid('id').primaryKey(),
  firstSeenAt: timestamp('first_seen_at', { withTimezone: true }).notNull(),
  lastVersion: text('last_version').notNull(),
  /** Support triage only. Never enforcement — that would be a fingerprint. */
  lastHostname: text('last_hostname'),
  updatedAt: updatedAt(),
});

/**
 * [PCN-005] The monotonic clock witness (Invariant L5). Append-only.
 *
 * The only anchor that advances on an IDLE installation, and therefore the only
 * thing that can prove an entitlement has elapsed with no internet and no
 * trading. The ledger cannot: it moves only when business moves.
 *
 * The rows are evidence, not verdicts. The witness is the K-th largest
 * observation at or below any signed `clockCeiling`, so one bad reading from a
 * failing CMOS battery cannot poison it permanently — see
 * `domain/licensing/clock.ts` for why `max()` is the wrong reducer and cannot
 * be repaired after the fact.
 */
export const clockObservations = pgTable(
  'clock_observations',
  {
    id: uuid('id').primaryKey(),
    observedAt: timestamp('observed_at', { withTimezone: true }).notNull(),
    /** 'boot' | 'interval' — how this observation came to be taken. */
    source: text('source').notNull(),
    createdAt: createdAt(),
  },
  (table) => [index('clock_observations_observed_at_idx').on(table.observedAt)],
);

/* ========================================================================== */

/**
 * Event tables, per Phase 9 §5.1 — INSERT only for the application role.
 * `src/db/grants.sql` reads this list; keep them in step.
 */
export const EVENT_TABLES = [
  'purchases',
  'purchase_lines',
  'sales',
  'sale_lines',
  'sale_line_allocations',
  'payments',
  'sale_returns',
  'sale_return_lines',
  'adjustments',
  'cash_movements',
  // [PCN-005] A licence history and a clock the application cannot rewrite.
  'licences',
  'clock_observations',
] as const;
