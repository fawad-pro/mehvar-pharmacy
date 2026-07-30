# Changelog

All approved plan changes and implementation milestones will be recorded here.

## Session 4 — Day 4, Payment, receipt, udhaar

W1's cash path gets a real payment overlay; W2 and W3 land in full, end to end,
with a printed receipt in hand.

**Payment overlay (Phase 10 §4)**

- F12 anywhere on the Sale surface, or Space from a focused cart row, opens the
  overlay. Tendered defaults to the exact total; change renders at the
  display's largest size next to TOTAL. Enter commits, Esc returns to the cart.
- Attaching a customer (F8, defect C5) turns the same overlay into a
  cash/credit split: whatever is tendered is cash, the remainder goes on the
  customer's account. With nobody attached, a shortfall is refused at the
  overlay — the same `credit_without_customer` rule the domain already
  enforces, surfaced before the commit rather than after.

**F8 is genuinely contextual (defect C5)**

- A small registry (`f8-context.tsx`) lets the Sale surface claim F8 for
  itself whenever the cart has items (attach customer, W2); with nothing
  registered — an empty cart, or any other screen — `AppShell` falls back to
  the global Settle Udhaar overlay (W3). Neither screen imports the other's
  internals; the fallback is a dispatch, not a shared state object.

**Udhaar sale and settlement (W2, W3)**

- `commitSettlement` — the one transaction for a standalone payment, idempotent
  on the client id exactly as `commitSale` was on Day 3, so Day 5 ingests it
  unchanged. No ceiling on the amount: Phase 5 invariant 3 has no floor, so an
  overpayment is legal and simply leaves the customer in credit.
