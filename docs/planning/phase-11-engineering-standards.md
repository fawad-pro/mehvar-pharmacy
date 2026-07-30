# Phase 11 — Engineering Standards & Development Workflow

Status: Draft for review
Informed by: Phases 5, 8, 9. Governs the implementation repository and sessions.

Everything here exists to protect two things under one-week pressure: the invariants (money and stock truth) and the pace itself. Standards that serve neither are omitted on purpose.

---

## 1. Repository structure

Next.js App Router monolith, structured by domain, not by technical layer:

```
src/
  app/                    # routes: (counter)/sale, purchases, products, customers,
                          # stock, day, settings, login; (owner)/today, stock, udhaar
  domain/                 # THE CORE. Pure business logic, one module per concept:
    sales/                #   commitSale() — the one transaction (Phase 9 §5.3)
    purchases/
    inventory/            #   FEFO allocation, pending resolution, rebuild+verify (ADR-5/8)
    udhaar/               #   balances, settlements
    cash/
    catalog/              #   tenant catalog, global linkage, proposals (Phase 6)
    reporting/            #   derived views' query layer (Phase 9 §7)
  db/
    schema.ts             # Drizzle schema = Phase 9, verbatim
    scoped.ts             # THE tenant chokepoint (ADR-2): all queries constructed here
    migrations/
  client/
    search/               # local index: build, rank, fuzzy (ADR-4, Phase 10 §5)
    sync/                 # offline queue, idempotent replay (ADR-3)
    keyboard/             # global key map (Phase 10 §3), one registry
    print/                # receipt render (Phase 10 §7)
  components/             # shadcn restyled to tokens; no raw hex (Phase 10 §6)
  lib/                    # branded types, money/qty math, dates (Asia/Karachi)
```

Rules: `domain/` never imports from `app/` or `components/`; every DB touch goes through `scoped.ts`; `client/sync` and `domain/sales` share the commit contract type so online and offline are provably the same shape (ADR-5's one code path).

## 2. Coding standards

- **TypeScript strict; `any` forbidden.** Branded types for the two sacred units: `Paisa` and `BaseQty` — raw `number` never crosses a domain boundary for money or stock. Conversion helpers live in `lib/` and are the only place multiplication by pack factors happens.
- **Domain functions are pure or transactional — never half.** Pure calculators (totals, FEFO planning, balance math) take data in, return data out, and are trivially testable. Transactional writers (`commitSale`, `ingestSyncedSale`, `receivePurchase`, `adjustStock`) own their transaction boundary whole (Phase 9 §5.3); no caller composes partial writes.
- **Errors:** domain writers return typed results (`ok | rejected(reason)`); throwing is reserved for bugs. UI maps reasons to I5 messages; no error strings composed in domain code.
- **Immutability in code as in schema:** no domain API updates an event row; compensating writers only. The two sanctioned mutations (allocation resolution, `qty_remaining`) exist as named functions in `inventory/` and nowhere else (ADR-8, Phase 9 §5.1).
- **Naming:** domain vocabulary from Phase 5 verbatim — `Batch`, `Allocation`, `PendingLayer`, `CashMovement`, `QuickItem`. No synonyms; the master plan's terminology is the codebase's.
- **Comments** explain *why* (cite ADR/P/D numbers); the plan is the design doc, code doesn't restate it.

## 3. Testing strategy — invariants over coverage

Priority order, and the honest scope for one week:

1. **Rebuild equivalence (the crown):** seed randomized event sequences (property-style: purchases, sales incl. offline-origin, returns, adjustments, settlements) → assert `qty_remaining` rebuild matches live values and every Phase 5 §5 invariant holds. This one suite guards the entire trust promise (ADR-8; Phase 5 invariant 6).
2. **Transaction semantics:** `commitSale` — splits (cash+credit=total), FEFO order incl. NULLS-LAST expiry, pending-layer creation on shortfall, override/discount flags recorded; `receivePurchase` — batch materialization, bonus-qty cost honesty; returns — restock + compensation correctness.
3. **Sync idempotency:** replaying the same client-ID batch N times = exactly-once effects (ADR-3; Phase 9 §5.3).
4. **Search ranking:** table-driven cases for the Phase 10 §5 ladder, including transliteration drift ("pandol"→Panadol) and formula matches.
5. **One E2E path:** W1 verbatim by keyboard — search → select → qty → pay → receipt DOM rendered — asserting the Phase 10 §3/§4 key sequence. One, not many (P6): it guards the surface that is the product.

No unit-test theater around framework glue; no coverage targets. A failing verifier in production is sev-1 (Phase 8 ADR-8) — tests exist to make that never fire.

## 4. Development workflow (implementation sessions)

- **The planning package is the spec.** Each session starts by loading the consolidated master plan (Batch 7 output); sessions implement, they do not re-litigate. A discovered flaw in the plan is raised as a plan-change note, decided, then implemented — never silently patched around (charter governance; Phase 4 §7 enforcement).
- **Session sequence follows Phase 13's day plan.** One coherent slice per session; each ends with: migrations applied cleanly from zero, tests green, W1 demo-able if touched.
- **Migrations are forward-only and committed with their feature.** `db:reset && db:migrate && db:seed` must always produce a working demo pharmacy (seed: ~50 curated products with real pack structures, a customer with balance, an open purchase draft) — the demo is a build artifact, always one command away.
- **Solo flow, disciplined:** trunk-based, small commits, conventional messages (`feat(sales): …`), tags at day boundaries. No CI in week one; the pre-push script runs typecheck + tests (P6: ceremony proportional to team size).
- **Definition of done, per feature:** invariant/transaction tests for anything touching money or stock; keyboard path works end-to-end; visible-state duties honored (unsynced badge, exception surfacing); token lint clean; a one-line note citing which W/P/D/ADR items it satisfies.

## 5. Exports

- Phase 12: pre-push script + backup/verifier operational wiring; seed pharmacy doubles as the demo environment for sales.
- Phase 13: session slicing consumes §4; test priorities schedule alongside features, not after them (rebuild-equivalence lands the same day as `commitSale`).
