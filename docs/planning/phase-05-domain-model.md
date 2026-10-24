# Phase 5 — Domain Model

Status: Draft for review
Informed by: Phases 1–4. Referenced principles cited as P#/I#/T#.

This document defines the concepts, their meanings, and the invariants that hold regardless of implementation. The data model (Phase 9) translates it into tables; the workflows (Phase 7) describe how humans touch it.

---

## 1. The shape of the model

Two kinds of things exist:

**Records of what happened** — purchases, sales, payments, adjustments, cash movements. These are immutable once committed. Mistakes are corrected by compensating records that reference what they fix (T2).

**Derived truths** — stock levels, batch quantities, customer balances, cash position, every report. These are never stored opinions; they are computations over the records. Any derived figure can be expanded into the records that produced it (T4).

This is the entire trust architecture of the product expressed as a modeling rule.

## 2. Core entities

### Tenant (Pharmacy)
The unit of isolation. Every entity below belongs to exactly one tenant. Required from day one by the commercial strategy (Phase 3 §5.1).

### User
Owner or Salesman. Every record carries the user who created it (T1). Two roles in V1: **Owner** (everything) and **Salesman** (sell, settle udhaar, receive purchases, adjust with reasons; no report access beyond the current day, no catalog price editing). Role nuances finalized in Phase 7/10.

### Product
Anything the pharmacy sells. Medicines are the primary case but not the only one — real pharmacies sell supplements, diapers, cosmetics, and sundries, and the model must not treat these as aliens. A product has:
- **Identity:** name, manufacturer, and for medicines: formula/salt (composition), form (tablet, syrup, injection, cream…), strength.
- **Unit structure:** a base unit (the smallest sellable thing — a tablet, a bottle, a sachet) and optional grouping levels above it (strip = 10 tablets; box = 5 strips). Defined per product. Non-medicine items usually have a single-level structure (one piece).
- **Selling prices** per unit level, tenant-owned (see Phase 6 for how identity data relates to the shared catalog).
- **Barcodes:** zero or more, each mapped to a unit level (a box barcode and a strip barcode differ).
- Optional **minimum stock level** (drives low-stock visibility).

**All stock arithmetic happens in base units.** "3 strips + 4 tablets" is stored and computed as 34 tablets; presentation converts back to natural language. This single rule eliminates the classic sub-unit corruption bug (P4 via arithmetic honesty).

*Amended 2026-10-24 by PCN-012.* Stock arithmetic stays in base units, and nobody at the counter sees them (P9). Each unit level carries its own selling price, entered as the owner knows it (strip, box), and an MRP entered against the unit it is printed for. Which units are offered is set once per pharmacy ("Do you sell loose tablets?") and per product (a "Sell" tick per unit). A product's smallest unit and existing pack sizes lock once any record references them; adding a larger pack and renaming a label stay allowed, and pack sizes must nest (a box holds a whole number of strips). A wrong pack after trading starts is fixed by replacing the product, with stock moved across by adjustments. Quantities are shown as an amount in the product's own units, largest first ("12 boxes, 3 strips, 7 tablets"), never with a word implying opened, loose or sealed packs.

### Batch (stock layer)
A quantity of a product that arrived together: batch number (as printed, optional in practice), expiry date, unit cost, and MRP/selling price at the time of arrival. Created by purchase entries and opening-stock entries. Batches are how expiry tracking, FEFO, and cost-basis reporting exist at all.

**Pragmatic stance:** batches are first-class in the model and nearly invisible at the counter. The salesman never selects a batch during a sale; consumption is automatic (see §4). Batch number itself is optional at purchase entry — expiry date is the field that matters and is always requested.

### Customer
A name and a phone number attached to a debt (charter boundary). Exists only to make udhaar recordable. Balance is derived, never stored.

### Supplier
A name on purchase entries, for "what did I buy from whom" visibility — and, since PCN-007 (applied to this section by PCN-010), what the pharmacy owes them: a derived position (tracked invoices as corrected − cash paid − supplier payments − supplier-return credit), never stored. No accounting beyond that (charter boundary).

## 3. Event records

### Purchase
Goods arriving: supplier, date, lines. Each line: product, quantity (any unit level, stored in base units), bonus quantity (the "10+1" scheme units — received free, entering stock at zero cost, kept distinct so margin reporting is honest), unit cost, expiry, batch number (optional), MRP/selling price (capturing price at receiving is a core workflow — Phase 1 §3). Each line creates or extends a batch.

### Sale
The counter event: lines + payment. Each line: product, quantity in base units, unit level as entered (for display/receipt), unit price, discount (line or invoice level), and the batch consumption it resolved to (recorded automatically). Payment: cash amount and/or credit amount against a named customer. A fully-paid cash sale and a fully-credit udhaar sale are the same record shape with different payment splits.

*Amended 2026-10-24 by PCN-012.* Purchase and sale lines record the unit entered, its count, the price or cost per that unit and the exact line amount; sale totals, invoices and supplier balances add line amounts, so they match paper to the paisa. Each batch carries its exact total cost; allocations are costed cumulatively, rounding up, so recognised cost is never understated and a used-up batch reconciles exactly to what was paid.

