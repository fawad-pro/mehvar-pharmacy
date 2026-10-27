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

`docs/research/commercialization.md` — packaging, local installation, updates,
licensing, product identity and the Mehvar ecosystem. **Gated on PCN-004**,
which proposes reversing Phase 3 §3's cloud deployment decision in favour of
Option E (local-first with optional cloud). Read it in full — and check PCN-004's
status — before touching anything installer-, update-, licensing- or
Hospital-integration-adjacent. Nothing in it is decided.

## Identifier system — cite these by number

- **P1–P9** product principles · **I1–I7** interaction · **T1–T5** trust (Phase 4)
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
- **Never build a query with a correlated `sql` subquery.** Drizzle renders
  interpolated columns unqualified **when the outer query is a single table** —
  `where ${saleReturns.saleId} = ${sales.id}` becomes `where "sale_id" = "id"`,
  both bind to the inner table, and it counts zero forever without erroring.
  Add a join to the outer query and the same expression renders correctly.
  _Refined Day 9_: that condition is the trap's real shape, and it makes the
  rule untestable by example — check it with one joined query and you will
  conclude it is folklore. Both branches are pinned in
  `db/drizzle-correlated-subquery.test.ts`. The rule stands for a sharper
  reason than "Drizzle is broken": a correlated subquery is correct only while
  its outer query keeps a join it does not own, so an unrelated edit can
  silently falsify it. Use plain grouped aggregates, which depend on nothing
  but themselves.

## Things Day 4 established

- **`commitSettlement` is the one writer for standalone payments**, idempotent
  on client id from day one, exactly as `commitSale` was on Day 3 — Day 5
  ingests it unchanged.
- **`sales` and `payments` share one receipt-number sequence** (PCN-002).
  `highestReceiptCounterAcrossReceipts` checks both tables; a writer that only
  checked `sales` would let a settlement collide with a sale's number.
- **The udhaar key is dispatched, never shared state.** `udhaar-key-context.tsx`
  (renamed from `f8-context.tsx` on Day 16, once Udhaar itself had moved off
  F8) is how the Sale surface takes the key for itself (cart has items)
  without either screen importing the other's internals; extend by
  registering a handler, not by teaching `AppShell` about a new screen's
  state.
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
  _Superseded by PCN-012 (2026-10-24): the reasoning is inverted — a cost that
  lands low reports a HIGHER margin. Allocations are to be costed cumulatively,
  rounding up, so cost is never understated and a used-up batch reconciles
  exactly to what was paid. Do not copy the floor into new code._
- **A batch born from an adjustment is counted once.** It is that batch's
  `qty_received`; the adjustment sum in `batchLedger` takes only _negative_
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
  _absent_ from the stock map, which the index reads as unknown rather than zero
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

## Things Day 8 established

- **A range-scoped figure must never be offered as something to act on.** The
  drawer count rendered against the Overall range's all-time expected cash; the
  number was merely confusing, but the _form beneath it_ would have written an
  uneditable over/short off it. When a screen shows a figure for a range, check
  what it invites the owner to do with it.
- **A label carries its own time scope, or the owner cannot read the screen.**
  "Sales" and "Expected cash" are the range's; the udhaar total is a position
  and always all-time. Three numbers with two different scopes and one heading
  is a screen nobody can explain out loud.
- **A derived figure and its expansion are one thing, and must be tested as
  one.** `customerBalance` had three terms and `customerLedger` had two for a
  whole session. Anywhere a number is shown big and also broken into rows,
  assert that the rows sum to the number.
- **A new invariant is not evidence until it has been seen to fail.** The
  ledger/balance assertion passed with the bug reintroduced, because the crown
  suite reached a credit-reducing return about once in ten histories. Revert
  the fix and watch the suite go red _before_ believing it. When an invariant
  depends on a rare generated event, add a counter to the suite's
  "actually exercised" guard so it cannot silently stop covering the case.
- **A built, correct, unreachable workflow is not built.** W9's opening stock
  was a query-string away from nowhere; `listPurchases` was called by nothing.
  Both had passed their own tests. Grep for the entry point, not the function.
