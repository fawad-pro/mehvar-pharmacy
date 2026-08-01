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

## Open research threads (not yet ADRs)

`docs/research/fbr-compliance.md` — FBR/tax-authority compliance readiness
vs. integration. Deliberately deferred past Day 8; read it in full before
touching anything tax- or compliance-adjacent, and before writing the ADR it
sets up.

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

| Session | Day | Slice                                                                       |
| ------- | --- | --------------------------------------------------------------------------- |
| 0       | —   | Bootstrap: scaffold, tooling, tokens, unit primitives ✅                    |
| 1       | 1   | Schema, `scoped.ts`, migrations + seed, app shell, ADR-7 auth ✅            |
| 2       | 2   | Catalog & search: CRUD, client index, ranking ladder, barcodes ✅           |
| 3       | 3   | **Sale core** — `commitSale`, FEFO, pending layer, cart UI + crown suite ✅ |
| 4       | 4   | Payment, receipt numbering, kiosk print, udhaar sale, settlement ✅         |
| 5       | 5   | Offline capture & sync ✅                                                   |
| 6       | 6   | Purchases, batches, adjustments, opening stock, pending resolution ✅       |
| 7       | 7   | Day close, reports, owner surface, returns, settings, export ✅             |
| 8       | 8   | Buffer & hardening: E2E, token lint sweep, restore drill, verifier, deploy  |

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

## Things Day 3 established

- **`commitSale` is the one writer for sales.** It owns its transaction whole and
  is already idempotent on client id — Day 5 ingests through it unchanged.
- **Run `npm run db:verify` after anything that moves stock.** It is the ADR-8
  verifier; a mismatch is sev-1.
- **Extend the crown suite, never fork it.** Purchases (Day 6) and returns
  (Day 7) add event kinds to `applyRandomEvent`; the value is that one history
  mixes everything.
- **Never build a verifier query with a correlated `sql` subquery.** Drizzle
  renders the interpolated outer column unqualified, and it resolves silently
  against the inner table. Use plain aggregates.

## Things Day 4 established

- **`commitSettlement` is the one writer for standalone payments**, idempotent
  on client id from day one, exactly as `commitSale` was on Day 3 — Day 5
  ingests it unchanged.
- **`sales` and `payments` share one receipt-number sequence** (PCN-002).
  `highestReceiptCounterAcrossReceipts` checks both tables; a writer that only
  checked `sales` would let a settlement collide with a sale's number.
- **F8 is dispatched, never shared state.** `f8-context.tsx`'s registry is how
  the Sale surface takes the key for itself (cart has items) without either
  screen importing the other's internals; extend by registering a handler, not
  by teaching `AppShell` about a new screen's state.
- **The receipt is one shape for every receipt-producing event**
  (`ReceiptData` in `src/client/print/receipt.ts`). A settlement is a sale
  receipt with no `lines` — add a new receipt-producing event (returns, Day 7)
  by constructing this same shape, not a new one.
- **`export type` re-exports do not survive a `'use server'` file.** Next's
  server-actions transform throws a runtime `ReferenceError` on a type-only
  re-export inside a directive module; re-export types from a plain module
  instead, or don't re-export what nothing imports.
- **Extend the crown suite, never fork it.** Udhaar sales and settlements are
  now event kinds in `applyRandomEvent`, and Phase 5 invariant 3 (customer
  balance) is checked every 10 events alongside the stock invariants —
  purchases (Day 6) and returns (Day 7) add their own kinds the same way.

## Things Day 5 established

- **Every capture goes through the outbox, online or not.** `useSync().capture()`
  is the only way a sale, settlement, quick item or customer is written. A new
  offline-capturable event is a new kind in `client/sync/records.ts` plus a
  branch in `domain/sync/ingest.ts` — and nothing else may be added to that
  union without a plan change (ADR-3 scopes it to W1–W3 and W6).
- **The receipt prints on the `capture()` resolve, never on a server response**
  (Phase 7 rule 3). If a new receipt-producing event appears, it prints from
  local state too.
- **`domain/sync/ingest.ts` holds no business rules.** It routes to the writer
  that already owns each record. A rule appearing there means an offline sale
  has started meaning something different from an online one (ADR-5).
- **Delivery is strictly FIFO and stops at the first failure**, because records
  depend on each other — a quick item before the sale that references it, a
  customer before the udhaar sale that owes against it.
- **A client component must never import from a module that reaches the
  database.** `commit-sale.ts` does; `sale-command.ts` is its pure half and is
  what the counter imports. Typecheck and lint cannot see this — `server-only`
  is the guard, and it only fires at build/run time, so a green
  `typecheck && lint` is not evidence the browser bundle is clean.
- **Backoff belongs to the pump, not the records.** `attempts` on a record is
  its history (feeding `origin` and the stuck warning); the pump's own
  consecutive-failure count drives the delay and clears on `online`.
- **`npm run build && npm run start` is the only real test of the service
  worker.** It registers in production only, and `e2e/pwa.spec.ts` skips
  otherwise — green in dev is not proof, exactly as with the database suites.
- **The E2E suite needs a seeded database and shares one.** Run it with
  `npm run e2e:reset`. It shares a device identity and a receipt sequence too,
  so a spec must never assert an exact global count — W6's quick item creates
  real products, and pinning the seed's 53 made one spec's correct behaviour
  look like another's regression. A spec that leaves lockout or balance state
  behind must clear it.
