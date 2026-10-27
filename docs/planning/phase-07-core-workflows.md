# Phase 7 — Core Workflows

Status: Draft for review
Informed by: Phases 1–6. Domain decisions cited as D# (Phase 5 §4); principles as P#/I#/T#.

Each workflow states: trigger, the path (with its keyboard shape), failure moments and their fast paths, and the speed expectation. Exact keys and screen layouts are Phase 10; this document fixes *what the path is*, not what it looks like.

---

## W1. Cash sale — the workflow the product exists for

**Trigger:** customer at counter. **Frequency:** dozens to hundreds daily.

Path: focus is always in search → type a few characters or scan → best match highlighted, arrow/enter to select → quantity (defaults to 1; typing "2" then unit toggles strip/tablet where relevant) → line lands in cart, focus returns to search → repeat → payment key → amount tendered (defaults to exact) → change displayed large → commit → receipt prints, focus returns to search for the next customer. *(Amended 2026-10-22, PCN-010: the product sends no drawer command; a cash drawer opens only where the printer driver is set to kick it on print.)*

- Never leaves the keyboard (I1). Scan-anywhere adds the scanned item (I1).
- Batch consumption and pricing are automatic (D1); if the consuming batch's price differs from the last-sold price, the line shows it plainly — no interruption.
- **Failure moments:** product not found → quick-add (W6) or refine search; stock shows zero but shelf has it → sale proceeds, pending layer records it (D2); only expired stock left → warned before payment, naming the expiry; the sale proceeds and is an exception (PCN-008); customer disputes price → line price editable (logged as override, visible to owner, T1); connectivity drops mid-sale → nothing about the path changes (charter outcome; mechanics in Phase 8 ADR).
- **Speed:** routine repeat sale well under half a minute; working target ~15 seconds (I2).

## W2. Udhaar sale (full or partial credit)

Same path as W1 until payment: credit key → customer picker (type-ahead on name/phone; new customer inline with just name + phone, seconds, D-boundary: nothing else asked) → amount split cash/credit (defaults sensible: full credit, or entered cash with remainder to credit) → commit → receipt shows credit line and running balance.

- New-customer-inline is mandatory: udhaar is extended mid-rush, not pre-registered.
- Balance shown at selection — the salesman sees exposure before extending more (T4).
- **Speed:** adds ≤5 seconds over W1.

## W3. Udhaar settlement

**Trigger:** customer pays down debt, usually without buying. Path: settlement key → customer → amount → commit → receipt (mini-statement: previous balance, paid, new balance). The receipt is the dispute-ender (T4, T5). Partial amounts are the norm ("500 de do"). **Speed:** under 10 seconds.

## W4. Sale return

**Trigger:** customer returns items, usually same-day/next-day with receipt. Path: returns key → find sale (scan receipt number, or search recent sales) → select lines/quantities → confirm → stock restores to source batch, cash-out recorded or credit reduced (compensating record, T2). Returns are exceptions surfaced in the owner's daily view (T1). No receipt → owner-only manual return against product (logged prominently).

## W5. Sub-unit sale

Not a separate workflow — a quantity affordance inside W1 (I3): quantity entry accepts the unit level ("4" + tab in tablet mode, or "1" strip), display always shows natural language ("1 strip + 4 tab"), arithmetic always in base units (Phase 5 §2). Called out because it is a known competitor-parity trap: it must feel native, not modal.

*Amended 2026-10-24 by PCN-012.* The unit is chosen with visible buttons on the line, labelled in the product's own words; on a sale line, every unit the product has (Tab · Strip · Box; amended 2026-10-26), beside − qty +; the price shows per chosen unit. Keyboard shortcuts remain and are never required. The same control serves W7, W8 and W9.

## W6. Quick item (unknown product mid-sale)

**Trigger:** shelf item not in catalog; customer waiting. Path: from an empty search result, one key → name + price → line lands in cart, sale continues. Creates a real product flagged *needs completion* (D3); appears in owner's daily view and completion queue. **Speed:** under 10 seconds. Guardrail: quick items cannot be silently forgotten — the queue nags until enriched or merged.

## W7. Purchase entry (receiving stock)

**Trigger:** distributor delivery with invoice; entered between customers, interruptible and resumable (a rush must not lose a half-entered invoice).

