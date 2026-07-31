# Research note — FBR / tax-authority compliance

**Status: open research, not a decision.** No ADR exists yet. Nothing in this
note authorizes any code, schema, or scope change. It exists so the thinking
survives the gap between this session and whichever session resumes it —
intended to be **after Day 8**.

**Do not read this as a plan.** It is a record of a discussion: the question
that triggered it, three viewpoints, where they agree and disagree, what's
been verified against what's been assumed, and what would need to be true
before a decision is worth making. A future session should be able to read
this document alone and pick the thread back up without re-deriving any of
it.

---

## 1. Why this discussion happened

Raised by the founder before committing to the Days 6–8 roadmap, as a
forward-looking architecture question rather than a Day 6–8 feature request:
should Mehvar support FBR (Federal Board of Revenue) POS/e-invoicing
integration, and if so, when and how — without compromising the product's
core bet, which is that **trust is the product's most valuable feature** and
the checkout must stay fast and cognitively effortless.

The founder deliberately sought more than one viewpoint before acting:

1. A prior consultation with Gemini (recommendation summarized below).
2. This session's own architecture review, grounded in the FBR/PRAL technical
   documentation the founder linked.
3. A further round of discussion-only architectural points the founder wanted
   preserved regardless of which way the eventual decision goes.

The founder's explicit instruction for that review: *"Please don't jump into
code. Treat this as a product architecture and roadmap discussion."* This
document is the artifact of that instruction, carried forward.

## 2. The founder's stated goals and concerns

Quoted/paraphrased from the founder directly, as the frame everything else in
this note is judged against:

- Trust is the product's most valuable feature.
- The software should feel calm, simple and effortless.
- Capture the sale first; never lose a sale.
- Offline-first where appropriate.
- Immutable ledger.
- No surprising automation.
- Capability-driven architecture rather than product variants.
- Keep the checkout flow extremely fast and cognitively light.
- Explicit worry: Mehvar should not become *"the software that reports your
  sales to the government"* — adoption anxiety in a market of independent,
  often informally-run neighborhood pharmacies is a real and specific risk,
  not a generic privacy concern.
- Counter-worry: don't paint the architecture into a corner by ignoring a
  capability that larger pharmacies or future regulation may require.
- Wants the difference between **FBR readiness** and **FBR integration**
  taken seriously as a possible answer in itself, not just a phasing detail.
- Explicitly did not want Gemini's recommendation, or this session's, treated
  as the answer — asked for challenge, not confirmation.

## 3. What the official documentation says — and what could not be verified

Three sources were provided:

- FBR Digital Invoicing technical documentation index —
  `fbr.gov.pk/technical-documentation-di/163085/173959`
- PRAL Technical Documentation for Digital Invoicing API (PDF)
- PRAL Digital Invoicing API Specification v1.2.2 (PDF)

**This session could not read any of the three directly.** The sandboxed
environment's network proxy returned HTTP 403 on `fbr.gov.pk` and
`download1.fbr.gov.pk` for both the fetch tool and direct `curl` — a policy
denial at the proxy, not a document-access problem. This is a material
limitation on everything below and is why the founder's instruction to
distinguish verified facts from assumptions matters so much here.

What follows was reconstructed from public secondary sources (search results,
tax-advisory summaries, news coverage) rather than the primary PDFs. Each
claim below should be treated as **"secondary-sourced, needs primary
verification,"** not as confirmed. Sources are listed at the end of this
document.

### 3.1 Two different regimes are being conflated

The founder's framing ("FBR POS") and the linked documentation ("Digital
Invoicing") turned out, on inspection, to name two different regimes with
different scope:

| | FBR POS Integration | Digital Invoicing (the linked docs) |
|---|---|---|
| Who it applies to | **Tier-1 retailers** only (Sales Tax Act 1990, s.2(43A)) | Sales-tax-**registered** persons generally |
| Tier-1 criteria (secondary-sourced) | Part of a chain of stores; retail in an air-conditioned shopping mall/plaza (excluding kiosks); electricity bill >Rs 1.2m in the preceding 12 months; wholesaler-cum-retailer; shop area ≥1000 sq ft | Sales-tax registration status |
| Regulatory vehicle | Long-standing | SRO 69(I)/2025 → SRO 709(I)/2025 → phased rollout under SRO 1852(I)/2025, final cohort reportedly live 31 Dec 2025 |

