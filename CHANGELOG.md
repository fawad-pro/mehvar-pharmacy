# Changelog

All approved plan changes and implementation milestones will be recorded here.

## Session 1 — Day 1, Foundation

**Schema (Phase 9, verbatim)**

- 22 tables: six reference, ten append-only event tables, `batches` carrying
  ADR-8's single transactional cache, three global-catalog tables, plus the
  three PCN-001 additions (`devices`, `sessions`, `tenants.slug`).
- CHECK constraints for Phase 5 invariant 4 (cash + credit = total, total =
  subtotal − discount), credit-requires-customer, positive quantities and
  amounts, and adjustment signed-delta/reason consistency.
- All money `bigint` paisa; all quantities integer base units; UUIDv7 keys, with
  `sales` and `payments` keyed by the client-generated id (ADR-3).

**ADR-1 made physical**

- `db:grants` REVOKEs UPDATE and DELETE on every event table from a non-owning
  application role. Immutability is now a database privilege rather than a code
  convention, and an integration test proves the database refuses both verbs.
- A REVOKE against the schema owner is inert, so the app connects as
  `mehvar_app` and migrations run as the owner. Raised as PCN-001.

**The chokepoint (ADR-2)**

- `TenantScope` cannot be constructed without a tenant id and an acting user; it
  stamps `tenant_id` and `created_by` on every insert, so a caller cannot forget
  attribution (T1) or write into the wrong tenant.
- Its type constraint rejects tenant-free tables at compile time — which caught
  that `tenants` itself cannot be scoped, and gave provisioning its own door.
- Tests: unit (construction guards, predicate binding) and integration (two
  tenants side by side — cross-tenant read, write and update all fail).

**Auth (ADR-7)**

- Device login with a hashed pairing key; long-lived counter session; PIN switch
  moving the acting user within that session. Argon2id, rate limiting, lockout
  with self-expiry so a counter is never bricked (P8).
- Policy split from hashing so the overlay can import PIN rules without dragging
  a native Argon2 binding into the browser bundle.

**Shell (Phase 10 §1/§3)**

- Top bar (pharmacy, active-user chip, connectivity), key bar rendering the one
  keyboard registry, and the ten global function keys bound from that same
  array — the printed shortcut and the bound handler cannot drift apart.
- Counter surfaces exist as routed placeholders naming the session that fills
  each, so no key on the bar leads somewhere blank.

**Seed**

- 53 curated products with real pack structures, 49 opening batches with a
  deliberate expiry spread, three suppliers, a customer with an udhaar balance,
  and an opening float.

**Fixed**

- `db:reset` dropped `public` but left Drizzle's migration ledger, so the next
  `db:migrate` believed it had nothing to do and produced an empty database that
  claimed to be migrated — silently breaking Phase 11 §4's contract.

**Open for review:** PCN-001.

## Session 0 — Bootstrap

Repository prepared for implementation. No business functionality; no
architectural decisions taken beyond what the planning package already fixes.

**Scaffold**

- Next.js 16 (App Router) + React 19 + TypeScript strict, per Phase 8 §2.
- Phase 11 §1 directory structure created in full, each directory carrying a
  `README.md` stating its contract and the plan sections that govern it.
- `db/schema.ts` and `db/scoped.ts` exist as documented stubs — both are Day 1.

**Design tokens (Phase 10 §6)**

- Palette, type scale and density values as CSS variables in
  `src/app/globals.css`, mapped into the Tailwind v4 theme. Inter with tabular
  numerals applied globally. No default theme shipped.

**Unit primitives (Phase 11 §2)**

- `Paisa`, `BaseQty` and `PackFactor` branded types; integer-paisa money
  arithmetic; base-unit quantity arithmetic with pack-level conversion confined
  to `lib/quantity.ts`; tenant-local business-day helpers defaulting to
  Asia/Karachi. 28 tests.

**Tooling**

- Vitest for unit and invariant suites; Playwright for the single E2E path.
- ESLint flat config + Prettier, carrying four guards that make plan clauses
  mechanical rather than reviewable-by-eye: `domain/` may not import `app/`,
  `components/` or framework code (Phase 11 §1); nothing outside `src/db` may
  import `drizzle-orm`, `pg` or `db/client.ts` (ADR-2); no raw hex outside
  `globals.css` (Phase 10 §6/§9); `any` is an error (Phase 11 §2). Each guard
  was verified to fire against a deliberate violation.
- Drizzle config, `docker-compose.yml` for local Postgres, and the
  `db:reset` / `db:migrate` / `db:seed` scripts.
- Pre-push hook running typecheck + lint + tests (Phase 11 §4). No CI, by the
  same clause.

**Governance**

- `CLAUDE.md`: vocabulary, identifier system, non-negotiables, definition of
  done, testing priority, session plan and cut order.
- `docs/PLAN_CHANGE_NOTES.md`: the ledger for raising a plan flaw instead of
  patching around it.

**Tooling choices made** (left open by the plan, not architectural): npm,
Node 22, Vitest, Playwright, ESLint flat config, Tailwind v4.

No plan-change notes raised — Phases 5, 8, 9, 10 and 11 were re-read against
each other and no gap forced an assumption.

## Version 1.0

- Initial planning package approved.
