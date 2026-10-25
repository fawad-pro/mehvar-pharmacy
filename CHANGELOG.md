# Changelog

All approved plan changes and implementation milestones will be recorded here.

## Session — Supplier accounts: every payment can be found again

- Each supplier has an account page (Purchases → a supplier's name, or
  "Payments and account" on any invoice). It lists every invoice, correction,
  return and payment with the date, time and who recorded it, and a running
  balance that ends on the figure at the top. Before this, paying the last
  Rs 500 of an invoice from "Owed to suppliers" lowered the balance and was
  shown nowhere.
- An invoice page now says where the supplier's account stands today, beside
  what that invoice left on credit when it arrived.
- The account takes payments too, the way a customer's does.

## Session — Sync backs off when the server cannot store a sale

- A sale the server answers but cannot store (a database missing a
  migration, a writer bug) no longer resends every 250ms. Any answer used to
  reset the sync backoff to zero, so three unsynced sales went out about four
  times a second for as long as the counter was open. Only a delivery that
  moved the queue clears the backoff now; anything else waits 1s, 2s, 4s… up
  to 30s, exactly as an unreachable server does. Nothing queued is dropped.

## Session — Refused stock adjustments leave nothing behind

- Removing more units than a batch has (damage, expiry, a downward count) is
  refused as before, but the refusal no longer saves the adjustment. It was
  returned from inside the transaction, which committed it: the record said the
  units left, the batch still held them, and `db:verify` reported a mismatch.
  The Adjust screen's "try again" then wrote a second one.
- A retry of a refused adjustment is refused again, instead of being reported
  as already done.
- Databases where an adjustment was refused before this fix may already hold
  such records; `npm run db:verify` names the batch if so.

## Session — Readable thermal receipts

- The receipt is laid out at 72 mm, the printable width of an 80 mm roll.
  At 80 mm it was wider than the head prints, so it was shrunk to about 90%
  before it reached the paper.
- Everything prints in solid black. Grey quantities, faint dashed rules and the
  coloured mark were reaching the thermal driver as halftone dots.
- Larger, heavier type: 13px body, bold item names, and the amount due largest
  and boldest on the slip. Nothing printed was added or removed.
