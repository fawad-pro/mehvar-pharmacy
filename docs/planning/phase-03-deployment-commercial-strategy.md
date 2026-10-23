# Phase 3 — Deployment & Commercial Strategy

Status: Draft for review
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

**E. Hybrid: cloud product with an optional local install.** **Adopted — see the amendment note below.** Originally deferred, not rejected: one codebase can support it later (containerized local deployment) if a segment demands it. Offering it in V1 doubles operational surface for a customer who hasn't asked yet.

> **Amended 2026-08-03 by PCN-004 (accepted).** A customer asked. Option E is promoted from deferred to primary and the deployment decision in §3 is inverted: local-first, with cloud services additive and cloud hosting optional. Options C and D keep their rejections — the flaw in C was perpetual *licensing*, and the subscription model in §3 is unchanged. Of C's five objections, PCN-004 answers "one-time revenue", "updates never reach the field" and (with a delay) "owner's remote visibility"; it answers "piracy" by declining the frame; and it **accepts "support liability on aging Windows machines" as a standing liability rather than claiming to solve it.** Full analysis: `docs/research/commercialization.md`.

**F. Freemium.** Rejected for V1. Moneypex markets "free" aggressively; competing there races to the bottom with a funded competitor. Our channel (personal network, demo-led) doesn't need a free tier to generate leads. A time-limited trial delivers the same risk reversal without training the market that the product is free.

## 3. Decision

**Deployment (amended 2026-08-03, PCN-004): local-first — a single-tenant Node installed per pharmacy, with optional cloud services and optional cloud hosting, one codebase.** Internet is never required to sell. Cloud is always additive and never on the path of a sale.

**Commercial model (amended 2026-09-20, PCN-006): perpetual authorization, not subscription.** A valid, founder-signed licence bound to an installation authorizes it forever — no expiry, renewal, grace or warn period. An unlicensed installation runs a 30-day evaluation, then falls to a restricted tier that withholds new business only (settlement, printing, export and catalogue updates always remain). The subscription framing in the options and requirements below (§2 Option C, §4, §5, and the "trial"/"renewal" language throughout Phase 3 and Phase 8 §invariants) is superseded; read those through PCN-006, which is authoritative on licensing. The trust promise is unchanged and strengthened: legitimate operation is never blocked, and the customer's data is never held hostage in any state.

The trust argument inverts with the deployment: the pitch now leads with "your data never leaves your shop", and owner-controlled export from day one still backs it — the data is theirs, demonstrably. The owner's-phone visibility and the survives-a-dead-PC guarantee are **restored by cloud services in roadmap Phase 3**, and are in deficit until then; that regression is accepted and time-boxed, not waved away.

_Superseded text (retained for the record):_ "Deployment: cloud, single multi-tenant service, browser-based, one codebase. This is the only deployment a solo founder can operate at near-zero marginal support cost, and it is the only one that delivers the owner's-phone visibility and the survives-a-dead-PC data guarantee."

**Pricing (amended 2026-10-22, PCN-010, applying PCN-006): a one-time licence fee per installation; the figure is not yet set.** It is set from the first pilots, against the market anchor above. No setup fee (market norm). The 30-day evaluation (PCN-006) replaces the trial. One plan in V1; multi-counter and multi-branch tiers are future revenue. The pilot's own terms — a free fixed-term pilot with written terms and a founding price was recommended — are open (PCN-010).

_Superseded text (retained for the record):_ "Target: Rs 2,000/month, or Rs 20,000/year … 14-day full trial, no card … The structure (one plan, two cadences, annual-led, no setup fee) is the strategy."

Positioning at Pharma Pro parity is deliberate: we price as a peer and win on the five-minute experience gap, not on discount. Underpricing signals inferiority in a trust purchase.

**Collection (amended 2026-10-22, PCN-010):** the licence fee is paid once, by bank transfer, JazzCash or Easypaisa, and the founder issues the licence (`licence:issue`). No reminders or renewals exist to automate. Bound by the same non-negotiable outcome: the customer's data is never held hostage — export remains available in every licence state.

**Hardware: recommend, don't sell.** Publish a tested hardware list (PC minimums, 80mm thermal printer models, USB scanners) and a one-page setup guide. Carrying hardware inventory adds capital risk and support scope for margin that isn't ours to chase. The channel partner may source hardware at his own margin if he wishes; the software company stays a software company.

**Channel:** the friend's network is the launch channel. Formalize it lightly through a referral / revenue-sharing arrangement, with specific terms finalized before commercial rollout — the planning commitment is the structure (rewarded referrals, no employment or equity entanglement), not the percentage. Demo script and trial-to-paid flow are the founder's to run initially.

## 4. Revenue reality check

At Rs 20,000/year: 10 pharmacies ≈ Rs 200k/yr, 25 ≈ Rs 500k/yr, 50 ≈ Rs 1M/yr. This is a volume-and-retention business at these price points. The strategic asset that changes the slope later is the catalog (Phase 6) and multi-branch tiering — not raising the entry price.

## 5. Requirements this decision exports to later phases

1. **The tenant chokepoint ships from day one in every install** (architecture phase). Amended 2026-08-03 by PCN-004: the *isolation mechanism* is universal; multi-*tenancy* is a deployment option rather than a deployment fact. `src/db/scoped.ts` costs nothing at runtime in a single-tenant install and is what keeps one codebase serving both homes — a single-tenant build that dropped it would contradict this document.
2. Owner data export as a V1 feature (workflows, IA phases).
3. The service must support restricting a tenant's access on non-payment without ever compromising that tenant's ability to export their data (architecture phase); the enforcement policy itself is operational and post-launch. **Implemented 2026-09-16 by PCN-005 (accepted)** as the graduated capability ladder: selling, receipt printing and export are unconditional in every licence state, and past grace the restriction falls on receiving, stock adjustment, catalogue packs and automatic updates, with reports read-only. This requirement and `docs/research/commercialization.md` §6 previously disagreed about how much a licence may withhold; §6 is amended to match.
4. Evaluation-to-licensed needs no data migration — the evaluation's data is the production data (architecture phase; amended by PCN-010 for PCN-006's evaluation).
5. Mobile-usable owner reporting (IA phase) — the phone dashboard is part of what the price buys. In V1 it is reached on the shop's own network (PCN-010).
6. Licence issuing is founder-side tooling (`licence:issue`); do not build billing automation into V1 (amended by PCN-010; there are no subscriptions to track).

## 6. Future Considerations

- ~~Local/containerized deployment for chains or compliance-driven customers (Option E)~~ — **adopted 2026-08-03 by PCN-004**; no longer a future consideration. See §2 Option E and §3.
- FBR digital invoicing as a paid add-on when customers cross Tier-1 thresholds
- Multi-branch tier; multi-terminal pricing
- Hardware bundle partnership if channel volume justifies it
