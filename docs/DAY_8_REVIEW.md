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
installation**. The screenshot shows the result: *Expected cash in drawer
Rs 1,047,691* against sales of Rs 48,257.

That number alone is only confusing. The bug is what sits directly beneath it:
`day-surface.tsx:188` renders **Count the drawer** unconditionally. The
`view === 'daily'` guard at line 160 wraps only the date picker.

So an owner on the Overall tab — a tab they will open, because it is the one
labelled with their whole business — counts Rs 8,000 in the till, types it, and
presses *Record over/short*. Mehvar writes an append-only cash movement of
**−Rs 1,039,691**. It cannot be edited (correctly, by ADR-1). It now poisons
every future expected-cash figure, and the only remedy is another compensating
movement of the same absurd size, which is itself now a permanent exception row.

The counting ritual is the moment the owner decides whether to trust the
software. Getting it wrong here is not a cosmetic defect.

**Fix:** the drawer count and the cash-movement form belong to *a day*, not to a
range. Render both only when `view === 'daily'`. Separately, "Expected cash in
drawer" has no meaning summed over all time — in Overall, that card should not
be one of the three numbers at all.

### 1.2 The three numbers mix two time semantics with nothing saying so

This is the user's own question — *"could a non-technical owner immediately
explain them?"* — and today the answer is no, for a structural reason rather
than a wording one.

In `reporting-queries.ts`, `salesPaisa` and `expectedCashPaisa` are range-scoped
(lines 53–92), but `udhaarTotalPaisa` is deliberately **not** — the credit
queries at lines 94–107 use `scope.scopeOf(sales)` with no date bounds, because
a balance is a position, not a flow. That is the correct accounting decision.

But it means that on the Daily tab, two cards mean *today* and one means *ever*,
under one heading, in identical typography. The owner has no way to know. Worse,
"Running udhaar total" is the one that reads like a daily figure.

**Fix — labels, not paragraphs.** Three words of scope, carried in the label
itself:

| Now | Should read |
|---|---|
| Sales | Sales today *(or: Sales, all time)* |
| Expected cash in drawer | Cash expected in the drawer now |
| Running udhaar total | Total owed to you |

The goal is that each card can be read aloud and be true without a footnote. No
explainer text, no tooltips, no help icons — that would be exactly the clutter
to avoid.

### 1.3 A sale cannot be completed without printing

`sale-surface.tsx:250` calls `print()` on every commit, unconditionally. There
is no setting and no keystroke that skips it.

The transaction correctly does not *depend* on printing — the receipt prints
from local state on the `capture()` resolve, which is the right architecture and
should not change. But the **paper** is unconditional. On a kiosk-printing
Chrome that is silent paper for every sale, including the very many where the
customer waves it away. Several pharmacies will want receipts off by default.

**Fix:** a tenant setting — *Print a receipt for every sale* — beside the
existing receipt header/footer fields in Settings, plus a way to print the last
receipt on demand when a customer asks after the fact. Both are small; the
`ReceiptData` shape and `usePrintReceipt` already support it.

### 1.4 Nothing looks clickable

Tailwind v4's preflight sets `<button>` to `cursor: default` (changed from v3),
and the codebase contains **zero** `cursor-pointer` declarations. Hover states
appear in 9 files out of ~30.

So *Pay — F12*, *Commit — Enter*, *Receive stock*, *Record over/short*, *Save*,
*Remove*, *Reset PIN* and the user chip all show a plain arrow cursor. The
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
time. They will click *F5 Day*, nothing will happen, and they will conclude the
software is broken.

Making each entry a link costs the keyboard user nothing — the shortcut, the
label and the active state all stay exactly as they are.

### 1.6 Internal specification language is printed on screen

Three user-visible strings cite the planning package:

- `day-surface.tsx:395` — *"Recorded. The ritual is closed — nothing else locks (D5)."*
- `returns-surface.tsx:373` — *"T2 — a compensating record, never an edit to the original sale."*
- `customers/page.tsx:54` — *"...added inline the first time udhaar is extended (F8, W2)."*

A pharmacist reading "(D5)" learns nothing and trusts slightly less: it reads
like a document that escaped into the product. The *ideas* are worth keeping —
"a return never edits the original sale" is a genuine trust statement and the
Returns screen is the right place to say it. Only the citations should go.

---

## 2. Strong improvements — still MVP

### 2.1 "Where are today's sales?" — it exists, behind the wrong door

The user could not find it, and they were right to look. It is on the **Returns**
screen. `returns-surface.tsx` lists recent sales with receipt number, customer,
total and date, and drills into the individual lines — it is the best-designed
surface in the product and it *is* the review-a-sale workflow.

Nobody will ever look there, because the key says "Returns."

The user asked whether a sales-history screen is feature creep. **It is** — and
it is also unnecessary, because the screen already exists. Two small connections
instead:

1. Make *Saved — A-32* on the Sale surface a link into that sale. It is the
   exact moment the question arises, and it answers the "should completed
   receipts become entry points?" question with the smallest possible change.
2. On Day & Reports, make *Sale count* the entry point to the same list.