- Customer creation is inline everywhere a customer is picked — name and phone
  only (Phase 5 §2's D-boundary), validated the same way whether the picker is
  attaching to a sale or settling a balance.
- The mini-statement (T4/T5: previous balance → this transaction → new
  balance) is computed from the balance read once inside the same transaction
  as the commit, so a concurrent settlement cannot read a stale figure.

**Receipt (ADR-6, Phase 10 §7)**

- One `ReceiptData` shape for a cash sale, an udhaar sale and a settlement — a
  settlement simply carries no `lines`. `usePrintReceipt` mounts the receipt
  and calls `window.print()` after two animation frames, so React has
  committed the DOM before the print engine walks it.
- Print CSS scopes everything outside `#printable-receipt` to
  `visibility: hidden` under `@media print`, sized for 80mm thermal paper; the
  receipt itself stays `display: none` on screen so it never appears in normal
  page flow.

**Customers (Phase 10 §2, W11)**

- List, balances derived and sorted largest-first; detail view is the T4
  ledger — every transaction behind a balance, running total alongside. Both
  read `src/db/udhaar-queries.ts` directly, the same pattern the Products
  screens established on Day 2.

**Rebuild equivalence, extended (Phase 11 §3.1)**

- Udhaar sales and settlements (including replays of both) join the randomized
  event mix. Phase 5 invariant 3 — a customer's balance, independently
  recomputed from the raw rows and through `customerBalance` itself — is now
  checked continuously alongside the stock invariants, so one history proves
  both trust promises at once.

**Fixed**

- A `'use server'` file exporting `export type { CustomerListItem }` threw
  `ReferenceError: CustomerListItem is not defined` at runtime — Next's server
  actions transform does not tolerate a type-only re-export in a directive
  file the way an ordinary module does. The re-export was unused; removed
  rather than worked around.
- Three E2E tests that pressed F12 expecting an immediate commit needed a
  following Enter once F12 started opening the payment overlay instead — an
  expected consequence of the day's own change, not a regression.

**Open for review: PCN-002** — Phase 10 §7 requires a receipt number on every
receipt, including settlements, but Phase 9 §3 named no such column for
`payments`. Implemented under the recommendation (a `receipt_number` column
sharing the device's counter with `sales`); see `docs/PLAN_CHANGE_NOTES.md`.

## Session 3 — Day 3, Sale core

The highest-consequence day. Everything the business promises passes through
`commitSale`, and the crown suite is what makes that claim checkable rather than
asserted.

**`commitSale` — one transaction (Phase 9 §5.3, ADR-5)**

- Sale, lines, FEFO allocations, batch decrements: all of it or none of it. A
  sale with lines but no allocations is a permanently wrong stock figure no later
  correction can distinguish from reality.
- Idempotent on the client id from day one, not from Day 5. ADR-5's "one code
  path" means the online path must already have the property the offline path
  needs, and a suite asserts three deliveries produce one decrement.
- `SELECT … FOR UPDATE` on candidate batches. Two counters selling the last strip
  would otherwise both read the same quantity and leave the batch negative; the
  loser now waits, re-reads, and allocates a pending row — the honest outcome.
- Never refuses a sellable cart. Insufficient stock is a pending allocation and a
  visible exception, not an error (P2, D2).

**FEFO and the pending layer (D1, D2)**

- Allocation planning is a pure function over a batch list, so the most
  consequential arithmetic in the product is testable exhaustively without a
  database. `expiry ASC NULLS LAST, created_at ASC`, with a total order so a plan
  is reproducible.
- Shortfalls become one pending row carrying no cost, resolved as a unit when a
  purchase or count correction arrives on Day 6.

**Rebuild equivalence — the crown (Phase 11 §3.1)**

- Randomized histories through the real writers against a real database, then
  recomputed from records and required to agree. Seeded, so a failure replays.
- Invariants checked continuously rather than only at the end, because a
  violation that appears and is later masked is what final-state assertions miss.
- Two tests assert the verifier can fail and can repair, because a verifier that
  never fires is indistinguishable from one that cannot.

**Cart (Phase 10 §4)**

- Quantity grammar (`3*pana`), Tab to cycle unit levels, +/− stepping by the
  entered unit, Delete to remove, ArrowUp from search into the cart. Keyboard
  only; the mouse works but is never needed.
- Device-scoped receipt numbers, client-minted (Phase 9 §3, defect C1), because a
  receipt with no number is not a receipt and ADR-3 requires printing offline.

**`npm run db:verify`** — the ADR-8 verifier as a command, read-only, exiting
non-zero on mismatch so it can gate a deploy (Phase 12 §2.4).

**Fixed — found by the crown suite on its first run**

- `batchLedger` computed allocations with a correlated subquery, and Drizzle
  renders an interpolated outer column _unqualified_: `where a.batch_id =
${batches.id}` compiled to `where a.batch_id = "id"`, which resolved against
  the inner table. It ran without error and returned zero for every batch. The
  ledger is now four plain aggregates joined in TypeScript — the one module whose
  entire job is to be trustworthy about arithmetic gets the boring
  implementation.

## Session 2 — Day 2, Catalog & search

Built for the 2,000–3,000 product catalog Phase 6 §3.2 describes, not the 53
seeded ones. The distinction is the whole session: the naive implementation —
scan the catalog and edit-distance every product per keystroke — passes a demo
and misses I2 at a real counter.

**The client index (ADR-4)**

- Prefix matching binary-searches a sorted token array; skeleton matching is a
  hash lookup; fuzzy matching never touches the catalog, being nominated by a
  trigram posting list and capped before any edit distance is computed. Build is
  O(catalog); search is bounded by absolute constants.
- Transliteration drift is handled by a consonant skeleton — "panadol",
  "pandol" and "penadol" all reduce to "pndl" — with bounded Damerau-Levenshtein
  as the backstop. Two cheap gatherers beat one expensive one.
- Cached in IndexedDB and refreshed incrementally against an `updated_at`
  watermark, so a corrected price ships one row rather than three thousand.
  Every cache failure degrades to a slower path, never to a counter that cannot
  search (P2).

**Ranking (Phase 10 §5)**

- The ladder in order: exact → name prefix → word boundary → fuzzy → salt and
  manufacturer. Salt matches are labelled in the UI, because a salesman shown an
  unasked-for brand needs to know why (substitution support, Phase 1 §5).
- Barcodes bypass ranking and carry the unit level they map to.
- The ranking table in `catalog-index.test.ts` is the specification, per the
  day's risk note that "the ranking table defines good enough".

**Products screen**

- Server-paginated list with search across name, salt and maker; create and edit
  with a pack-level editor that previews "1 box = 200 tab" before saving, because
  a wrong pack factor corrupts stock silently rather than loudly.
- Barcode linking, scanner-first, with the unit level a required choice.
- The completion queue (D3) surfaces from the partial index added on Day 1.

**Schema**

- `updated_at` on `products` and `product_barcodes` — mechanical columns that
  make incremental index refresh possible. Stamped by `TenantScope.update`, so no
  writer can forget them.

**Fixed**

- `formatPaisa` truncated paisa by default, rendering a Rs 3.50 tablet as "3" on
  the search results and the catalog list. Paisa are now shown by default and
  suppressing them is the opt-in — a wrong price on a counter screen is the kind
  of silent money error the whole codebase is arranged to prevent.
- The seeded udhaar sale consumed Panadol's entire opening batch, leaving the
  demo's most-searched product at zero stock.

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
