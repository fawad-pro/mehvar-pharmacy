# MEHVAR PHARMACY — CONSOLIDATED MASTER PLAN

Version: 1.0 (post-consolidation review) · July 2026
Product: Mehvar Pharmacy — cloud pharmacy POS & operations for independent Pakistani pharmacies
Status: Planning complete. This package is the authoritative specification for the implementation session.

---

## How to use this package (implementation session: read first)

1. **This package is the spec.** Implement it; do not re-litigate it. If implementation reveals a genuine flaw, raise a plan-change note, get a decision, then proceed (Phase 11 §4). Never silently patch around the plan.
2. **Reading order for the implementation session:** Phase 5 (domain) → Phase 9 (schema) → Phase 8 (ADRs) → Phase 7 (workflows) → Phase 10 (screens) → Phase 11 (standards) → Phase 13 (day plan). Phases 1–4, 6, 12 are context and constraints; consult as referenced.
3. **Identifier system, used throughout:**
   - **P1–P8** product principles, **I1–I7** interaction principles, **T1–T5** trust principles (Phase 4)
   - **D1–D5** domain semantic decisions (Phase 5 §4)
   - **W1–W12** core workflows (Phase 7)
   - **ADR-1–ADR-8** architecture decisions (Phase 8) — note: Mehvar Hospital's ADR numbering is a separate series; references to "Mehvar ADR-2/16/18 lineage" mean the hospital product's records, cited as philosophical ancestry only.
4. **Build sequence:** Phase 13 §3, Days 1–8, with the pre-implementation track (§2) assumed complete before Day 1. The cut order under pressure is Phase 13 §3 (end) — pre-decided; follow it, don't invent one at 2am.
5. **Definition of V1 complete:** Phase 13 §7. Definition of done per feature: Phase 11 §4.

## Glossary (canonical terms — use these words, no synonyms)

- **Base unit / BaseQty** — the smallest sellable unit of a product (tablet, bottle, piece); all stock arithmetic happens here.
- **Pack levels** — ordered grouping levels above base (strip, box) with factors in base units.
- **Batch** — a stock layer created by a purchase line or opening/count adjustment: expiry, cost, price, qty_remaining.
- **Pending layer** — allocation rows with null batch: sales consumed stock the system didn't have (D2); visible, resolvable, never silent.
- **Allocation** — the record linking a sale line to the batch(es) it consumed; written server-side (ADR-5).
- **Quick item** — a minimal product created mid-sale (D3/W6), flagged needs-completion; never an anonymous line.
- **Udhaar** — credit extended to a named customer; balance always derived from sales minus payments.
- **Settlement** — a standalone payment against udhaar (W3).
- **Cash movement** — non-sale drawer cash: float, withdrawal, expense, over/short.
- **Receipt number** — device-scoped, client-generated (prefix + counter), identical online and offline.
- **Paisa** — all money as integer paisa; branded type in code.
- **Global catalog / tenant catalog** — Mehvar-owned identity layer vs. pharmacy-owned products and prices (Phase 6 §2).
- **Verifier** — the scheduled rebuild-equivalence check (ADR-8); a mismatch is sev-1.
- **The three numbers** — today's sales, expected cash in drawer, running udhaar total (W10/W11).

## Consolidation review record

Every artifact was re-read against every other. Five defects found and fixed in the source phases (already applied below):

- **C1 — Offline receipt numbering contradiction (material).** Phase 9 assigned sale numbers server-side; ADR-3 requires printing receipts from local state during disruptions — an offline sale could never number its receipt. Resolved: `receipt_number` is client-generated and device-scoped (e.g., `A-1042`), unique per tenant, identical behavior online and offline. Phases 9, 10 §7, 13 Day 4 updated.
- **C2 — Price flow underspecified between batch and product.** D1 charges the consuming batch's price; ADR-4's client index knows only product prices. Resolved: purchase commit updates the product's default price and MRP to received values (the "price capture at receiving" flow made concrete — a sanctioned reference-entity update); batches retain their own price for D1 variance display; the client index stays batch-unaware. Phase 9 §3 updated.
- **C3 — Deploy window vs. real pharmacy hours.** "After 11pm" collided with pharmacies trading past 11pm. Resolved: lowest-traffic window (deep night, after midnight PKT), revisited if 24-hour pharmacies onboard; ADR-3 noted as the reason a mistimed deploy still cannot stop selling. Phase 12 §2 updated.
- **C4 — Version-skew tolerance lacked its column.** Phase 12 §2.6 requires ingestion to accept prior-version offline payloads; the schema carried no version. Resolved: `client_schema_version` on sales and payments. Phase 9 updated.
- **C5 — F8 key overload ambiguity.** Globally "Settle Udhaar," on the sale screen "attach customer." Resolved as deliberate contextual behavior, specified: with items in cart F8 attaches a customer (W2); with an empty cart it opens settlement (W3) — one key, both meanings "customer + money." Phase 10 §4 updated.

Verified clean in the same pass: terminology consistency across all thirteen artifacts (pending layer, quick item, paisa, base units — no synonyms found); no residue of superseded decisions (standalone naming, hard keystroke benchmarks, prescriptive suspension mechanics — all absent); every ADR consistent with the architecture overview and the schema; every workflow expressible against the domain model (W1–W12 ↔ Phase 5 entities and D1–D5); every Phase 3 §5 exported requirement discharged (multi-tenancy → ADR-2; export → Phase 9 §8 + Phase 10 Settings; suspension outcome → tenant flag + always-open export, Phase 12; trial-as-production → ADR-2 consequence; mobile owner reporting → Phase 10 §2; no billing automation → Phase 13 trade-offs); implementation roadmap dependencies match the architecture (commit transaction before sync; search index before offline; hardware verified pre-week).

## Package contents (in order)

1. Market, Competitive & Operational Research
2. Product Charter
3. Deployment & Commercial Strategy
4. Principles & Product Identity
5. Domain Model
6. Medicine Catalog & Master Data Strategy
7. Core Workflows
8. Architecture, Technology Stack & ADRs
9. Data Model & Database Design
10. Information Architecture, Navigation & Screens
11. Engineering Standards & Development Workflow
12. Deployment Operations, Security & Backups
13. Implementation Roadmap, Risks & Future Evolution

---


<!-- ==================== phase-01-research.md ==================== -->

# Phase 1 — Market, Competitive & Operational Research

Status: Approved (v1.0, consolidated)
Research date: July 2026
Sources: Live web research (competitor sites, FBR, DRAP), competitor analysis, and domain knowledge of Pakistani pharmacy operations.

**Confidence statement.** The operational model in this document is derived from live market research, competitor analysis, domain knowledge, and familiarity with Pakistani pharmacy operations. It is considered sufficiently reliable for V1 planning. Assumptions that materially affect implementation are validated during the first reference-customer deployment — in production, against real usage — rather than through pre-development field studies. Planning proceeds without blocking on in-person validation.

---

## 1. Market landscape

The Pakistani pharmacy software market is active and maturing. It is no longer a gap market — it is a quality market. Multiple vendors compete for independent pharmacies with overlapping feature checklists. The opportunity is not "no software exists"; it is "no software is loved."

Two generations coexist:

**Generation 1 — Desktop incumbents.** MARS (Softronix) is the reference: offline Windows software, 600+ medical stores across 40+ cities, 30,000+ preloaded products with prices updated from an online database. Commercial model: no upfront license fee, nominal yearly fee for support and updates. Strengths: works without internet, deep catalog, established trust, local support culture. Weaknesses: dated UX, single-machine data risk, no remote visibility for owners, update friction.

**Generation 2 — Cloud POS with offline mode.** Pharma Pro (Rs 2,000/month starter: 1 user, 1 terminal, up to 1,500 sales/month; browser-cached catalog, offline sales queue with auto-sync, 58/80mm thermal support, Roman Urdu marketing). Mint POS (from Rs 2,499/month, generic retail POS with a pharmacy vertical: expiry color-coding, generic + brand alias search, offline capable, FBR integration). SadaHisab (cloud, positioned on local pricing and tax practices). Moneypex (25,000+ preloaded medicines, tablet/strip/box unit levels, formula search, batch tracking, FBR emphasis, aggressive free-tier marketing). Oscar POS (cloud, FBR-integrated, pharmacy vertical). pointofsale.pk (Rs 1,500/month, no setup fee, offline with local backup, explicit customer credit tracking).

**Adjacent:** InstaCare (healthcare suite claiming 10,000+ clinics/labs/pharmacies, compliance positioning around provincial healthcare commissions, Roman Urdu-friendly UI). Hospital-pharmacy modules (Softronic, Hospital.Partners, Zarzoob) target hospitals, not counters — not direct competitors.

## 2. What the market has already validated

These findings retire several of our open questions:

1. **Cloud with outage resilience is the established pattern, not a differentiator.** Pharma Pro's model — catalog cached in browser, sales saved locally through an outage, auto-sync on reconnect — is precisely the resilience layer we hypothesized. The market validates the direction and simultaneously removes it as a unique selling point. Given improved connectivity, this is scoped as graceful degradation of a connected system (sales capture and receipt printing survive an outage; everything else may wait), not as offline-first architecture. The final scope of degraded-mode behavior is an ADR in the architecture phase.
2. **Udhaar tracking is table stakes.** Even the cheapest competitor (Rs 1,500/month) advertises customer credit tracking. Our sales/payments-separation model is confirmed as a day-one requirement, not an optional accommodation.
3. **Preloaded catalogs are table stakes among serious players.** MARS ships 30,000+ products; Moneypex 25,000+. A blank catalog at first launch is a competitive liability. This raises the stakes of Phase 6 (Catalog Strategy): we need a credible preloaded starter catalog at launch, not only import tooling.
4. **Entry pricing is anchored at Rs 1,500–2,500/month.** Our earlier Rs 2,000–3,500 estimate was right at the low end and slightly optimistic at the top. Pricing above ~Rs 2,500/month requires demonstrable superiority; "no setup fee" is the market norm.
5. **Sub-unit inventory (tablet/strip/box) is expected.** Competitors advertise selling a single tablet or a whole box against one stock position. Our unit-of-sale domain question is confirmed as mandatory, not edge-case.
6. **Roman Urdu is the lingua franca of this market's UX and marketing.** Multiple vendors lead with it. Full Urdu localization is not required; Roman Urdu-friendly labels, search tolerance, and marketing voice are.

## 3. Regulatory findings

**FBR POS integration is NOT a V1 requirement for our segment.** Integration is mandatory only for Tier-1 retailers as defined in section 2(43A) of the Sales Tax Act — units of chains, retailers in air-conditioned malls, businesses with annual electricity bills exceeding Rs 1.2 million, or those crossing withholding-tax thresholds. A typical independent neighborhood pharmacy meets none of these. Competitors market FBR integration heavily because it sounds authoritative, but for our target customer it is future-proofing, not necessity. Decision: FBR digital invoicing goes to Future Considerations as a requirement that must remain adoptable later without rework; how to preserve that option is an architecture-phase concern. It must not complicate V1.