The user's instinct that Returns should be the reference design for reviewing
historical sales is correct. Reuse it; do not rebuild it.

### 2.2 Purchase history is recorded, queried, and unreachable

`listPurchases` exists (`purchase-queries.ts:103`). `recentPurchasesAction`
exists (`purchases/actions.ts:100`). **Nothing calls it.**

So *"Received — 1 batch on the shelf"* is a message that evaporates. Asked
directly — *where would I expect to see that later? is it actionable? does it
create confidence?* — the honest answers are: nowhere, no, and no. The owner's
natural next question ("what did I take from Bilal Distributors this month, and
what did I pay?") has no answer in the interface, though both the data and the
query are already there.

Wiring the existing action into a list beneath the entry form closes the
purchase → stock loop. It is the highest value-per-line change on this list.

### 2.3 The Stock screen contains no stock

Stock shows expiring batches, running-low items, shortfalls and recent
adjustments — every exception, and not one answer to *"how many Panadol do I
have?"*

The Products list has no quantity column either. Today the only ways to check
on-hand are to type the name into the Sale search or open the product detail
page one at a time.

For a pharmacist this is the most-expected number in the entire product. The
data is already computed: `stockByProduct` in `catalog-queries.ts:105`, and the
client index holds it. A quantity column on Products is likely the smaller,
better change — it puts the number where people already search.

### 2.4 Recent adjustments — keep them, connect them

They belong on Stock. Day & Reports is the owner's *money* view; Stock is the
*shelf* view, and an adjustment is a shelf fact. Moving them would hide them.

The real problem is not placement, it is that the three halves of one workflow
live on three screens with no path between them: a shortfall appears on Stock,
the count correction that fixes it is on Adjust (F9), and the purchase that also
fixes it is on Purchases (F2). The Stock page *describes* this in prose
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
customer's name. *Half of what?*

`step.customer.balancePaisa` is already in scope in `settle-udhaar-overlay.tsx`.
Showing the current balance above the amount field is one line and removes a
memory task from a moment where money changes hands.

### 2.7 Customers: one aggregate number

The user asked whether Customers should surface totals. One number in the
header — *Rs X owed across N customers* — matched to the Day screen's udhaar
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
on/off toggle from §1.3, and device management — the login screen promises *"the
owner can switch it back on in Settings"* for a deactivated counter, and that
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

A bundled national drug database is a data-licensing and data-*maintenance*
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
   The data is authoritative, priced correctly for *that* shop, and arrives as a
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
  *furniture that rearranges itself stops being trustworthy* — is exactly right.
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

| Transition | State |
|---|---|
| Receive stock → view inventory | **Broken.** "Received — 1 batch on the shelf" links nowhere; no purchase history (§2.2), and Stock shows no on-hand (§2.3). |
| Sell → print → customer pays | Sound. Fast, keyboard-complete, correct. |
| Sale → review that sale | **Broken.** The list exists on Returns; nothing points to it (§2.1). |
| Customer takes udhaar → settles later | Sound. Balance shown before credit is extended (T4), partial payment works — but the settle screen omits the balance (§2.6). |
| Owner reviews the day | Sound in Daily; **dangerous in Overall** (§1.1). |
| Owner investigates an exception | **Weak.** Every exception row is inert text. A shortfall, a quick item and a discounted line all name a thing the owner would want to open, and none of them opens (§2.4). |
| Owner closes the day | Sound in design (nothing locks, D5), undermined by the missing opening-float prompt (§2.9). |

The pattern is worth naming because the fix is the same each time and it is
small: **when the product tells the owner something happened, that sentence
should be the way to go look at it.**

---

## 6. Smaller notes

- **Terminology drift.** The phone view says *Today's sales*; the Day screen
  says *Sales*. Customers says *Balance*; Day says *Running udhaar total*. Pick
  one word per concept — the working agreement already requires this of the
  code, and it should hold for the interface.
- **The Next.js dev badge covers F1.** In all five screenshots a dark circle
  sits on the *F1 Sale* label. It does not ship in a production build, but
  anything demoed from `next dev` will show it obscuring the most important key
  on the bar. Demo from `npm run build && npm run start`.
- **Empty states are good** and should be left alone. "Search above to start a
  sale", "Nothing exceptional today", "Nothing below its minimum. Set minimum
  levels on a product (F3) to see it here" — all say what to do next without
  nagging. This is a strength.
- **Error copy is a strength too.** *"This machine could not save the sale. Do
  not hand over the items — get help."* is the best sentence in the product.

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
8. Link *Saved — A-32* into the sale — §2.1
9. Backdrop dismissal on the three pickers — §2.5
10. Balance on the settle screen; total on Customers — §2.6, §2.7

Items 1–6 are a morning. Items 7–10 are an afternoon, and every one of them is
wiring something that already exists rather than building something new.

**Verdict: ship it after §1.** The foundations — append-only records, derived
truth, the tenant chokepoint, the pending layer, offline capture — are stronger
than the surface currently communicates. Most of this review is about closing
the gap between how trustworthy the system is and how trustworthy it looks.
