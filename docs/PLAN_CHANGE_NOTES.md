# Plan Change Notes

The planning package is the specification. Implementation sessions implement it;
they do not re-litigate it. When implementation reveals a genuine flaw — a
contradiction between phases, a missing architectural decision, or a
specification that cannot be built as written — the session **stops** and files a
note here rather than making an assumption (Phase 11 §4, Phase 4 §7).

> "A discovered flaw in the plan is raised as a plan-change note, decided, then
> implemented — never silently patched around."

Deliberate exceptions to a principle are recorded the same way: as a decision
with a reason, never absorbed silently (Phase 4 §7).

## Format

```
## PCN-001 — <short title>
Session: <n> (Day <n>)   ·   Raised: <date>   ·   Status: open | decided | rejected

**Plan sections in tension.** Which phases/ADRs, quoted.
**The contradiction or gap.** What cannot be built as written, and why.
**Options.** Each with its consequence, honestly.
**Recommendation.** One, with reasoning.
**Decision.** Filled in by the owner. Date and rationale.
**Applied.** Commit(s) implementing the decision; source phase updated if needed.
```

Note the precedent set by the consolidation review (master plan, "Consolidation
review record"): defects C1–C5 were fixed _in the source phases_, not worked
around downstream. A decided note follows the same path — the plan is corrected,
then the code follows the corrected plan.

---

## Open notes

## PCN-001 — ADR-7's login flow has no schema, and §5.1's REVOKE has no role

Session: 1 (Day 1) · Raised: 2026-07-30 · Status: **open — implemented under the
recommendation below, pending your decision**

### Plan sections in tension

- **ADR-7:** "Tenant device login (long-lived session on the counter machine)
  with in-app user switching by PIN per salesman/owner; owner logs in normally
  from any device."
- **Phase 9 §3 (`sales`):** `receipt_number` is "client-generated at commit,
  device-scoped: short device prefix + per-device counter, e.g. `A-1042`".
- **Phase 9 §2:** `tenants` is id, name, status, settings. `users` is id,
  tenant_id, name, role, pin_hash, password_hash, is_active.
- **Phase 9 §5.1:** "REVOKE UPDATE/DELETE on event tables **for the app role**."
- **Phase 4 §6:** one domain serves the product (`pharmacy.mehvar.app`) — there
  are no per-tenant subdomains to carry tenant identity.

### The gaps

Four things ADR-7 and Phase 9 §3 require have no schema and no stated owner:

1. **Tenant identity at login.** A device or an owner arriving at a single shared
   domain must name which pharmacy they belong to. No column carries that;
   `tenants` has a name but nothing unique and typeable.
2. **The device itself.** ADR-7's "device login" and Phase 9 §3's "short device
   prefix" both presuppose a device record. There is no `devices` table, so the
   receipt prefix — which must be unique per tenant, or `A-1042` collides across
   two counters — has nowhere to live and nothing enforcing its uniqueness.
3. **Sessions.** Purely mechanical, but they need storage.
4. **PIN lockout state.** Phase 12 §5 requires "rate-limited, lockout after
   repeated failures with owner override". Attempt count and lockout expiry have
   no columns.

Separately, **§5.1's "app role" is never provisioned anywhere in the package.**
Phase 12 §1 says configuration is environment variables in Railway and stops
there. This matters more than it looks: a `REVOKE` against the role that owns the
tables is silently inert in Postgres. If the application connects with the
owner's credentials — the default on Railway — then ADR-1's physical
immutability guarantee is decorative, and nothing anywhere would report that.
The product's central promise would be unenforced and appear enforced.

### Options

**A. Add the four columns/tables; provision a non-owning app role.** Recommended.
`tenants.slug`; a `devices` table (name, receipt_prefix, pairing_key_hash,
is_active) with a unique index on (tenant_id, receipt_prefix); a `sessions`
table; `users.failed_pin_attempts` and `users.pin_locked_until`. Two database
URLs: `DATABASE_URL` (app role, INSERT-only on event tables) and
`DATABASE_ADMIN_URL` (owner, migrations and grants only).

**B. Put the device prefix in `tenants.settings` JSONB.** Avoids a table, but
loses the unique constraint on (tenant_id, receipt_prefix) — and a duplicated
prefix means duplicated receipt numbers across two counters, which is a data
defect that surfaces as an angry customer holding two identical receipts. Phase 9
§5.5 already requires (tenant_id, receipt_number) to be unique; enforcing that
without a device registry means detecting collisions after the fact instead of
preventing them.

**C. Defer, and hard-code a single device per tenant.** Cheapest today. Breaks
the moment a pharmacy adds a second counter, and Phase 9 §3's `A-1042` example
exists precisely because more than one counter is anticipated.

### Recommendation

**A.** All four are the smallest additions that let ADR-7 be built as written,
and three of the four (sessions, lockout state, slug) are mechanical in the sense
Phase 9's preamble already sanctions. `devices` is the only genuinely new entity,
and Phase 9 §3's receipt-number format already implies it — the plan describes
its output without ever describing it.

The app role is not optional in the same way. Without it, §5.1 is a comment.

### What was implemented (and is reversible)

Implemented per A, marked `[PCN-001]` in `src/db/schema.ts` at each column. If you
prefer B or C, the changes are confined to that file, `src/auth/`, and
`src/db/auth-queries.ts`.

The app role is enforced but **not mandatory**: `db:grants` skips with a warning
when `APP_DB_ROLE` is unset, and the immutability tests skip alongside it, so a
developer without the role still gets a working checkout — they simply do not get
the guarantee, and both the script and the test say so.

### Decision

_Awaiting review._

### Suggested plan amendment if accepted

Phase 9 §2 gains `tenants.slug`, the `devices` and `sessions` tables, and the two
`users` lockout columns. Phase 12 §1 gains the two-role database configuration and
a line stating that the application must not connect as the schema owner.

---

## PCN-002 — every receipt needs a number, but `payments` doesn't have one

Session: 4 (Day 4) · Raised: 2026-07-30 · Status: **open — implemented under the
recommendation below, pending your decision**

### Plan sections in tension

- **Phase 10 §7 (receipt spec):** "80mm primary / 58mm variant… **udhaar receipts
  and settlements print the mini-statement**… footer = **receipt number**
  (device-scoped, Phase 9 §3 — identical online and offline), date/time,
  salesman name, configurable thank-you line…" — stated once, for the receipt in
  general, then explicitly extended to settlements in the same sentence.
- **Phase 9 §3:** `payments` — "id (client-generated), tenant_id, customer_id,
  amount_paisa, method, sale_id (nullable… standalone = settlement W3), origin,
  client_schema_version, client_committed_at, created_by/at." No
  `receipt_number` column. Only `sales` carries one.
- **W3:** "…commit → receipt (mini-statement: previous balance, paid, new
  balance). The receipt is the dispute-ender (T4, T5)."

