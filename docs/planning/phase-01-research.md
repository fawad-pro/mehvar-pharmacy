# Phase 1 — Market, Competitive & Operational Research

Status: Draft for review
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