- The test receipt ends with a 50 mm and a 72 mm bar, so a ruler shows
  whether a printer scales or clips the page (OPERATIONS.md, "Receipt printer
  settings").

## Session — Barcode scanning at the counter

- A barcode linked on the Products screen now scans at the counter straight
  away. The counter's search index was built once per page load, and catalogue
  edits never refreshed it, so a fresh code read as unknown until a reload.
- The 2D code on medicine packs (GS1 DataMatrix: product number, expiry,
  batch) finds its product. Before, any code containing letters was never
  looked up as a barcode. A pack's code matches the box's printed EAN and every
  later batch of the same pack; a code saved earlier as a full 2D string still
  works.
- An unknown scan no longer opens "Add it now" with the code as the product
  name. The scanner's Enter does nothing by itself; the operator chooses "Link
  it to a product" (owner only, at the unit the code is on) or "Add a new
  product" with the name left blank.

## Session — Prices per strip and box (PCN-012, step 2a)

- Each unit of a product has its own price. The owner types the strip or box
  price they know; Mehvar suggests the others and shows them before saving.
- A box sells at exactly the box price: a box of 14 at Rs 250 is Rs 250.00 on
  the line, the total, the receipt and a refund — no more per-tablet rounding.
- At the counter, Tab moves a line to the next unit at that unit's price and
  keeps the count; + and − add or remove one unit. Receipts say "2 box".
- Sales recorded before this change, and offline sales captured before the
  update, keep exactly the amounts they were charged.

## Session — Pack sizes protected (PCN-012, step 1)

- A product's base unit and pack sizes can no longer be changed once anything
  is recorded against it (stock, a sale, a purchase or an adjustment). Changing
  them would have silently re-read every recorded quantity. Prices, names and a
  larger pack on top (a carton over the box) can still be edited.
- The product edit form says the units are fixed before Save, and the refusal
  says what to do instead.
- New pack sizes must nest: a box must hold a whole number of strips. Products
  already trading with a non-nesting pack keep working and stay editable.

## Session — Supplier credit made visible (PCN-011)

- A supplier holding the pharmacy's money — an overpayment, or credit for goods
  sent back from a paid invoice — used to vanish from every screen. The
  Purchases panel now lists "Credit with suppliers" under "Owed to suppliers".
- Paying more than is owed says, before recording, how much will stay with the
  supplier as credit. A warning, never a block.
- The Day screen shows "Rs X credit with N suppliers" beside the owed figure
  when there is any. Owed and credit are never netted.

## Session — Expired stock, purchase corrections, supplier returns (Day 20)

PCN-008 and PCN-009 applied; the E2E suite made to pass against a database it
has run on before.

**Expired stock is the last stock a sale reaches (PCN-008)**

- Earliest-expiry-first always reached for an expired batch first. Allocation
  now consumes unexpired batches first, then expired, then the pending layer.
- The cart warns "only expired stock left" / "part from expired stock", naming
  the expiry, before payment. Never a block (P2).
- The Day screen lists "Expired stock sold" first, derived from the allocations
  the server actually made, so an offline sale cannot dodge it.

**Purchases can be corrected; goods can go back for credit (PCN-009)**

- Migration 0011: `purchase_corrections` and `supplier_returns`, both
  INSERT-only for the app role. Compensating records: the purchase line is
  never edited.
- A correction states what the line should have said (quantity, bonus, unit
  cost, a reason). Quantity changes move the batch; a corrected cost values
  every unit sold from that batch, including units sold before the correction.
  A reduction larger than the batch still holds is refused.
- A supplier return removes stock from a batch and subtracts the supplier's
  credit from what is owed.
- The stock verifier, supplier balances and margin all count both. The invoice
  page shows the corrected total beside the entered one; the forms live on
  `/purchases/[id]/correct`, owner-only. Both acts appear on the Day screen.
- The data export now includes `supplier_payments` (missing since PCN-007) and
  both new tables, pinned by `tests/export-coverage.test.ts`.

**E2E without a reset**

- The warm-up compiles every route a function key reaches, not only the
  opening ones; `/receipts` and `/purchases` failed on their first key press.
- Specs that receive stock size their quantities from what the system holds
  now, so the suite passes against a developer database without
  `npm run e2e:reset`.

## Session — Migration 0009 on databases that ran supplier credit early (Day 19)

`db:migrate` failed on databases that had run supplier credit from its original
branch: 0009 tried to create `supplier_payments` again, the batch rolled back,
0010 never ran, and the Day screen crashed on `purchases.credit_tracked`.

**Root cause.** Supplier credit was written as migration `0006_supplier_credit`
(a79e57d, journal `when` 1786460433684) on a branch that diverged from main.
Main had since taken 0006–0008 for licensing, so the work was cherry-picked as
`0009_supplier_credit` with a regenerated `when` (1790111708134). The SQL is
byte-identical (git blob 408d5e0a, SHA-256 7f6808b1…). drizzle recognises an
applied migration only by its `when`, so on any database that had run the
branch, 0009 looked new and re-ran its `CREATE TABLE`. On a database that had
not met main yet, licensing 0006–0008 rolled back with it.

**Fix.** `scripts/db/renumbered-migrations.ts` registers the renumbering, and
`applyMigrations` records 0009 as applied when, and only when, the database
recorded the former `when` with the current file's hash and its objects are
present. It first migrates up to 0008, so licensing still runs. It adds one
row and changes no existing row. A former-number row with a different hash is
refused before anything changes. No migration file was edited and no `when`
moved. Restore, the restore drill and the packaged installer all migrate
through `applyMigrations`, so they inherit the fix. `db:migrate` now also prints
the database's own error (`Cause: relation … already exists`); drizzle's
message alone was the bare query.

- Historical purchases keep PCN-007's decided semantics: every purchase that
  existed when 0010 ran is untracked, including ones recorded on the branch.
- Tests: `tests/renumbered-migration.integration.test.ts` rebuilds the affected
  database from the branch's journal with trading on it, in both histories (seen
  failing before the fix). It asserts every record and row version unchanged,
  the schema identical to a fresh install, and a second run a no-op. A hash
  mismatch is refused. `tests/renumbered-migrations.test.ts` pins the
  registry's hash to the file.

## Session — Release hardening for the first pharmacy (Day 18)

The installer, upgrade, recovery and diagnostics paths, closed against a real
compiled installer (Inno Setup 6.4.3 under Wine) and a populated
upgrade-and-recovery rehearsal. One plan change decided (PCN-007); nothing else
re-litigated.

**Installer: back up first, keep the shop's settings, ship no secrets**

