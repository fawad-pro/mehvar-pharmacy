# Mehvar Pharmacy — working agreement

Read this before touching anything. It is the short form; **the authoritative
specification is `docs/MASTER_PLAN.md`** and it wins every disagreement with
this file.

## The one rule

**The planning package is the spec. Sessions implement it; they do not
re-litigate it.** A discovered flaw is raised as a plan-change note, decided,
then implemented — never silently patched around (Phase 11 §4, Phase 4 §7).

## Reading order for a new session

Phase 5 (domain) → Phase 9 (schema) → Phase 8 (ADRs) → Phase 7 (workflows) →
Phase 10 (screens) → Phase 11 (standards) → Phase 13 (day plan). Phases 1–4, 6
and 12 are context and constraints; consult as referenced.

## Identifier system — cite these by number

- **P1–P8** product principles · **I1–I7** interaction · **T1–T5** trust (Phase 4)
- **D1–D5** domain semantic decisions (Phase 5 §4)
- **W1–W12** core workflows (Phase 7)
- **ADR-1–ADR-8** architecture decisions (Phase 8)

## Vocabulary — use these words, no synonyms

Base unit / BaseQty · Pack levels · Batch · **Pending layer** · Allocation ·
**Quick item** · Udhaar · Settlement · Cash movement · Receipt number · Paisa ·
Global catalog / tenant catalog · Verifier · **The three numbers** (today's
sales, expected cash in drawer, running udhaar total).

The master plan's terminology is the codebase's (Phase 11 §2).

## Non-negotiables

1. **Append-only records, derived truth** (ADR-1). No domain API updates an
   event row. Corrections are compensating rows referencing their target. The
   only two sanctioned mutations in the entire system — allocation resolution
   and `batches.qty_remaining` — live as named functions in `domain/inventory/`
   and nowhere else (ADR-8).
2. **The tenant chokepoint** (ADR-2). Every query is constructed in
   `src/db/scoped.ts`, which cannot be constructed without tenant context.
   Nothing outside `src/db` imports `drizzle-orm`, `pg`, or `db/client.ts` — put
   new queries in a module under `src/db`, as `auth-queries.ts` does.
3. **Branded units** (Phase 11 §2). `Paisa` and `BaseQty`; raw `number` never
   crosses a domain boundary for money or stock. Pack-factor multiplication
   happens only in `src/lib/quantity.ts`. Money is integer paisa; stock is
   integer base units.
4. **Never block a sale** (P2). Missing catalog entry, ambiguous price, network
   drop, unknown barcode, insufficient stock — every one has a designed fast
   path. Stock may go negative (D2); the pending layer makes it visible, never
   silent.
5. **One code path for online and offline** (ADR-5). Offline records are ingested
   through the same domain writer, idempotent on client ID.
6. **Layering** (Phase 11 §1). `domain/` never imports `app/`, `components/`, or
   framework code. Lint enforces 2, 3-adjacent, and 6.
7. **No raw hex** outside `src/app/globals.css` (Phase 10 §6/§9). Semantic colour
   only with meaning (I7).
8. **TypeScript strict; `any` forbidden** (Phase 11 §2).

## Definition of done, per feature (Phase 11 §4)

- Invariant/transaction tests for anything touching money or stock
- Keyboard path works end to end
- Visible-state duties honoured (unsynced badge, exception surfacing)
- Token lint clean
- A one-line note citing which W/P/D/ADR items it satisfies

## Testing priority (Phase 11 §3) — invariants over coverage

1. **Rebuild equivalence** (the crown): randomized event sequences → assert the
   `qty_remaining` rebuild matches live values and every Phase 5 §5 invariant
   holds. This one suite guards the entire trust promise.
2. Transaction semantics (`commitSale`, `receivePurchase`, returns)
3. Sync idempotency (replay N times = exactly-once effects)
4. Search ranking (including "pandol" → Panadol)
5. **One** E2E path: W1 verbatim by keyboard

No unit-test theater around framework glue. No coverage targets. Tests land with
their feature, never after — rebuild equivalence ships the same day as
`commitSale`.

## Session plan (Phase 13 §3)

| Session | Day | Slice                                                                        |
| ------- | --- | ---------------------------------------------------------------------------- |
| 0       | —   | Bootstrap: scaffold, tooling, tokens, unit primitives ✅                     |
| 1       | 1   | Schema, `scoped.ts`, migrations + seed, app shell, ADR-7 auth ✅             |
| 2       | 2   | Catalog & search: CRUD, client index, ranking ladder, barcodes               |
| 3       | 3   | **Sale core** — `commitSale`, FEFO, pending layer, cart UI + the crown suite |
| 4       | 4   | Payment, receipt numbering, kiosk print, udhaar sale, settlement             |
| 5       | 5   | Offline capture & sync                                                       |
| 6       | 6   | Purchases, batches, adjustments, opening stock, pending resolution           |
| 7       | 7   | Day close, reports, owner surface, returns, settings, export                 |
| 8       | 8   | Buffer & hardening: E2E, token lint sweep, restore drill, verifier, deploy   |

Day 3 is the highest-consequence day. **If anything slips, it slips _into_ that
day, never out of it.**

**Cut order if a day slips** (decided calmly in advance, Phase 13 §3): weekly and
monthly report tabs → CSV import in W9 → returns without receipt → near-expiry
60/90 horizons → quick-item completion queue polish.

**Never cut:** rebuild-equivalence tests, offline capture, receipt printing,
exception visibility.

## Things Day 1 established that later sessions rely on

- **The app connects as a non-owning database role.** Event tables are
  INSERT-only for it (Phase 9 §5.1). If a writer needs to change an event row,
  that is a design error, not a grant to widen — the only sanctioned mutations
  are allocation resolution and `batches.qty_remaining`. Allocation resolution
  will need a SECURITY DEFINER function when Day 6 builds it; `batches` is
  already writable.
- **Run `npm run db:grants` after any migration that adds a table.** A new table
  starts with default privileges, so a new event table is mutable until granted.
- **`TenantScope` stamps `tenant_id` and `created_by`.** Never pass them; they
  are ignored if you do.
- **`tenants` is not scopeable** — use `src/db/provisioning.ts`.
- **The keyboard registry is one array** (`src/client/keyboard/registry.ts`). The
  key bar renders it and the handler binds it. Add a key in one place.
- **Integration suites skip without a database**, and immutability assertions
  additionally skip without `APP_DB_ROLE`. Green locally is not proof; the
  pre-deploy gate runs them for real.

## Commits

Conventional messages (`feat(sales): …`), small, trunk-based, tags at day
boundaries. Migrations are committed with their feature. `npm run verify` before
pushing (the pre-push hook runs it; enable with `npm run hooks:install`).