### The gap

A settlement is a standalone `payments` row (`sale_id` null) — Phase 5 §3's own
definition: "money received from a customer independent of a new sale." Phase
10 §7 requires _that same row_ to print a receipt with a footer showing "the
receipt number." There is nowhere to put one: `payments` has no such column, and
borrowing a `sales` row is not an option — a settlement is not a sale, and the
schema's own CHECK constraints (`cash + credit = total`) would make a fabricated
sale row nonsensical.

This is the same shape as C1 (Phase 9 originally under-scoped which records need
a device-scoped receipt number), discovered fresh in a different table.

### Options

**A. Add `payments.receipt_number`, same shape as `sales.receipt_number`.**
Recommended. Client-generated, device-scoped, `unique(tenant_id,
receipt_number)`. The device's local counter is shared across both tables —
a sale and a settlement share one sequence, the way a single paper receipt
book would number every slip it tears off regardless of what the slip records.
Simplest, and it is what "the receipt" (Phase 10 §7 treats sale and settlement
receipts as one template with different bodies) implies.

**B. Give `payments` its own independent counter/prefix.** Rejected: two
sequences per device means two places a collision can happen, and buys nothing
— nothing in the plan distinguishes "sale receipts" from "settlement receipts"
as separate print runs a shop would keep separate.

**C. Settlements print without a receipt number.** Rejected outright: it
contradicts Phase 10 §7's footer spec verbatim, and a printed slip with no
number is not the dispute-ender T4/T5 promise the receipt exists to keep.

### Recommendation

**A.** One column, one shared device sequence, no new architectural surface —
the same pattern C1 already established for `sales`, extended to the one other
table that prints a receipt.

### What was implemented (and is reversible)

`payments.receiptNumber`, `NOT NULL`, `unique(tenant_id, receipt_number)`,
marked `[PCN-002]` in `src/db/schema.ts`. The client's receipt-number sequence
(`src/client/print/receipt-number.ts`, built Day 3) is reused unchanged — it was
already device-scoped and table-agnostic, so nothing about it needed to change
to serve both tables. Reversing to Option B would touch only the settlement
commit writer and the client counter's key.

### Decision

_Awaiting review._

### Suggested plan amendment if accepted

Phase 9 §3's `payments` row gains `receipt_number` (client-generated,
device-scoped, unique per tenant — identical in shape and derivation to
`sales.receipt_number`), sharing its device counter with sales.

---

## PCN-003 — the same gap, found again: `sale_returns` has no receipt number

Session: 7 (Day 7) · Raised: 2026-07-31 · Status: **open — implemented under
the recommendation below, pending your decision**

### Plan sections in tension

- **Phase 7, cross-cutting rule 4 / Phase 10 §7:** receipts print for every
  money event — "sale, return, settlement" — footer carries the device-scoped
  receipt number.
- **Phase 9 §3 (`sale_returns`):** "id, tenant_id, sale_id, cash_out_paisa,
  credit_reduced_paisa, reason_note, created_by/at." No `receipt_number`
  column.
- **W4:** "…confirm → stock restores to source batch, cash-out recorded or
  credit reduced (compensating record, T2)." No receipt is mentioned in the
  workflow text itself, but Phase 10 §7's footer spec is unconditional across
  all three money events.

### The gap

Identical shape to PCN-002, in the one other table Phase 10 §7 names and Phase
9 §3 under-scoped. A return that reduces credit or pays cash out is a money
event exactly as a settlement is, and the customer walking away with a slip
that has no number is the same dispute-ender failure PCN-002 already
reasoned through for payments.

### Options

**A. Add `sale_returns.receipt_number`, same shape and shared device counter
as `sales` and `payments`.** Recommended — the pattern is now established
twice; extending it a third time is not a new decision, it is applying the
decided one.

**B. Returns print without a receipt number.** Rejected for the same reason
PCN-002 rejected it for settlements: it contradicts Phase 10 §7 verbatim.

