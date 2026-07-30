# Mehvar Pharmacy Implementation Status

## Planning

- [x] Planning complete
- [x] Architecture approved
- [x] Repository created

## Session 0 — Bootstrap

- [x] Next.js App Router + TypeScript strict scaffold
- [x] Phase 11 §1 directory structure, each folder carrying its contract
- [x] Design tokens (Phase 10 §6) as CSS variables, wired into Tailwind
- [x] Branded units and unit arithmetic (`Paisa`, `BaseQty`, business day) + tests
- [x] Lint guards: domain layering, DB chokepoint, no raw hex, no `any`
- [x] Vitest and Playwright harnesses
- [x] Drizzle config, local Postgres, `db:reset` / `db:migrate` / `db:seed` scripts
- [x] Pre-push gate (typecheck + lint + test)
- [x] `CLAUDE.md` working agreement, `docs/PLAN_CHANGE_NOTES.md` ledger

Verified green: `typecheck`, `lint`, `test` (28), `build`, `e2e` (1).

No business functionality implemented, by design. No plan-change notes raised.

## Session 1 — Day 1, Foundation

- [x] Drizzle schema verbatim from Phase 9 (22 tables, CHECKs, indexes)
- [x] `scoped.ts` tenant chokepoint + `provisioning.ts` bootstrap door
- [x] Phase 9 §5.1 grants: INSERT-only on event tables for the app role
- [x] Migrations + demo pharmacy seed (53 products, 49 opening batches, customer
      with an udhaar balance, opening float)
- [x] App shell: top bar, key bar, F-key registry (Phase 10 §1/§3)
- [x] ADR-7 auth: device login, PIN switch, Argon2id, rate limit and lockout
- [x] Tests: chokepoint enforcement (unit + integration), PIN hash/lockout
- [x] Done-when: `db:reset && db:migrate && db:grants && db:seed` yields a
      logged-in shell with a switchable user, asserted by E2E

Verified green: `typecheck`, `lint`, `test` (60), `build`, `e2e` (3).

**Open for review: PCN-001** — ADR-7's login flow has no schema, and Phase 9
§5.1's "app role" is never provisioned. Implemented under the recommendation;
see `docs/PLAN_CHANGE_NOTES.md`.

## Session 2 — Day 2, Catalog & search

- [x] Client-side index (ADR-4): sorted-token prefix search, consonant-skeleton
      matching, trigram-prefiltered fuzzy, barcode hash
- [x] Ranking ladder per Phase 10 §5, with the ranking table as its spec
- [x] IndexedDB cache with incremental refresh against an `updated_at` watermark
- [x] `GET /api/catalog` — whole or `?since=` delta
- [x] Products CRUD: server-paginated list, pack-level editor with preview,
      barcode linking, completion queue
- [x] Search UI on the Sale surface, keyboard-only
- [x] Tests: ranking table, scale characteristics at 3,000 and 12,000 products,
      pack-level and barcode validation, six E2E paths

Verified green: `typecheck`, `lint`, `test` (137), `build`, `e2e` (9).

## Session 3 — Day 3, Sale core

- [x] `commitSale` as one transaction: lines, FEFO allocation, pending layer,
      discounts, override flags, cash split
- [x] Idempotent on client id (ADR-3), with `FOR UPDATE` batch locking
- [x] Pure FEFO planner (D1) and pending layer (D2)
- [x] Rebuild + verifier (ADR-8), plus `npm run db:verify`
- [x] Cart UI: quantity grammar, unit-level cycling, in-place line edit
- [x] Device-scoped receipt numbers (Phase 9 §3)
- [x] **Rebuild-equivalence suite (the crown)** — randomized, seeded histories
- [x] Transaction semantics, FEFO ordering incl. NULLS LAST, pending creation
- [x] Done-when: a keyboard-only cash sale commits, stock derives correctly, and
      `db:verify` agrees against the real database

Verified green: `typecheck`, `lint`, `test` (219), `build`, `e2e` (14).

## Session 4 — Day 4, Payment, receipt, udhaar

- [x] Payment overlay: tendered/change, F12 or Space-from-cart, cash/credit
      split when a customer is attached
- [x] F8 contextual (defect C5): attaches a customer with items in the cart,
      falls back to Settle Udhaar on an empty cart — via `f8-context.tsx`,
      shared with no other screen state
- [x] `commitSettlement` — idempotent standalone payment, mini-statement
      computed inside the transaction (T4/T5)
- [x] Inline customer create (name + phone only, W2), reused by both the
      attach and settle pickers
- [x] Printed receipt (ADR-6, Phase 10 §7): one shape for sale / udhaar sale /
      settlement, print-CSS scoped to `#printable-receipt`
- [x] Device-scoped receipt numbering extended to payments (PCN-002), sharing
      one sequence with sales
- [x] Customers screens: list (balances largest-first) and detail (T4 ledger)
- [x] Rebuild-equivalence suite extended with udhaar sales and settlements;
      Phase 5 invariant 3 (customer balance) checked continuously
- [x] Done-when: W1, W2 and W3 complete end-to-end by keyboard with a printed
      receipt in hand (asserted via `#printable-receipt`'s content)

Verified green: `typecheck`, `lint`, `test` (243), `build`, `e2e` (18).

**Open for review: PCN-002** — `payments` needed a receipt number Phase 9 §3
never named. Implemented under the recommendation; see
`docs/PLAN_CHANGE_NOTES.md`.

## Pre-implementation track (Phase 13 §2 — owner-side, blocks Day 1 where noted)

- [ ] **Catalog curation** — hand-verified head of ~1,500–3,000 fast movers with
      pack structures and MRPs. **The long-lead item**; the launch gate is this
      curated head, not the full DRAP seed.
- [ ] **Hardware** — reference pharmacy's printer and scanner models identified
      and tested against ADR-6 kiosk printing **before Day 1**. Printer surprises
      are the classic week-one derailment.
- [ ] **Infrastructure** — Railway project, Postgres, staging, domain, error
      tracking, backup storage bucket.
- [ ] **Brand assets** — wordmark treatment, receipt mark, tokens confirmed
      against Phase 10 §6.
- [ ] Local development environment (`.env` from `.env.example`, Docker Postgres)

## Phase 13 — the build week

- [x] Day 1 — Foundation: schema, chokepoint, migrations + seed, app shell, auth
- [x] Day 2 — Catalog & search
- [x] Day 3 — Sale core (**highest consequence**; the crown test suite lands here)
- [x] Day 4 — Payment, receipt, udhaar
- [ ] Day 5 — Offline capture & sync
- [ ] Day 6 — Purchases, batches, stock operations
- [ ] Day 7 — Day close, reports, owner surface, export
- [ ] Day 8 — Buffer & hardening, restore drill, production deploy

## Definition of V1 complete (Phase 13 §7)

- [ ] W1–W12 operable by keyboard at the counter, on real hardware
- [ ] Rebuild-equivalence suite green; production verifier scheduled and quiet
- [ ] Selling survives a connectivity disruption with no user action, no data loss
- [ ] Receipts print correctly for sales, udhaar, settlements and returns
- [ ] Owner's three questions answered on a phone in one glance
- [ ] Backup running, restore drill passed, export working
- [ ] Reference pharmacy onboarded, opening stock entered, first live day sold through