**This distinction has not been confirmed against the primary PDFs** and is
the single most consequential unverified claim in this document — if it is
wrong, several downstream conclusions below need revisiting.

### 3.2 Scope as it may apply to a neighborhood pharmacy (unverified)

Two claims, both secondary-sourced, both load-bearing for the "not urgent"
conclusion this session reached:

- **Medicines are reported as exempt from sales tax** under the Sixth
  Schedule (secondary-sourced framing: sales tax applies to goods *"except
  computer software, poultry feeds, medicines and unprocessed agricultural
  produce"*).
- **Sales-tax registration thresholds** reported: retailers under roughly
  Rs 5m turnover exempt from registration; a general registration bar around
  Rs 10m taxable turnover.

If both hold, a typical neighborhood pharmacy's revenue is dominated by
*exempt* supplies (medicines), its *taxable* slice (cosmetics, toiletries,
surgical sundries) is thin, and it is plausibly neither registered nor
required to register — which would put it outside both regimes' scope today.
**This has not been confirmed by a tax practitioner and is the founder's
explicit condition for closing this question (§7).**

### 3.3 Technical/architectural provisions (unverified, secondary-sourced)

- **Offline handling**: secondary sources describe a local queue during
  network outages with auto-sync on reconnect, and a stated requirement that
  invoices reach FBR within a **24-hour** window.
- **Invoice identity**: each invoice is reported to receive an IRN (Invoice
  Reference Number) from FBR; an invoice is described as not valid without
  one.
- **Mandatory fields** (secondary-sourced): buyer NTN/CNIC, buyer business
  name, province/address; per-line HS code, quantity, UoM, sales value
  excl. tax, tax rate; for unregistered/walk-in buyers, NIC or NTN is
  reportedly still required per Sales Tax Act s.23(1)(b), sometimes described
  in vendor material as satisfiable with a placeholder like "Walk-in
  Customer" — **this specific point (whether an ordinary walk-in pharmacy
  sale genuinely requires a captured CNIC) is one of the open questions in
  §7 and was not confirmed.**
- **Corrections**: invoices are reported to lock after a window (some
  secondary sources say 72 hours), after which corrections must be issued as
  credit/debit notes referencing the original rather than edits.

### 3.4 A version-currency flag, worth noting explicitly

While searching for secondary sources, this session's search results
surfaced a reference to **"Technical Documentation for DI API V1.12"**
(dated 2025), while the founder's third link is **v1.2.2** (dated 2024).
**Whether the founder's linked documents are still current has not been
checked.** This should be re-verified before any future session treats them
as authoritative.

---

## 4. Three viewpoints, kept distinct

The founder asked for these to be preserved as separate viewpoints rather
than merged into one voice. They are presented in the order they arrived.

### 4.1 Gemini — first round (as relayed by the founder)

- Mehvar should support FBR POS.
- It should be an optional **premium** capability, not mandatory.
- It should be implemented as an **isolated module**.
- The checkout should remain usable even if the module is disabled.
- It could become a **commercial differentiator** for larger pharmacies that
  require compliance.

### 4.2 Gemini — second round (as relayed by the founder, after seeing this
session's review)

- Agrees Days 6–8 should stay focused on the core product.
- Strongly agrees with the **"absence is a feature"** UX framing (§5.5).
- Agrees with **readiness before implementation**.
- Recommends a **Tenant Tax Profile** abstraction instead of an
  `fbr_enabled` boolean.
- Revises its own first-round position: believes compliance should
  eventually be **bundled into an Enterprise/Scale tier**, rather than sold
  as a standalone premium unlock.
- Recommends writing an ADR **after the MVP**, and only implementing active
  integration once customer demand or regulation justifies it.

Gemini's second round already walks back its own first-round "premium
unlock" framing without being told to — worth noting because this session's
independent review (§4.3) arrived at the same correction from a different
angle (the ethics of monetizing a legal obligation, §5.2), and the two
reinforcing each other from different starting points is a meaningfully
stronger signal than either alone.

### 4.3 This session's architecture review — full recommendation preserved

This is the complete review this session produced, kept intact rather than
summarized, since a future session should be able to see the reasoning chain
and not just the conclusion.

#### Headline recommendation

