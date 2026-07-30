# Phase 13 — Implementation Roadmap, Risks & Future Evolution

Status: Draft for review
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
Payment overlay (tendered/change, split cash-credit), sale numbering, receipt render + kiosk silent print (ADR-6, Phase 10 §7), udhaar sale with inline customer create (W2), settlement with mini-statement receipt (W3), customer balance derivation.
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