### Payment
Money received from a customer independent of a new sale — the udhaar settlement. Amount, customer, method (cash in V1). A customer's balance = credit extended (from sales) − payments − credit reversed by returns.

### Sale Return
References the original sale (whole or lines). Restores stock (to the batch it came from when known), records cash returned or credit reduced. A compensating record, not an edit (T2).

### Adjustment
Stock change with a mandatory coded reason: damage, expiry write-off, return to distributor, count correction, opening stock. Attributed and visible in the owner's daily view (T1). Adjustments are the only non-sale, non-purchase path by which stock moves — together, since 2026-10-22 (PCN-009), with two compensating records: a *purchase correction* (what a received line should have said: quantity, bonus, unit cost, with a reason) and a *supplier return* (goods sent back from a batch, with the credit the supplier gives, which reduces what is owed).

### Cash Movement
Cash placed into or taken out of the drawer outside of sales: opening float, owner withdrawal, small expense with a note ("chai, rickshaw"). Included because without it the drawer never reconciles and the owner's "today's cash" number becomes fiction — a small entity that protects a headline promise. Not an expense-management feature (boundary holds); just drawer honesty.

## 4. Key semantic decisions

**D1. Automatic FEFO consumption.** Sales consume stock from the earliest-expiry batch first, automatically — among batches that have not yet expired. *(Amended 2026-10-22 by PCN-008: expired batches are consumed only when nothing unexpired is left; the counter warns, naming the expiry, before payment, and the sale is an exception in the owner's daily view. Never blocked, P2.)* The salesman sees the price, not the batch. When two batches carry different prices, the sale line uses the consuming batch's price and shows it plainly — the price ambiguity moment (Phase 1 §5) resolves by rule, not by conversation. Owner can review batch-price transitions in the daily view.

**D2. Stock may go negative; sales are never blocked.** When the shelf has it and the system doesn't (unentered purchase, count drift), the sale proceeds (P2), consumption is recorded against a *pending layer*, and the discrepancy surfaces in the owner's daily view for reconciliation. When the missing purchase is later entered or a count correction made, pending consumption resolves against real batches. Negative stock is a visible exception state, never a silent one.

**D3. Quick item escape hatch.** A sale of something not in the catalog must not stall (P2): a quick-add captures name and price in seconds, creates a real (minimal) product flagged *needs completion*, and the owner's daily view lists it for enrichment. No anonymous "misc" lines — every sale line references a product, or inventory truth dies quietly.

**D4. Prices are tenant truth; MRP is the ceiling.** The selling price lives with the tenant's product (and per-batch where batches differ). MRP is regulated and printed on the pack; the product warns when a price exceeds recorded MRP but does not block (the pack in hand is authoritative, not our data).

**D5. One business day as the reporting frame.** Day close is a reporting ritual, not a transactional lock: the day's sales, cash movements, exceptions (discounts, adjustments, negative stock, quick items, price overrides) summarized for the owner (T1). Nothing is frozen; late entries land visibly in the day they were recorded.

## 5. Invariants

1. Product stock (base units) = Σ purchases + Σ positive adjustments − Σ sales − Σ negative adjustments − Σ returns-to-distributor + Σ sale returns ± Σ purchase-correction quantity deltas − Σ supplier returns (PCN-009). Always derivable, never stored as authority.
2. Batch quantity ≥ 0; the pending layer is the only construct that may represent unresolved negative consumption, and it is always visible.
3. Customer balance = Σ credit extended − Σ payments − Σ credit reversals. Never stored as authority.
4. Sale total = Σ line totals − invoice discount; cash + credit split = total, exactly.
5. Every record is attributed (user, timestamp) and immutable; every correction references its target.
6. Derived figures are reproducible from records alone — dropping every cache and recomputing changes nothing (T4 made testable; this is the domain's deepest test target for Phase 11).

## 6. Explicitly out of the model (V1)

Prescriptions and clinical data, including controlled-drug registers (PCN-010); expenses beyond drawer cash movements; loyalty, pricing tiers, or customer data beyond name+phone; multi-branch stock; purchase orders (a low-stock *list* exists; ordering happens on WhatsApp as it does today); inter-pharmacy anything.

*Amended by PCN-007:* supplier payables are **in** the model. What a pharmacy owes a supplier is a derived position — Σ (invoice cost − cash paid at receiving) over purchases whose payment was recorded, minus Σ supplier payments — the mirror of a customer balance (invariant 3), never stored as authority. Purchases entered before supplier credit existed have no recorded payment and owe nothing. *Since PCN-009* the position also adds each correction's invoice delta and subtracts supplier-return credit. A negative position — a credit with the supplier — is shown separately from what is owed, never netted or dropped (PCN-011).

## 7. Exports to later phases

- Phase 6: the Product identity fields above are the contract the shared catalog must fill.
- Phase 7: D1–D3 define the fast paths workflows must express.
- Phase 8 (ADRs): derivation strategy (compute vs. cache-and-verify), pending-layer resolution mechanics, connectivity-disruption capture.
- Phase 9: this model translates to schema with invariants as constraints and tests.
- Phase 11: invariant 6 is the primary test suite.