**Don't build FBR into Days 6–8. Don't build it after, either, until a real
customer needs it.** Write one ADR recording the decision (after the MVP,
per §6), and do nothing else for now. Not because the capability is
low-value — because Mehvar is already substantially FBR-ready **by accident
of good architecture**, and the remaining gap cannot be usefully closed
before it's known which regulatory regime, if any, a real customer actually
falls under.

#### Where Gemini's first round is wrong

**"Optional premium capability / commercial differentiator" — rejected.**
Monetizing a legal compliance obligation is a weak commercial position
(nobody pays a premium for permission to obey the law; compliance is a
purchase precondition for those who need it, not an upsell) and creates a
perverse incentive where Mehvar's revenue rises when regulation tightens on
its customers — which quietly misaligns Mehvar with the customer, corroding
the trust posture the product is built on. Price on scale (multi-counter,
branches, owner reporting); let compliance ride along in whichever tier a
business that size would buy anyway. *(Gemini's second round independently
arrived at a version of this correction — see §4.2.)*

**"Isolated module" undersells the real cost.** The API client is
trivially isolatable. The data model is not — HS code per product,
per-line tax rate, standardized UoM, and buyer identity reach into the
catalog, the sale line, and the receipt. "A module" implies bounded,
contained work; the actual shape is a thin adapter plus several
schema-reaching fields.

**"Checkout remains usable if disabled" is too weak a bar.** Disabled is
the easy case. The dangerous state is *enabled and failing* — FBR
unreachable, an expired token, a line rejected for a bad HS code. That's
the only version of this requirement worth stating, and it's not the one
Gemini's first round stated.

#### Where this review pushes back on the founder

- The founder's "don't want Mehvar to be the government-reporting software"
  instinct is correct and well-founded — not something to talk them out of.
- But avoiding the capability isn't neutral: if regulation eventually
  reaches this customer segment and Mehvar can't comply, Mehvar becomes the
  software owners have to *leave*. Readiness is the hedge against that, and
  (per §5.6) it turns out to be nearly free given what's already built.
- An ethical dimension the founder hadn't named, proposed as a candidate
  principle: if Mehvar ever transmits, and a pharmacy has been
  under-declaring, Mehvar creates legal exposure its owner may not have
  understood they were accepting. Candidate principle: **"Mehvar never
  surprises anyone into compliance — transmission is an act the owner
  knowingly performs, never a default, never a side effect of an upgrade,
  never a support-side toggle."**

#### Readiness vs. integration, and why readiness is nearly free

Readiness is **not** "build the adapter and leave it flagged off" — that's
integration with a switch: full maintenance cost, no revenue, and it rots.
Readiness means *nothing in the current design forecloses compliance*. The
test proposed: *if a customer registered for sales tax tomorrow, what would
change, and is any of it irreversible?*

Run against what exists today (Days 1–5):

| Requirement (secondary-sourced, §3.3) | Mehvar today |
|---|---|
| Immutable invoices; corrections as credit/debit notes referencing the original | **ADR-1 — already true** |
| Local queue during outage, auto-sync on reconnect, within a time window | **ADR-3 outbox — already true** |
| Stable per-invoice identity | **Client-generated UUIDv7 + device-scoped receipt numbers — already true** |
| Exact money arithmetic | **Integer paisa — already true** |
| Line-level detail | **Sale lines carry qty/price/discount — already true** |
| HS code, per-line tax rate, standardized UoM | **Missing** |
| Seller STRN, tenant tax profile | **Missing, but structurally trivial to add** |

The alignment on the first five rows is not luck: FBR's reported
lock-then-credit-note correction model (§3.3) *is* ADR-1's shape. Most POS
systems mutate invoices and would need surgery to comply; Mehvar's
append-only design already can't.

The two missing rows are the entire gap, and there's a specific reason not
to close them speculatively: **e-invoicing is prospective, not
retroactive** — compliant invoices would start from the day a tenant
registers, with no backfill of history. So there's no "we'll regret not
capturing this from day one" risk. A nullable column added later costs an
afternoon; the same field back-filled across thousands of already-seeded
catalog rows today costs real data-quality debt against Phase 13 §2's
critical-path catalog curation work.

#### The sharpest real tension found: receipt vs. fiscal invoice