Path: new purchase → supplier (type-ahead, inline create) → invoice ref/date → lines: product search → quantity + bonus quantity (10+1 entered as 10 + 1, kept distinct — Phase 5 §3) → unit cost → expiry (always asked) → batch number (optional) → MRP/selling price confirmation (capture-at-receiving, Phase 1 §3; changed price flags the transition for the owner) → next line. Commit creates batches (D1 feeds from here). A line entered wrong is corrected afterwards from the invoice, owner-only, by stating what it should have said — never by editing it (PCN-009, T2).

*Amended 2026-10-24 by PCN-012.* Quantity, bonus and cost are entered per pack as invoiced ("Cost per box", "Bonus (boxes)"); the line total matches the paper invoice to the paisa.

- Unknown product → inline create with global-catalog assist (Phase 6): pick identity, confirm pack structure, price — richer than W6's quick-add because time pressure is lower.
- **Speed:** a 20-line invoice in a handful of minutes; per-line rhythm matters more than total.

## W8. Stock adjustment

**Trigger:** damage, expiry write-off, return to distributor, count correction. (Goods returned to a distributor *for credit* are a supplier return from the invoice, owner-only, which also reduces what is owed — PCN-009; the reason-coded adjustment remains for returns with no credit.) Path: adjustment → product → quantity ± → mandatory coded reason (+ optional note) → commit. Attributed, listed in owner's daily view without exception (T1). Count corrections resolve pending layers (D2). Salesman may adjust; visibility is the control, not permission friction (P7 balanced with T1).

*Amended 2026-10-24 by PCN-012.* Quantities are entered in the product's own units with the shared quantity control.

## W9. Opening stock (onboarding)

A guided variant of W7 without a supplier invoice: walk the shelves, search/create products, enter quantity + expiry + price. Creates opening batches (reason-coded, D-model §3). Assisted by founder during onboarding (Phase 3: assisted setup is part of the trial). Import path (CSV from a competitor system) lands here too (Phase 6 §3.3). This workflow is the adoption gate — it must be genuinely fast, and its quality determines whether trust starts at day one or never.

*Amended 2026-10-24 by PCN-012.* Stock is counted as it sits — Boxes [ ] Strips [ ] Tablets [ ], only the units the product has — with a cost per unit that is required and pre-filled from the product's last purchase when there is one.

## W10. Day close

**Trigger:** shutter down. Path: one screen, three numbers first — today's sales, expected cash in drawer, running udhaar total — then the exception list: expired stock sold (PCN-008), discounts and overrides, adjustments, returns, quick items created, negative-stock incidents, cash movements (D5, T1). Owner counts the drawer against the expected figure; a recorded over/short entry closes the ritual. Nothing locks (D5). **Speed:** the three numbers in one glance; the ritual in two minutes.

## W11. Owner remote view

**Trigger:** owner's phone, any time. Mobile-usable (Phase 3 §5.5): today's three numbers, the exception list, low stock and near-expiry counts. Read-only in V1. *(Amended 2026-10-22, PCN-010.)* **In V1 this is reached on the shop's own network**: the Node in the shop serves it, and nothing reaches it from outside until roadmap Phase 3 adds a cloud route — so the pitch is "check your shop from your phone in the shop", not "from anywhere". It also needs a session that works over LAN HTTP, which is not yet built (Phase 12 §5).

## W12. Expiry & low-stock management

**Trigger:** weekly rhythm, or the near-expiry indicator. Near-expiry list (30/60/90-day horizons) → act per batch: return to distributor (W8 reason-coded) or write off. Low-stock list from minimum levels where set; the list is phone-readable because reordering happens on WhatsApp with distributors — we produce the list, not the order (Phase 5 §6 boundary).

## Cross-cutting rules

1. Search is the home position; every workflow begins and ends with focus there (I1, I4).
2. Any workflow the salesman can start, the salesman can finish — no mid-path permission walls (P2, P7); sensitive acts are visible (T1) rather than blocked.
3. Every commit is instant to the operator; nothing waits on anything remote (charter outage outcome; mechanics Phase 8).
4. Receipts print for every money event — sale, return, settlement (T5).
5. Every exception this document names has exactly one home: the owner's daily view (W10/W11). One list, always the same list.

## Exports to later phases

- Phase 8 (ADRs): commit-latency and disruption-capture mechanics (rule 3); search architecture serving W1's rhythm.
- Phase 10: keyboard map, screen inventory, and layouts realizing these paths; W1's screen is 80% of perceived quality.
- Phase 11: W1, W2, W7 invariant tests are the core suite alongside Phase 5 invariant 6.
- Phase 13: implementation order follows dependency: W1 → W7 → W2/W3 → W9 → W10/W11 → rest.