- **The E2E suite runs on one worker, and that is correctness.** One database,
  one paired device, one receipt sequence: parallel workers are counters
  sharing a prefix, contending for numbers. Do not raise it to "speed the suite
  up".
- **Startup waits are not interaction waits.** The default five-second expect
  timeout belongs to assertions about a keystroke being answered (I2). Route
  compilation, the catalog fetch and the receipt context are one-time costs
  that no spec measures — they get `STARTUP_TIMEOUT_MS`, and `warm-up.ts`
  compiles the routes once before any test runs.
- **Anything the counter needs before it can sell must retry forever.** The
  receipt context is the example: no receipt number means no sale, so a single
  failed fetch at startup would otherwise disable Pay until someone reloaded.
  A wall the operator cannot see or clear is worse than an outage (P2).
- **A backoff nothing schedules is decorative.** If a delay is computed,
  something has to act on it; otherwise the real recovery time is whatever the
  slowest poll happens to be.

## Things Day 6 established

- **`commitPurchase` is the one writer for purchases**, `commitAdjustment` the
  one writer for adjustments — same shape as `commitSale`: own the transaction
  whole, idempotent on client id from the first commit.
- **One batch per purchase line, never per product.** FEFO (D1) only means
  something if the expiry that arrived with a delivery stays attached to the
  units that arrived with it.
- **Allocation resolution is a database function, not application code.**
  `resolve_sale_line_allocation` (migration 0003) is SECURITY DEFINER with a
  pinned `search_path`; the app role holds EXECUTE on it and no UPDATE on
  `sale_line_allocations`. Its guard clause is also the concurrency control —
  `SELECT … FOR UPDATE` is not available to a role without UPDATE privilege, so
  a lost race returns `false` and the caller skips rather than decrements.
- **Pending rows resolve oldest-first and whole or not at all.** Chronology, not
  FEFO; splitting one would mean mutating an event row or inventing an
  allocation.
- **Effective unit cost floors.** Bonus stock makes cost land a paisa low rather
  than high, so a reported margin is never better than the real one.
- **A batch born from an adjustment is counted once.** It is that batch's
  `qty_received`; the adjustment sum in `batchLedger` takes only *negative*
  deltas. Day 3's signed sum was right until materialization existed, and
  `db:verify` is what caught it.
- **A `'use server'` file must not re-export a type — this bit twice.** Day 4's
  `CustomerListItem` and Day 6's `BatchOnHand` are the same `ReferenceError`.
  When a client component needs a shape that a query returns, declare the shape
  in the pure domain module and let `src/db` import it from there: that also
  keeps the client out of a module reaching the database.
- **A `<label>` with no `htmlFor` beside an input with no id labels nothing.**
  Nest the input inside its label when the fields are generated per row. If a
  spec cannot find a field by name, neither can a screen reader.
- **A spec that receives stock must not use a product another spec oversells.**
  The suite shares one database. Related: a product the seed never stocked is
  *absent* from the stock map, which the index reads as unknown rather than zero
  and does not warn about — correct behaviour, wrong choice for a test that
  wants a guaranteed shortfall.

## Things Day 7 established

- **`commitReturn` and `commitCashMovement` are the one writers for their
  events**, same shape as every other transactional writer: own the
  transaction whole, idempotent on client id from the first commit.
- **A repeated gap gets the same fix, not a fresh debate.** PCN-003
  (`sale_returns` needed a `receipt_number`) is PCN-002's exact shape found
  again; the fix was applying the decided pattern, not re-litigating it.
- **`restockToBatch` is ADR-8's second sanctioned mutation's mirror image** —
  symmetric to `consumeFromBatch`, unguarded on the way up since there is no
  upper bound a return could violate the way a sale could violate a lower
  one.
- **A documented "no-op today" is a promise to keep, not a comment to
  outlive its own accuracy.** Day 5 left `− Σ credit reversed` in
  `customerBalance` as dead code with a note explaining why; Day 7 is where
  that note either becomes true or gets deleted as wrong. It became true.
- **`ThreeNumbers`/`ReportFigures`/every exception-row type gets redeclared
  in each client component that needs it**, never imported from
  `src/db/reporting-queries.ts`. The type-erasure argument ("it's erased at
  compile time, so it's safe") is exactly the argument the rule exists to
  refuse — nothing in the toolchain can verify erasure by reading the file,
  so the rule is "don't name the module," not "imports are fine if
  type-only."
- **`textContent()` across sibling elements has no whitespace between
  them.** A regex capturing "everything non-whitespace" after a label will
  swallow the next sibling's text if the DOM has no space node separating
  them. Bound the capture to the actual format instead of trusting
  whitespace that was never there.
- **Cutting a plan item is a recorded decision, not a silent gap.** Weekly
  and monthly report tabs are Phase 13 §3's own named cut-order item; cutting
  them the moment the day's scope was clear (rather than after running out of
  time) and writing down why (Phase 4 §7) is the same posture as a PCN,
  applied to scope instead of a schema gap.

## Commits

Conventional messages (`feat(sales): …`), small, trunk-based, tags at day
boundaries. Migrations are committed with their feature. `npm run verify` before
pushing (the pre-push hook runs it; enable with `npm run hooks:install`).