Not surfaced by Gemini in either round. **ADR-3 requires the receipt to
print instantly from local state. Digital Invoicing's reported model says
an invoice isn't valid without an IRN, which only FBR can issue.** These
cannot both be true of one document.

Proposed resolution, offered as a candidate architectural principle rather
than a decision: treat them as **two documents with different lifecycles**
sharing one sale — the **counter receipt** (local, instant, device-numbered,
the dispute-ender per T4/T5, must never wait on a network) and the
**fiscal invoice** (server-side, carries IRN + QR, comes into existence
whenever FBR answers, possibly minutes later). If this integration is ever
built, this split is the first design decision to get right — getting it
wrong means either a slow checkout or invalid invoices.

Related and explicitly unresolved: buyer identity. If ordinary walk-in
sales genuinely require a captured CNIC (§3.3, unconfirmed), that alone
could be disqualifying for W1's speed budget — this is flagged, not
resolved, in §7.

#### Capability model fit

Proposed as a candidate refinement, not a settled abstraction: existing
Mehvar capabilities are *product* capabilities (things the software does by
choice). FBR compliance is a *jurisdictional obligation* — a regime the
tenant is subject to, not a feature they picked. A bare `fbr_enabled`
boolean is likely wrong within a year, since Punjab, Sindh and KP each have
their own revenue authorities with potentially their own regimes — a
boolean forces a second boolean, then a third. Proposed shape: a **Tenant
Tax Profile** (what regime this pharmacy trades under, what identity, which
authority) from which compliance *behaviors derive*, with a capability flag
only gating whether Mehvar *acts* on that profile.

*(This is the same shape Gemini's second round converged on independently —
see §4.2 and §5.2.)*

#### Failure modes to design around (if ever built)

1. Integration becoming a wall in the sale path — submission must be an
   outbox record, never a precondition; the shape for this already exists.
2. Correction after the lock window — Mehvar needs to know when a
   compensating row requires an external credit note vs. a purely local
   correction.
3. Receipt/invoice divergence — the sharpest tension above.
4. Silent enablement — never a default, never flipped by support, always an
   explicit, informed owner act.
5. HS code data quality — a wrong code is a wrong tax and a real liability;
   Mehvar should refuse to submit a line with no verified code rather than
   guess one.
6. Integrator licensing — FBR reportedly permits licensed integrators;
   whether Mehvar becomes one or rides an existing integrator (e.g. PRAL
   directly) is a business/legal question with lead time measured in
   months, separate from and prior to the engineering question.

#### Proposed UX for both cohorts

- **Pharmacies that don't need it: they never see the word FBR.** Not
  greyed-out, not a "Pro" badge, not an upsell — nothing. A visible-but-
  disabled FBR feature is itself the signal that produces the founder's
  named adoption anxiety ("this software is on speaking terms with the tax
  authority, and one day it'll be switched on"). Absence is the feature.
- **Pharmacies that do need it:** configured once during assisted setup,
  then invisible, like the receipt printer. Counter flow unchanged.
  Failures surface in the owner's day view — where Mehvar already surfaces
  exceptions — never mid-sale at the counter.

#### Roadmap position

Days 6–8 stay untouched by this. Day 6 (purchases/batches/pending
resolution) and Day 7 (day close/reports/returns) are substantial; Day 8 is
the plan's buffer, and consuming it on speculative compliance work is
exactly how one-week plans fail. Phase 13 §7's V1 definition does not
mention FBR.

The one artifact proposed for Day 8, if there's spare buffer: an ADR (see
§6) recording this decision, zero code.

### 4.4 Additional architectural discussion points (founder, preserved
as-is)

The founder asked that these be kept as their own discussion points,
distinct from both Gemini's and this session's framings above, since they
were raised independently and may carry weight even where they overlap with
either:

- Keep FBR **integration** separate from FBR **readiness** as a hard
  conceptual line, not just a phasing convenience.
- The checkout is the product's most protected workflow. Compliance must
  never compromise the speed or reliability of selling medicine.
- If future compliance requires communication with external authorities,
  the preferred direction is that sales continue to be captured safely
  first, with any external submission designed so it does not undermine
  Mehvar's trust principles. **This remains an architectural discussion
  rather than a final decision until the official documentation is fully
  verified.**
