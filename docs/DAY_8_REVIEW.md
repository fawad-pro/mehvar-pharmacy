# Day 8 — pre-launch product review

A review of Mehvar as a product, not as a codebase: read as a pharmacy owner
seeing it for the first time, a cashier who has to be fast on it all day, and a
pharmacist who has to trust its numbers.

The question is not "what could we add." It is **"would I install this in a real
pharmacy tomorrow?"**

Short answer: **yes, after six fixes.** One of them is a data-integrity bug that
can permanently corrupt the owner's cash figures. The rest are the difference
between a product that is correct and a product that feels correct — which, for
something whose stated most valuable feature is trust, is not a lesser category.

The engineering here is unusually disciplined and most of the product is already
right. Section 4 lists what should be left alone, and it is deliberately long.

---

## 1. Must fix before launch

### 1.1 The Overall view can permanently corrupt the cash record — sev-1

`day/page.tsx:55` computes the Overall view over `new Date(0) → 2999`, so
`threeNumbers` returns **all cash that has ever crossed the drawer since
installation**. The screenshot shows the result: _Expected cash in drawer
Rs 1,047,691_ against sales of Rs 48,257.

That number alone is only confusing. The bug is what sits directly beneath it:
`day-surface.tsx:188` renders **Count the drawer** unconditionally. The
`view === 'daily'` guard at line 160 wraps only the date picker.

So an owner on the Overall tab — a tab they will open, because it is the one
labelled with their whole business — counts Rs 8,000 in the till, types it, and
presses _Record over/short_. Mehvar writes an append-only cash movement of
**−Rs 1,039,691**. It cannot be edited (correctly, by ADR-1). It now poisons
every future expected-cash figure, and the only remedy is another compensating
movement of the same absurd size, which is itself now a permanent exception row.

The counting ritual is the moment the owner decides whether to trust the
software. Getting it wrong here is not a cosmetic defect.

**Fix:** the drawer count and the cash-movement form belong to _a day_, not to a
range. Render both only when `view === 'daily'`. Separately, "Expected cash in
drawer" has no meaning summed over all time — in Overall, that card should not
be one of the three numbers at all.

### 1.2 The three numbers mix two time semantics with nothing saying so

This is the user's own question — _"could a non-technical owner immediately
explain them?"_ — and today the answer is no, for a structural reason rather
than a wording one.

In `reporting-queries.ts`, `salesPaisa` and `expectedCashPaisa` are range-scoped
(lines 53–92), but `udhaarTotalPaisa` is deliberately **not** — the credit
queries at lines 94–107 use `scope.scopeOf(sales)` with no date bounds, because
a balance is a position, not a flow. That is the correct accounting decision.

But it means that on the Daily tab, two cards mean _today_ and one means _ever_,
under one heading, in identical typography. The owner has no way to know. Worse,
"Running udhaar total" is the one that reads like a daily figure.

**Fix — labels, not paragraphs.** Three words of scope, carried in the label
itself:

| Now                     | Should read                         |
| ----------------------- | ----------------------------------- |
| Sales                   | Sales today _(or: Sales, all time)_ |
| Expected cash in drawer | Cash expected in the drawer now     |
| Running udhaar total    | Total owed to you                   |

The goal is that each card can be read aloud and be true without a footnote. No
explainer text, no tooltips, no help icons — that would be exactly the clutter
to avoid.

### 1.3 A sale cannot be completed without printing

`sale-surface.tsx:250` calls `print()` on every commit, unconditionally. There
is no setting and no keystroke that skips it.

The transaction correctly does not _depend_ on printing — the receipt prints
from local state on the `capture()` resolve, which is the right architecture and
should not change. But the **paper** is unconditional. On a kiosk-printing
Chrome that is silent paper for every sale, including the very many where the
customer waves it away. Several pharmacies will want receipts off by default.

**Fix:** a tenant setting — _Print a receipt for every sale_ — beside the
existing receipt header/footer fields in Settings, plus a way to print the last
receipt on demand when a customer asks after the fact. Both are small; the
`ReceiptData` shape and `usePrintReceipt` already support it.

### 1.4 Nothing looks clickable

Tailwind v4's preflight sets `<button>` to `cursor: default` (changed from v3),
and the codebase contains **zero** `cursor-pointer` declarations. Hover states
appear in 9 files out of ~30.

So _Pay — F12_, _Commit — Enter_, _Receive stock_, _Record over/short_, _Save_,
_Remove_, _Reset PIN_ and the user chip all show a plain arrow cursor. The
product's most important controls give no feedback that they are controls.

