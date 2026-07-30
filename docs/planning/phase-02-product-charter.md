# Phase 2 — Product Charter

Status: Draft for review
Informed by: Phase 1 Research (July 2026)

---

## Product Name

**Mehvar Pharmacy** — a member of the Mehvar product family. Brand architecture and rationale are defined in Phase 4 (Principles & Product Identity). In counter conversation the product is simply "Mehvar."

## Product Vision

The primary application running at the counter of an independent Pakistani pharmacy, all day, every day. A salesman learns it in minutes, completes every common task faster than the paper alternative, and never gets blocked mid-sale. The owner trusts its numbers more than his own register.

The ambition is to be the best pharmacy software in its category — measured not by feature count but by how it feels to operate under pressure at a busy counter.

## The One-Sentence Test

Mehvar's was "Most hospital software tells you what happened. Mehvar tells you what's happening." This product's is:

**"Software that's faster than the register — and can't lie."**

Every sale in seconds, every rupee accounted for, every number backed by records that can't be quietly edited. Speed earns the salesman; incorruptibility earns the owner.

## What We Are Building

A counter-first pharmacy operations system:

- Instant medicine search (brand, salt, misspelling-tolerant, barcode)
- Rapid keyboard-first sales workflow with cart, cash payment, and thermal receipt
- Udhaar: credit sales and settlements against named customers, with balances that always agree with the underlying transactions
- Batch-level inventory with expiry tracking and expiry-aware selling
- Sub-unit sales (tablet / strip / box) against one coherent stock position
- Purchases: distributor invoice entry, bonus units, price capture at receiving
- Stock adjustments with reasons, never silent edits
- Low-stock and near-expiry visibility
- Daily close and owner reporting: today's sale, today's cash, what's running out — plus weekly, monthly, and overall views
- Uninterrupted selling through temporary connectivity disruptions, with no data loss and no operator effort to recover

## What We Are NOT Building (V1)

- Prescription management, dispensing records, or any clinical functionality
- Patient/medical records of any kind
- Customer relationship management: a customer is a name and phone number attached to a debt — no addresses, notes, loyalty, messaging, or marketing
- Multi-branch operation (single branch in V1; nothing in the product may make future multi-branch impossible)
- Supplier accounting / payables ledger (purchase recording yes; distributor credit management no)
- FBR POS integration (not required for our non-Tier-1 segment; must remain adoptable later without disrupting the product)
- Accounting beyond the pharmacy's operational money flow (no general ledger, no financial statements)
- E-commerce, delivery, or customer-facing apps
- Urdu-script localization (Roman Urdu-friendly labels and search tolerance: yes)

Exclusions exist to protect speed and clarity. Each is revisitable post-V1; none is revisitable during V1.

## Product Philosophy

1. **The counter is the product.** Every architectural and design decision is judged by its effect on the sale moment. Admin screens may be merely good; the sale screen must be exceptional.
2. **Never block a sale.** No network outage, no missing catalog entry, no price ambiguity, no permission wall may stop a customer from being served. Every such moment has a designed fast path.
3. **Numbers that can't lie.** Every balance — stock, cash, udhaar — is traceable to the transactions that produced it. History is never silently edited; corrections are visible as corrections. The owner can always answer "why is this number what it is?" from within the product. How this guarantee is achieved is an architecture decision; that it holds is a product promise.
4. **Faster than paper or it doesn't ship.** The paper register is the benchmark for every workflow. Where software can't beat paper's speed, it must beat it on trust so decisively the trade is obvious.
5. **The salesman is the bar.** If a non-technical operator can't learn a workflow in minutes and run it at rush hour, the workflow is wrong — not the operator.

## Target Customer

**Primary buyer:** Independent pharmacy / medical store owner in Pakistan. Motivations: theft and shrinkage anxiety, expiry losses, visibility while absent, professionalism signaling. Price-sensitive; trust-sensitive above all.

**Primary user:** The counter salesman — possibly not a licensed pharmacist, comfortable in Roman Urdu, variable typing ability, operating under rush pressure.

**Secondary:** The owner as evening operator and remote reader of the day's numbers.

**Future:** Small chains (2–5 branches); the multi-branch path is preserved architecturally and deferred entirely as product.

## Reference Customer Posture

The first pharmacies — reached through personal network — are reference customers, not the target architecture. Same discipline as Al Sayed Hospital in Mehvar: their workflows inform, their idiosyncrasies do not dictate. Product decisions favor patterns that generalize across independent Pakistani pharmacies.

## Market Position

A quality entrant in a crowded checklist market. Feature parity is assumed (search, batches, expiry, udhaar, offline, preloaded catalog are all table stakes per Phase 1). Differentiation is experiential: interaction speed as an engineered property, keyboard-first operation, trust architecture legible to a suspicious owner, and design quality obvious within a five-minute demo. Pricing must land within market norms (entry anchored Rs 1,500–2,500/month equivalent); the commercial model is decided in Phase 3.

## Success Criteria

**Counter (measured in software):**
- Repeat cash sale of 3 known items: under 15 seconds, zero mouse touches
- Search: near-instant, misspelling-tolerant results with minimal typing for common items; barcode hit resolves instantly (exact numeric budgets set and verified during implementation)
- Outage resilience: during a temporary connection loss, selling and receipt printing continue with zero workflow difference, and recovery requires no operator action

**Trust (the decisive measure):**
- By day 60 at the reference pharmacy, the owner has retired the parallel paper registers for stock, cash, and udhaar — the system is the sole record of the business. Supporting evidence: unannounced physical spot counts match system stock, and the owner settles udhaar disputes by showing the customer the screen.

**Owner (answered within seconds, from a phone):**
- What did I sell today, and how much cash should be in the drawer?
- Who owes me money, and how much?
- What is running out, and what is about to expire?
- Did anything unusual happen today (adjustments, voids, discounts)?

**Business (first 90 days post-launch):**
- Reference pharmacy runs every sale through the system for 30 consecutive days without reverting to paper
- Salesman self-sufficiency within one day of training
- Two paying pharmacies beyond the reference site

## Constraints

- Implementation window: approximately one week, AI-assisted, in a separate repository driven by this planning package
- One codebase; deployment/commercial strategy decided in Phase 3
- Hardware assumption: aging Windows PC, 80mm (or 58mm) thermal printer, USB barcode scanner, generally stable internet with occasional outages, UPS-backed power
- Team: solo founder; support burden must approach zero by design

## Post-Launch Validation

The first reference pharmacy is the real-world validation environment for this planning package. The operational model behind these decisions is research-derived and reliable for V1 planning, but production usage is the authoritative test. Observations from actual counter operation — request patterns, search behavior, udhaar practice, speed bottlenecks — may refine workflows, UX, and domain assumptions after launch. Such refinements are expected, planned for, and never a reason to delay V1. They are also safe by design: the product guarantees a complete, unalterable record of business events, so changes to workflows and presentation never put historical data at risk.

## Long-Term Direction

Single counter → the system an independent pharmacy relies on every day to sell, stock, purchase, track udhaar, and understand its business → small chains → the catalog itself as a compounding data asset that deepens with every pharmacy onboarded. Each step is earned by the previous one; none is built speculatively in V1.