### Recommendation

**A.**

### What was implemented (and is reversible)

`saleReturns.receiptNumber`, `NOT NULL`, `unique(tenant_id, receipt_number)`,
marked `[PCN-003]` in `src/db/schema.ts`. Same client-side counter as `sales`
and `payments` — no new architectural surface.

### Decision

_Awaiting review._

### Suggested plan amendment if accepted

Phase 9 §3's `sale_returns` row gains `receipt_number` (client-generated,
device-scoped, unique per tenant), sharing its device counter with sales and
payments.

---

## Decided notes

## PCN-004 — the product is to be installed in the shop, but Phase 3 decided cloud

Session: 9 · Raised: 2026-08-03 · **Decided: 2026-08-03 — accepted (Option A)**

Unlike PCN-001–003, this note implements nothing. Those were gaps found while
building something the plan had already decided. This is a reversal of a
decision the plan made deliberately, with options weighed and rejections
recorded — so it stops rather than proceeding under a recommendation. The
supporting analysis is `docs/research/commercialization.md`.

### Plan sections in tension

- **Phase 3 §2, Option C:** "**On-premise, perpetual license.** Rejected.
  One-time revenue with perpetual support obligation; piracy is rampant and
  unpoliceable for a solo founder; every install is a support liability on
  aging Windows machines; updates never reach the field; the owner's remote
  phone visibility — a core charter promise — disappears."
- **Phase 3 §2, Option E:** "**Hybrid: cloud product with an optional local
  install.** Deferred, not rejected. One codebase can support it later
  (containerized local deployment) if a segment demands it… Goes to Future
  Considerations."
- **Phase 3 §3:** "**Deployment: cloud, single multi-tenant service,
  browser-based, one codebase.**"
- **Phase 3 §5.1:** "Multi-tenant service from day one (architecture phase) —
  single-tenant-now would contradict this document."
- **Phase 12 §1:** "**Production:** Railway — one Next.js service, one
  PostgreSQL instance, one region."

### The contradiction

The founder now requires Mehvar to run as locally installed software in the
pharmacy. Phase 3 §3 decided the opposite, and Phase 12 §1 built on it. This
cannot be absorbed as an implementation detail: it changes what is deployed,
how it is updated, where backups live, and how the product is licensed.

It is not, however, unanticipated. Option E describes this exact deployment and
was **deferred rather than rejected** — the stated reason being that it "doubles
operational surface for a customer who hasn't asked yet." A customer has now
asked. So the change available is narrower than overturning Phase 3: it is
promoting E from deferred to primary, and inverting which deployment leads.

Two things survive the change unchanged and are worth naming, because they are
what makes it affordable:

- **The commercial model.** Option C's fatal flaw was perpetual _licensing_.
  Nothing here proposes that; billing stays a subscription exactly as Phase 3 §3
  decided.
- **The tenant chokepoint.** Phase 3 §5.1's intent is preserved by keeping
  `scoped.ts` in every install regardless of tenant count. It costs nothing at
  runtime and is the only thing preventing a fork into "local edition" and
  "cloud edition."

Phase 3's remaining objections are answered at a cost, and one is not fully
answered at all — the Windows support burden is accepted, not eliminated
(`commercialization.md` §2.1, §8.1).

### Options

**A. Promote Option E; local-first with optional cloud.** Recommended. Local
Node deployment leads; cloud services are additive and never on the sale path;
cloud-hosted tenants remain available in the same image for customers who prefer
them. Phase 3 §3's _commercial_ decisions are untouched. Cost: an installer, an
auto-updater, local backups, and a permanent Windows support surface. The owner's
remote visibility (Phase 3 §5.5) is lost until roadmap Phase 3 restores it —
a real, time-boxed regression against a charter promise.

**B. Keep Phase 3 as written; remain cloud-only.** Zero engineering cost and no
regression. Rejected only if the founder's requirement is firm — which it
appears to be. Worth stating plainly that this option is not unreasonable: every
Phase 3 objection was correct when written and four of the five remain at least
partly true.

**C. Build both as first-class from the start.** Rejected. It is the
"doubles operational surface" outcome Option E was deferred to avoid, incurred
before a single local install has been survived. Option A reaches the same place
by Phase 4 with the evidence collected first.

**D. Local install as a one-off for this customer, cloud for everyone else.**
Rejected. A deployment that exists for one customer is a fork with no owner, and
it decays the moment the mainline moves.

### Recommendation

**A**, contingent on the founder accepting §8.1's standing liability with open
eyes. The architecture supports this change unusually cheaply — ADR-3's offline
outbox already provides the "what happens during the upgrade" story that
on-premise products normally have to invent, and UUIDv7 ids already make
independent installations mergeable. Neither was designed for this and both work.

The decision that would be wrong is C: reversing Phase 3 by doing more, rather
than by doing the deferred thing that was already scoped.

### Nothing implemented at the time of filing

By design. Phase 0 of the commercialization roadmap is this note.

### Decision

**Accepted, 2026-08-03 — Option A.** Local-first with optional cloud; Option E
promoted from deferred to primary.

The founder's rationale, recorded because a future session will need to know it
was a considered reversal and not drift: local deployment is now a product
requirement, not a preference. The architecture supports it at unusually low
cost — ADR-3's offline outbox already supplies the "what happens during the
upgrade" story, and UUIDv7 ids already keep installations mergeable — and the
commercial model in Phase 3 §3 is untouched. The Windows support burden
(objection 3) is accepted with open eyes as a standing liability, not treated as
solved; it is carried as open question 1 in the research note and is to be
validated against real pharmacy hardware before pharmacy #4.