- **Setup events are not exceptions.** `opening_stock` in the exception list
  meant one row per shelf line burying the ones that mean something. The same
  discipline as I7's colours: a channel that fires routinely stops being read.
- **Tailwind v4 gives `<button>` `cursor: default`.** Not a v3 default. The base
  rule in `globals.css` is deliberate, not decoration — without it every control
  in the product reads as inert text under the pointer.
- **Keyboard-first is a claim about speed, not a licence to ignore the mouse.**
  The key bar is navigable now. Dismissal is per-overlay and deliberate:
  pickers dismiss on backdrop click, the payment overlay does not.

## Things Day 9 established

- **A place to do, a separate place to review.** `/receipts` and
  `/purchases/[id]` are the review halves of Sale and Purchases; adjustment
  history moved off Stock and onto Adjust. Stock browsing answers "what do I
  have"; a log of corrections answers "what did we change" and belongs with the
  screen that makes them. Reviewing must never enter a workflow that can change
  something — the one control that does says so and navigates away.
- **Two names for one query is a bug, not a presentation choice.**
  `threeNumbers.salesPaisa` and `reportFigures.revenuePaisa` were the identical
  SQL, printed on one screen as "Sales today" and "Revenue". There is now one
  sales figure in the product and it is net of returns.
- **A reported margin must never be better than the real one** — Day 6's rule,
  which the report was breaking. `commitReturn` correctly touches neither the
  sale nor its allocations (ADR-1), so refunded sales kept contributing full
  revenue *and* full cost forever; since a sale earns more than it costs,
  dropping the returned portion removes more revenue than cost and the gross
  figure was strictly optimistic. Returns are subtracted in the range they
  happened, matching how `expectedCash` already treats them.
- **The key registry is only "one array" if the handler binds by meaning.** It
  branched on the literal strings `'F8'` and `'F10'`, so reordering the bar
  would have silently rewired what the keys did. Routeless keys now carry a
  `dispatch` field, and `registry.test.ts` pins that every one of them has it.
- **Ten keys with no pattern is ten things to memorise.** The bar is three
  bands — counter (F1–F4), goods (F5–F8), owner (F9–F10) — ordered by how close
  the task is to the customer, with a visible divider. A grouping nobody can
  see is a comment, not a design.
