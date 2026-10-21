# Phase 9 — Data Model & Database Design

Status: Draft for review
Implements: Phase 5 (domain), per ADR-1/2/3/5/8 (Phase 8). PostgreSQL.

Conventions first, tables second, enforcement third. Column lists name the semantically required fields; implementation may add mechanical columns (timestamps handled by convention) but may not add mutable business state to immutable tables.

---

## 1. Conventions

- **IDs:** UUIDv7 primary keys. Money-critical client-originated rows (sales, payments) carry the client-generated ID as the primary key — idempotent sync by construction (ADR-3).
- **Tenancy:** `tenant_id` on every tenant-owned row; every query passes through the tenant-scoped data-access chokepoint (§5). Global-catalog tables carry no tenant_id.
- **Attribution:** `created_by` (user id) + `created_at` on every business row (T1). Immutable tables have no `updated_at` — there are no updates.
- **Money:** integer paisa (`bigint`). No floats anywhere near money.
- **Quantities:** integer base units (Phase 5 §2) everywhere. Presentation converts.
- **Immutability:** business-event tables accept INSERT only (enforced §5). Products/customers/suppliers are reference entities: editable fields limited to identity/settings, never to anything a report derives from.
- **Soft archive:** reference entities carry `is_active`; nothing is ever deleted (referenced history must resolve).
- **Business day:** derived from `created_at` in tenant-local time (single timezone country); no stored day-close lock (D5). Over/short entries are cash movements with a reason code.

## 2. Reference tables

**tenants** — id, name, status (`active | suspended`), settings JSONB (receipt header/footer, timezone default Asia/Karachi, expiry horizons).

**users** — id, tenant_id, name, role (`owner | salesman`), pin_hash, password_hash (owner remote login, nullable for salesmen), is_active.

**products** — id, tenant_id, global_product_id (nullable FK, Phase 6 link), name, manufacturer, form, strength, formula_text, base_unit_name, pack_levels JSONB (ordered levels: `[{name:"strip",factor:10},{name:"box",factor:100}]` — factors in base units), default_price_per_base_unit, current_mrp_per_base_unit (reference ceiling, D4), min_stock_base_units (nullable), needs_completion boolean (D3), is_active.
*Pack levels as JSONB, not a child table: read-whole, written rarely, never queried relationally — the simplest honest shape.*

**product_barcodes** — id, tenant_id, product_id, barcode, unit_level_name. Unique (tenant_id, barcode).

**customers** — id, tenant_id, name, phone (nullable), is_active. Nothing else, by charter boundary.

**suppliers** — id, tenant_id, name, phone (nullable), is_active.

## 3. Event tables (append-only)

**purchases** — id, tenant_id, supplier_id, invoice_ref, invoice_date, note, cash_paid_paisa, credit_tracked, created_by/at.
*PCN-007: `cash_paid_paisa` is what was paid at receiving; the remainder is owed to the supplier. `credit_tracked` is false for every purchase entered before supplier credit existed (no payment was recorded; migration 0010 marks them by stored default, rewriting no row) — those owe nothing.*
**purchase_lines** — id, tenant_id, purchase_id, product_id, qty_base, bonus_qty_base, unit_cost_paisa (per base unit; bonus units carry zero cost by derivation, not by column), expiry_date, batch_number (nullable), mrp_at_receiving_paisa, price_at_receiving_paisa.
*Each line materializes a batch (§4).*

**sales** — id (client-generated), tenant_id, sale_number (tenant-scoped sequence, assigned server-side for receipt continuity), customer_id (nullable; required iff credit_paisa > 0), subtotal_paisa, invoice_discount_paisa, total_paisa, cash_paisa, credit_paisa, change_paisa, origin (`online | offline_sync`), client_committed_at, created_by/at.
CHECK: cash + credit = total; credit > 0 ⇒ customer_id set.

**sale_lines** — id, tenant_id, sale_id, product_id, qty_base, entered_unit_level, unit_price_paisa (per base unit as charged), line_discount_paisa, price_overridden boolean (T1 exposure).

**sale_line_allocations** — id, tenant_id, sale_line_id, batch_id (nullable), qty_base, unit_cost_paisa (from batch; null while pending).
*The D1/D2 mechanism: server-side FEFO writes one row per consumed batch (ADR-5); `batch_id NULL` rows are the pending layer, plus resolved_by (nullable FK to the purchase_line or adjustment that later resolved it) and resolved_at. Pending rows are the only "mutable" business rows in the system, and only their resolution fields may be set — once, forward-only.*