Two refinements were directed at the same time and are applied in the research
note: roadmap Phases 1 and 2 merged into a single **First Paying Pharmacy**
phase whose milestone is that a non-technical pharmacy can install and trade
without developer tools, and an explicit design principle (§0.1) requiring every
decision to serve the first pharmacy while remaining evolvable to the hundredth
without an architectural rewrite.

### Applied

- Master-plan amendments below applied to the source phases, per the C1–C5
  precedent (Phase 3 §2/§3/§5.1/§6, Phase 12 §1/§2/§3).
- `docs/research/commercialization.md` — roadmap frozen; Phase 1 in progress.

### Plan amendment (accepted)

- **Phase 3 §2** — Option E moves from "Deferred" to the decided option; Options
  C and D keep their rejections, with a line noting which objections Option A
  answers and which it accepts (§2.1's table).
- **Phase 3 §3** — deployment becomes "local-first: a single-tenant Node
  installed per pharmacy, with optional cloud services and optional cloud
  hosting, one codebase." Pricing, collection, hardware and channel unchanged.
- **Phase 3 §5.1** — reworded: the tenant chokepoint ships from day one in every
  install; multi-_tenancy_ becomes a deployment option rather than a deployment
  fact.
- **Phase 3 §6** — Option E leaves Future Considerations.
- **Phase 12 §1** — topology gains the local Node; Railway is retained for
  staging, the demo environment, and the Phase 3 cloud services.
- **Phase 12 §2** — the release procedure gains the updater's empty-outbox
  precondition; §2.1's deep-night window becomes per-installation.
- **Phase 12 §3** — backups gain the local nightly dump; the offsite requirement
  is explicitly time-boxed to roadmap Phase 3.

---

## PCN-005 — an expired licence may withhold more than a banner, but never a sale

Session: 17 · Raised: 2026-09-16 · **Decided: 2026-09-16 — accepted (Option A)**

Like PCN-004 and unlike PCN-001–003, this note implements nothing. Those were
gaps found while building something the plan had already decided. This widens a
decision the research note made deliberately, with its reasoning recorded — so
it stops rather than proceeding under a recommendation. The supporting analysis
is the licensing architecture produced alongside this note.

### Plan sections in tension

- **`docs/research/commercialization.md` §6 (frozen, decided):** "**Never block a
  sale.** P2 is not suspended for billing. An expired licence shows the owner a
  banner; it does not stop the counter. Anything else makes the licensing system
  a P2 violation."
- **Same note, roadmap Phase 2 success criteria:** "An expired licence shows a
  banner and **does not stop a sale**."
- **Phase 3 §5, requirement 3:** "The service must support **restricting a
  tenant's access on non-payment** without ever compromising that tenant's
  ability to export their data (architecture phase); the enforcement policy
  itself is operational and post-launch."
- **Phase 3 §3:** "the customer's data is never held hostage — export remains
  available regardless of payment state."
- **P2:** "Never block a sale… every blocking moment must have a designed fast
  path."
- **T3:** "Full export, always available, even in suspension."

### The gap

Phase 3 §5 already exports a requirement for **restricting access** on
non-payment, bounded by one thing only: export must survive. §6 later narrowed
that restriction to a banner. Both are in the package; they do not agree on how
much a licence may withhold.

The founder now requires the product to be protected against continued use
without authorisation, ahead of distribution to pharmacies nobody will visit.
Under §6 as written, a pharmacy that never pays again loses a banner and nothing
else, indefinitely. That is not a restriction, and Phase 3 §5's requirement is
left with no implementation.

The substance of §6's reasoning is not in question. Its asymmetric-risk
argument — "a false lockout at 9am on a Monday costs the reference customer, the
referral behind them, and the reputation that is the entire launch channel" — is
correct, and this note preserves it **absolutely, on the sale path**. What is in
question is whether that argument reaches the back office. It does not, on the
plan's own terms: ADR-3 already excludes purchases, adjustments and catalogue
edits from offline capture, and already has them "require a connection and say
so calmly." Nobody is standing at the counter when stock is received.

### Options

**A. A graduated capability ladder.** Recommended. Three tiers. Selling
(W1–W3, W6), receipt printing and data export are unconditional in **every**
licence state, forever. Past expiry-plus-grace, the installation loses stock
receiving (W8/W9), stock adjustment (W10), catalogue packs and auto-updates;
reports go read-only. A lapsed pharmacy trades exactly as fast as a paid one and
cannot restock, so value decays visibly without a customer ever being made to
wait. Consequence: §6's "banner" sentence is widened, and the product carries a
gating chokepoint it does not have today.

**B. Banner only, exactly as §6 is written.** Zero change to the frozen note and
zero false-lockout risk. Licensing becomes a renewal-reminder system and
non-payment is collected socially. Consequence: Phase 3 §5's restriction
requirement stays unimplemented, and the founder's stated requirement is not
met. This option is not unreasonable and should not be dismissed — it is what
the note decided, and it was decided for good reasons.

**C. Read-only after grace — no new sales.** Rejected. A direct P2 violation,
and the exact failure §6 exists to prevent. Recorded so it is not proposed later
as the "obvious" strengthening.

### Why A does not violate P2

P2's test is _"name the moment this feature could stop a sale; show its escape
hatch."_ Under A there is no such moment, by construction rather than by
intention:

- The four ADR-3 record kinds — sale, settlement, quick item, customer — are
  ungated in every state, **asserted by kind rather than by module**. This
  matters concretely: `createQuickItem` lives in `src/domain/catalog/writers.ts`,
  so a gate written against "catalogue writes" would break W6's unknown-medicine
  escape hatch _and_, because `ingestBatch` stops at the first non-`synced`
  outcome, strand every offline sale behind it in the outbox permanently.
- Printing is untouched (T5 — the receipt is the pharmacy's public face, and
  nothing about our billing appears on it).
- `/api/export` stays open in every state, as it already is for suspension
  (T3, Phase 3 §3).

A lapsed pharmacy accumulates pending-layer rows as stock drains. That is D2's
existing visible-exception machinery doing its job, not a new nag, and Day 6's
oldest-first resolution clears it when they pay. Nothing needs unwinding.

### What A costs, honestly

A capability gate is a new enforcement surface in a codebase that has one
(`scoped.ts`) and guards it carefully. It needs the same posture: one
chokepoint, one sweep test whose polarity defaults new actions to _needing a
decision_, and an exemption list somebody had to write by hand.

It also introduces an offline expiry clock, and with it a case the product does
not have today: a pharmacy whose computer has the wrong date. The architecture
resolves this without ever withholding a lapse, and accepts one bounded
trade-off — a wrong forward clock expires a paying customer early. That is
survivable only because of this note's own recommendation: under A the cost is
receiving, not selling.

### Recommendation

**A.** Phase 3 §5's requirement is already in the package and currently has no
implementation; A is the smallest thing that gives it one while leaving every
sentence of P2, T3 and T5 true. B is a legitimate outcome and costs one file's
worth of code to switch to.

The decision that would be wrong is C — strengthening by doing the thing §6
correctly forbids, rather than by finding the capabilities whose withdrawal
costs the pharmacy nothing at the counter.

### Nothing implemented at the time of filing

By design, following PCN-004.

### Decision

**Accepted, 2026-09-16 — Option A.** The graduated capability ladder, exactly as
the architecture describes it:

- **`full`** — normal operation.
- **`full + notice`** — normal operation, with a renewal or expiry notice.
- **`restricted`** — stock receiving, stock adjustment, catalogue-pack updates
  and automatic software updates are withheld; reports become read-only.

Four constraints are part of the decision, not commentary on it:

1. **Selling, printing and data export remain available in every licence state,
   including lapsed.** No exception, no configuration, no later trade.
2. **Option C is rejected.** Read-only-after-grace must not be introduced, by
   this slice or any later one.
3. **Enforcement is capability- and ADR-3-record-kind-based, never a blanket
   module lock.** `sale`, `settlement`, `quick_item` and `customer` stay ungated
   wherever they are written — the gate is asked by capability, and the sweep
   test asserts the record kinds by kind rather than by module.
4. **The architecture and its decisions D1–D12 are frozen for implementation.**
   Scope is not broadened and no new product or security decision is taken
   without stopping for review; anything that genuinely cannot be built as
   written is a new PCN, not an assumption.

Rationale, recorded because a future session will need to know this was a
considered widening and not drift: Phase 3 §5's requirement 3 was already in the
package with no implementation, and §6's narrowing is what left it that way.
The ladder gives it one while leaving every sentence of P2, T3 and T5 literally
true — the counter never waits, the receipt always prints, the data is always
the customer's. What a lapsed pharmacy loses is the ability to restock, which
costs it real value over weeks without costing a single customer a second at the
counter.

### Plan amendment (accepted)

- **`docs/research/commercialization.md` §6** — "An expired licence shows the
  owner a banner; it does not stop the counter" becomes: "An expired licence
  never stops the counter, never stops a receipt printing, and never closes
  export. Past grace it withholds the capabilities that are not on the sale path
  — receiving, adjustment, catalogue packs and updates — and says so in plain
  words."
- **Same note, roadmap Phase 2 success criteria** — gains the same wording.
- **Phase 3 §5** — requirement 3 gains a pointer to the ladder as its
  implementation, so the requirement and its answer are no longer in two
  documents that disagree.

Applied in the source sections per the C1–C5 precedent of correcting the plan
rather than working around it downstream.

### Applied

- Plan amendments above applied to `docs/research/commercialization.md` §6 and
  its roadmap Phase 2 criteria, and to `docs/MASTER_PLAN.md` Phase 3 §5.
- Stage 1 of the licensing architecture implemented in this session: trust root,
  token, evaluator and ladder, the three tables with migration 0006 and grants,
  the clock model (five anchors, K=5 corroborated witness, two-sided
  `clockDisagreement`, signed `clockCeiling`), Settings surface, banner, issuing
  and inspection CLIs, support-bundle section, and soft binding with
  self-service rebinding.
- Online refresh, revocation-by-endpoint and activation limits are **not** in
  this slice; they are roadmap Phase 3 and the token format carries their shape
  without their code.

---

### Session 0 (Bootstrap) — nothing raised

Phases 5, 8, 9, 10 and 11 were re-read against each other for gaps that would
force an assumption during bootstrap. None was found; the C1–C5 fixes are
consistently applied throughout the package.

Tooling choices the plan deliberately leaves open were made in Session 0 without
a note, since they are not architectural decisions and no phase constrains them:
npm as package manager, Node 22, Vitest for unit and invariant suites, Playwright
for the single E2E path, ESLint flat config with Prettier. They are recorded in
`README.md` and are cheap to reverse.

## PCN-006 — perpetual authorization with a 30-day unlicensed evaluation; expiry retired

Session: (current) · Raised: 2026-09-19 · **Decided: 2026-09-20 — accepted (founder locked decisions 1–5)**
**Supersedes: PCN-005** (does not modify it — PCN-005 remains the record of the
decision this note reverses, per Phase 11 §4 / Phase 4 §7).

Like PCN-004 and PCN-005, this note changes a decision rather than filling a gap.
It is filed so implementation waits for the decision instead of proceeding under a
recommendation. The founder locked the five decisions this note records.

### The decision, in one line

The offline product is **perpetually licensed**. The licence answers _"is this
installation authorized?"_ — never _"has this customer paid this period?"_ A new
**unlicensed** installation may operate as a **full evaluation for 30 days**;
after that, without activation, it becomes **unauthorized (restricted)**. A valid,
bound, perpetual licence makes the installation **authorized with full
functionality indefinitely**, and the evaluation clock is never consulted again.
There is no expiry, renewal, grace, warn period, paid-through date, or countdown
on the authorized path.

### The lifecycle

    NEW / UNLICENSED INSTALLATION
              ↓
        30-DAY EVALUATION  (full functionality)
              ↓
      ┌───────┴────────┐

activate no activation
valid licence after 30 days
↓ ↓
AUTHORIZED UNAUTHORIZED
(full, forever) (restricted)
↑
└── revocation (separate, signed, time-independent) → RESTRICTED

The 30-day clock **belongs to the installation**, not to a customer, account, or
purchased licence. It is not a trial entitlement, not a subscription, not a grace
period, and not an expiry on the perpetual licence. Copying a _licensed_ install
to another machine yields **unbound** (restricted immediately) — it does not mint
a fresh evaluation.

### States and tiers

Two capability tiers — **full** and **restricted** — across five states:

| State            | Definition                                                   | Tier       |
| ---------------- | ------------------------------------------------------------ | ---------- |
| **evaluation**   | No valid bound licence, within 30 days of first use          | full       |
| **authorized**   | Valid signed token, bound to this installation, not revoked  | full       |
| **unauthorized** | No valid bound licence, past 30 days                         | restricted |
| **unbound**      | Valid token, bound to a different installation (a copy)      | restricted |
| **revoked**      | A valid signed revocation for this licence has been received | restricted |

`invalid` (bad signature / wrong pharmacy / unknown key / unreadable / format-too-
new) resolves to restricted as well, with its own message.

### Resolution order (why the clock dies on activation)

1. Valid signed **revocation** present → **revoked**. _(clock not read)_
2. Valid signed token **bound here** → **authorized** → return. _(clock not read)_
3. Valid token **bound elsewhere**, or token invalid → **unbound / invalid**. _(clock not read)_
4. No valid token → read the evaluation clock: within 30 days → **evaluation**,
   else → **unauthorized**.

Authorization is decided at step 2 and returns, so an authorized installation
never reads the evaluation clock, the witness, or the observation history.
Activation writes the bound-licence row and invalidates the resolver cache; the
next resolution hits step 2 and returns authorized — instantly, offline, with no
server. Decision 1 (Profile C) and decision 2 (L1 restatement) below govern the
restricted tier.

### Capability profile (Decision 1 — Profile C)

`✓ available · ✗ blocked · (read) view only`

| Workflow                                          | evaluation (≤30d) | unauthorized / unbound / revoked      | authorized |
| ------------------------------------------------- | ----------------- | ------------------------------------- | ---------- |
| Sales (new)                                       | ✓                 | ✗                                     | ✓          |
| Quick items (W6)                                  | ✓                 | ✗                                     | ✓          |
| Udhaar / credit sales (new)                       | ✓                 | ✗                                     | ✓          |
| **Settlement of EXISTING udhaar**                 | ✓                 | **✓ (carve-out)**                     | ✓          |
| **Drain already-captured offline sales (outbox)** | ✓                 | **✓ (carve-out)**                     | ✓          |
| Customers create/edit                             | ✓                 | ✗                                     | ✓          |
| Receiving stock / purchases                       | ✓                 | ✗                                     | ✓          |
| Stock adjustments                                 | ✓                 | ✗                                     | ✓          |
| Tenant product create/edit                        | ✓                 | ✗                                     | ✓          |
| Printing                                          | ✓                 | reprint existing ✓; new follows sales | ✓          |
| Reports                                           | ✓                 | ✓ (read)                              | ✓          |
| Catalogue browse/search                           | ✓                 | ✓ (read)                              | ✓          |
| **Catalogue updates/import (signed packs)**       | ✓                 | **✓ (never gated)**                   | ✓          |
| Settings / configuration                          | ✓                 | licence activation ✓; rest ✗          | ✓          |
| **Export / recovery**                             | ✓                 | **✓ (always)**                        | ✓          |

The two carve-outs are deliberate: an evaluator who extended real credit can still
**collect** it and close balances, and offline sales already captured during
evaluation can still **finish syncing** rather than stranding — neither creates
new business, and both prevent data loss.

### Decision 2 — the L1 restatement (the reversal)

PCN-005 and prior invariant L1 held that the sale path is ungated **in every
state**. That protected legitimate operation; it is now scoped to legitimate
installations only:

> **Legitimate operation is never blocked by licensing.** Evaluation and
> authorized installations conduct normal sales, settlements, receiving,
> adjustments and all workflows without any licence gate. **Unauthorized and
> revoked installations may not create new business** (no new sales, credit,
> customers, stock movements or catalogue authoring), **but their existing data
> and already-captured transactions remain fully recoverable** — visible,
> reportable, exportable, and (for the outbox and existing udhaar) drainable to a
> consistent close.

The mechanical guarantee behind the old L1 — that gating the sale path must never
strand captured offline records behind a stopped outbox — is **preserved** by the
outbox carve-out: in the restricted tier, **new capture is blocked at the counter,
but ingest of already-captured records continues**, so nothing strands or is lost.

### Catalogue update rule (unchanged intent, gate removed)

Catalogue import/update is part of the perpetual product and is **never gated by
licence state** — not by evaluation age, not by authorization, not by payment.
The bundled catalogue loads at install; signed catalogue packs remain the trusted
distribution mechanism, verified locally against the trust root and applied
offline. `--trusted-local` remains a **trust/bootstrap** distinction only and
carries no licensing meaning and confers no unauthorized-copy bypass for anything
else. The old `catalog_pack` capability gate is removed outright.

### Revocation (separate concept)

Revocation is a **founder-signed, time-independent security action** (chargeback,
confirmed piracy, leaked key). It is not evaluation end and not expiry. A revoked
installation is treated as restricted, keeps export/recovery and read access, and
**cannot self-clear** — only a new licence from the founder restores
authorization. Offline, a revocation takes effect only when the signed statement
reaches the machine; silence is never revocation. Evaluation end, licence
authorization, and revocation are three distinct concepts and are never conflated.

### The 30-day clock (Decision 3 — keep the witness, strip the subscription math)

The evaluation boundary needs a trustworthy "first use" anchor and a
rollback-resistant "now," and **only** those:

- **First-use anchor** = `min(installationFirstSeenAt, earliestEvent,
tenantCreatedAt, earliestObservation)` — already resistant to file deletion and
  trial reset. Retained.
- **Rollback-resistant now** = `max(systemNow, witness, ledgerHighWater)`, where
  the **witness is the corroborated K-th-largest clock observation**. Retained,
  because it is what stops "set the clock back to evaluate forever."
- **Removed:** `clockCeiling` (it existed to protect a _paying_ customer from a
  poisoned witness; authorized installs no longer read the clock, so a forward
  clock fault can only shorten a pirate's own free evaluation — self-harm, never
  an exploit). Also removed: the `licenceIssuedAt` clock anchor and all
  entitlement/grace/warn arithmetic.

The clock participates only in step 4 of resolution. Once authorized, it is inert.

### Licence token (Decision 5 — clean v2, identity only)

Move to a clean **format v2** payload. It carries identity and nothing time- or
payment-oriented:

- **Kept:** `v`, `kid`, `licenceId`, `tenantSlug`, `customerName`, `issuedAt`.
- **Optional, retained for future metadata:** `plan`, `branches` (unused by V1
  logic; no enforcement).
- **Removed:** `entitlementEndsAt`, `expiresAt`, `graceDays`, `warnDays`,
  `clockCeiling`.

The token does **not** carry an installation id; the installation **binds on first
use** (a `licences` row records this machine's id), which remains the correct and
retained model.

### Security / binding model (retained)

Kept in full, because it is exactly what a perpetual anti-copy licence needs:
Ed25519 trust root; the private signing key held outside the application, build
and CI; signed licence tokens; installation identity (able to _restore_ its id
rather than mint a new one); licence-to-installation binding on first use;
controlled rebinding within the existing allowance; signed revocation; signed
catalogue packs; tenant scoping; and the data-integrity guarantees. No hardware
fingerprinting.

### What is removed from the core

Statuses `licensed / expiring / grace / stale / lapsed`; tier `full_notice`; the
`trial` concept (renamed to _evaluation_, lengthened to 30 days); all
entitlement/grace/warn computation; `clockCeiling`; the online **renewal-token**
path (revocation delivery may remain, dormant); and every "days remaining /
renew" affordance on the authorized path.

### Guarantees this note keeps true

- **P2 (restated):** legitimate operation — evaluation and authorized — is never
  blocked or delayed by licensing. The unauthorized/revoked restriction applies
  only to installations that are not legitimately licensed, and even then never
  destroys, hides, corrupts, or withholds recovery of existing data.
- **T3 / Phase 3 §3:** full export/recovery is available in **every** state,
  forever.
- **T5:** printing is untouched; nothing about licensing appears on a receipt.

### What this obligates in code (non-normative pointer)

Token v2 and evaluator rewrite (`state.ts`); two-tier `capabilities.ts` with the
restricted withhold set expanded to new-business writes and the two carve-outs
excluded; conditional gating of the sale/customer/settlement/outbox paths by tier
(the L1 restatement — highest-risk change); removal of the `catalog_pack` gate;
trimmed clock in resolution; schema drop of the four expiry columns; banner and
Settings→Licence rewrite (evaluation countdown; unauthorized activation prompt;
authorized nominal, no countdown); founder tooling simplified to perpetual issue;
`db:seed`/demo to issue a dev perpetual licence or run its evaluation; tests for
`state`/gating/refresh rewritten (the two failing `licence-refresh` tests dissolve
with the renewal removal).

### Documents superseded or to be amended (not edited here)

PCN-005 (superseded); `commercialization.md` §0 and §6 (subscription premise and
expiry philosophy — amend to perpetual + optional Mehvar Care); phase-03 §5
("restrict on non-payment" — retired, export survival kept); MASTER_PLAN licensing
invariants (L1 restated as above; L5/L6 reduced from anti-expiry to
evaluation-boundary anti-rollback; L2/L3 retained); README and any code comments
describing licensing as subscription/expiry enforcement.

### Explicitly deferred — do NOT build under this note

**Mehvar Care** (optional recurring service: cloud backup, automatic updates,
owner mobile reporting, priority support, recovery assistance) — any _time-based_
entitlement lives there, never in the core licence; it may reuse the dormant
signed-refresh transport and must never hold the core product, its data, or an
already-obtained catalogue pack hostage. **Mehvar Cloud** (separate SaaS,
own subscription) — out of scope; must not influence this offline design.

### Nothing implemented at the time of filing.

---

## PCN-007 — supplier credit was built without a note, and its migration turned purchase history into debt

Session: release hardening (Day 18) · Raised: 2026-10-21 · Status: decided

**Plan sections in tension.** Phase 5 §6, _Explicitly out of the model (V1)_:
"supplier balances/payables". T4: "Any derived figure — a balance, a total, a
stock count — can be expanded into the transactions that produced it." T2:
"Corrections, not erasures." ADR-1: append-only records, derived truth.

**The contradiction or gap.** Two things, the second caused by the first.

1. Supplier credit (Day 17: `purchases.cash_paid_paisa`, `supplier_payments`,
   "Owed to suppliers") is a payables feature, which Phase 5 §6 excludes, and no
   note was ever filed for it. Its code and CHANGELOG cite "PCN-006", which is
   the licensing note; the CHANGELOG also calls its migration 0006 (it is 0009).
2. Migration 0009 added `cash_paid_paisa` with `DEFAULT 0 NOT NULL`. Every
   purchase that already existed was entered with no "Paid now" field, so its 0
   is a default, not a fact — and every one read as owed in full. The upgrade
   rehearsal (a populated pre-0009 install upgraded to 0009) showed "Owed to
   suppliers Rs 2,131,851.60" on the Day screen: the shop's entire purchase
   history, presented as debt. The only way to clear it in the product was to
   record supplier payments that never happened, which ADR-1 then makes
   permanent. A figure that cannot be expanded into real transactions breaks T4.

**Options.**

- **A. Edit 0009 in place** to add the column nullable. Correct for databases
  that have not run it; databases that have (development, test installs) keep
  the old shape. drizzle matches migrations by timestamp, not content, so
  nothing would notice — schema drift between installs, silently. Rejected.
- **B. Backfill in a new migration**: `UPDATE purchases SET … WHERE
cash_paid_paisa = 0`. Cannot tell a historical 0 from a purchase genuinely
  recorded as fully on credit since, and it rewrites rows of an event table.
  Against ADR-1 and T2.
- **C. Record what is actually known** (implemented, uncommitted): migration
  0010 adds `purchases.credit_tracked boolean`, added with `DEFAULT false` and
  then switched to `DEFAULT true`. Every row that existed reads false through
  PostgreSQL's stored default — no row is rewritten, no payment invented — and
  every purchase recorded since reads true. Balances count tracked purchases
  only; an untracked invoice's detail page says its payment was not recorded.
  Forward-only, survives dump and restore. Cost: on a database that already ran
  0009 AND recorded credit purchases before 0010 (development and test installs
  only; no pharmacy has run 0009), those purchases also become untracked.
- **D. Withdraw supplier credit** until a payables decision is made: revert the
  Day 17 feature. Honours Phase 5 §6 as written; loses a feature already built
  and tested.
- (Not proposed: an owner-entered opening balance per supplier, for debt that
  genuinely predates tracking. A future feature, if the owner wants it.)

**Recommendation.** C, and decide (1) explicitly: either amend Phase 5 §6 to
admit supplier payables (this note becomes their decision of record, with its
number, and the code's "[PCN-006]" labels are corrected to it) or choose D.
C is safe under either: it only makes the existing feature stop inventing debt.

**Decision.** 2026-10-21, the owner: **keep supplier credit**, adopt **C**,
and reconcile the plan. Supplier payables are admitted to the model; this note
is their decision of record. (The implementing session's note on why C: it
stops the feature inventing debt without rewriting any record.)

**Applied.** On `claude/epic-euler-jdspyu`, in the release-hardening commit
that numbers this note: Phase 5 §6 amended (payables in, derived like a
customer balance) and Phase 9 §3 amended (`purchases.cash_paid_paisa`,
`purchases.credit_tracked`, `supplier_payments`); migration
`0010_supplier_credit_tracked` with `schema.ts`, `supplier-queries.ts`,
`purchase-queries.ts`, the purchase detail page and `commit-purchase.ts`; the
supplier-credit code's "[PCN-006]" labels corrected to PCN-007 (licensing's
own PCN-006 citations untouched) and the CHANGELOG's "migration 0006"
corrected to 0009. Tests: `supplier-balance.integration.test.ts`,
`tests/supplier-credit-migration.integration.test.ts`.