- **Six headings the owner has to total up is not a summary.** The exception
  list is one banner naming the kinds, with the groups beneath as the answer
  rather than the question. The empty state is a positive statement ("Nothing
  needs a look today") because an absence reads as a missing section.

## Things Day 10 established

- **A pharmacy asks two questions about two medicines, and they are not the
  same question.** `identityKey` (brand + strength + form + manufacturer)
  answers "have I already got this?" and blocks. `equivalenceKey` (formula +
  strength + form) answers "can I give this instead?" and only informs.
  Merging Panadol and Paracip because they share a molecule would destroy real
  inventory — they are alternatives a shop stocks on purpose.
- **`875mg/125mg` and `125mg/5ml` are written identically and mean different
  things.** Same dimension on both sides is a combination; different dimensions
  is a concentration. Strength is parsed to integer micrograms/microlitres, not
  compared as text, because a strength mix-up reaches a patient.
- **Reduce for comparison, never for display.** A concentration reduced to
  lowest terms is arithmetically identical and unreadable (`25mcg/1mcl`). The
  parsed value keeps what the pack says (D4); `componentKey` does the reducing.
- **A catalogue update must not need an application release.** Packs are
  versioned data files (`domain/catalog/pack.ts`), applied idempotently on
  identity so "run it again" is always safe advice. `format` (shape) and
  `catalogVersion` (freshness) are separate numbers; a pack from a newer format
  is REFUSED whole rather than partially imported.
- **Importing a catalogue never changes a pharmacy's own products, prices or
  stock.** Identity only, both because Phase 6 §2 says so and because a pack is
  shared by every shop (T3).
- **`uuidv7().slice(0, 8)` is not unique.** The first 48 bits of a v7 are a
  millisecond timestamp, so the leading 8 hex characters change roughly once a
  minute — two runs seconds apart produce identical "unique" values. Use the
  tail, which is the random part.
- **The shared-database rule has a second half.** `catalog_versions` and
  `global_products` have no tenant column at all, so they accumulate across
  every run, not just every test. Assert the property ("the older pack did not
  become current"), never the value.

## Things Day 11 established

- **A success message that counts files is not a success message.** `db:migrate`
  printed "Migrations applied (6 file(s))" whether it applied six or zero — the
  number was `readdir().length`. It now names the target database and each
  migration it actually applied, and says "already up to date" out loud.
- **`migrate()` resolving is not evidence the schema is current.** It resolves
  happily when it decides there is nothing to do, and that decision comes from
  a table that can disagree with the journal (a stale `created_at` watermark is
  enough). `assertJournalApplied` compares the journal to
  `drizzle.__drizzle_migrations` afterwards and refuses, naming the migration.
  Without it the symptom surfaces days later as "column does not exist" on an
  unrelated page.
- **PostgreSQL reports a MISSING role and a wrong password identically** —
  `password authentication failed for user` — deliberately, so roles cannot be
  enumerated. Anyone debugging a fresh install is therefore sent to check a
  password that was never wrong. `db:grants` is the only thing that creates
  `mehvar_app`, so `docker compose down -v` + migrate + seed leaves no role at
  all.
- **`npm run db:setup` is the supported fresh path**, one command, because the
  three steps are not independent: grants creates the role that seed connects
  as. `e2e:reset` and the README use it, so they cannot drift.
- **Configure on every run, not only on create.** `db:grants` set the app role's
  password only when creating the role, which quietly made `APP_DB_PASSWORD`
  mean "the password to use if this role does not exist yet". Rotating it in
  `.env` did nothing and the app failed authentication against a credential the
  operator could see was correct.
- **`dotenv/config` fills any variable the shell left unset.** Unsetting
  `DATABASE_ADMIN_URL` to target a scratch database silently got `.env`'s value
  instead — so a migration ran against a completely different database and
  reported success. This cost a wrong diagnosis during this very session;
  printing the target is what makes it visible.

## Things Day 12 established

- **A green component test proves nothing about the path to it.** Every
  catalogue test passed while the Add Product picker found nothing on every
  fresh install, because each test applied its OWN pack and then searched it.
  `db:setup` never loaded the real one; the Windows installer did, and the
  developer machine had it only because it was imported by hand while building.
  A test that supplies its own fixture cannot notice the supply chain is
  broken.
- **This is the third repeat of the same mistake** (Day 8's unreachable W9, Day
  10's unreachable global catalogue, this). The fix is a test aimed at the
  PATH: `tests/setup-path.test.ts` reads the `db:setup` chain and names the
  stage that went missing. Cheap, runs without a database, and catches a
  re-omission on every run.
- **An empty catalogue is a setup state, not a "no results" state.** Reporting
  one as the other is what made this invisible for days: the operator was told
  to try another spelling when no spelling would ever work. `searchCatalogAction`
  returns `catalogLoaded` alongside the matches, and the picker says which
  command to run.
- **What ships to a pharmacy and what a developer gets must come from one
  chain.** The installer applied the pack; `db:setup` did not. Both now build
  from `seed-data.ts` and apply through `applyCatalogPack`.

## Things Day 13 established

- **The E2E suite had never once been run.** A build failure was reported as an
  environment limitation and never rechecked; it was transient, and the real
  blocker was a missing browser binary, which `PLAYWRIGHT_CHROMIUM_PATH` (already
  supported by the config) solves. Four specs were failing — three from renames
  and moves this work made, one from a genuine race. "Blocked by the
  environment" is a claim with a shelf life; re-test it before repeating it.
- **A debounced URL sync races the navigation it sits next to.** Typing a
  receipt number schedules a `router.replace` 200ms out; clicking the result
  inside that window pushed the detail page and the replace landed on top,
  putting the operator back on the list. The fastest way to use the screen was
  the one path that broke. Any screen that syncs search state to the URL must
  cancel that sync when the operator navigates.
- **An E2E failure after a UI change is the suite doing its job.** Three of the
  four were labels and locations this work deliberately changed — "Running
  udhaar total" → "Owed to you", adjustment history moving off Stock, the
  settlement slip's "Previous/New balance" → "Before/Now". Update the spec to
  the new intent; never weaken an assertion to make it pass.
- **A spec asserting `-50.00` on a balance was asserting a bug.** It pinned the
  minus sign the position vocabulary exists to remove.

## Things Day 14 established

- **A bootstrap command runs against databases people have been using for
  weeks.** `db:seed` meant "create the demo pharmacy" and died on the unique
  slug, taking `db:setup` with it and leaving the catalogue step unrun. It now
  means "make sure the demo pharmacy exists and its catalogue is current".
- **"Idempotent" here means the END STATE is safe to ask for again**, not that
  the same statements can run twice. The split is deliberate: the tenant's
  product catalogue is topped up (missing seed products added, matched on
  `identityKey` so a differently-typed duplicate is never created, existing rows
  never modified); sales, batches, cash movements, customers, users and devices
  are created once and never again, because repeating them would double the
  stock on every shelf and invent sales that never happened.
- **`db:setup` must never be the destructive one.** `db:reset && db:setup` is
  how a clean demo is asked for, and `setup-path.test.ts` pins that setup does
  not itself reset.
- **A top-up adds nothing it cannot add honestly.** New seed products arrive
  with no opening stock; inventing batches on a database somebody has been
  testing against would corrupt the figures they were testing.

## Things Day 15 established

- **A script that reaches the database loads `dotenv/config` first.** The two
  catalogue scripts did not, so they read `.env` only when the shell already
  exported `DATABASE_URL` and `SESSION_SECRET`. `db:setup` completed migrate,
  grants and seed and then died in its last step — on a machine whose `.env` was
  present and correct the whole time, which is why the report reasonably
  suspected everything except the missing import.
- **`catalog:build` passing told us nothing**, because it writes a file from a
  static list and never calls `serverEnv()`. The half of a chain that needs
  configuration is the half that must be tested with none.
- **My own environment masked it, for the third time this month.** Day 12's
  hand-imported pack, Day 14's already-seeded database, and now every command
  in this session being prefixed with `export`. A clean-run reproduction
  (`env -i PATH HOME`, `.env` as the only source) is now the standard for
  anything on the setup path — not because Windows is different, but because a
  developer shell is.
- **`tests/script-env.test.ts` checks the class, not the two broken files.** It
  walks the module graph from every npm-script entry point and requires dotenv
  from any script that reaches `src/env`/`src/db` **or** names a variable
  `.env.example` defines. Taking the variable list from the template means a new
  one is covered without anyone remembering this test exists. Libraries are
  excluded on purpose: `scripts/db/verify-all.ts` reaches the database and must
  NOT load dotenv, because a module that reads `.env` as a side effect of being
  imported is worse than the bug being prevented.

## Things Day 16 established

- **A hint that spells out a shortcut by hand can drift the moment the bar is
  reordered.** Udhaar moved from F8 to F4 (Day 9), and `registry.test.ts`
  pinned that the *handler* binds by dispatch meaning, but nothing pinned
  that on-screen *text* did — the Sale surface and payment overlay kept
  saying "F8" for months after the key moved. `keyFor(dispatch)` is now the
  only way a hint may name a key; `hint-sourcing.test.ts` requires the four
  known sites to call it and sweeps the rest of the source tree for the same
  shape of bug (a dispatch key's meaning named next to a literal number)
  reappearing anywhere else.
- **A file named after a key is a hint that will also go stale.**
  `f8-context.tsx` was renamed to `udhaar-key-context.tsx`, with every
  export and comment describing the mechanism by meaning ("the udhaar key")
  rather than by letter. The file compiling with a wrong name in it for
  months is the same lesson as the hints, one level up.
- **"Currently correct" is not evidence a hint is sourced correctly.** The
  top bar's `<kbd>F10</kbd>` for Switch user, and a server action's "Press
  F10 to switch user", were the identical bug — silent, only because that key
  has not moved yet. Both now call `keyFor('switch-user')` too.

## Things Day 19 established

- **Never renumber a migration that has run anywhere.** drizzle knows an
  applied migration only by its journal `when`; a cherry-picked migration with
  a regenerated `when` is a NEW migration to every database that ran the
  original. That is what broke `0009_supplier_credit` on databases that had
  run it as `0006_supplier_credit`. A colliding number on a branch is resolved
  before it runs anywhere, or by keeping the original `when`.
- **If one is renumbered anyway, register it in the same commit**
  (`scripts/db/renumbered-migrations.ts`). The database's row for the former
  `when` is proof only while its hash equals the current file's, so the file is
  never edited afterwards; `renumbered-migrations.test.ts` fails if it is.
- **"Already exists" in a migration is a history question, not a DDL one.** The
  tempting fix was `IF NOT EXISTS` in 0009, which would also have hidden every
  future drift. The answer was in `git log` and the recorded hash.

## Things Day 20 established

- **Earliest-expiry-first is wrong the day a batch expires.** An expired batch
  is always the earliest, so FEFO alone sells it first. `planAllocation` takes
  the business day as a required argument (PCN-008); forgetting it is exactly
  how the bug looked.
- **A test date chosen as "the future" is a time bomb.** Two tests went red the
  day PCN-008 landed because `2026-09-01` had quietly become the past. Use
  dates that stay on their side of today (`2020-…`, `2030-…`), or pin today.
- **A correction records the figures it leaves behind** (PCN-009:
  `effective_unit_cost_paisa`, `invoice_delta_paisa`), so readers sum rather
  than replay history. Reports value allocations at the latest corrected cost;
  nothing else had to learn about corrections.
- **A new event table has three homes**: `EVENT_TABLES` (grants), the test
  purge (`tests/db-admin.ts`), and the export. The export was missed once
  (`supplier_payments`); `export-coverage.test.ts` now pins it.
- **The E2E suite runs against a developer's database without a reset.** A
  spec that needs a shortfall or an expired batch sizes it from the current
  catalog payload, never from the seed; warm-up lists every routed key.

## Things the scanner fix established

- **Revalidating a route does not reach the counter's search index.** The
  index is client state built from `/api/catalog`, held by `CatalogProvider`
  in the counter layout across navigation. A catalogue edit must call
  `useCatalog().refresh()`; the search box also pulls changes on arrival. A
  comment claiming `revalidateAfter('catalog')` made edits "reach /sale" is
  what kept this invisible.
- **`refresh` from `useCatalog` is stable on purpose.** It was rebuilt with
  every index, so an effect depending on it re-ran after the refresh it
  triggered.
- **A scanned code is a GTIN only by proof**, never by shape: AI 01 with a
  valid check digit, and GTIN-13 ⇄ `0`-prefixed GTIN-14 as the only
  equivalence. Indicator digits 1–9 are other packaging levels.

## Things the supplier account established

- **Walk the whole workflow, not the screen you changed** — the owner's
  standing instruction. Supplier credit had a balance, a Pay button and tests
  for both, and a payment still vanished: nothing listed it. Before calling a
  money workflow done, follow the money from where it is entered to every place
  someone would look for it afterwards, and back.
- **A balance with a Pay button needs its expansion** (T4). `supplierLedger`
  is to `supplierBalance` what `customerLedger` is to `customerBalance`, and
  `supplier-balance.integration` asserts the rows sum to the balance (Day 8).
  A new term in one is a new term in the other.

## Commits

Conventional messages (`feat(sales): …`), small, trunk-based, tags at day
boundaries. Migrations are committed with their feature. `npm run verify` before
pushing (the pre-push hook runs it; enable with `npm run hooks:install`).

## Things the scan guard established

- **A scanner types into whatever has the cursor and presses Enter.** Every
  form that commits on Enter was one scan away from recording a barcode as
  money: Cash tendered, a settlement, a supplier payment, Paid now. Fixing
  them one by one found the next one each time.
- **One guard on the window, ahead of every screen** (`client/scan/field-guard.ts`,
  mounted by `ScanGuard` in the shell). A field that is MEANT to receive scans
  opts out with `data-scan-target`; everything else is protected without
  anyone remembering to protect it. A new scan field that forgets the
  attribute fails loudly (its scans are put back), never silently.
- **"Not an amount" is not zero.** `parseRupeeInput` returns null; use it
  wherever reading junk as Rs 0 would record something (a drawer count, Paid
  now). `paisaFromRupeeInput` (zero for junk) is only for fields where zero
  commits nothing.

## Things Session 2 (stock coming in) established

- **A batch's cost is a total, not a rate.** No whole-paisa per-unit cost
  multiplies back to what was paid (a box of 14 at Rs 250). Margin takes each
  outflow's cumulative share — `C(n) = ⌈total × n ÷ received⌉`, cost =
  `C(after) − C(before)` — from the batch's CURRENT total (D1: corrections
  restate what already left). Every outflow is a movement (D2). Never multiply
  `unit_cost_paisa` into a money figure again; it is nominal.
- **A purchase line's cost has one expression.** `purchaseLineCostSql` in SQL,
  `lineCostPaisa` in TypeScript. Summing `qty_base × unit_cost_paisa` is the
  bug this replaced; the crown suite's own supplier check had it too, and went
  red the moment pack lines appeared — which is how it should be found.
- **Counts arrive in packs; the database keeps base units.** Every count is
  turned into base units through `lib/quantity` (`levelToBaseUnits`,
  `costOfBaseUnits`), and the writer refuses an entered pack whose size is not
  the product's.

## Things the PCN-012 final pass established

- **A movement records the words it was entered in.** Returns, removals and
  supplier returns carry `unit_key`/`unit_name`/`unit_count` beside the base
  quantity; display them with `describeCounted`, and let the writer check the
  unit against the product rather than trusting the screen.
- **A unit's key is its identity; its name is a label.** Renames are allowed,
  size changes are not. Anything that finds a unit from a history row matches
  by key, or by size — never by the name the row was written with.
- **Moving stock between products is a transfer, not a loss.**
  `product_replaced` adjustments are a `transfer` in `batchCostLedger`; a
  write-off figure that counted them would report a loss that never happened.
  The moved cost is the batch total less what already left, so both batches
  reconcile exactly.
- **A server action that revalidates re-renders the page it was called
  from.** A result shown on that page vanishes if the page's own render
  changes (the replace screen now renders "already replaced"); show the result
  where the user goes next.
- **The receipt belongs to the customer.** A shortfall note (D2) printed on
  every oversold sale's slip for months, and a refund slip read "Amount Due
  -530.00" with an udhaar reduction labelled "Paid". Staff-facing notices go on
  the counter screen and the exception list, never in `ReceiptData`; a
  receipt-producing event that is not a sale says what it is (`refund`).
- **A load must never overwrite what the user changed.** Settings filled its
  form from an effect with no cancellation; development runs effects twice,
  and the second answer landing after a click saved the old value back. That
  left auto-print off for the rest of the E2E suite — first misdiagnosed as an
  interrupted run. Every effect that fills editable state from a request
  ignores a stale answer, and a spec that changes shared settings reads the
  saved value back before trusting its own clean-up.
- **A hand-kept list of risky fields misses the next one.** The Settings PIN
  field shipped without an autofill opt-out because `password-autofill.test.ts`
  checked a list nobody updated; Chrome filled the device's saved login into a
  new salesman's name and PIN. The test now finds every password input in
  `src` and fails until each is declared opted-out or a real login. The same
  autofill sends a key-less `keydown`: a native key listener must not assume
  `event.key` is a string.