**payments** — id (client-generated), tenant_id, customer_id, amount_paisa, method (`cash`), sale_id (nullable: set when part of a sale commit; standalone = settlement W3), origin, client_committed_at, created_by/at.

**supplier_payments** — id, tenant_id, supplier_id, amount_paisa, method (`cash`), purchase_id (nullable), note, created_by/at.
*PCN-007: the payable mirror of `payments`. A supplier balance is derived: Σ (line cost − cash paid) over tracked purchases − Σ supplier payments.*

**sale_returns** — id, tenant_id, sale_id, cash_out_paisa, credit_reduced_paisa, reason_note, created_by/at.
**sale_return_lines** — id, tenant_id, sale_return_id, sale_line_id, qty_base, restock_batch_id (nullable — known source batch or write-off).

**adjustments** — id, tenant_id, product_id, batch_id (nullable), qty_base_delta (signed), reason (`damage | expiry_writeoff | distributor_return | count_correction | opening_stock`), note, created_by/at.
*Positive opening/count deltas materialize batches (§4).*

**cash_movements** — id, tenant_id, direction (`in | out`), amount_paisa, reason (`opening_float | owner_withdrawal | expense | over_short`), note, created_by/at.

## 4. Batches

**batches** — id, tenant_id, product_id, source (`purchase_line | adjustment`), source_id, batch_number (nullable), expiry_date (nullable only for non-perishables), unit_cost_paisa, price_per_base_unit_paisa, qty_received_base, **qty_remaining_base** (the single ADR-8 transactional cache), created_at.
Derivation contract: qty_remaining = qty_received − Σ allocations − Σ negative batch adjustments + Σ restocked returns. The rebuild/verifier routine (ADR-8) recomputes and compares; mismatch alerts.
FEFO order: expiry_date ASC NULLS LAST, created_at ASC.

## 5. Enforcement

1. **Immutability:** REVOKE UPDATE/DELETE on event tables for the app role; allocation-resolution and qty_remaining changes go through SECURITY DEFINER functions (or the single transaction path) — the only doors, and they only open forward.
2. **Tenant chokepoint:** one data-access module owns every query; it requires tenant context to construct. No raw queries outside it. (Row-Level Security noted as a hardening option post-V1; the chokepoint is the V1 guarantee, P6.)
3. **Sale commit = one transaction:** insert sale + lines + FEFO allocations + payment + decrement qty_remaining. Offline ingestion runs the identical function per record, idempotent on client ID (ADR-5's "one code path").
4. **Checks in schema, not just code:** the CHECK constraints above, qty_base > 0 on lines, amount_paisa > 0 on payments, signed-delta reason consistency on adjustments.
5. **Indexes (hot paths):** (tenant_id, created_at) on all event tables; (tenant_id, product_id, expiry_date) on batches; (tenant_id, customer_id) on sales/payments; (tenant_id, barcode) unique; (tenant_id, needs_completion) partial on products; (tenant_id, sale_number) unique.

## 6. Global catalog tables (tenant-free; Phase 6)

**global_products** — id, name, manufacturer, formula_text, form, strength, pack_levels JSONB, reference_mrp_paisa (nullable), quality (`verified | reference`), source (`drap_seed | curated | promoted`).
**global_barcodes** — id, global_product_id, barcode, unit_level_name.
**catalog_proposals** — id, tenant_id (provenance), type (`barcode | new_product | mrp_signal`), payload JSONB, status (`pending | accepted | rejected`), reviewed_at.
*Identity only — no tenant pricing, no sales data, ever (Phase 6 §2 line).*

## 7. Derived views (compute-on-read; ADR-8)

Defined as SQL views/queries, not tables: product stock (Σ batch qty_remaining + pending exposure), customer balances (Phase 5 invariant 3), daily summary (W10's three numbers + exception list: overrides, discounts, adjustments, returns, quick items, negative-stock incidents, cash movements, late-synced records), near-expiry and low-stock lists, margin reporting (allocations' cost vs. charged price — honest about bonus units and pending allocations).

## 8. Export shape (Phase 3 §5.2)

One tenant-scoped dump: every table above filtered by tenant, as CSV-per-table in a zip, generated on demand. No format cleverness; completeness is the feature.

## 9. Exports to later phases

- Phase 10: daily-summary view is W10/W11's contract; needs_completion queue feeds the completion UI.
- Phase 11: §4 derivation contract and §5.3 idempotency are the highest-value test targets.
- Phase 12: backup cadence for this single database is the business-continuity story (P8); verifier alerting wiring.
