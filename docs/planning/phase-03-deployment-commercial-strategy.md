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

> **Superseded in part by PCN-006 (accepted 2026-09-20).** The commercial model
> is now a **perpetual authorization** with a **30-day unlicensed evaluation**,
> not a subscription with expiry, renewal or grace. Items below that assume
> subscription mechanics are read through that amendment: requirement 3's
> non-payment restriction is now the *restricted tier* an unauthorized/unbound/
> revoked installation falls into (new business withheld; settlement, print,
> export, catalogue updates always available); requirement 4's "trial" is the
> 30-day evaluation; requirement 6's subscription-payment tooling is retired.
> The one invariant that strengthens rather than changes: the customer's data is
> never held hostage, in any state. See PCN-006 for the authoritative model.

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