This is the single cheapest fix in the review and it addresses the user's
"can I click this?" question almost entirely. It does not require visual noise —
a base rule in `globals.css` for `button:not(:disabled)` plus a hover tint on
already-interactive rows preserves the minimalism exactly.

### 1.5 The key bar is inert to the mouse

`key-bar.tsx` renders each entry as a `<span>`. The app's only persistent
navigation cannot be clicked.

Keyboard-first is right. Mouse-hostile is not the same thing, and this punishes
precisely the person who matters most on day one: the owner, on a laptop,
without the F-keys in muscle memory yet, being shown the product for the first
time. They will click _F5 Day_, nothing will happen, and they will conclude the
software is broken.

Making each entry a link costs the keyboard user nothing — the shortcut, the
label and the active state all stay exactly as they are.

### 1.6 Internal specification language is printed on screen

Three user-visible strings cite the planning package:

- `day-surface.tsx:395` — _"Recorded. The ritual is closed — nothing else locks (D5)."_
- `returns-surface.tsx:373` — _"T2 — a compensating record, never an edit to the original sale."_
- `customers/page.tsx:54` — _"...added inline the first time udhaar is extended (F8, W2)."_

A pharmacist reading "(D5)" learns nothing and trusts slightly less: it reads
like a document that escaped into the product. The _ideas_ are worth keeping —
"a return never edits the original sale" is a genuine trust statement and the
Returns screen is the right place to say it. Only the citations should go.

---

## 2. Strong improvements — still MVP

### 2.1 "Where are today's sales?" — it exists, behind the wrong door

The user could not find it, and they were right to look. It is on the **Returns**
screen. `returns-surface.tsx` lists recent sales with receipt number, customer,
total and date, and drills into the individual lines — it is the best-designed
surface in the product and it _is_ the review-a-sale workflow.

Nobody will ever look there, because the key says "Returns."

The user asked whether a sales-history screen is feature creep. **It is** — and
it is also unnecessary, because the screen already exists. Two small connections
instead:

1. Make _Saved — A-32_ on the Sale surface a link into that sale. It is the
   exact moment the question arises, and it answers the "should completed
   receipts become entry points?" question with the smallest possible change.
2. On Day & Reports, make _Sale count_ the entry point to the same list.

The user's instinct that Returns should be the reference design for reviewing
historical sales is correct. Reuse it; do not rebuild it.

### 2.2 Purchase history is recorded, queried, and unreachable

`listPurchases` exists (`purchase-queries.ts:103`). `recentPurchasesAction`
exists (`purchases/actions.ts:100`). **Nothing calls it.**

