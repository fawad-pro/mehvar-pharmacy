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

- **Catalog curation (Phase 6 §3):** the hand-verified head of ~1,500–3,000 fast movers with pack structures and MRPs, sourced from the reference pharmacy's shelves and a distributor price list. **This is the long-lead item.** DRAP seed import can follow post-launch. *(Restated 2026-10-22, PCN-010: the starter catalogue holds 138 verified products with MRPs and 3,819 reference products without; the verified head is still the gap, and the pilot pharmacy's own shelves are the fastest way to grow it.)*
- **Brand assets:** wordmark treatment for Mehvar Pharmacy, receipt mark, tokens confirmed against Phase 10 §6.
- **Hardware:** reference pharmacy's printer and scanner models identified and tested against ADR-6 kiosk printing before Day 1 — printer surprises are the classic week-one derailment.
- **Infrastructure (amended 2026-10-22, PCN-010):** a Windows build machine with Inno Setup, a code-signing certificate (the long lead — start now), and Railway for the demo and the later cloud services.

## 3. Pilot readiness

> **Replaced 2026-10-22 by PCN-010.** The build week this section scheduled is
> complete; its day-by-day record is `CHANGELOG.md`, and the original schedule is
> in this file's history. What follows is the plan from here: what must be true
> before a real pharmacy trades on Mehvar, what can land while the pilot runs,
> and what waits for after it. Development continues in parallel with the pilot.

**The build week, for the record.** Days 1–7 shipped as planned; Day 8's
hardening became the release-hardening sessions that followed. Its cut order
(weekly/monthly report tabs → CSV import in W9 → returns without receipt →
near-expiry 60/90 horizons → quick-item completion queue polish) was applied
once, to the report tabs, and recorded. Never cut, then or now:
rebuild-equivalence tests, offline capture, receipt printing, exception
visibility.

**Before the pilot — one counter, one neighbourhood pharmacy, founder on site:**

| Item | State |
|---|---|
| Expired stock skipped by automatic selling, warned and listed (PCN-008) | Built |
| Purchase corrections and supplier returns (PCN-009) | Built |
| Receipt settings apply without a restart; test receipt; default-printer warning | Built |
| Real-Windows validation: install, upgrade, repair, failure paths, restore, uninstall, the bundled PostgreSQL, the pilot's own printer and scanner | **Pending** — the Windows validation checklist |
| Owner can change the owner password and the owner's own PIN (Settings) | **Not built** |
| Last successful backup visible to the owner; backup folder set from Settings | **Not built** |
| Running version shown in the app; one-page update procedure | **Not built** |
| A founder-issued licence installed (the 30-day evaluation restricts receiving after it ends) | At install |

**While the pilot runs:** the nightly verifier beside the backup, with a
mismatch shown in the app; code signing (long lead — start now); digital-wallet
tenders (JazzCash, Easypaisa), the next tender after cash and udhaar; whatever
week one at the counter shows is slow or confusing (§4).

**After the pilot:**

- **Multi-counter on the shop LAN** — a screen to add counters with their own
  receipt prefixes, a session that works over LAN HTTP, a search index that
  refreshes while open, and a two-counters-at-once test (Phase 12 §1).
- **The in-app updater** — roadmap Phase 2, with Phase 12 §2's acceptance
  criteria.
- **Cloud services** — offsite backup and the owner's remote view from outside
  the shop, roadmap Phase 3 (`commercialization.md`).
- Weekly and monthly report tabs, product-level sales and margin reports, 58 mm
  receipts, a cash-drawer kick, and the rest of §6's ledger — each when a named
  customer need exists (P6).

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
| Solo support load | Founder becomes the bottleneck | Founder-installed local Nodes (PCN-004), WhatsApp support with the redacted support bundle, recurring causes become fixes not FAQs; whether remote screen-share is allowed is open (PCN-010) |
| Negative-stock model misread as sloppiness | Owner distrust in demos | Explain as designed exposure (D2); exception list makes it a feature — never blocks a sale, never hides one |

**Trade-offs consciously taken:** row-scoped multi-tenancy over stronger isolation (chokepoint now, RLS later); one cached quantity over pure derivation (verifier as the honesty mechanism); client-side search over a search service (speed and offline for free, index staleness accepted); no billing automation (manual founder-side tracking); two roles only; single branch; kiosk printing over a print agent.

## 6. Future Considerations (consolidated ledger)

Deferred deliberately, with the phase that raised each:

- **Commercial/deployment:** containerized local deployment for chains or compliance-driven buyers (P3-E); multi-branch and multi-terminal pricing tiers (P3); hardware bundle partnership (P3); billing automation (P3 §5.6); tiering beyond one plan (P3).
- **Regulatory:** FBR digital invoicing as a paid add-on when customers cross Tier-1 thresholds, wrapping receipt generation server-side (P1 §3, ADR-6).
- **Architecture:** Postgres RLS hardening (ADR-2, P12 §5); background job infrastructure if verification or catalog work outgrows scheduled runs; websocket live updates for multi-terminal counters.
- **Product:** purchase orders (P5 §6; supplier payables were admitted by PCN-007); expenses beyond drawer cash movements; prescription capture; loyalty or customer tiers; WhatsApp receipt delivery and udhaar reminders; multi-branch stock; distributor return workflows beyond supplier returns from the invoice (PCN-009); barcode label printing.
- **Catalog:** automated DRAP price-notification ingestion; contribution tooling beyond the founder-reviewed proposal queue (P6 §5).
- **Platform:** the in-app updater (roadmap Phase 2) and multi-counter on the shop LAN (PCN-010); Urdu-script localization; native mobile app (responsive web serves V1); multi-currency (irrelevant until outside Pakistan).

Nothing in this ledger is promised. Each item re-enters planning only when a named customer need and a business case exist (P6).

## 7. Definition of V1 complete

- W1–W12 operable by keyboard at the counter, on real hardware
- Rebuild-equivalence suite green; production verifier scheduled and quiet
- Selling survives a connectivity disruption with no user action and no data loss
- Receipts print correctly for sales, udhaar, settlements, and returns
- Owner's three questions answered on a phone in one glance (in V1, on the shop's own network — PCN-010)
- Backup running and its last success visible to the owner, restore drill passed, export working
- Reference pharmacy onboarded with opening stock entered and its first live day sold through the system