**DRAP provides a public registered-products database** — brand name, dosage form, composition/active ingredients, registration number, and manufacturer — explicitly provisional and reference-only. It contains no retail prices and no barcodes. **MRP is regulated and printed on the pack**; pharmacies cannot legally charge above it. Implications for catalog strategy: DRAP data can seed identity (what exists, who makes it, what's in it), but pricing must come from distributor invoices and pack labels at the counter, and barcodes must be captured operationally. Price capture at purchase time is therefore a core workflow, not an admin task.

## 4. Competitive weaknesses — where we win

Feature checklists are saturated; experience is not. Consistent gaps observable across the market:

- **Speed as a designed property.** No competitor publishes or evidently engineers to interaction speed budgets. "Fast billing" is claimed universally and specified nowhere.
- **Keyboard-first operation.** Pharma Pro hints at it (a visible F12 pay shortcut); none treat the keyboard map as a product surface. A counter operator's hands should never need the mouse during a sale.
- **Trust architecture.** No competitor talks about why their numbers can be believed — immutable records, derived stock, audit trails legible to a suspicious owner. Theft and shrinkage anxiety is a primary owner motivation (MARS testimonials cite uncovering theft). A ledger-native product speaks directly to this fear.
- **Owner-absent visibility.** Cloud vendors offer dashboards, but the "owner checks the day from his phone at 11pm" experience is nowhere treated as a first-class scenario.
- **Design quality.** The category's visual and interaction design is utilitarian at best. A product that feels premium will be noticed in demos — and demos via a connected friend are our sales channel.

Differentiation thesis: **win on experience quality, trust, and speed — not on feature count.** Every competitor claim is a checklist item; ours must be a felt difference in the first five minutes of a demo.

## 5. Operational reconstruction — a day at the counter

Reconstructed from domain knowledge and market research; reliable for planning per the confidence statement above. Refinements come from reference-customer observation post-launch.

**Cast.** The owner (often absent, sometimes runs the evening shift), one or two salesmen (frequently not licensed pharmacists; variable literacy in English; fluent in Roman Urdu), a part-time helper. The person at the counter is the real primary user; the owner is the buyer.

**Morning.** Shutter up between 9–10am. Cash drawer starts with a float. Distributor delivery riders arrive through the morning with stock and carbon-copy invoices; the salesman checks quantities against the invoice, notes bonus units ("10+1" schemes), and stacks strips on shelves. Prices on new stock may differ from old stock of the same medicine — both sit on the shelf simultaneously.

**Sales flow.** Most customers present a doctor's prescription or ask by brand name. Empty strips are common for repeat purchases. Symptom-based requests ("bukhar ki goli") occur but are a minority of interactions. The salesman resolves the request to a product from memory, quotes the price, frequently cuts a strip to sell partial units, rounds totals to friendly numbers, and takes cash. Many sales are 2–4 items and under 60 seconds. Receipts are rarely demanded but a printed receipt signals professionalism. Substitution is constant: the asked-for brand is out, an equivalent salt from another manufacturer is offered.

**Udhaar.** Known neighborhood customers take goods on credit, recorded in a paper register by name — no addresses, no formality. Settlement is partial and irregular ("500 de do, baqi baad mein"). Disputes arise from illegible or missing register entries. This is the single most emotionally charged record in the shop.

**Evening.** The rush is 6–10pm. At close, cash is counted against remembered sales; discrepancies are absorbed with suspicion. The owner wants three numbers: today's sale, today's cash, what's running out.

**Ambient realities.** Internet connectivity in Pakistan has improved considerably; the normal operating condition is a stable connection, with temporary outages (power or network) as exceptional events the system must survive gracefully rather than the baseline it is designed around. A UPS typically covers short power interruptions. The counter machine is often an aging Windows PC. Phones are ubiquitous; the owner's phone is his real dashboard. Any workflow requiring more than a few seconds of typing during a rush will be bypassed, and any system that blocks a sale will be abandoned mid-rush — permanently.

**Design consequences (carried into later phases).** Search must resolve brand names — including the misspellings that come from reading handwritten prescriptions — and salts instantly; barcode and empty-strip repeat purchases must be the fastest path of all. Sub-strip units are a first-class sale line. Price ambiguity between old and new stock must be handled at the sale line without friction. Udhaar entry must be as fast as the paper register. Day-close must produce the owner's three numbers in one screen. Selling must continue uninterrupted through temporary connectivity disruptions; how much beyond the sale workflow remains available during a disruption is decided in the architecture phase. The salesman, not the owner, is the UX bar: learnable in minutes by a non-technical operator.

## 6. Commercial context (input to Phase 3)

- Hardware reality check stands: used PC Rs 35–50k, scanner Rs 5–10k, 80mm thermal printer Rs 12–20k. Total entry cost dominated by hardware.
- Software pricing norms: Rs 1,500–2,500/month subscription, or MARS-style free-install + annual support fee. "No upfront charges" is a common promise.
- The MARS annual-fee model is culturally proven with this exact buyer and deserves genuine evaluation in Phase 3 alongside subscription — it may be the trust-compatible framing of recurring revenue.
- Piracy risk confirms the earlier instinct against one-time perpetual licensing.

## 7. Risks registered

1. **Crowded category, thin differentiation window.** If our experience advantage isn't obvious in a five-minute demo, we're a me-too product at a me-too price.
2. **Catalog cold-start.** Competitors ship 25–30k preloaded items; matching this is a data project with real lead time. Phase 6 must produce a concrete, dated plan.
3. **Reconstruction risk.** Section 5 is derived, not observed. Accepted for V1 planning per the confidence statement; the mitigation is the reference-customer deployment, where real usage refines workflows, UX, and domain assumptions without delaying development.
4. **Price ceiling.** The market anchors low. Revenue depends on volume through the friend's network, retention, and eventual multi-tier pricing — not high unit price.


<!-- ==================== phase-02-product-charter.md ==================== -->

# Phase 2 — Product Charter

Status: Approved (v1.0, consolidated)
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


<!-- ==================== phase-03-deployment-commercial-strategy.md ==================== -->

# Phase 3 — Deployment & Commercial Strategy

Status: Approved (v1.0, consolidated)
Informed by: Phase 1 Research, Phase 2 Charter

---

## 1. What this document decides

How the product is deployed, how it is priced, how money is collected, and how hardware is handled. The evaluation weighs customer adoption, trust, maintainability, support overhead, and long-term business sustainability — for a solo founder selling through a personal network into a market anchored at Rs 1,500–2,500/month.

## 2. Options evaluated

**A. Cloud SaaS, monthly subscription.** The Generation-2 competitor norm (Pharma Pro Rs 2,000/mo, Mint Rs 2,499/mo, pointofsale.pk Rs 1,500/mo).
- Adoption: no install, demo-to-live in a day; monthly feels low-commitment. Subscription fatigue is real but this market has normalized it.
- Trust: weakest on the "where is my data" objection; strongest on "your data survives your PC dying."
- Maintainability: one deployment, instant updates, remote support. Best possible for a solo founder.
- Sustainability: recurring revenue; non-payment handled by suspension, not collection visits. Piracy impossible.

**B. Cloud SaaS, annual fee.** Same deployment; billing framed the MARS way — the culturally proven "yearly fee" this exact buyer already pays.
- Adoption: one decision per year suits a cash culture; a single Rs 18–24k ask is psychologically "buying the software," not renting it.
- Sustainability: fewer collection events, cash up front, renewal is the retention scoreboard. Risk: a larger sticker at the door.

**C. On-premise, perpetual license.** Rejected. One-time revenue with perpetual support obligation; piracy is rampant and unpoliceable for a solo founder; every install is a support liability on aging Windows machines; updates never reach the field; the owner's remote phone visibility — a core charter promise — disappears. The trust advantage ("my data stays in my shop") is real but purchased at the cost of every other criterion.

**D. On-premise, annual support fee (the MARS model).** MARS proves the *billing* model works, but MARS carries an installed base and support infrastructure built over years. For us it inherits every liability of C except revenue durability. The correct lesson from MARS is its fee framing, not its deployment. Rejected as deployment; adopted as pricing psychology.

**E. Hybrid: cloud product with an optional local install.** Deferred, not rejected. One codebase can support it later (containerized local deployment) if a segment demands it — likely chains with compliance concerns, not V1 independents. Offering it in V1 doubles operational surface for a customer who hasn't asked yet. Goes to Future Considerations.

**F. Freemium.** Rejected for V1. Moneypex markets "free" aggressively; competing there races to the bottom with a funded competitor. Our channel (personal network, demo-led) doesn't need a free tier to generate leads. A time-limited trial delivers the same risk reversal without training the market that the product is free.

## 3. Decision

**Deployment: cloud, single multi-tenant service, browser-based, one codebase.** This is the only deployment a solo founder can operate at near-zero marginal support cost, and it is the only one that delivers the owner's-phone visibility and the survives-a-dead-PC data guarantee. The cloud trust objection is met head-on in sales posture: the pitch leads with what cloud gives the *owner* (check your shop from anywhere; your records outlive any machine; disputes settled by showing the screen) and the product backs it with owner-controlled data export from day one — the data is theirs, demonstrably.

**Pricing: one plan, two cadences, annual-led — set as an initial V1 target, not a permanent decision.**
- Target: **Rs 2,000/month**, or **Rs 20,000/year** (two months free — the closer in every demo)
- No setup fee (market norm; violating it loses demos)
- 14-day full trial, no card, assisted setup included
- One plan in V1. Tiering (multi-terminal, multi-branch) is future revenue, not launch complexity.
- These numbers are validated during the first reference-customer deployments — willingness to pay, cadence preference, and renewal behavior are the evidence. The *structure* (one plan, two cadences, annual-led, no setup fee) is the strategy; the figures are the opening position.

Positioning at Pharma Pro parity is deliberate: we price as a peer and win on the five-minute experience gap, not on discount. Underpricing signals inferiority in a trust purchase.

**Collection:** annual invoices collected at renewal; monthly via bank transfer / JazzCash / Easypaisa with automated reminders and a grace period. Non-payment handling is an operational policy decided post-launch, bound by one non-negotiable outcome: the customer's data is never held hostage — export remains available regardless of payment state. This is both ethics and the strongest possible answer to the cloud-trust objection.

**Hardware: recommend, don't sell.** Publish a tested hardware list (PC minimums, 80mm thermal printer models, USB scanners) and a one-page setup guide. Carrying hardware inventory adds capital risk and support scope for margin that isn't ours to chase. The channel partner may source hardware at his own margin if he wishes; the software company stays a software company.

**Channel:** the friend's network is the launch channel. Formalize it lightly through a referral / revenue-sharing arrangement, with specific terms finalized before commercial rollout — the planning commitment is the structure (rewarded referrals, no employment or equity entanglement), not the percentage. Demo script and trial-to-paid flow are the founder's to run initially.

## 4. Revenue reality check

At Rs 20,000/year: 10 pharmacies ≈ Rs 200k/yr, 25 ≈ Rs 500k/yr, 50 ≈ Rs 1M/yr. This is a volume-and-retention business at these price points. The strategic asset that changes the slope later is the catalog (Phase 6) and multi-branch tiering — not raising the entry price.

## 5. Requirements this decision exports to later phases

1. Multi-tenant service from day one (architecture phase) — single-tenant-now would contradict this document.
2. Owner data export as a V1 feature (workflows, IA phases).
3. The service must support restricting a tenant's access on non-payment without ever compromising that tenant's ability to export their data (architecture phase); the enforcement policy itself is operational and post-launch.
4. Trial-to-paid needs no data migration — trial data becomes production data (architecture phase).
5. Mobile-usable owner reporting (IA phase) — the phone dashboard is part of what the price buys.
6. Payment tracking for subscriptions is founder-side tooling and may be manual at launch; do not build billing automation into V1.

## 6. Future Considerations

- Local/containerized deployment for chains or compliance-driven customers (Option E)
- FBR digital invoicing as a paid add-on when customers cross Tier-1 thresholds
- Multi-branch tier; multi-terminal pricing
- Hardware bundle partnership if channel volume justifies it


<!-- ==================== phase-04-principles-product-identity.md ==================== -->

# Phase 4 — Principles & Product Identity

Status: Approved (v1.0, consolidated)
Informed by: Phases 1–3

This document operationalizes the Charter's philosophy into rules that win arguments during design and implementation, then defines the product's identity: values, personality, design direction, and naming direction.

---

## 1. Product Principles

Each principle includes its test — the question that settles a dispute.

**P1. The counter outranks everything.** When two designs conflict, the one that makes the sale moment faster or calmer wins. *Test: does this change add even one second or one decision to a routine sale?*

**P2. Never block a sale.** Missing catalog entry, ambiguous price, network drop, unknown barcode — every blocking moment must have a designed fast path that keeps the customer moving and reconciles the record afterward. *Test: name the moment this feature could stop a sale; show its escape hatch.*

**P3. Faster than paper, or more trustworthy than paper — ideally both.** Paper is the incumbent. Every workflow must beat the register on speed, or beat it so decisively on trust that the trade is obvious to the salesman, not just the owner. *Test: walk the paper version of this task; time both.*

**P4. Numbers that can't lie.** No silent edits anywhere. Corrections are visible as corrections, adjustments carry reasons, and every balance answers "why is this number what it is?" on demand. *Test: can any user change any figure without leaving a visible trace? If yes, the design is wrong.*

**P5. One obvious way.** Every task has exactly one primary path, discoverable without training. Settings, modes, and configurability are treated as failures of decision-making until proven otherwise. *Test: did we add an option because users need it, or because we couldn't decide?*

**P6. Earn every feature.** Nothing enters V1 without a named daily task it accelerates. "Useful someday" goes to Future Considerations. *Test: which of the day-at-the-counter moments (Phase 1 §5) does this serve?*

**P7. The salesman is the bar.** A non-technical operator, comfortable in Roman Urdu, learns any workflow in minutes and runs it at rush hour. If training is required, the design failed. *Test: could a new hire run this on day one having watched it done twice?*

**P8. The shop opens tomorrow.** The pharmacy's ability to trade is never hostage to our operations. Updates, deployments, migrations, and recovery procedures are designed so the counter works every morning, unconditionally — changes land quietly, never mid-rush, and never require the pharmacy to do anything to keep selling. *Test: describe the worst thing that can happen on our side tonight; show why the counter still sells at 9am.*

## 2. Interaction Principles

**I1. Keyboard-first, shortcuts visible.** The entire sale — search, add, quantity, discount, payment, print — completes without the mouse. Shortcuts are printed on the interface itself, not hidden in help. The scanner is a keyboard: a scan anywhere sensible does the right thing.

**I2. Speed is a requirement, calibrated at implementation.** Search feels instant, returning useful results within the first few keystrokes and with minimal typing. A routine repeat cash sale completes in well under half a minute — the working target is around fifteen seconds. Screen transitions are imperceptible; receipt printing starts without a pause the customer notices. Exact numeric budgets are set and verified during implementation against real hardware; the expectation of near-instant response is not negotiable, the specific benchmark is.

**I3. Forgiving input.** Misspellings resolve (prescriptions are handwritten; salesmen transcribe). Quantities accept "2 strips" thinking, not database thinking. Sensible defaults everywhere; the common case pre-selected.

**I4. One primary action per screen.** Every screen answers "what do I do here?" with one visually dominant action. Secondary actions exist quietly.

**I5. Prevent errors; don't scold.** Design makes wrong states hard to reach. When intervention is needed, the message says what to do next, in plain words, without jargon or blame.

**I6. Glanceable numbers.** Prices, totals, balances, and stock levels are large, tabular, and unambiguous at arm's length in a bright shop. The owner's three numbers (today's sale, today's cash, what's running out) are never more than one action away.

**I7. Calm under density.** The sale screen carries real information density without visual noise: strong hierarchy, restrained color, semantic states only (expiry warnings, low stock, unsynced records) — color always means something.

## 3. Trust Principles

**T1. The owner sees everything; the system forgets nothing.** Every void, discount, adjustment, and price override is visible in the owner's daily view, attributed and timestamped.

**T2. Corrections, not erasures.** Mistakes are reversed by compensating entries that reference what they fix. The original always remains visible.

**T3. The data is the customer's.** Full export, always available, even in suspension. This is a sales argument, a retention ethic, and the honest answer to "where are my numbers?"

**T4. Show the math.** Any derived figure — a balance, a total, a stock count — can be expanded into the transactions that produced it. Udhaar disputes end by showing the screen.

**T5. Print like a business.** The receipt is the pharmacy's public face and the product's daily advertisement. It is professional, legible, and correct, every time.

## 4. Brand Values & Personality

**Values: Bharosa (trust), Raftaar (speed), Saadgi (simplicity).** In that order — trust is bought, speed is felt, simplicity is how both are delivered.

**Personality:** the ideal senior salesman — quick, accurate, unflappable, respectful, no wasted words. Never playful at the counter, never bureaucratic, never condescending. The product is confident enough to be plain.

**Voice:** short sentences, concrete words, sentence case, no exclamation marks. English UI baseline with Roman Urdu where it lands more naturally in microcopy and marketing ("Udhaar" is the feature's name — not "Credit Management"). Numbers are always the loudest thing on the screen.

## 5. Design Direction

- **Feel:** premium-clean and calm; the quality gap versus incumbents should be visible in a screenshot before a single click.
- **Its own face within the family.** Mehvar Pharmacy shares the Mehvar wordmark logic and quality bar but carries its own palette and personality — no reuse of the hospital product's royal blue/mint. Family coherence at the brand level, product distinctness at the interface level.
- **Palette direction:** deep green anchor (pharmacy association, trust, "sehat") with warm neutrals and a restrained accent; semantic red/amber reserved exclusively for expiry and stock warnings so alarm colors keep meaning.
- **Typography:** a highly legible grotesk with strong tabular numerals (candidates: Inter, IBM Plex Sans); numerals are the brand's real typeface — prices, totals, and balances must render beautifully and align in columns.
- **Layout:** generous hit targets, high contrast for bright shops and aging screens, density where work happens and whitespace where decisions happen.
- Final tokens, exact palette values, and component language are Phase 10 (IA & Screens) work; this direction is binding on that work.

## 6. Brand Architecture

**Decision: this product joins the Mehvar family as "Mehvar Pharmacy."** A standalone brand (candidates evaluated: Amanat, Meezan, Rasid, Sahih) was considered and set aside.

Rationale: a solo founder can build one brand well or two brands poorly. Every pharmacy demo, receipt footer, and reference story should compound into the same name that hospital demos compound into. "Mehvar" carries the right meaning for a family (axis — the thing operations turn on), survives Roman Urdu conversation naturally ("humne Mehvar lagaya hai"), and positions the company as a healthcare operations software house rather than a one-product shop — which strengthens both products' credibility with buyers who ask "who else uses your software?" The honest caveat: Mehvar's brand equity today is one hospital deep, so the compounding benefit is forward-looking, not inherited. That is acceptable; brand architecture is a decision about where value accumulates, and one account is the right one.

Structure:
- **Mehvar** — master brand: the company and the trust mark. One wordmark logic, one voice foundation.
- **Mehvar Pharmacy** — this product. Full name in formal contexts; "Mehvar" alone at the counter and in conversation.
- The hospital product's own naming within the family is settled on the Mehvar side; nothing here constrains it.
- Future products follow the same pattern: Mehvar + plain descriptor. No sub-brand ever gets its own invented name.

Each family member keeps its own visual identity and personality within shared brand foundations: Mehvar Pharmacy's deep green palette, counter-native voice, and salesman-first personality are its own; the wordmark construction, quality bar, and trust posture are the family's. Domain strategy follows the parent (the product lives under the Mehvar domain, e.g. pharmacy.mehvar.app when that domain activates); no separate domain purchase is needed.

## 7. Enforcement

These principles are cited by number in later phases and in implementation reviews ("violates P2", "fails I2 budget"). Any deliberate exception is recorded as a decision with a reason, in the ADR log, not absorbed silently.


<!-- ==================== phase-05-domain-model.md ==================== -->

# Phase 5 — Domain Model

Status: Approved (v1.0, consolidated)
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

### Batch (stock layer)
A quantity of a product that arrived together: batch number (as printed, optional in practice), expiry date, unit cost, and MRP/selling price at the time of arrival. Created by purchase entries and opening-stock entries. Batches are how expiry tracking, FEFO, and cost-basis reporting exist at all.

**Pragmatic stance:** batches are first-class in the model and nearly invisible at the counter. The salesman never selects a batch during a sale; consumption is automatic (see §4). Batch number itself is optional at purchase entry — expiry date is the field that matters and is always requested.

### Customer
A name and a phone number attached to a debt (charter boundary). Exists only to make udhaar recordable. Balance is derived, never stored.

### Supplier
A name on purchase entries, for "what did I buy from whom" visibility. No payables, no accounting (charter boundary).

## 3. Event records

### Purchase
Goods arriving: supplier, date, lines. Each line: product, quantity (any unit level, stored in base units), bonus quantity (the "10+1" scheme units — received free, entering stock at zero cost, kept distinct so margin reporting is honest), unit cost, expiry, batch number (optional), MRP/selling price (capturing price at receiving is a core workflow — Phase 1 §3). Each line creates or extends a batch.

### Sale
The counter event: lines + payment. Each line: product, quantity in base units, unit level as entered (for display/receipt), unit price, discount (line or invoice level), and the batch consumption it resolved to (recorded automatically). Payment: cash amount and/or credit amount against a named customer. A fully-paid cash sale and a fully-credit udhaar sale are the same record shape with different payment splits.

### Payment
Money received from a customer independent of a new sale — the udhaar settlement. Amount, customer, method (cash in V1). A customer's balance = credit extended (from sales) − payments − credit reversed by returns.

### Sale Return
References the original sale (whole or lines). Restores stock (to the batch it came from when known), records cash returned or credit reduced. A compensating record, not an edit (T2).

### Adjustment
Stock change with a mandatory coded reason: damage, expiry write-off, return to distributor, count correction, opening stock. Attributed and visible in the owner's daily view (T1). Adjustments are the only non-sale, non-purchase path by which stock moves.

### Cash Movement
Cash placed into or taken out of the drawer outside of sales: opening float, owner withdrawal, small expense with a note ("chai, rickshaw"). Included because without it the drawer never reconciles and the owner's "today's cash" number becomes fiction — a small entity that protects a headline promise. Not an expense-management feature (boundary holds); just drawer honesty.

## 4. Key semantic decisions

**D1. Automatic FEFO consumption.** Sales consume stock from the earliest-expiry batch first, automatically. The salesman sees the price, not the batch. When two batches carry different prices, the sale line uses the consuming batch's price and shows it plainly — the price ambiguity moment (Phase 1 §5) resolves by rule, not by conversation. Owner can review batch-price transitions in the daily view.

**D2. Stock may go negative; sales are never blocked.** When the shelf has it and the system doesn't (unentered purchase, count drift), the sale proceeds (P2), consumption is recorded against a *pending layer*, and the discrepancy surfaces in the owner's daily view for reconciliation. When the missing purchase is later entered or a count correction made, pending consumption resolves against real batches. Negative stock is a visible exception state, never a silent one.

**D3. Quick item escape hatch.** A sale of something not in the catalog must not stall (P2): a quick-add captures name and price in seconds, creates a real (minimal) product flagged *needs completion*, and the owner's daily view lists it for enrichment. No anonymous "misc" lines — every sale line references a product, or inventory truth dies quietly.

**D4. Prices are tenant truth; MRP is the ceiling.** The selling price lives with the tenant's product (and per-batch where batches differ). MRP is regulated and printed on the pack; the product warns when a price exceeds recorded MRP but does not block (the pack in hand is authoritative, not our data).

**D5. One business day as the reporting frame.** Day close is a reporting ritual, not a transactional lock: the day's sales, cash movements, exceptions (discounts, adjustments, negative stock, quick items, price overrides) summarized for the owner (T1). Nothing is frozen; late entries land visibly in the day they were recorded.

## 5. Invariants

1. Product stock (base units) = Σ purchases + Σ positive adjustments − Σ sales − Σ negative adjustments − Σ returns-to-distributor + Σ sale returns. Always derivable, never stored as authority.
2. Batch quantity ≥ 0; the pending layer is the only construct that may represent unresolved negative consumption, and it is always visible.
3. Customer balance = Σ credit extended − Σ payments − Σ credit reversals. Never stored as authority.
4. Sale total = Σ line totals − invoice discount; cash + credit split = total, exactly.
5. Every record is attributed (user, timestamp) and immutable; every correction references its target.
6. Derived figures are reproducible from records alone — dropping every cache and recomputing changes nothing (T4 made testable; this is the domain's deepest test target for Phase 11).

## 6. Explicitly out of the model (V1)

Prescriptions and clinical data; supplier balances/payables; expenses beyond drawer cash movements; loyalty, pricing tiers, or customer data beyond name+phone; multi-branch stock; purchase orders (a low-stock *list* exists; ordering happens on WhatsApp as it does today); inter-pharmacy anything.

## 7. Exports to later phases

- Phase 6: the Product identity fields above are the contract the shared catalog must fill.
- Phase 7: D1–D3 define the fast paths workflows must express.
- Phase 8 (ADRs): derivation strategy (compute vs. cache-and-verify), pending-layer resolution mechanics, connectivity-disruption capture.
- Phase 9: this model translates to schema with invariants as constraints and tests.
- Phase 11: invariant 6 is the primary test suite.


<!-- ==================== phase-06-catalog-strategy.md ==================== -->

# Phase 6 — Medicine Catalog & Master Data Strategy

Status: Approved (v1.0, consolidated)
Informed by: Phases 1, 3, 5

The catalog is a strategic asset, not a lookup table: it is the thing that gets harder for competitors to match with every pharmacy onboarded, and the difference between a demo that starts selling in minutes and one that starts with data entry.

---

## 1. The problem, stated honestly

Competitors ship 25,000–30,000 preloaded items (MARS, Moneypex). DRAP's public database provides identity for registered drugs — brand, form, composition, registration number, manufacturer — but no pack structures, no retail prices, and no barcodes, and it is explicitly provisional. The three fields a counter actually needs to sell (pack structure, price, barcode) are exactly the fields no public source provides. Barcode coverage among Pakistani manufacturers is inconsistent; MRPs change by government notification. A "complete" preloaded catalog is therefore not downloadable — it must be assembled, and it decays without maintenance.

## 2. Architecture: two layers

**Global Catalog (Mehvar-owned).** Product identities: name, manufacturer, formula/salt, form, strength, known pack structures, known barcodes, reference MRP where known. Shared across all tenants, curated by Mehvar. Contains no tenant data, no prices-as-charged, no sales information — identity only.

**Tenant Catalog (pharmacy-owned).** The pharmacy's actual products: what they stock, their selling prices, their minimum levels, their quick-added items. A tenant product may *link* to a global entry (inheriting identity and future identity corrections) or stand alone (quick items, local products, general retail goods). Prices and stock are always tenant-only.

This split is what makes the network effect possible without ever sharing a pharmacy's commercial data — a line the trust posture (T3) does not permit crossing.

## 3. Cold start: the launch catalog

A pre-launch data project, time-boxed and honest about scope:

1. **Seed identity from DRAP** for breadth (~25k+ registered products): name, manufacturer, composition, form. Machine-imported, marked as unverified reference data.
2. **Curate the head of the market by hand:** the top ~1,500–3,000 fastest-moving SKUs (the Panadols, Augmentins, Brufens, common syrups, injections, and the general-retail staples) get verified pack structures, unit hierarchies, and current MRPs. This is the set that makes the demo sing; a typical counter's daily sales concentrate overwhelmingly here. Sources: distributor price lists, pack inspection, the reference pharmacy's shelves.
3. **Import tooling** for competitor exports and distributor lists (CSV): mapping assistant, duplicate detection against the global catalog, review-before-commit. This converts a competitor's install base into a migration path.
4. **Barcodes accumulate operationally** (see §4); launch does not depend on barcode coverage.

Launch gate: the curated head (2), not the full seed (1). The seed can grow post-launch without blocking anything.

## 4. The compounding loop

Every pharmacy operation enriches the asset:

- **Unknown barcode scanned** → five-second link to a product → barcode joins the tenant product; identity-level barcode is proposed upward to the global catalog.
- **Quick item completed** by an owner → candidate global entry if it matches no existing identity.
- **Purchase entry** captures current MRPs in the wild → aggregate MRP drift signals for curation (identity-level only, never tenant pricing).
- Founder-side curation reviews proposals; nothing enters the global catalog uncurated, because the catalog's value is that it can be trusted.

Global updates flow down as *suggestions* to linked tenant products (new barcode known, MRP notification, corrected composition) — accepted by the tenant, never forced. A pharmacy's catalog is never silently rewritten under it (P8 in data form).

## 5. Maintenance & ownership

- Curation is a founder responsibility in V1; time-boxed weekly, driven by the proposal queue.
- MRP notifications (DRAP price revisions) are tracked manually at first; tooling only when volume demands it (P6).
- Data quality states are explicit: *verified* (curated), *reference* (seeded, unreviewed), *tenant-only*. The counter never needs to care; the curation queue does.

## 6. Risks

1. **Curation bottleneck:** the head-of-market set slips and launch demos feel empty. Mitigation: hard scope (the ~2k list drawn from the reference pharmacy's actual shelf + one distributor's fast-mover list), started before implementation week.
2. **Seed pollution:** DRAP data contains duplicates/stale entries. Mitigation: reference-tier marking; never auto-link tenant products to unverified seeds.
3. **Contribution noise:** bad barcode links propagate. Mitigation: curated promotion only; provenance kept per contribution.

## 7. Exports to later phases

- Phase 7: unknown-barcode and quick-item flows; purchase-entry MRP capture.
- Phase 8 (ADR): global/tenant catalog linkage and update-propagation mechanics; search operates over the *tenant* catalog with global fallback for adds.
- Phase 12/13: launch-catalog data project scheduled as a pre-implementation track (it does not consume implementation-week time).


<!-- ==================== phase-07-core-workflows.md ==================== -->

# Phase 7 — Core Workflows

Status: Approved (v1.0, consolidated)
Informed by: Phases 1–6. Domain decisions cited as D# (Phase 5 §4); principles as P#/I#/T#.

Each workflow states: trigger, the path (with its keyboard shape), failure moments and their fast paths, and the speed expectation. Exact keys and screen layouts are Phase 10; this document fixes *what the path is*, not what it looks like.

---

## W1. Cash sale — the workflow the product exists for

**Trigger:** customer at counter. **Frequency:** dozens to hundreds daily.

Path: focus is always in search → type a few characters or scan → best match highlighted, arrow/enter to select → quantity (defaults to 1; typing "2" then unit toggles strip/tablet where relevant) → line lands in cart, focus returns to search → repeat → payment key → amount tendered (defaults to exact) → change displayed large → commit → receipt prints, drawer opens, focus returns to search for the next customer.

- Never leaves the keyboard (I1). Scan-anywhere adds the scanned item (I1).
- Batch consumption and pricing are automatic (D1); if the consuming batch's price differs from the last-sold price, the line shows it plainly — no interruption.
- **Failure moments:** product not found → quick-add (W6) or refine search; stock shows zero but shelf has it → sale proceeds, pending layer records it (D2); customer disputes price → line price editable (logged as override, visible to owner, T1); connectivity drops mid-sale → nothing about the path changes (charter outcome; mechanics in Phase 8 ADR).
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

## W6. Quick item (unknown product mid-sale)

**Trigger:** shelf item not in catalog; customer waiting. Path: from an empty search result, one key → name + price → line lands in cart, sale continues. Creates a real product flagged *needs completion* (D3); appears in owner's daily view and completion queue. **Speed:** under 10 seconds. Guardrail: quick items cannot be silently forgotten — the queue nags until enriched or merged.

## W7. Purchase entry (receiving stock)

**Trigger:** distributor delivery with invoice; entered between customers, interruptible and resumable (a rush must not lose a half-entered invoice).

Path: new purchase → supplier (type-ahead, inline create) → invoice ref/date → lines: product search → quantity + bonus quantity (10+1 entered as 10 + 1, kept distinct — Phase 5 §3) → unit cost → expiry (always asked) → batch number (optional) → MRP/selling price confirmation (capture-at-receiving, Phase 1 §3; changed price flags the transition for the owner) → next line. Commit creates batches (D1 feeds from here).

- Unknown product → inline create with global-catalog assist (Phase 6): pick identity, confirm pack structure, price — richer than W6's quick-add because time pressure is lower.
- **Speed:** a 20-line invoice in a handful of minutes; per-line rhythm matters more than total.

## W8. Stock adjustment

**Trigger:** damage, expiry write-off, return to distributor, count correction. Path: adjustment → product → quantity ± → mandatory coded reason (+ optional note) → commit. Attributed, listed in owner's daily view without exception (T1). Count corrections resolve pending layers (D2). Salesman may adjust; visibility is the control, not permission friction (P7 balanced with T1).

## W9. Opening stock (onboarding)

A guided variant of W7 without a supplier invoice: walk the shelves, search/create products, enter quantity + expiry + price. Creates opening batches (reason-coded, D-model §3). Assisted by founder during onboarding (Phase 3: assisted setup is part of the trial). Import path (CSV from a competitor system) lands here too (Phase 6 §3.3). This workflow is the adoption gate — it must be genuinely fast, and its quality determines whether trust starts at day one or never.

## W10. Day close

**Trigger:** shutter down. Path: one screen, three numbers first — today's sales, expected cash in drawer, running udhaar total — then the exception list: discounts and overrides, adjustments, returns, quick items created, negative-stock incidents, cash movements (D5, T1). Owner counts the drawer against the expected figure; a recorded over/short entry closes the ritual. Nothing locks (D5). **Speed:** the three numbers in one glance; the ritual in two minutes.

## W11. Owner remote view

**Trigger:** owner's phone, any time. Mobile-usable (Phase 3 §5.5): today's three numbers, the exception list, low stock and near-expiry counts. Read-only in V1. This is what "check your shop from anywhere" in the sales pitch concretely is.

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


<!-- ==================== phase-08-architecture-stack-adrs.md ==================== -->

# Phase 8 — Architecture, Technology Stack & ADRs

Status: Approved (v1.0, consolidated)
Informed by: Phases 1–7. Satisfies exports from Phases 3 (§5), 5 (§7), 6 (§7), 7.

---

## 1. Architecture overview

One product, one codebase, one deployment: a **multi-tenant web application** — a single full-stack monolith serving every pharmacy, with a browser client engineered for counter resilience. No microservices, no separate API service, no mobile app (the owner's phone uses the same responsive web app). Every piece of this shape is chosen for a solo founder operating at near-zero marginal support cost (Phase 3) within a one-week build (charter constraint).

Three runtime surfaces, one system:
- **Counter client** (desktop browser, keyboard-first): the sale surface; locally resilient (ADR-3, ADR-4).
- **Owner surface** (any browser, phone-first layouts for W10/W11 views): read-heavy.
- **Server**: source of truth, all writes committed as immutable records (ADR-1), all derivations verifiable (ADR-8).

## 2. Technology stack

| Layer | Choice | Note |
|---|---|---|
| Framework | Next.js (App Router) + TypeScript | Founder's proven stack; speed via muscle memory (Phase 3 rationale) |
| UI | Tailwind + shadcn/ui | Restyled to Mehvar Pharmacy tokens (Phase 4 §5); no default-theme shipping |
| Database | PostgreSQL | Single instance, single schema, tenant-scoped rows (ADR-2) |
| Data access | Drizzle ORM | Thin, SQL-transparent — invariants live in SQL, not ORM magic |
| Hosting | Railway (app + Postgres) | Founder-operated already; automated backups mandatory (Phase 12) |
| Client resilience | PWA: service worker + IndexedDB | Scoped precisely by ADR-3/ADR-4 |
| Auth | Own session auth + counter PINs | Deliberate deviation from Clerk — ADR-7 |
| Printing | HTML/CSS 80mm receipts, kiosk silent print | ADR-6 |

No Redis, no queue infrastructure, no search service, no websockets in V1. Each absence is a P6 decision; the monolith plus Postgres covers every workflow in Phase 7 at single-pharmacy scale with headroom for hundreds of tenants.

## 3. Architecture Decision Records

### ADR-1: Append-only records, derived truth
**Decision:** All business events (Phase 5 §3) are immutable rows. No UPDATE/DELETE on committed records; corrections are compensating rows referencing their target. All balances and reports derive from records.
**Why:** This is Phase 5 §1 made physical — the entire trust posture (P4, T1–T4) as a schema property. Inherits Mehvar's proven ledger discipline (Mehvar ADR-2/ADR-18 lineage) scaled down.
**Consequence:** Phase 9 forbids mutable business columns; the invariant-6 rebuild test (Phase 5 §5) becomes implementable.

### ADR-2: Multi-tenancy — one database, row-scoped
**Decision:** Single Postgres, `tenant_id` on every tenant-owned row, enforced in the data-access layer with composite indexes; no schema-per-tenant, no database-per-tenant.
**Why:** Phase 3 requires multi-tenant day one; row scoping is the only variant compatible with one-week delivery and solo operations. Cross-tenant leakage is guarded by a single query-layer chokepoint (Phase 9 §5) rather than scattered WHERE clauses.
**Consequence:** Tenant export (Phase 3 §5.2) is a scoped dump; suspension is a tenant flag; global catalog tables live alongside, tenant-free (Phase 6 §2).

### ADR-3: Connectivity resilience — offline capture for money-critical events only
**Decision:** The counter client is a PWA that keeps working through disruptions for exactly: cash sales, udhaar sales, settlements, and quick-item creation (W1–W3, W6). These commit locally (IndexedDB, client-generated IDs) and sync automatically on reconnect, idempotently. Everything else — purchases, adjustments, reports, catalog edits — requires a connection and says so calmly.
**Why:** Charter demands uninterrupted *selling*, not an offline-first product; Phase 1 downgraded outages to exceptional. This scope keeps the hard problem small: append-only events with client IDs make sync conflict-free by construction — there is nothing to merge, only to deliver.
**Consequence:** The receipt prints from local state instantly (rule 3, Phase 7); unsynced-record count is a visible semantic state (I7) and surfaces in the daily view once synced late.

### ADR-4: Search — client-side index over the tenant catalog
**Decision:** The counter loads the tenant's catalog (products, prices, barcodes, customers) into a client-side index (IndexedDB-backed, in-memory served). Every keystroke searches locally: normalized tokens + fuzzy matching tuned for Roman-Urdu-flavored misspellings; barcode hits resolve locally. Global-catalog assist (W7 inline create) searches the server. The index refreshes on catalog changes and on session start.
**Why:** I2's near-instant expectation cannot depend on network round-trips per keystroke; a tenant catalog of a few thousand items is trivially memory-resident. This one decision simultaneously delivers speed, the offline sale path (ADR-3 needs local product data anyway), and server simplicity (no search infrastructure).
**Consequence:** Index staleness is bounded and harmless (prices confirmed at commit); Phase 10 designs the search interaction knowing latency is effectively zero.

### ADR-5: Batch consumption resolved server-side at commit/sync
**Decision:** Sale lines record product + quantity. FEFO batch allocation (D1) and pending-layer creation (D2) happen in the server transaction that commits the sale — for online sales immediately, for offline sales at sync ingestion. The client never allocates batches.
**Why:** Allocation needs authoritative batch state; doing it client-side would require syncing batch quantities outward and inviting conflicts. Server-side allocation makes offline sales and online sales identical at ingestion — one code path, one invariant set.
**Consequence:** A batch-price difference (D1's display duty) uses the client's last-known price at sale time; final allocation may adjust recorded margin, never the customer's charged price. Daily view shows any such variances (T1).

### ADR-6: Receipts — HTML/CSS 80mm, silent print via kiosk mode
**Decision:** Receipts render as print-CSS HTML sized for 80mm (58mm variant) thermal paper. The counter browser runs with silent-printing enabled (Chrome `--kiosk-printing`, configured at install); fallback is the normal print dialog. No print agent, no driver integration, in V1.
**Why:** T5 demands professional receipts every time; a custom local agent is a support liability (P8) a solo founder shouldn't ship in week one. Kiosk-mode silent print is a documented, one-time setup step that fits assisted onboarding (Phase 3).
**Consequence:** The install guide (Phase 12) owns printer setup; receipt templates are product surface (Phase 10); the FBR seam, if ever needed, wraps receipt generation server-side (Phase 1 §3).

### ADR-7: Auth — own sessions + counter PINs (no Clerk)
**Decision:** Tenant device login (long-lived session on the counter machine) with in-app user switching by PIN per salesman/owner; owner logs in normally from any device. Implemented in-house with standard session cookies and hashing; no third-party auth service.
**Why:** The counter is a *shared terminal* — the real auth act is "which person is acting now," a PIN-switch interaction no hosted auth product models well. Clerk (the Mehvar choice) adds per-MAU cost, a network dependency in the sale path (violating ADR-3), and no benefit for PIN ergonomics. This is a deliberate, justified deviation from the founder's default stack.
**Consequence:** Every record's attribution (T1) comes from the active PIN user; session security posture documented in Phase 12; password reset is founder-assisted at V1 scale (P6).

### ADR-8: Derived state — transactional running quantities, always rebuildable
**Decision:** `batches.qty_remaining` (and only that) is maintained transactionally as an optimization; every other figure computes on read from records via indexed SQL. A rebuild routine recomputes all running quantities from records; an automated verifier runs it against live values on schedule and after sync ingestion.
**Why:** Pure compute-on-read keeps FEFO allocation queries hot-path expensive; pure caching invites drift. One cached quantity with a mechanical verifier is the smallest honest compromise — and the verifier operationalizes Phase 5 invariant 6 as a running production check, not just a test.
**Consequence:** Phase 11's core suite = rebuild-equivalence tests; any verifier mismatch is a sev-1 signal (it means the trust promise broke).

## 4. Cross-cutting notes

- **Commit latency (Phase 7 rule 3):** online commits are one server transaction; offline commits are local and instant; nothing in a sale path awaits anything slower than the local machine except the final online commit, which the operator does not wait on for receipt printing (print from committed-local state; ADR-3).
- **Suspension (Phase 3 §5.3):** tenant flag gates writes; export endpoint remains open regardless.
- **Trial = production (Phase 3 §5.4):** trivially satisfied — a trial tenant is a tenant.
- **Future seams honored, unbuilt:** FBR (wraps ADR-6 server-side), local deployment (the monolith containerizes; Phase 3 Option E), multi-branch (tenant model extends; nothing in ADR-2 precludes it).

## 5. Exports

- Phase 9: implements ADR-1/2/5/8 as schema; client-ID idempotency columns from ADR-3.
- Phase 10: designs against zero-latency search (ADR-4), PIN switching (ADR-7), unsynced-state visibility (ADR-3), receipt templates (ADR-6).
- Phase 11: rebuild-equivalence suite (ADR-8), sync idempotency tests (ADR-3).
- Phase 12: kiosk print setup, backup policy, session security, verifier alerting.


<!-- ==================== phase-09-data-model.md ==================== -->

# Phase 9 — Data Model & Database Design

Status: Approved (v1.0, consolidated)
Implements: Phase 5 (domain), per ADR-1/2/3/5/8 (Phase 8). PostgreSQL.

Conventions first, tables second, enforcement third. Column lists name the semantically required fields; implementation may add mechanical columns (timestamps handled by convention) but may not add mutable business state to immutable tables.

---

## 1. Conventions

- **IDs:** UUIDv7 primary keys. Money-critical client-originated rows (sales, payments) carry the client-generated ID as the primary key — idempotent sync by construction (ADR-3).
- **Tenancy:** `tenant_id` on every tenant-owned row; every query passes through the tenant-scoped data-access chokepoint (§5). Global-catalog tables carry no tenant_id.
- **Attribution:** `created_by` (user id) + `created_at` on every business row (T1). Immutable tables have no `updated_at` — there are no updates.
- **Money:** integer paisa (`bigint`). No floats anywhere near money.
- **Quantities:** integer base units (Phase 5 §2) everywhere. Presentation converts.
- **Immutability:** business-event tables accept INSERT only (enforced §5). Products/customers/suppliers are reference entities: editable fields limited to identity/settings, never to anything a report derives from.
- **Soft archive:** reference entities carry `is_active`; nothing is ever deleted (referenced history must resolve).
- **Business day:** derived from `created_at` in tenant-local time (single timezone country); no stored day-close lock (D5). Over/short entries are cash movements with a reason code.

## 2. Reference tables

**tenants** — id, name, status (`active | suspended`), settings JSONB (receipt header/footer, timezone default Asia/Karachi, expiry horizons).

**users** — id, tenant_id, name, role (`owner | salesman`), pin_hash, password_hash (owner remote login, nullable for salesmen), is_active.

**products** — id, tenant_id, global_product_id (nullable FK, Phase 6 link), name, manufacturer, form, strength, formula_text, base_unit_name, pack_levels JSONB (ordered levels: `[{name:"strip",factor:10},{name:"box",factor:100}]` — factors in base units), default_price_per_base_unit, current_mrp_per_base_unit (reference ceiling, D4), min_stock_base_units (nullable), needs_completion boolean (D3), is_active.
*Pack levels as JSONB, not a child table: read-whole, written rarely, never queried relationally — the simplest honest shape.*

**product_barcodes** — id, tenant_id, product_id, barcode, unit_level_name. Unique (tenant_id, barcode).

**customers** — id, tenant_id, name, phone (nullable), is_active. Nothing else, by charter boundary.

**suppliers** — id, tenant_id, name, phone (nullable), is_active.

## 3. Event tables (append-only)

**purchases** — id, tenant_id, supplier_id, invoice_ref, invoice_date, note, created_by/at.
**purchase_lines** — id, tenant_id, purchase_id, product_id, qty_base, bonus_qty_base, unit_cost_paisa (per base unit; bonus units carry zero cost by derivation, not by column), expiry_date, batch_number (nullable), mrp_at_receiving_paisa, price_at_receiving_paisa.
*Each line materializes a batch (§4). Committing a purchase also updates the product's `default_price_per_base_unit` and `current_mrp_per_base_unit` to the received values — this is the "price capture at receiving" flow made concrete, a sanctioned reference-entity update (never an event mutation). The batch retains its own price for D1 variance display; the client search index (ADR-4) refreshes from the product default, staying simple and batch-unaware.*

**sales** — id (client-generated), tenant_id, receipt_number (client-generated at commit, device-scoped: short device prefix + per-device counter, e.g. `A-1042`; unique per tenant; works identically offline — resolves the conflict between server sequencing and ADR-3's print-from-local), customer_id (nullable; required iff credit_paisa > 0), subtotal_paisa, invoice_discount_paisa, total_paisa, cash_paisa, credit_paisa, change_paisa, origin (`online | offline_sync`), client_schema_version, client_committed_at, created_by/at.
CHECK: cash + credit = total; credit > 0 ⇒ customer_id set.

**sale_lines** — id, tenant_id, sale_id, product_id, qty_base, entered_unit_level, unit_price_paisa (per base unit as charged), line_discount_paisa, price_overridden boolean (T1 exposure).

**sale_line_allocations** — id, tenant_id, sale_line_id, batch_id (nullable), qty_base, unit_cost_paisa (from batch; null while pending).
*The D1/D2 mechanism: server-side FEFO writes one row per consumed batch (ADR-5); `batch_id NULL` rows are the pending layer, plus resolved_by (nullable FK to the purchase_line or adjustment that later resolved it) and resolved_at. Pending rows are the only "mutable" business rows in the system, and only their resolution fields may be set — once, forward-only.*

**payments** — id (client-generated), tenant_id, customer_id, amount_paisa, method (`cash`), sale_id (nullable: set when part of a sale commit; standalone = settlement W3), origin, client_schema_version, client_committed_at, created_by/at.

**sale_returns** — id, tenant_id, sale_id, cash_out_paisa, credit_reduced_paisa, reason_note, created_by/at.
**sale_return_lines** — id, tenant_id, sale_return_id, sale_line_id, qty_base, restock_batch_id (nullable — known source batch or write-off).

**adjustments** — id, tenant_id, product_id, batch_id (nullable), qty_base_delta (signed), reason (`damage | expiry_writeoff | distributor_return | count_correction | opening_stock`), note, created_by/at.
*Positive opening/count deltas materialize batches (§4).*

**cash_movements** — id, tenant_id, direction (`in | out`), amount_paisa, reason (`opening_float | owner_withdrawal | expense | over_short`), note, created_by/at.

## 4. Batches

**batches** — id, tenant_id, product_id, source (`purchase_line | adjustment`), source_id, batch_number (nullable), expiry_date (nullable only for non-perishables), unit_cost_paisa, price_per_base_unit_paisa, qty_received_base, **qty_remaining_base** (the single ADR-8 transactional cache), created_at.
Derivation contract: qty_remaining = qty_received − Σ allocations − Σ negative batch adjustments + Σ restocked returns. The rebuild/verifier routine (ADR-8) recomputes and compares; mismatch alerts.
FEFO order: expiry_date ASC NULLS LAST, created_at ASC.

## 5. Enforcement

1. **Immutability:** REVOKE UPDATE/DELETE on event tables for the app role; allocation-resolution and qty_remaining changes go through SECURITY DEFINER functions (or the single transaction path) — the only doors, and they only open forward.
2. **Tenant chokepoint:** one data-access module owns every query; it requires tenant context to construct. No raw queries outside it. (Row-Level Security noted as a hardening option post-V1; the chokepoint is the V1 guarantee, P6.)
3. **Sale commit = one transaction:** insert sale + lines + FEFO allocations + payment + decrement qty_remaining. Offline ingestion runs the identical function per record, idempotent on client ID (ADR-5's "one code path").
4. **Checks in schema, not just code:** the CHECK constraints above, qty_base > 0 on lines, amount_paisa > 0 on payments, signed-delta reason consistency on adjustments.
5. **Indexes (hot paths):** (tenant_id, created_at) on all event tables; (tenant_id, product_id, expiry_date) on batches; (tenant_id, customer_id) on sales/payments; (tenant_id, barcode) unique; (tenant_id, needs_completion) partial on products; (tenant_id, receipt_number) unique.

## 6. Global catalog tables (tenant-free; Phase 6)

**global_products** — id, name, manufacturer, formula_text, form, strength, pack_levels JSONB, reference_mrp_paisa (nullable), quality (`verified | reference`), source (`drap_seed | curated | promoted`).
**global_barcodes** — id, global_product_id, barcode, unit_level_name.
**catalog_proposals** — id, tenant_id (provenance), type (`barcode | new_product | mrp_signal`), payload JSONB, status (`pending | accepted | rejected`), reviewed_at.
*Identity only — no tenant pricing, no sales data, ever (Phase 6 §2 line).*

## 7. Derived views (compute-on-read; ADR-8)

Defined as SQL views/queries, not tables: product stock (Σ batch qty_remaining + pending exposure), customer balances (Phase 5 invariant 3), daily summary (W10's three numbers + exception list: overrides, discounts, adjustments, returns, quick items, negative-stock incidents, cash movements, late-synced records), near-expiry and low-stock lists, margin reporting (allocations' cost vs. charged price — honest about bonus units and pending allocations).

## 8. Export shape (Phase 3 §5.2)

One tenant-scoped dump: every table above filtered by tenant, as CSV-per-table in a zip, generated on demand. No format cleverness; completeness is the feature.

## 9. Exports to later phases

- Phase 10: daily-summary view is W10/W11's contract; needs_completion queue feeds the completion UI.
- Phase 11: §4 derivation contract and §5.3 idempotency are the highest-value test targets.
- Phase 12: backup cadence for this single database is the business-continuity story (P8); verifier alerting wiring.


<!-- ==================== phase-10-ia-navigation-screens.md ==================== -->

# Phase 10 — Information Architecture, Navigation & Screens

Status: Approved (v1.0, consolidated)
Informed by: Phases 4 (identity, I-principles), 5–7 (domain, workflows), 8 (ADR-3/4/6/7)

This document fixes the screen inventory, navigation model, keyboard map, search interaction, the sale screen's layout logic, design tokens, and receipt spec. Pixel-level execution happens in implementation against the frontend-design discipline; nothing here is decoration — every choice traces to a workflow or principle.

---

## 1. Structural idea: one home, everything one key away

The sale screen is home (Phase 7 rule 1). Every other surface is a sortie: reached by one global key, exited back to Sale with Esc. There is no dashboard-first posture for the counter — the counter's dashboard is the cart. Persistent chrome is minimal: a slim top bar (pharmacy name, active user chip with PIN-switch, connectivity/unsynced badge) and a bottom **key bar** showing the global function keys — the visible-shortcuts principle (I1) rendered as furniture, and a deliberate echo of the DOS-era POS foot rail that Gen-1 (MARS-trained) salesmen already trust.

## 2. Screen inventory

**Counter surfaces (desktop, keyboard-first):**
1. **Sale** (home) — W1, W2, W5, W6 in one surface; payment as overlay
2. **Settle Udhaar** — overlay (from anywhere); W3
3. **Returns** — W4: find sale → select lines → confirm
4. **Purchases** — list + entry form; W7 (resumable drafts — the only draft state in the product)
5. **Products** — catalog list, product detail/edit, completion queue (D3), barcode management
6. **Customers** — list with balances, customer detail = derived ledger (T4 expansion view)
7. **Stock** — low stock, near expiry (30/60/90 tabs), adjustment entry (W8), pending-layer/negative incidents
8. **Day & Reports** — W10 day view (three numbers + exception list + count-drawer ritual), then daily/weekly/monthly/overall report tabs
9. **Settings** — receipt header/footer, users & PINs, printer setup guide, export (Phase 3 §5.2 lives here, owner-only)
10. **Login / PIN switch** — device login once (ADR-7); PIN overlay thereafter

**Owner phone surface (responsive views of the same app, read-only):**
- **Today** (three numbers + exceptions), **Stock** (low/near-expiry counts and lists), **Udhaar** (balances, largest first). Bottom-tab navigation, numerals huge (I6). This is W11 and the concrete pitch artifact ("check your shop from anywhere").

## 3. Global keyboard map

Visible in the key bar always (I1). Letters chosen for reach; function keys for surfaces:

- **F1** Sale (home) · **F2** Purchases · **F3** Products · **F4** Customers · **F5** Day & Reports · **F6** Stock · **F7** Returns · **F8** Settle Udhaar · **F9** Adjustment · **F10** PIN switch · **Esc** back to Sale / close overlay
- Barcode scans are keyboard input everywhere sensible: on Sale they add the item; on Products they find it; on Purchase entry they fill the line's product (I1 "the scanner is a keyboard").

## 4. Sale screen — the 80% surface

Layout logic (not pixels): three zones with fixed roles.

- **Search bar, full width, top.** Focus lives here (rule 1). Beneath it, the results dropdown when typing.
- **Cart, left ~62%.** A dense table (I7): line = name + natural-language quantity ("1 strip + 4 tab", W5) + unit price + line total; selected line editable in place (arrow up into cart, +/- for qty, Delete removes with strike-through until commit, price edit logged as override).
- **Right rail ~38%.** Totals stacked large-to-small: TOTAL in the display's biggest numerals (I6), then discount, then item count. Below: customer strip (empty = cash walk-in; F8 with items in the cart attaches a customer for udhaar, showing name + current balance — exposure visible before extending more, W2; F8 with an empty cart opens the Settle Udhaar overlay, W3 — one key, two contexts, both meaning "customer + money"). Bottom: the two commit actions — **Cash (Enter on payment overlay)** dominant, **Udhaar** secondary (I4: one primary action).

**Payment overlay (Space or F12 from cart):** tendered amount (numpad-first, defaults exact), change rendered enormous, Enter commits → receipt prints (ADR-6) → overlay closes → focus returns to search, cart clears. Split cash/credit lives here when a customer is attached.

**Quantity grammar (I3):** `3*pana` in search = quantity 3 of the selected result; bare selection = qty 1; Tab on the qty cell cycles unit levels (tab/strip/box) where the product defines them.

**States that must be visible calmly (I7):** consuming-batch price change (D1 — line shows "price updated" chip), zero/negative stock (line proceeds, amber chip, D2), unsynced count in top bar (ADR-3), quick-add result row when search is empty (W6: one key → name+price mini-form inline).

## 5. Search interaction spec (ADR-4's front half)

- Results begin rendering from the first keystroke; matching is local, so latency is imperceptible (I2).
- Ranking: exact/starts-with on name → word-boundary match → fuzzy (misspelling-tolerant, tuned for Roman-Urdu transliteration drift: "panadol/pandol/penadol") → formula/salt match (labelled as such — substitution support, Phase 1 §5).
- Result row: **name + strength** (primary), form + manufacturer (secondary), **price** (right-aligned, tabular), stock badge (green/amber/zero-red only when meaningful — semantic color rule).
- Arrow keys navigate, Enter adds, typing continues to refine. No mouse required ever; mouse works anyway.
- Barcode hit bypasses ranking: instant add (unit level per barcode mapping). Unknown barcode → inline prompt: link to product (type-ahead) or quick-add (W6/Phase 6 §4 loop).
- Empty results → quick-add row is the first-class result (P2), not an error state.

## 6. Design tokens (finalizing Phase 4 §5 direction)

- **Palette:** `--green-900 #0B3B2C` (anchor: headers, key bar), `--green-600 #11704F` (primary actions), `--green-100 #E4F1EA` (selection/success tints), `--ink #1B1F1D` (text), `--paper #FAFAF7` (surfaces), `--line #E3E4DF` (rules), `--amber #B7791F` (caution: near-expiry, negative stock, unsynced), `--red #B3372E` (expiry/danger only). Semantic colors appear **only** with meaning (I7); green family carries brand, never alarm.
- **Typography:** Inter (variable), `font-feature-settings: "tnum"` globally on numerals; scale ~13px table base / 15px controls / totals at display sizes. Numerals are the brand (Phase 4): every money and quantity column right-aligned tabular.
- **Density:** compact rows in cart and tables (36px), generous hit targets on actions (44px+), high contrast throughout (bright-shop legibility, Phase 4 §5).
- Tokens ship as CSS variables; shadcn components restyled to them — no default-theme shipping (Phase 8 §2).

## 7. Receipt spec (ADR-6's product surface)

80mm primary / 58mm variant, print-CSS: header = tenant name, phone, address (settings); body = lines (name, qty natural language, amount), subtotal/discount/total; payment = cash/tendered/change or udhaar split; **udhaar receipts and settlements print the mini-statement** (previous balance → this transaction → new balance) — the dispute-ender (T4/T5, W3); footer = receipt number (device-scoped, Phase 9 §3 — identical online and offline), date/time, salesman name, configurable thank-you line, and a modest **"Mehvar"** mark (brand compounding, Phase 4 §6). Monospace-adjacent numeral alignment; no logos-as-images in V1 (thermal dithering risk, P6).

## 8. Empty, loading, error postures

Empty states teach the key that fills them ("F2 — enter your first purchase"). Loading is skeleton-quiet; nothing spins over the sale path (commits are local-fast, ADR-3/§4.4 of Phase 8). Errors follow I5: say the next action, plainly; never a code, never blame. Disconnection posture: purchases/reports/catalog say "needs internet — selling keeps working" (ADR-3's calm sentence).

## 9. Exports

- Phase 11: keyboard map and search ranking are test surfaces (the W1 E2E path asserts the key sequence verbatim); tokens enforced by lint (no raw hex in components).
- Phase 12: printer setup guide content pairs with ADR-6 kiosk configuration; Settings→Export wiring.
- Phase 13: build order within screens — Sale search+cart → payment+receipt → purchases → the rest (mirrors W-order).


<!-- ==================== phase-11-engineering-standards.md ==================== -->

# Phase 11 — Engineering Standards & Development Workflow

Status: Approved (v1.0, consolidated)
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


<!-- ==================== phase-12-deployment-operations-security.md ==================== -->

# Phase 12 — Deployment Operations, Security & Backups

Status: Approved (v1.0, consolidated)
Informed by: Phases 3 (commercial), 8 (ADRs), 9 (schema), 11 (workflow). Governed by P8 — the shop opens tomorrow.

This document answers P8's test directly: *describe the worst thing that can happen on our side tonight, then show why the counter still sells at 9am.*

---

## 1. Topology & environments

**Production:** Railway — one Next.js service, one PostgreSQL instance, one region. Custom domain under the parent brand (Phase 4 §6). TLS terminated at the platform; HTTPS only, HSTS on.

**Environments:** `local` (developer machine), `staging` (Railway, own database, seeded demo pharmacy — doubles as the sales demo environment per Phase 11 §5), `production`. Three, no more; each additional environment is maintenance a solo founder pays for weekly.

**Configuration:** environment variables only, held in Railway; no secrets in the repository, no `.env` committed. Secret rotation is a documented manual procedure at this scale (P6).

## 2. Release procedure (P8 made operational)

1. **Release window:** deploys happen in the tenant base's lowest-traffic window (currently deep night, after midnight PKT — many pharmacies trade past 11pm) — never during rush hours. Revisit the window if 24-hour pharmacies onboard; ADR-3's offline capture means even a mistimed deploy cannot stop selling, but the rule stands anyway. This is a rule, not a preference.
2. **Forward-only migrations, committed with their feature** (Phase 11 §4). Every migration must be additive-safe: new columns nullable or defaulted, no destructive column drops in the same release that stops using them (drop in a later release, once verified). Deploys therefore never require a maintenance window.
3. **Pre-deploy gate:** typecheck + full test suite green, `db:reset && db:migrate && db:seed` clean from zero, W1 E2E passing (Phase 11 §3.5).
4. **Post-deploy verification:** run the ADR-8 rebuild verifier against production immediately after migration; confirm the sale path with one test transaction on the demo tenant; confirm receipt renders.
5. **Rollback posture:** application rollback is a platform redeploy of the previous image (minutes). Because migrations are additive-safe, the previous image runs against the migrated schema — this is *why* additive-safety is mandatory rather than tidy. Data is never rolled back; append-only records make forward correction the only honest repair (ADR-1).
6. **Client version skew:** the counter client may be running yesterday's build when a deploy lands. Offline-captured records carry client IDs and a schema version; ingestion accepts prior-version payloads for at least one release cycle (ADR-3 idempotency plus tolerance). A hard-refresh prompt appears only between sales, never mid-cart.

**P8 answer:** the counter client holds its catalog index locally and can capture sales without us (ADR-3/4). If our service is down at 9am, the pharmacy opens, sells, prints, and syncs later. If our latest release is broken, the previous image is minutes away and the schema still accepts it. Nothing about tomorrow's trading depends on tonight going well.

## 3. Backups & recovery

The pharmacy's entire business lives in one database; backup is a trust feature (T3), not an IT chore.

- **Platform backups:** Railway automated daily snapshots, retained per plan.
- **Independent nightly dump:** `pg_dump` to separate object storage outside the hosting provider, 30-day retention. One provider failure must not take the backups with the database — this is the single most important line in this document.
- **Targets:** RPO ≤ 24 hours for catastrophic loss (realistically minutes, since counter clients retain unsynced local records and the loss window is server-side only); RTO ≤ 4 hours to a restored, verified service.
- **Restore drill:** performed once before first paying customer and quarterly thereafter — restore latest dump into a scratch database, run the ADR-8 verifier, confirm invariants (Phase 5 §5) hold. An untested backup is not a backup.
- **Tenant self-service export** (Phase 3 §5.2, Phase 9 §8) is always available, in every payment state. It is simultaneously the trust argument, the retention ethic, and a customer-side backup we don't have to operate.

## 4. Monitoring & the verifier

- **Error tracking** (Sentry or platform-equivalent) with a hard rule: any exception on the sale commit or sync ingestion path pages the founder. Everything else is a queue reviewed daily.
- **Uptime check** on the sale surface, 5-minute interval, alerting to phone.
- **ADR-8 rebuild verifier on schedule** (nightly) and after every sync-ingestion batch. A mismatch is sev-1: it means a derived number disagreed with the records, which is precisely the promise the product sells (P4/T4). Alert loudly, investigate before anything else ships.
- **Business-health glance** (founder-side, weekly): tenants active, sales volume per tenant, unsynced-record ages, pending-layer backlog, quick-item completion queue depth. Unsynced ages and pending backlogs are early warnings of a pharmacy quietly falling out of the system — the churn signal that matters more than logins.

## 5. Security posture

Scaled honestly to a two-role, single-shop product holding no clinical data.

- **Tenant isolation:** the `scoped.ts` chokepoint (ADR-2, Phase 11 §1) is the guarantee; a test asserts that no query path constructs without tenant context. Postgres RLS remains the documented post-V1 hardening step.
- **Sessions:** device-bound long-lived session cookie for the counter (HttpOnly, Secure, SameSite=Lax), short-lived sessions for owner remote logins. PIN switching (ADR-7) changes the acting user within the device session; PINs are hashed (Argon2id), rate-limited, lockout after repeated failures with owner override.
- **Authorization** is enforced server-side per role on every mutation — never by hiding UI. Salesman scope per Phase 5 §2.
- **Data minimization as a genuine asset:** the product stores customer *name and phone only* (charter boundary) and no health or prescription data whatsoever. This is worth stating in sales conversations — there is no sensitive patient dataset to leak, by design.
- **Transport & storage:** HTTPS only; database encrypted at rest by the platform; backup dumps encrypted before upload to independent storage.
- **Counter machine hygiene** (documented in the setup guide, not enforceable by us): dedicated browser profile, no shared personal browsing, screen lock, UPS. Physical access to the counter machine is the realistic threat model, which is exactly why PIN attribution exists (T1).
- **Dependencies:** lockfile committed; monthly patch review; no unmaintained packages in the money path.

## 6. Counter setup guide (onboarding artifact)

A one-page, screenshot-led document the founder or channel partner follows per pharmacy:

1. Hardware check: PC minimums, 80mm (or 58mm) thermal printer, USB scanner, UPS.
2. Printer install; print a test receipt from the app.
3. Browser: dedicated profile, `--kiosk-printing` shortcut created (ADR-6), app pinned, PWA installed, autostart on boot.
4. Scanner: verify it emits Enter after the code; scan test.
5. Tenant setup: receipt header/footer, users and PINs, expiry horizons.
6. Opening stock (W9) — assisted, the adoption gate.
7. First live sale together, with the salesman driving.
8. Hand over: WhatsApp support number, the one-page keyboard cheat sheet (Phase 10 §3) printed and taped to the counter.

## 7. Support model

WhatsApp-first, founder-answered, at V1 scale — the channel this market already lives in. Response expectation set explicitly at sale: same-day for questions, immediate for anything blocking selling. Every support contact is logged in one place with its cause; recurring causes become product fixes, not FAQ entries (P5/P6 discipline). Remote assistance uses the owner surface plus screen-share; no remote-control software installed on counter machines.

## 8. Incident posture

Severity 1 = selling is blocked, or a derived number disagrees with records (verifier mismatch). Response: acknowledge to affected pharmacies by WhatsApp within minutes, restore selling first (the offline path usually means selling never stopped — say so plainly, it is reassurance backed by architecture), diagnose second. Corrections to data are always compensating records (ADR-1/T2), never edits, even during incidents. Every sev-1 gets a written note to self: cause, fix, and the test or guard that prevents recurrence.

## 9. Exports

- Phase 13: restore drill and printer setup are scheduled items in the launch sequence, not implied work.
- Master plan: this document owns every operational promise the commercial strategy makes (Phase 3 §5.3 suspension outcome, §5.2 export, uptime posture behind the subscription).


<!-- ==================== phase-13-implementation-roadmap.md ==================== -->

# Phase 13 — Implementation Roadmap, Risks & Future Evolution

Status: Approved (v1.0, consolidated)
Informed by: all prior phases. Consumes Phase 11 §4 (session discipline), Phase 7 (W-order), Phase 10 (screen order).

---

## 1. Sequencing logic

Three rules order this plan:

1. **Riskiest architecture first, while context is fresh.** The sale commit transaction (FEFO allocation + pending layer) and the offline sync path are the two decisions that can quietly ruin the product. Both land by mid-week, adjacent to each other, not on the final day.
2. **Every day ends demo-able.** The product must be showable from Day 3 onward, because demos are the sales channel and a demo-able build is a truthful progress signal (Phase 11 §4 definition of done).
3. **Tests land with their feature, never after.** Rebuild-equivalence ships the same day as `commitSale` (Phase 11 §5).

## 2. Pre-implementation track (runs in parallel with planning — starts now)

These do not consume implementation-week hours and are the most common cause of a slipped launch if left late:

- **Catalog curation (Phase 6 §3):** the hand-verified head of ~1,500–3,000 fast movers with pack structures and MRPs, sourced from the reference pharmacy's shelves and a distributor price list. **This is the long-lead item.** DRAP seed import can follow post-launch.
- **Brand assets:** wordmark treatment for Mehvar Pharmacy, receipt mark, tokens confirmed against Phase 10 §6.
- **Hardware:** reference pharmacy's printer and scanner models identified and tested against ADR-6 kiosk printing before Day 1 — printer surprises are the classic week-one derailment.
- **Infrastructure:** Railway project, Postgres, staging, domain, error tracking, backup storage bucket.

## 3. The build week

Each day: goal, deliverables, tests landing, and its risk note.

**Day 1 — Foundation.**
Repo scaffold (Phase 11 §1 structure), Drizzle schema verbatim from Phase 9, `scoped.ts` tenant chokepoint, migrations + seed (demo pharmacy: ~50 curated products with real pack structures, one customer with balance, opening batches), design tokens and app shell (top bar, key bar, F-key registry), auth: device login + PIN switch (ADR-7).
*Tests:* chokepoint enforcement; PIN hash/lockout.
*Done when:* `db:reset && db:migrate && db:seed` yields a logged-in shell with a switchable user.
*Risk:* schema churn later is expensive — Phase 9 is implemented as written, not improvised.

**Day 2 — Catalog & search.**
Products/barcodes CRUD, pack-level editing, tenant catalog list, client-side index build (ADR-4), ranking ladder with transliteration-tolerant fuzzy matching, barcode resolution, search UI per Phase 10 §5.
*Tests:* ranking table incl. "pandol"→Panadol, formula matches, barcode unit-level mapping.
*Done when:* typing three characters returns correctly ranked results instantly against the seeded catalog.
*Risk:* fuzzy tuning is a rabbit hole — time-box it; the ranking table defines "good enough."

**Day 3 — Sale core (the heart).**
`commitSale` as one transaction: lines, FEFO allocation, pending layer on shortfall, discounts, override flags, cash split (Phase 9 §5.3); cart UI, quantity grammar, unit-level cycling, in-place line edit.
*Tests:* **rebuild-equivalence suite** (property-style, the crown), transaction semantics, FEFO ordering with NULLS LAST, pending-layer creation.
*Done when:* a keyboard-only cash sale commits, stock derives correctly, and the verifier agrees.
*Risk:* the highest-consequence day in the week. If anything slips, it slips *into* this day, never out of it.

**Day 4 — Payment, receipt, udhaar.**
Payment overlay (tendered/change, split cash-credit), device-scoped receipt numbering (Phase 9 §3), receipt render + kiosk silent print (ADR-6, Phase 10 §7), udhaar sale with inline customer create (W2), settlement with mini-statement receipt (W3), customer balance derivation.
*Tests:* split invariants (cash+credit=total), balance derivation, settlement idempotency.
*Done when:* W1, W2, W3 complete end-to-end on real hardware with a printed receipt in hand.
*Risk:* thermal printing is the classic surprise — hardware was tested pre-week (§2) precisely to keep it a half-day, not a day.

**Day 5 — Offline capture & sync.**
PWA shell + service worker, IndexedDB local queue for W1/W2/W3/W6, instant local commit and print-from-local, idempotent server ingestion through the *same* domain writer (ADR-3/5), unsynced badge and late-sync surfacing.
*Tests:* replay-N-times idempotency, ingestion equivalence (offline-origin sale produces byte-equivalent domain effects to an online one), disruption simulation mid-cart.
*Done when:* network disabled → sell, print, re-enable → everything reconciles with no user action.
*Risk:* second-highest of the week; placed adjacent to Day 3–4 while the commit contract is fresh in context.

**Day 6 — Purchases, batches, stock operations.**
Purchase entry with resumable drafts (W7): bonus quantities, expiry always requested, MRP/price capture-at-receiving, batch materialization; adjustments with coded reasons (W8); opening stock guided flow + CSV import (W9); pending-layer resolution on purchase/count-correction; low-stock and near-expiry lists (W12).
*Tests:* batch materialization, bonus-cost honesty in margin math, pending resolution, adjustment reason integrity.
*Done when:* a 20-line invoice enters at working rhythm and resolves a pending shortfall from Day 3.

**Day 7 — Day close, reports, owner surface, export.**
W10 day view (three numbers, exception list, drawer count with over/short), cash movements, daily/weekly/monthly/overall reports, owner phone views (W11), returns (W4), settings (receipt config, users/PINs, export per Phase 9 §8).
*Tests:* daily-summary correctness against seeded scenarios; export completeness.
*Done when:* the owner's three questions answer in one glance on a phone.

**Day 8 (buffer & hardening — plan for it, don't pretend otherwise).**
E2E W1 keyboard path, token lint pass, empty/error posture sweep (Phase 10 §8), backup + restore drill (Phase 12 §3), verifier scheduling and alerting, production deploy, setup-guide dry run on the reference pharmacy's actual hardware.

**If a day slips, this is the cut order** (decided now, calmly, rather than at 2am): weekly/monthly report tabs → CSV import in W9 → returns without receipt → near-expiry 60/90 horizons → quick-item completion queue polish. Never cut: rebuild-equivalence tests, offline capture, receipt printing, exception visibility.

## 4. Post-launch: first 30 days

Week 1 — founder onsite/on-call during counter hours at the reference pharmacy; log every hesitation and workaround (this is the validation the charter promised in place of pre-development field study). Week 2 — fix the friction found, no new features. Weeks 3–4 — second and third pharmacy onboarding, catalog head expansion from real sales data, retire the paper registers (the charter's trust criterion). Refinements to workflows and UX are expected here and are safe by design (Phase 2 Post-Launch Validation).

## 5. Risks & trade-offs accepted

| Risk | Exposure | Mitigation / accepted trade-off |
|---|---|---|
| Catalog head not ready | Empty-feeling demos, slow onboarding | Pre-implementation track (§2) started now; launch gate is the curated head, not the full seed |
| Thermal printing friction | Day-4 slip; support burden | Hardware tested pre-week; kiosk print, no custom agent (ADR-6); setup guide owns it |
| Offline sync bugs | Lost or duplicated sales — existential for trust | Append-only + client IDs make sync delivery-only; idempotency tested Day 5; same domain writer as online (ADR-5) |
| Verifier mismatch in production | The core promise breaks | Nightly + post-ingestion verification, sev-1 posture (Phase 12 §4) |
| One-week estimate optimistic | Rushed money paths | Day 8 buffer planned; pre-decided cut list (§3); tests-with-feature is non-negotiable |
| Crowded market, thin differentiation | Me-too positioning at me-too price | Experience-quality thesis (Phase 1 §4); demo-able from Day 3 to test the five-minute gap early |
| Solo support load | Founder becomes the bottleneck | Cloud single deployment (Phase 3), WhatsApp support, recurring causes become fixes not FAQs |
| Negative-stock model misread as sloppiness | Owner distrust in demos | Explain as designed exposure (D2); exception list makes it a feature — never blocks a sale, never hides one |

**Trade-offs consciously taken:** row-scoped multi-tenancy over stronger isolation (chokepoint now, RLS later); one cached quantity over pure derivation (verifier as the honesty mechanism); client-side search over a search service (speed and offline for free, index staleness accepted); no billing automation (manual founder-side tracking); two roles only; single branch; kiosk printing over a print agent.

## 6. Future Considerations (consolidated ledger)

Deferred deliberately, with the phase that raised each:

- **Commercial/deployment:** containerized local deployment for chains or compliance-driven buyers (P3-E); multi-branch and multi-terminal pricing tiers (P3); hardware bundle partnership (P3); billing automation (P3 §5.6); tiering beyond one plan (P3).
- **Regulatory:** FBR digital invoicing as a paid add-on when customers cross Tier-1 thresholds, wrapping receipt generation server-side (P1 §3, ADR-6).
- **Architecture:** Postgres RLS hardening (ADR-2, P12 §5); background job infrastructure if verification or catalog work outgrows scheduled runs; websocket live updates for multi-terminal counters.
- **Product:** supplier payables and purchase orders (P5 §6); expenses beyond drawer cash movements; prescription capture; loyalty or customer tiers; WhatsApp receipt delivery and udhaar reminders; multi-branch stock; distributor return workflows beyond reason-coded adjustments; barcode label printing.
- **Catalog:** automated DRAP price-notification ingestion; contribution tooling beyond the founder-reviewed proposal queue (P6 §5).
- **Platform:** Urdu-script localization; native mobile app (responsive web serves V1); multi-currency (irrelevant until outside Pakistan).

Nothing in this ledger is promised. Each item re-enters planning only when a named customer need and a business case exist (P6).

## 7. Definition of V1 complete

- W1–W12 operable by keyboard at the counter, on real hardware
- Rebuild-equivalence suite green; production verifier scheduled and quiet
- Selling survives a connectivity disruption with no user action and no data loss
- Receipts print correctly for sales, udhaar, settlements, and returns
- Owner's three questions answered on a phone in one glance
- Backup running, restore drill passed, export working
- Reference pharmacy onboarded with opening stock entered and its first live day sold through the system
