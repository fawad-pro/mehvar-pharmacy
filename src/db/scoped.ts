/**
 * THE tenant chokepoint — ADR-2, Phase 9 §5.2, Phase 11 §1.
 *
 * ============================================================================
 * NOT YET IMPLEMENTED. This is Session 1 / Day 1 work (Phase 13 §3).
 * ============================================================================
 *
 * "One data-access module owns every query; it requires tenant context to
 * construct. No raw queries outside it."
 *
 * Row-scoped multi-tenancy (ADR-2) is a consciously taken trade-off: it is the
 * only variant compatible with one-week delivery and solo operations, and the
 * price of that choice is that isolation is guaranteed by discipline at ONE
 * place rather than by the database. That is what this module is. Postgres RLS
 * is the documented post-V1 hardening step (Phase 12 §5), not a V1 dependency.
 *
 * The shape Day 1 implements:
 *   - a `TenantScope` that cannot be constructed without a tenant id;
 *   - query builders that close over it, so no call site can forget the filter;
 *   - transaction helpers, since `commitSale` and friends own their transaction
 *     boundary whole (Phase 11 §2);
 *   - global-catalog access kept deliberately separate (Phase 9 §6 tables carry
 *     no tenant_id, and must never be reachable through a tenant scope).
 *
 * Phase 12 §5 requires a test asserting that no query path constructs without
 * tenant context. That test lands with this module, on Day 1.
 */

export {};
