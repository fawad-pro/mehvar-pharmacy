/**
 * Drizzle schema — Phase 9, verbatim.
 *
 * ============================================================================
 * NOT YET IMPLEMENTED. This is Session 1 / Day 1 work (Phase 13 §3).
 * ============================================================================
 *
 * When it lands it implements Phase 9 exactly as written — the Day 1 risk note
 * is explicit that "schema churn later is expensive; Phase 9 is implemented as
 * written, not improvised." The conventions that govern every table:
 *
 *   §1 IDs         — UUIDv7 primary keys; sales and payments carry the
 *                    CLIENT-generated id as the primary key, which is what makes
 *                    offline sync idempotent by construction (ADR-3).
 *   §1 Tenancy     — `tenant_id` on every tenant-owned row. Global catalog
 *                    tables (§6) carry none.
 *   §1 Attribution — `created_by` + `created_at` on every business row (T1).
 *                    Immutable tables have NO `updated_at`: there are no updates.
 *   §1 Money       — integer paisa, `bigint`. No floats anywhere near money.
 *   §1 Quantities  — integer base units everywhere (Phase 5 §2).
 *   §1 Immutability— event tables accept INSERT only, enforced by REVOKE (§5.1).
 *                    The only sanctioned mutations in the entire system are
 *                    allocation resolution and `batches.qty_remaining` (ADR-8).
 *   §1 Soft archive— reference entities carry `is_active`; nothing is deleted.
 *
 * Table groups, in Phase 9's order:
 *   §2 Reference   — tenants, users, products, product_barcodes, customers, suppliers
 *   §3 Events      — purchases, purchase_lines, sales, sale_lines,
 *                    sale_line_allocations, payments, sale_returns,
 *                    sale_return_lines, adjustments, cash_movements
 *   §4 Batches     — batches, holding the single ADR-8 transactional cache
 *   §6 Global      — global_products, global_barcodes, catalog_proposals
 *
 * Indexes are Phase 9 §5.5; CHECK constraints are §5.4.
 */

export {};