- Consider modeling this area as a broader **Compliance domain** rather
  than thinking only about FBR, since future provincial or other
  regulatory authorities may introduce their own requirements. *(Compatible
  with, and arguably a generalization of, the Tenant Tax Profile shape both
  this session and Gemini's second round proposed — worth reconciling
  explicitly when this is picked back up, not assumed identical.)*
- Preserve the distinction between verified facts and assumptions — several
  questions remain open because the official documentation could not be
  fully verified (see §7).
- Validate the open questions later using: the latest official FBR/PRAL
  documentation, at least one pharmacy already using the system, and a
  Pakistani tax practitioner familiar with pharmacy retail.

---

## 5. Where the viewpoints agree

Convergent across all three (founder's additional points, both Gemini
rounds, and this session's review), which is worth noting precisely because
they were developed somewhat independently:

1. **Days 6–8 stay focused on the core product.** No dissent anywhere in the
   discussion.
2. **Readiness before implementation.** All three frame this as the right
   posture, though "readiness" is defined slightly differently by each (see
   §6 open question).
3. **The checkout/sale-capture path is the thing to protect above all
   else.** Stated independently by the founder's original goals, the
   founder's additional points, and this session's review.
4. **"Absence is a feature" for pharmacies that don't need it.** Gemini's
   second round explicitly and strongly agrees; this session's review
   proposed it; the founder's original adoption-anxiety concern is what
   motivated it in the first place.
5. **A boolean flag is the wrong abstraction; some kind of tenant-level tax
   profile is better**, converged on independently by this session and
   Gemini's second round, and compatible with (if not identical to) the
   founder's broader "Compliance domain" framing.
6. **Compliance should not be sold as a standalone premium unlock.**
   Gemini's second round revised its own first-round position to agree with
   this session's review here.
7. **An ADR should be written, but not yet — after the MVP, once open
   questions are answered.**

## 6. Where the viewpoints diverge or remain unreconciled

- **Gemini (both rounds) never surfaced the receipt-vs-fiscal-invoice
  tension** (§4.3) — the sharpest concrete conflict found between ADR-3 and
  the (unverified) Digital Invoicing real-time model. This is not a
  disagreement so much as a gap in Gemini's analysis that a future session
  should weigh independently rather than assume is settled.
- **Tenant Tax Profile vs. broader Compliance domain**: this session and
  Gemini's second round proposed a *tax-specific* profile; the founder's
  additional points proposed a *general compliance* domain that would cover
  FBR and any future provincial/other regulatory regime. These may be the
  same abstraction at different altitudes, or the compliance domain may be
  the correct broader container with tax profile as one instance inside it.
  **Not reconciled — flagged as a specific thing to resolve before writing
  code, not before writing the eventual ADR.**
- **What exactly "readiness" requires as a deliverable** is stated with
  different granularity by each viewpoint (Gemini: write an ADR after MVP;
  this session: a gap analysis + a named owner + a periodic scope review +
  an optional throwaway sandbox spike). Not contradictory, but not merged
  into one checklist yet — see §8 for a first attempt at reconciling this.
- **How much of this session's review rests on unverified secondary
  sources** is itself a point of caution the founder raised independently
  (§4.4) and this session flagged throughout §3 and §4.3 — it isn't a
  disagreement between viewpoints, but it is a reason **none of the above
  should be treated as more settled than "worth returning to once
  verified."**

## 7. Open questions requiring evidence (unresolved — do not assume answers)

Carried forward verbatim from the founder's framing, since these are the
actual gate on turning any of the above into a decision:

1. Is invoice submission synchronous or asynchronous in practice?
2. What latency should be expected from FBR's side?
3. Is buyer CNIC actually required for ordinary walk-in pharmacy sales, or
   is a placeholder ("Walk-in Customer") genuinely sufficient?
4. Which pharmacy categories are genuinely in scope today — does the
   Tier-1/Digital-Invoicing distinction in §3.1 hold up, and does the
   medicines-exemption reasoning in §3.2 actually apply to a typical
   neighborhood pharmacy's mix of taxable and exempt goods?
5. Which version of the FBR/PRAL documentation is current? (§3.4 flags a
   possible version mismatch between the founder's linked v1.2.2 and a
   v1.12 reference found in search results.)

This session's review surfaces one more, implied by §4.3 but not yet on the
founder's list:

6. Does the receipt/fiscal-invoice split proposed in §4.3 match how FBR
   actually expects invoice issuance to relate to point-of-sale receipt
   printing, or is there a compliant way to unify them that this session
   didn't find because the primary PDFs couldn't be read?

## 8. Validation plan (as agreed, not yet started)

The founder's stated plan for closing §7, preserved as-is:

- Read the **latest** official FBR/PRAL documentation directly (this
  session could not — proxy-blocked; a future session or a human should
  fetch these directly rather than relying on secondary sources).
- Talk to **at least one pharmacy already using the system** (Tier-1 or
  Digital-Invoicing registered) to learn how it actually behaves in
  practice — latency, offline handling, buyer-identity handling.
- Consult a **Pakistani tax practitioner familiar with pharmacy retail**
  specifically, not general e-invoicing advisories, to confirm scope
  (question 4 above) and get a professional opinion rather than
  secondary-sourced inference.

## 9. Why this was deferred, and what would bring it back

Deferred because:

- Nothing in Phase 13's V1 definition requires it.
- Day 8 is the plan's buffer and the founder's own cut-order discipline
  exists precisely to protect it from exactly this kind of speculative
  scope.
- The open questions in §7 are gating, not decorative — a decision made now
  would be a guess dressed as an architecture choice, which is the opposite
  of the trust-first posture this document is trying to protect.

Candidate triggers for resuming this discussion, proposed by this session
and not yet agreed as formal policy:

- A real customer is registered for sales tax, or is credibly told they
  will be required to register.
- Multiple pipeline/sales conversations are blocked specifically on this.
- Registration thresholds or Tier-1 criteria move in a direction that would
  plausibly bring ordinary neighborhood pharmacies into scope.

## 10. What "resuming this" should look like

A future session picking this up should, in order:

1. Read this document in full before doing anything else.
2. Treat §7 as the actual work — go verify, don't re-derive from secondary
   sources again.
3. Only after §7 is closed, reconcile §6's open divergences (Tenant Tax
   Profile vs. Compliance domain; what "readiness" concretely requires).
