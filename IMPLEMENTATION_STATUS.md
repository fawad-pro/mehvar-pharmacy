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
- [ ] Day 2 — Catalog & search
- [ ] Day 3 — Sale core (**highest consequence**; the crown test suite lands here)
- [ ] Day 4 — Payment, receipt, udhaar
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