- Every upgrade and repair dumps the database to `backups\pre-update\` from
  `PrepareToInstall`, before a file is replaced; if a pharmacy exists and
  cannot be backed up, Setup stops with nothing changed.
- `.env` is merged, not regenerated: installer-owned keys are rewritten (logged
  by name), the shop's own settings are kept verbatim.
- The build machine's `.env` never enters the payload (stripped, refused,
  excluded), and an upgrade deletes the copy older installers left.
- The payload now carries the Windows argon2 binary whatever machine built it;
  a Linux-built payload had none and would have failed at the first PIN.

**A safe upgrade lifecycle**

- Setup stops `MehvarNode` then `MehvarPostgres` after the backup and before
  replacing files, puts them back if one refuses, and restarts them if Setup
  ends before provisioning. `install-services.ps1` stops the application again
  before migrating.
- Step 9 proves the pharmacy from the database; `first-run.txt` (plaintext
  credentials) is no longer required, and nothing recreates it.
- Upgrades skip the shop-name and PIN pages; `init` decides "a pharmacy exists"
  before reading them.
- `lint:ps` catches a `{constant}` inside a Pascal `{ }` comment, which broke the
  compile and had shipped in the pre-update backup's own comments.

**Restore and recovery**

- The restore drill migrates a restored dump before granting, so backups taken
  before an update drill clean; it also proves the application role is refused
  UPDATE and DELETE on every event table.
- `ops:restore` / `mehvar-restore.cmd` replaces a dead counter PC: it proves the
  backup in a scratch database, keeps the database it replaces, and issues a
  one-time pairing key on screen. See OPERATIONS.md, "Replacing the counter PC".

**Supplier credit, admitted to the plan and corrected (PCN-007)**

- Phase 5 §6 no longer excludes supplier payables; the Day 17 feature now
  has its decision of record. Its code cited PCN-006 (licensing); relabelled.
- Migration 0010 adds `purchases.credit_tracked`: purchases from before
  supplier credit read untracked through PostgreSQL's stored default — no row
  rewritten, no payment invented — and no longer count as owed.

**Release identity and diagnostics**

- VERSION records `<version>+<commit>[.dirty]`; the server, `init`, the support
  bundle and the installer's name all use it. `package:installer` refuses a
  `.dirty` payload.
- The support bundle redacts credentials from every section, and the install
  log masks them at the source.

## Session — Sales/POS usability pass and supplier credit (Day 17)

A read of the counter as a cashier sees it, then the one credit gap the product
had. Nothing re-litigated; the base-unit model and the udhaar pattern were both
reused, not replaced (PCN-005, PCN-006).

**The counter, made legible at a glance**

- **Quantity** is now the loudest cell after the name, with −/+ steppers visible
  on every cart line so a new cashier never has to be told +/− also work. The
  selected line spells out "+/− adjust · Tab switches unit", which is also how a
  single tablet or a partial strip is sold — the base unit is already the
  smallest sellable unit, so no schema change (I1, I3, W5, PCN-005).
- **Stock** shows in the product's own unit on every search result and on the
  selected line — a quiet figure normally, amber at the last pack, red at zero
  (I7 kept; D2 unchanged: a shortfall is exposure, never a block).
- **Per-line discounts** get their own cart column and an inline editor; the
  original amount stays struck-through beside the net and prints on the receipt.
  The fields existed end to end already (`sale_lines.line_discount_paisa`); this
  makes them reachable and visible (T1).
- The **F1–F10 foot rail** sits a touch taller (52px) with boxed keys and larger
  labels — easier to read and hit, still compact (Phase 10 §1, I1).

**Supplier credit — the pharmacy owes distributors too (PCN-007)**

- The mirror of customer udhaar. Migration 0009 adds `purchases.cash_paid_paisa`
  (the analogue of `sales.cash_paisa`) and the `supplier_payments` event table
  (the analogue of `payments`); both derive rather than store the balance:
  `Σ (invoice − paid) − Σ payments`, never authority (ADR-1, Phase 5 inv. 3).
- Purchase entry gains one "Paid now" field, defaulting to the full invoice so a
  cash purchase is unchanged; less puts the rest on the supplier's account and
  asks for a supplier (the mirror of `credit_without_customer`).
- `commitSupplierPayment` mirrors `commitSettlement` — online-only and idempotent
  on a client id, exactly as `commitPurchase` is. The Purchases surface gains an
  "Owed to suppliers" panel with a settle action; the Day screen gains the
  position figure; the invoice detail shows paid vs owed.
- Balance derivation and settlement idempotency are pinned in
  `supplier-balance.integration.test.ts`; the pure rules in
  `supplier-credit.test.ts` and `supplier-payment-command.test.ts`.
- **Run `npm run db:grants` after migrating** — a new event table starts mutable
  until granted, and `supplier_payments` must be INSERT-only (Phase 9 §5.1).

## Session 8 — Day 8, hardening: the pre-launch product review and its fixes

The day the product got read as a product rather than a codebase. The full
review is `docs/DAY_8_REVIEW.md`; this records what changed because of it.

**The sev-1: a drawer count against a lifetime figure**

- The Overall range computes the three numbers from epoch to 2999, but
  **Count the drawer rendered in both ranges** — the `view === 'daily'` guard
  covered only the date picker. An owner counting the till on the Overall tab
  would have recorded an over/short against every rupee since installation:
  an append-only row, uneditable by ADR-1, poisoning every later cash figure.
- The count and the cash-movement form are now bound to _today's_ drawer, and
  "expected cash in drawer" no longer appears in a range where it means
  nothing. `e2e/day.spec.ts` guards both directions.

**The three numbers now carry their own scope**

- Sales and expected cash are range-scoped; the udhaar total is a position and
  is always all-time (`threeNumbers` was always right about this). Two cards
  meaning "today" and one meaning "ever" under one heading is not something an
  owner can infer, so each label says which it is.
- `opening_stock` leaves the exception list. It is the setup ritual, not an
  exception, and one row per shelf line buries the two that mean something.
- Nothing prompted the opening float, without which expected cash is silently
  wrong on the first morning. It does now, once, where the number already is.

**The udhaar ledger disagreed with its own balance**

- `customerBalance` subtracts credit reversed by returns; `customerLedger` did
  not read them. On any customer with a credit-refunded return, the headline
  balance and the running total below it disagreed — on the screen T4
  designates for ending udhaar disputes.
- Fixed, and the agreement is now asserted in the crown suite.
- **The new invariant was vacuous when first written** and passed with the bug
  reintroduced: the generator reached a credit-reducing return roughly once in
  ten histories. The return generator now prefers a credit sale, and
  `creditReducingReturns` joined the suite's "this history was interesting"
  guard. Reverting the fix now fails the suite; before this change it did not.

**Workflows that existed but had no door**

- W9's opening stock (`?opening=1`) was linked from nowhere, and could not
  create a product — `ProductSearch` was mounted without `onQuickAdd`, on the
  one screen whose whole job is filling an empty catalog. Both fixed.
- `listPurchases`/`recentPurchasesAction` were written, correct and called by
  nothing: "Received — 1 batch on the shelf" was the only record of a delivery
  an owner ever saw. Purchases now lists what was received.
- Recent sales already existed on Returns; Day's sale count and the counter's
  "Saved — A-32" now lead there rather than describing it.
- Stock's shortfall rows carry the two fixes the prose named, and the Products
  list carries on-hand quantity — the most-asked question about a medicine, on
  the screen where it is already looked up.

**Affordances, without adding noise**

- Tailwind v4's preflight gives buttons `cursor: default` and the tree had zero
  `cursor-pointer`: every control in the product read as inert under the
  pointer. One base rule in `globals.css`.
- The key bar was a row of `<span>`s — the only persistent navigation, inert to
  the mouse. Now navigable, with the shortcut and active state unchanged. F8
  and F10 stay non-interactive: they are dispatched, not routed.
- Backdrop dismissal on the pickers (supplier, customer, PIN switch, quick
  item) and deliberately **not** on the payment overlay, which sits
  mid-transaction where a stray click would cost a re-key.

**Receipts became optional without becoming unavailable**

- A sale printed unconditionally. The transaction never depended on it, but the
  paper did, and shops that print on request had no way to stop it.
  `autoPrintReceipt` is a tenant setting; the last sale keeps a Print receipt
  action, still from local state, so nothing waits on the network.

**Copy**

- Three user-visible strings cited the planning package — `(D5)`, `T2 —`,
  `(F8, W2)`. The ideas stayed; the identifiers went.

## Session 7 — Day 7, Day close, reports, owner surface, returns, settings, export

The day the owner's three questions get an answer, and the day the last of
the counter's money paths — a refund — gets its own writer.

**Returns (W4) and the third receipt-numbered table**

- `commitReturn` joins `commitSale`, `commitPurchase` and `commitAdjustment`
  as a transaction-owning, idempotent writer. It restores stock to a named
  batch (`restockToBatch`, ADR-8's second sanctioned mutation's mirror image)
  or writes off when no batch is named, and records the refund as cash-out or
  credit-reduced — a compensating record against the sale, never an edit to
  it (T2, ADR-1).
- **PCN-003**, filed and applied the moment it was found: `sale_returns` had
  the identical gap PCN-002 found in `payments` — Phase 10 §7 requires a
  receipt for every money event, and Phase 9 §3 named no `receipt_number`
  column for this table either. Same fix, same shared device sequence, and
  the pattern is now established a third time rather than re-litigated:
  `sales`, `payments` and `sale_returns` all draw from one receipt book.
- The refund owed per line is computed from what that line actually
  charged — unit price net of its own line discount — not the catalog price,
  and floors the same way `costing.ts`'s bonus-unit blend does: never in the
  customer's favour beyond what they paid.
- Online only, like purchases and adjustments: a return needs to know how
  much of a sale remains returnable, which a disconnected counter cannot
  answer honestly.

**Cash movements and the drawer-count ritual (W10)**

- `commitCashMovement` is the one writer for the four reason codes — opening
  float, owner withdrawal, expense, and the drawer count's over/short entry.
  Three imply their own direction; over/short is the one exception, since the
  count can land either side of expected.
- The Day & Reports screen's ritual is exactly what W10 describes: count the
  drawer, see the difference against the expected figure, record it, done —
  "nothing locks" (D5) is not a caveat, it is the whole design: a late entry
  simply lands in the day it was recorded, and no screen anywhere checks
  whether "today" has been closed.

**The three numbers, honestly derived**

- `expectedCashPaisa` counts only what actually crossed the drawer: cash sale
  portions, cash settlements, cash movements — and nothing credit touched.
  `udhaarTotalPaisa` extends Phase 5 invariant 3 with the term Day 5's own
  comment predicted it would need: `− Σ credit reversed`, now real rather
  than a no-op, because a credit-refund return is exactly that reversal.
- The exception list is Phase 9 §7's list verbatim — overrides, discounts,
  adjustments, returns, quick items, cash movements, records ADR-3's offline
  path delivered late — computed on read, nothing cached (ADR-8).
- Weekly and monthly report tabs are Phase 13 §3's first cut-order item and
  were cut deliberately rather than built thin: daily and overall (all-time)
  answer the done-when — "the owner's three questions answer in one glance on
  a phone" — without them, and the cut is recorded here per Phase 4 §7 rather
  than absorbed silently.

**The owner phone view (W11)**

- A short-lived `owner_remote` session (`/owner/login`, password auth —
  ADR-7's "owner logs in normally from any device") separate from the
  counter's long-lived `device` session. The schema and session-kind
  plumbing for this were already built on Day 1; Day 7 is the first session
  to actually use them.
- Three bottom tabs — Today, Stock, Udhaar — one page, client-side tab state
  rather than three routes, since a phone checking in has no keyboard path to
  protect and no reason to hold a live connection open. Udhaar is sorted
  balance-first, reusing `listCustomers`' existing "largest first" ordering
  unchanged.

**Settings (Phase 10 §2 surface 9)**

- Receipt header/footer, users & PINs (add a salesman, reset a PIN — which
  doubles as Phase 12 §5's "owner override" by clearing lockout state in the
  same write — deactivate/reactivate), a printer setup guide, and the export
  link. Owner-gated by permission rather than only by visibility, unlike W8's
  adjustments: a salesman minting their own PIN account is not something
  visibility alone should allow.
- No key-bar entry — F1–F10 were already spoken for — reachable instead from
  a new "Settings" link beside the owner chip in the top bar, owner-only.

**Export (Phase 9 §8, Phase 3 §5.2)**

- `GET /api/export`: every §2–§4 table (reference, event, batches) filtered to
  the tenant, one CSV per table, zipped with `jszip` (added this session —
  the only new dependency), generated on demand. `users` is exported minus
  its two credential-hash columns: the data is the customer's, but a leaked
  password hash is a security incident, not a deliverable.
- Reachable regardless of tenant suspension, per Phase 3 §5.3 — the route
  never checks tenant status, on purpose.

**Crown suite extended, not forked**

- Returns and cash movements are new event kinds in `applyRandomEvent`,
  exactly as Day 6 extended it for purchases and adjustments rather than
  forking a parallel suite. The customer-balance invariant now nets out
  return credit-reversals, and the receipt-sequence invariant (PCN-002) now
  covers all three receipt-numbered tables, not two.

**Fixes made along the way**

- **`customerBalance` and `balancesByCustomer` had a documented no-op
  waiting to become real.** Day 5's comment said credit reversals from
  returns were "a no-op today" pending Day 7 — this session is where that
  term stopped being theoretical and started subtracting.
- Two test-authoring bugs, not application bugs, caught before they reached
  CI: a `textContent()` read across adjacent sibling `<p>` elements with no
  DOM whitespace between them swallowed a receipt total into the receipt
  number capture; and a figure-tile label ("Sales", meaning sale _count_)
  collided with the three-number card of the same name (meaning revenue) —
  renamed to "Sale count" rather than left for the next reader to trip on.

## Session 6 — Day 6, Purchases, batches, stock operations

Where stock starts arriving as well as leaving, and where D2's pending layer —
the thing that lets Day 3 refuse to block a sale — finally gets its answer.

**Receiving is one transaction, and it materializes batches (W7, D1)**

- `commitPurchase` writes the purchase, its lines, one batch per line, and any
  pending resolution inside a single transaction, idempotent on the client id
  exactly as `commitSale` and `commitSettlement` are. It is the one writer for
  purchases.
- One batch per line, never per product: FEFO (D1) is only meaningful if the
  expiry that arrived with this delivery is recorded against the units that
  arrived with it. Merging two deliveries of the same product into one batch
  would average away the fact the system exists to track.

**Bonus schemes tell the truth about cost (`domain/purchases/costing.ts`)**

- "10+1 free" is invoiced for ten and received as eleven. The batch carries the
  _effective_ unit cost — invoiced total over units received — so margin is
  computed against what the stock actually cost.
- The division floors, deliberately. Cost lands a paisa low rather than a paisa
  high, so a reported margin is never better than the real one. The residual is
  a named function rather than a rounding accident, and the entry screen shows
  the blended figure at entry time rather than at month end.

**The pending layer resolves (D2, ADR-8)**

- Resolution is the second of ADR-8's two sanctioned mutations, and it is now
  the only reason the app role can update an allocation row: migration 0003 adds
  `resolve_sale_line_allocation`, a SECURITY DEFINER function with a pinned
  `search_path`. The role holds EXECUTE on it and no UPDATE on the table.
- The function is also the concurrency control. `SELECT … FOR UPDATE` is not
  available to a role with no UPDATE privilege — the guard clause inside the
  function (`batch_id IS NULL AND resolved_at IS NULL`) is what makes a lost
  race a returned `false` instead of a double-count, and the caller skips
  rather than decrementing what it did not win.
- Oldest pending first, not FEFO: this is a question about chronology — who was
  waiting longest — rather than about which stock to consume. And a pending row
  resolves whole or not at all, because splitting one would mean either
  mutating an event row or inventing an allocation nobody recorded.

**Adjustments carry a coded reason (W8, W9)**

- The direction is chosen first, because it decides everything after it: stock
  leaving must name the batch it leaves from, stock arriving creates its own.
  Two forms rather than one form that rejects half of what it accepts.
- Not owner-gated, per W8: "visibility is the control, not permission
  friction". Every adjustment is attributed and appears on the stock screen
  without exception, which is a stronger control than a wall the salesman
  routes around by asking someone else to click it.
- W9's opening stock is the same screen with the direction and reason
  pre-selected, so the arithmetic that materializes a batch exists once.

**A real bug the verifier caught: double-counted materialization**

- An adjustment that materializes its own batch counts as that batch's
  `qty_received`. The rebuild was _also_ summing it into the adjustment delta,
  so every added unit was counted twice and `db:verify` failed. Phase 9 §4's
  word "negative" turned out to be load-bearing; Day 3's generalization to a
  signed sum was correct right up until a batch could be born from an
  adjustment. `batchLedger` now sums only negative adjustments.

**W7's rhythm, proven in a browser**

- The done-when verbatim — a 20-line invoice at working rhythm, and a shortfall
  the counter sold into being closed by the delivery that was missing.
- The half-entered invoice survives being interrupted by a customer: the draft
  is written on every keystroke, so there is no "save" to forget, and F1 to the
  counter and back loses nothing.

**Fixes made along the way**

- **A `'use server'` file re-exported a type again.** `export type
{ BatchOnHand }` threw `ReferenceError: BatchOnHand is not defined` at
  runtime — the identical failure Day 4 hit with `CustomerListItem`, already
  written down in CLAUDE.md and repeated anyway. The shape now lives in the
  pure domain module, which satisfies both rules at once: a client component
  must not name a module that reaches the database, and a server-actions file
  must not re-export a type.
- **The purchase entry fields had labels associated with nothing.** A `<label>`
  with no `htmlFor` beside an input with no id is decoration; the fields were
  unreachable by name to a screen reader and to the keyboard path the
  definition of done requires. The inputs are nested inside their labels now,
  which is also why they were untestable.
- **Two specs contended for one product.** This suite's purchase test received
  500 Rocephin, which pulled `sale.spec.ts`'s deliberate oversell back into
  stock and made its correct behaviour look like a regression. A spec that
  _receives_ stock now reaches for something no selling spec depends on being
  short of. Related: a product the seed has never stocked is absent from the
  stock map, which the index reads as _unknown_ rather than zero and therefore
  does not warn about — right behaviour, and a trap for a test that wants a
  guaranteed shortfall.

**Known intermittent, carried into Day 8**

- Two full-suite runs out of three saw a single offline spec fail at the point
  where it stops waiting on the unsynced badge and asserts server-visible
  state — a different spec each time, passing in isolation and on repeat. The
  badge reading zero while a record is still queued would be an ADR-3 visible-
  state defect rather than a test problem, so it is written down here rather
  than retried away. Day 8 is the buffer day; this is the first thing on it.

## Session 5b — the E2E suite made reliable on a slower machine

A second local run reported seventeen failures, all in the startup path
("`\d+ products` not found", "Getting this counter ready…" still visible).
Nothing was broken: the counter was becoming ready perfectly well, some way
after a five-second deadline. Tests were taking 13–35 seconds each against
1–3 here, which is the whole story.

Three causes, and the first is correctness rather than pacing:

- **The suite ran four workers against one database, one paired device, and
  therefore one device-scoped receipt sequence** (Phase 9 §3). That is two
  "counters" sharing a prefix and minting the same numbers — a condition the
  system is built to survive and does, but a rare one, and hammering it makes
  the suite nondeterministic while proving nothing `ingest.integration.test.ts`
  does not already prove. A real shop's second counter has its own prefix. Now
  `workers: 1`.
- **Nothing compiled the routes before the first test needed them.** Playwright
  waits for the dev server to answer once and calls it ready, but Next compiles
  on demand, so the first test to open `/sale` paid for that page, its bundle
  and `/api/catalog` — several times over, in parallel, on a cold machine. A
  global setup now walks the routes once, sequentially.
- **Startup assertions used the default five-second timeout.** Five seconds is
  the right question to ask of an interaction ("did the screen answer the
  keystroke?") and the wrong one to ask of a route still being compiled.
  Startup is a one-time cost and no spec is measuring it; the interaction
  assertions that carry the I2 speed budget are untouched.

Verified by reproducing the conditions rather than assuming: a cold `.next`
with three of four cores saturated, which put the run at 1.5 minutes — the same
order as the report — green four times consecutively under that load.

## Session 5a — fixes from local verification of Day 5

A local run reported 17 of 24 E2E tests failing, most of them landing on
`/login` instead of `/sale`. Chasing it turned up one environment problem and
three genuine defects — two of them in the application, and the more serious of
those was a way to lose a day's trading.

**`receipt-context.tsx` had no retry, and nothing can be sold without it**
(P2). A counter cannot number a receipt until it has heard from the server once
(Phase 9 §3), so a single failed `saleContext()` at startup — the shop opening
before the uplink is up, a blip while the shell mounts — left Pay disabled
permanently, with no way back except a reload nobody would think to try. Worse
than an outage, because the counter _looks_ fine. It now retries until it
lands, and says "Getting this counter ready…" while it does, because a disabled
button with no explanation is the kind of thing that gets a shop phoning the
founder (I5).

**The sync pump's backoff was decorative.** `backoffMs` computed a delay that
nothing ever acted on: the only things that re-invoked a flush were `online`, a
fresh capture, and the 15-second safety tick. So every transient failure — a
re-mintable receipt collision, one dropped request — waited up to fifteen
seconds instead of the one it had earned, leaving the badge lit long after the
cause had passed. The pump now schedules its own retry at the computed delay.

**Test defects, all mine from Day 5:**

- `offline.spec.ts` creates quick items by design (W6), which permanently raises
  the catalog count; `catalog.spec.ts` asserted an exact "53 in catalog"
  immediately before the Risek assertion the report mentioned. One spec's
  correct behaviour was being read as another's regression. The count assertion
  no longer pins a number.
- `shell.spec.ts`'s wrong-PIN test left `failed_pin_attempts` incremented, so
  five runs against one database locked Bilal out and broke the _successful_
  switch test for reasons unrelated to the code. It now gets the PIN right
  afterwards, which is what happens at a counter anyway and clears the counter.
- The five copies of `openCounter` are now one, in `e2e/support/counter.ts`, and
  a failed pairing reports the reason the app already rendered instead of a bare
  "expected /sale, got /login". `npm run e2e:reset` reseeds and runs.

**The reported symptom itself was environmental**: an unseeded database. Device
pairing looks up the demo counter, does not find it, and redirects to
`/login?error=unknown_device` — exactly "lands on /login". The helper now says
so, and names the fix.

## Session 5 — Day 5, Offline capture & sync

The second-highest-consequence day, and the one where "lost or duplicated
sales — existential for trust" (Phase 13 §4) stops being a risk register entry
and becomes tested behaviour.

**Every sale is captured locally first**

- The counter writes the sale into a durable IndexedDB outbox and prints the
  receipt on that write — never on a server response. Phase 7 rule 3:
  "nothing in a sale path awaits anything slower than the local machine except
  the final online commit, which the operator does not wait on for receipt
  printing."
- Online or offline takes the same path, deliberately. An offline path that
  only runs during outages is a path that is never really tested; routing all
  captures through one queue means the disruption path is exercised a few
  hundred times a day and a reconnect is not a special mode, just the normal
  loop finding the network already there.
- `enqueue` waits for the IndexedDB _transaction to complete_, not for the
  request to succeed. The difference is invisible in every test and decisive in
  a power cut, and it is what lets the receipt print immediately afterwards.
- Two receipt figures are consequently the client's last-known values — the
  customer's balance and whether the sale outran stock. That is ADR-5's stated
  posture applied to the other two numbers on a receipt; the authoritative
  pending layer is created server-side at ingestion, and Phase 5 invariant 3
  keeps the true balance re-derivable regardless of what any slip says.

**Delivery (ADR-3, ADR-5)**

- `domain/sync/ingest.ts` contains no business rules on purpose: it routes each
  record to the writer that already owns it. A rule appearing there would mean
  an offline sale had started meaning something different from an online one.
- Idempotency is not implemented at the boundary either — it is a property the
  writers already had, because every one keys on a client-generated id. A batch
  replayed five times is exactly-once by construction.
- Strictly FIFO, stopping at the first failure: a quick item (W6) must land
  before the sale whose line references it, and a customer created inline (W2)
  before the udhaar sale that owes against it.
- A taken receipt number is re-minted and retried rather than surfaced; a
  domain rejection is kept and made visible rather than dropped, because a
  record that printed a receipt and cannot be stored is something a person has
  to see.

**W6 quick item (D3)**

- Enter on a search that found nothing opens a two-field form pre-filled with
  what was typed. The product is real from that moment — added to the local
  index so the cart line renders and the next search finds it, queued so it
  becomes real on the server whenever the server is next reachable.
- What the form does _not_ ask for is the design: pack structure guessed wrong
  under time pressure corrupts stock silently, so it belongs to the completion
  queue where there is time to be right.

**PWA shell**

- A service worker so a counter that reloads mid-outage still boots. Never
  touches a non-GET request — a cached or swallowed server action would make a
  sale look delivered when it was not — and never caches `/api`, which has its
  own watermarked cache.
- Registered in production only; the behaviour is verified against
  `npm run build && npm run start`, and `e2e/pwa.spec.ts` skips in dev the same
  way the integration suites skip without a database.

**Unsynced badge (I7)**

- The top bar counts the outbox, which is the only honest number: "offline"
  describes the network, and what the operator needs to know is whether any of
  their sales are still only on this machine. Amber, never red — a queue
  draining normally is not an alarm.

**Fixed / found while building**

- A client component importing `validateSaleCommand` pulled `commit-sale.ts`'s
  database imports into the browser bundle, where `server-only` refused them.
  Neither typecheck nor lint can see this; the marker did its job. The pure
  command and its validator now live in `domain/sales/sale-command.ts` with no
  imports below `lib/` — the split Phase 11 §2 already asked for, made physical
  by the one thing that could detect it.
- Backoff was driven by the record's stored attempt count, so a counter that
  traded through a long outage came back with its backoff already at the 30s
  ceiling and sat with a lit badge after the network was visibly back. Backoff
  is now the pump's own consecutive-failure count, cleared on `online` — the
  record's `attempts` remains its history, feeding `origin` and the stuck
  warning.
- The customer type-ahead rejected unhandled while offline. It now degrades to
  the inline create, which is the part that matters mid-rush (P2).

**Plan reading worth flagging:** ADR-3 lists four capturable events and does not
name customer creation, but it names W2, and W2 makes inline customer create
mandatory ("udhaar is extended mid-rush, not pre-registered"). Capturing W2
offline therefore includes its inline create; refusing it would put a wall in
the middle of a named workflow, which P2 forbids. Implemented on that reading
rather than raised as a plan change — say so if you read it differently.

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