4. Only then write the ADR — this document is explicitly not one, and nothing
   here should be copied into an ADR without re-checking it against
   verified sources first, since large parts of §3 and §4.3 are
   secondary-sourced and flagged as such throughout.

---

## Sources consulted (secondary; primary PDFs were not accessible this session)

- [Tier-1 retailer definition, FBR](https://www.fbr.gov.pk/sales-tax-general-order-tier-1/163085/173442)
- [Pakistan extends e-invoicing scope to corporate and non-corporate registered persons, EY](https://www.ey.com/en_gl/technical/tax-alerts/pakistan-extends-scope-of-electronic-invoicing-to-corporate-and-noncorporate-registered-persons)
- [Registered persons required to integrate digitally, KPMG](https://kpmg.com/us/en/taxnewsflash/news/2025/04/pakistan-corporate-non-corporate-registered-persons-required-register-digitally.html)
- [Sales tax scope and exemptions, FBR](https://www.fbr.gov.pk/sales-tax/142263/131269)
- [Tax laws applying to a pharmacy business in Pakistan](https://sohaibnsultan.pk/tax-laws-applying-to-a-pharmacy-business-in-pakistan-a-complete-guide-for-2026/)
- [Credit and debit notes under FBR digital invoicing](https://taxflow.com.pk/blog/debit-note-credit-note-fbr/)
- [FBR e-invoicing compliance guide — IRN, deadlines, penalties](https://invoiceflow.pk/fbr-compliance/)
- [FBR Digital Invoicing FAQs, official](https://fbr.gov.pk/faqs/173967/173969)

**Primary sources still needing direct verification** (not accessible from
this session's environment — proxy returned HTTP 403 on `fbr.gov.pk`):

- FBR Digital Invoicing technical documentation index —
  `https://www.fbr.gov.pk/technical-documentation-di/163085/173959`
- PRAL Technical Documentation for Digital Invoicing API (PDF) —
  `https://download1.fbr.gov.pk/Docs/20256596455967TechnicalDocumentationforDIAPI.pdf`
- PRAL Digital Invoicing API Specification v1.2.2 (PDF) —
  `https://download1.fbr.gov.pk/Docs/2024223112430432TechnicalSpecificationDigitalInvoicing1.2.2.pdf`