So _"Received — 1 batch on the shelf"_ is a message that evaporates. Asked
directly — _where would I expect to see that later? is it actionable? does it
create confidence?_ — the honest answers are: nowhere, no, and no. The owner's
natural next question ("what did I take from Bilal Distributors this month, and
what did I pay?") has no answer in the interface, though both the data and the
query are already there.

Wiring the existing action into a list beneath the entry form closes the
purchase → stock loop. It is the highest value-per-line change on this list.

### 2.3 The Stock screen contains no stock

Stock shows expiring batches, running-low items, shortfalls and recent
adjustments — every exception, and not one answer to _"how many Panadol do I
have?"_

The Products list has no quantity column either. Today the only ways to check
on-hand are to type the name into the Sale search or open the product detail
page one at a time.

For a pharmacist this is the most-expected number in the entire product. The
data is already computed: `stockByProduct` in `catalog-queries.ts:105`, and the
client index holds it. A quantity column on Products is likely the smaller,
better change — it puts the number where people already search.

### 2.4 Recent adjustments — keep them, connect them

They belong on Stock. Day & Reports is the owner's _money_ view; Stock is the
_shelf_ view, and an adjustment is a shelf fact. Moving them would hide them.

The real problem is not placement, it is that the three halves of one workflow
live on three screens with no path between them: a shortfall appears on Stock,
the count correction that fixes it is on Adjust (F9), and the purchase that also
fixes it is on Purchases (F2). The Stock page _describes_ this in prose
("Receiving the purchase (F2) or correcting the count clears them") but offers
no way to act.

Give each shortfall row the two actions directly. Same information, one step
instead of three, and the prose can then be deleted — a link that works needs
less explaining than a sentence describing what to do.

### 2.5 Modals: dismiss the pickers, not the payment

None of the six overlays has backdrop dismissal. They should not all be treated
alike:

- **Supplier picker, customer picker, PIN switch** — non-destructive selection
  dialogs. Clicking outside is the universal expectation and costs nothing.
  Add it. (The user flagged supplier selection specifically; they were right.)
- **Payment overlay** — keep it Esc-only. This one is mid-transaction with money
  entered, and a stray click that discards it costs a re-key in front of a
  waiting customer. Deliberate asymmetry, worth keeping.

None of them trap focus either, which matters for the keyboard promise: Tab from
the payment field escapes into the page behind the dialog.

### 2.6 Settle udhaar doesn't say what is owed

The user asked what happens when a customer pays half. The answer is that it
works correctly — the amount field is free entry and partial payment is the
norm. But at the moment the cashier types the amount, the screen shows only the
customer's name. _Half of what?_

`step.customer.balancePaisa` is already in scope in `settle-udhaar-overlay.tsx`.
Showing the current balance above the amount field is one line and removes a
memory task from a moment where money changes hands.

### 2.7 Customers: one aggregate number

The user asked whether Customers should surface totals. One number in the
header — _Rs X owed across N customers_ — matched to the Day screen's udhaar
figure. It answers the owner's question on the screen where they ask it, and it
lets them verify that two screens agree, which is itself a trust act. One line;
no clutter risk.

### 2.8 Settings: replace the native dialogs

PIN reset uses `window.prompt` and `window.alert` (`settings-surface.tsx:157`).
In an otherwise carefully styled product a raw browser dialog reads as
unfinished — and it is the screen where an owner sets up staff access, so it is
a bad place to look improvised. `resetPin` also neither refreshes nor confirms
inline on success.

Otherwise Settings is correctly scoped: receipt text, users and PINs, printer
guide, export. Nothing there is unnecessary. Two things are missing: the receipt
on/off toggle from §1.3, and device management — the login screen promises _"the
owner can switch it back on in Settings"_ for a deactivated counter, and that
control does not exist.

### 2.9 Nothing prompts the opening float

"Expected cash in drawer" is only right if the day's opening float was recorded,
and nothing asks for it. On the first morning the number will be wrong and the
owner will not know why — which is the worst possible first impression for the
figure the whole trust promise rests on.

A single line on the Day screen when today has no `opening_float` movement is
enough. Not a wizard, not a modal — one prompt where the number already is.

---

## 3. Post-MVP

### 3.1 Catalogue strategy — the real strategic question

The user is right that incumbents ship with thousands of medicines preloaded,
and right to ask how Mehvar should answer. My recommendation is that **Mehvar
should not try to win this fight on the incumbents' terms**, for a reason that
follows directly from the product's own principles.

A bundled national drug database is a data-licensing and data-_maintenance_
business, not a product feature. Prices in Pakistan move. A stale bundled
catalogue is not neutral — it is actively worse than an empty one, because it
asserts a wrong price with the software's authority behind it. A pharmacy that
sells at last year's price because Mehvar said so has been failed in exactly the
dimension the product claims as its differentiator. **Trust is the product;
shipping numbers we cannot stand behind spends it.**

The architecture already contains the better answer, half-built — the
`global catalog / tenant catalog` split is in the vocabulary, and the quick-item
path (W6) already means a shop can open on day one with an empty catalogue and
grow it from real sales. The strategy should make that deliberate:

1. **Seed from the pharmacy's own purchase invoices during assisted onboarding.**
   The data is authoritative, priced correctly for _that_ shop, and arrives as a
   by-product of work they must do anyway. This is the strongest position and it
   is nearly free, because purchase entry already creates products.
2. **A curated global catalogue of the top fast-movers with salt, manufacturer,
   form and pack — and no price.** It removes the typing without asserting a
   number. Prices stay tenant-owned, always.
3. **Barcodes accumulate per tenant**, which the product already does well.

This is the ADR the FBR research thread sets up the shape for, and it deserves
to be written before the second pharmacy is onboarded — not before the first.
The first pharmacy is an assisted install; the strategy question is what happens
at ten.

### 3.2 Already correctly deferred

Weekly and monthly report tabs remain a recorded cut (Phase 13 §3). Right call,
and it should stay cut — Daily plus Overall answers the owner's three questions,
and the Overall tab needs fixing (§1.1) before it earns any siblings.

---

## 4. What I would deliberately not change

These are not oversights. Several are things a reviewer would reflexively flag,
and changing them would make the product worse.

- **A sale is never blocked.** Missing catalog entry, unknown barcode, network
  down, insufficient stock — every one has a fast path, and stock is allowed to
  go negative with the shortfall made visible rather than silent. This is the
  spine of the product and the reason it will survive a real counter.
- **Append-only, with compensating records.** There must never be an "edit this
  sale" button, however often it is requested. The Returns flow is the correct
  and complete answer.
- **Owner-only keys stay visible but dimmed.** The reasoning in `key-bar.tsx` —
  _furniture that rearranges itself stops being trustworthy_ — is exactly right.
  A cashier who sees a stable map learns it once.
- **F8's dual meaning.** The one clever key in the product, and it earns it:
  cart full means "attach a customer," cart empty means "settle udhaar," and
  both are "customer + money." Do not split it into two keys.
- **No day-close lock (D5).** Resisting a "close the day" button that freezes
  records is correct for a shop that stays open late and records things after
  the fact. Day close is a reporting frame, not a transaction boundary.
- **The receipt prints from local state, never from a server response.** Keep
  this exactly as it is — §1.3 is about making the paper optional, not about
  making it wait for anything.
- **Minimal chrome, no dashboard, no charts.** The three numbers are the report.
  Resist every request to add a graph.
- **The Returns two-step flow.** The best surface in the product. Do not touch
  it — copy it (§2.1).
- **Esc-only on the payment overlay**, as distinct from the pickers (§2.5).

---

## 5. Workflow transitions

Evaluated as one chain rather than as screens. Most transitions are sound; three
are broken, and all three are the same failure — **a workflow that ends in a
message instead of a destination.**

| Transition                            | State                                                                                                                                                                      |
| ------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Receive stock → view inventory        | **Broken.** "Received — 1 batch on the shelf" links nowhere; no purchase history (§2.2), and Stock shows no on-hand (§2.3).                                                |
| Sell → print → customer pays          | Sound. Fast, keyboard-complete, correct.                                                                                                                                   |
| Sale → review that sale               | **Broken.** The list exists on Returns; nothing points to it (§2.1).                                                                                                       |
| Customer takes udhaar → settles later | Sound. Balance shown before credit is extended (T4), partial payment works — but the settle screen omits the balance (§2.6).                                               |
| Owner reviews the day                 | Sound in Daily; **dangerous in Overall** (§1.1).                                                                                                                           |
| Owner investigates an exception       | **Weak.** Every exception row is inert text. A shortfall, a quick item and a discounted line all name a thing the owner would want to open, and none of them opens (§2.4). |
| Owner closes the day                  | Sound in design (nothing locks, D5), undermined by the missing opening-float prompt (§2.9).                                                                                |

The pattern is worth naming because the fix is the same each time and it is
small: **when the product tells the owner something happened, that sentence
should be the way to go look at it.**

---

## 6. Smaller notes

- **Terminology drift.** The phone view says _Today's sales_; the Day screen
  says _Sales_. Customers says _Balance_; Day says _Running udhaar total_. Pick
  one word per concept — the working agreement already requires this of the
  code, and it should hold for the interface.
- **The Next.js dev badge covers F1.** In all five screenshots a dark circle
  sits on the _F1 Sale_ label. It does not ship in a production build, but
  anything demoed from `next dev` will show it obscuring the most important key
  on the bar. Demo from `npm run build && npm run start`.
- **Empty states are good** and should be left alone. "Search above to start a
  sale", "Nothing exceptional today", "Nothing below its minimum. Set minimum
  levels on a product (F3) to see it here" — all say what to do next without
  nagging. This is a strength.
- **Error copy is a strength too.** _"This machine could not save the sale. Do
  not hand over the items — get help."_ is the best sentence in the product.

---

## 7. If there is exactly one engineering day

In order. The first six are §1 and are not negotiable; the rest is whatever the
day holds.

1. Guard the drawer count and cash movements to the daily view — §1.1
2. Scope-label the three numbers — §1.2
3. Receipt on/off setting + reprint last — §1.3
4. Button cursors and hover states — §1.4
5. Key bar clickable — §1.5
6. Strip the three spec citations — §1.6
7. Wire up purchase history (`recentPurchasesAction` already exists) — §2.2
8. Link _Saved — A-32_ into the sale — §2.1
9. Backdrop dismissal on the three pickers — §2.5
10. Balance on the settle screen; total on Customers — §2.6, §2.7

Items 1–6 are a morning. Items 7–10 are an afternoon, and every one of them is
wiring something that already exists rather than building something new.

**Verdict: ship it after §1.** The foundations — append-only records, derived
truth, the tenant chokepoint, the pending layer, offline capture — are stronger
than the surface currently communicates. Most of this review is about closing
the gap between how trustworthy the system is and how trustworthy it looks.

---

## 8. Second pass — workflow coherence

A deeper pass over the three lifecycles the first review treated more shallowly
than Returns and Overall. It found one data-integrity defect, two workflows that
are built but unreachable, and one piece of test theatre.

### 8.1 The customer ledger disagreed with its own balance — must fix

`customerBalance` subtracts three terms: credit extended, payments, and credit
reversed by returns (`udhaar-queries.ts:37-42`, correct since Day 7).
`customerLedger` read only two — sales and payments.

So on any customer who has ever had a credit-refunded return, the big balance
at the top of their page and the running total in the table below it **did not
agree**. The page's own comment claimed they were "the same derivation read two
ways." They weren't.

This is the screen T4 designates for ending udhaar disputes — _"any derived
figure can be expanded into the transactions that produced it."_ A ledger that
cannot arrive at the number printed above it is worse than no ledger, because
it is authoritative-looking and self-contradicting, in front of a customer who
is already arguing about money.

Fixed, and the agreement is now an invariant in the crown suite.

### 8.2 The crown suite's new invariant was initially vacuous — worth recording

Adding "ledger total equals balance" to the rebuild-equivalence suite passed
immediately — including with the bug deliberately reintroduced. The generator
picks a sale to return against uniformly from all issued sales, but udhaar
sales occupy an 8% band of the event roll while cash sales are the ~44%
fallback, and only 40% of returns against a customer choose credit. The
credit-reducing return — the one case the invariant exists to guard — had
roughly a one-in-ten chance of occurring _per history_.

Two changes: the return generator now prefers a credit sale half the time when
one exists, and `observed.creditReducingReturns` joins the suite's existing
"this history was actually interesting" guard, so the case can never silently
stop being exercised again.

Verified honestly: with the fix reverted the suite now fails with
`expected 1198 to be 394`. Before this change it passed.

The general lesson is the one the suite's own coverage test already encodes —
**a green assertion that never met its case is not evidence.** It was worth
finding on a test written the same hour, because the same trap applies to every
invariant added after this.

### 8.3 Opening stock was built, correct, and had no door

`AdjustSurface` supports W9's guided opening-stock mode via `?opening=1`, and
`grep` found **no link to it anywhere in the product**. The flow that gets a
brand-new pharmacy's shelves into the system — the first thing any real
installation does — was reachable only by typing a query string.

Worse, on that screen a product not already in the catalog **could not be
created**: `ProductSearch` was mounted without `onQuickAdd`, so both the Enter
path and the "Add …" row were inert. W9's own wording is "walk the shelves,
**search/create products**, enter quantity + expiry + price."

So on day one, with an empty catalog and 800 SKUs on the shelves, the workflow
was: leave to Products → Add product → return → re-search → enter quantity.
Per item. That is not an onboarding flow, and it is the single biggest reason
a real first install would have gone badly.

Both fixed: Stock now links to it, and quick-create works there (on the _add_
direction only — you cannot remove units of something that has never existed).

### 8.4 The exception list buried its own exceptions

The screenshot shows _Exceptions 66_, of which _Adjustments (53)_ — and almost
every one reads "opening stock."

Opening stock is not an exception. It is the setup ritual, one row per shelf
line, and including it means a real onboarding drowns the two rows that
genuinely mean something (a damage write-off, a count correction) under
hundreds that mean "we installed the software." An exception list the owner
learns to scroll past has stopped being an exception list — the same discipline
that keeps amber meaningful, applied to the list instead of the colour.

`opening_stock` is now excluded. Every other adjustment reason still appears.

### 8.5 Smaller lifecycle gaps, fixed

- **No way to take a payment from the customer's own page.** The owner looked
  at "Rs 5,000 owed" and had to know to press F8 _from elsewhere_ — and F8 only
  opens Settle when the cart is empty, so mid-sale it does something different.
  The page that shows the debt now takes the payment against it.
- **Settle didn't say what was owed.** Answered directly in the review's §2.6.
- **Return rows are now named in the ledger** ("Return, against A-14"), so the
  reversal is legible rather than an unexplained negative.

### 8.6 Deliberately left alone in this pass

- **Inline customer creation captures no phone** (`phone: null`, hardcoded),
  and there is no customer edit screen, so the Phone column is often
  unfillable. Real, but it is a _new form_, not a wiring fix, and W2's whole
  argument is that udhaar is extended mid-rush and the picker must stay at two
  keystrokes. Post-MVP, as a customer edit screen — not by widening the picker.
- **`listCustomers` fetches all matching rows to sort by a derived balance.**
  Deliberate and documented; a customer book stays in the low thousands. Not a
  problem until it is a different product.
- **Adjustments stay on Stock**, per §2.4. This pass confirmed the placement is
  right; it was the missing actions that were wrong, and those are now there.
