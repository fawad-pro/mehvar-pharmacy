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

---

## PCN-008 — automatic FEFO sells expired batches first

Session: gap audit (Day 20) · Raised: 2026-10-22 · Status: decided, applied

**Plan sections in tension.** Phase 5 §4, D1: "Sales consume stock from the
earliest-expiry batch first, automatically. The salesman sees the price, not
the batch." P2: "Never block a sale." T1: "The owner sees everything; the
system forgets nothing." W12 manages near-expiry stock before it expires; no
section says what a sale does with stock that already has.

**The contradiction or gap.** Earliest-expiry-first is exactly the wrong order
once a batch is past its date: an expired batch is always the earliest, so it is
always consumed first. `lockBatchesForProducts` (`src/db/sales-queries.ts`)
orders by `expiry_date ASC` with no filter, `allocate` (`domain/inventory/
allocation.ts`) consumes in that order, and nothing on the Sale screen mentions
expiry. A pharmacy holding one expired strip and one good box sells the expired
strip, silently, and nothing records that it happened. Selling expired medicine
is a patient-safety matter and an offence; D1 never contemplated it.

**Options.**

- **A. Block the sale** when only expired stock remains. Safe, but contradicts
  P2, and the shelf may hold stock the system does not know about (D2).
- **B. Require the owner's PIN** to sell expired stock. A permission wall in the
  middle of a sale (Phase 7 cross-cutting rule 2), at a counter where the owner
  is often absent.
- **C. Skip expired batches when picking stock automatically; if only expired
  stock remains, warn plainly, naming the expiry, and record an exception.**
  The salesman decides, the owner sees it.
- **D. Leave D1 as written.** Rejected: the current behaviour is the defect.

**Recommendation.** C. It keeps P2 (nothing is blocked), makes the dangerous
case loud at the moment it happens and visible afterwards (T1), and changes
nothing for the ordinary case.

**Decision.** 2026-10-22, the owner: **C**.

**What C means, precisely** (the implementation contract):

1. A batch is expired when its `expiry_date` is before the current business day
   in the tenant's time zone. A batch with no expiry is never expired.
2. Automatic allocation consumes unexpired batches first, in D1's order; then
   expired batches; then the pending layer (D2). Expired stock is consumed only
   when nothing unexpired is left, never ahead of it.
3. Before commit, the Sale screen warns when a line would be met from expired
   stock, naming the expiry date, in plain words (I5). The warning never blocks
   payment.
4. Every allocation against an expired batch appears in the owner's daily view
   as its own exception kind, attributed like every other (T1, W10).
5. Offline (ADR-3/5): the warning uses the counter's local snapshot; the
   exception is derived from the allocation the server actually made, so an
   offline sale cannot dodge it.

**Applied.** 2026-10-22, uncommitted on `claude/epic-euler-jdspyu`. Phase 5 §4
D1, W1's failure moments and W10's exception list amended (master plan and
phase files). `planAllocation` takes the business day and orders unexpired
batches before expired ones before the pending layer; `commitSale` passes the
day the sale lands. The catalog payload carries expired stock per product, and
the cart warns "only expired stock left" / "part from expired stock", naming the
expiry, never blocking. The Day screen lists "Expired stock sold" first, derived
from the allocations the server made (`expiredStockSoldInRange`). Tests:
`allocation.test.ts` (seen failing against the old order),
`commit-sale.integration.test.ts`, `reporting-queries.integration.test.ts`,
`catalog-index.test.ts`, the stock-rebuild suite (expiry choices now always
include a past date), `e2e/expiry.spec.ts`.

---

## PCN-009 — purchases cannot be corrected, and distributor returns do not reduce what is owed

Session: gap audit (Day 20) · Raised: 2026-10-22 · Status: decided, applied

**Plan sections in tension.** Phase 5 §3, Adjustment: "Adjustments are the
only non-sale, non-purchase path by which stock moves." T2: "Mistakes are
reversed by compensating entries that reference what they fix." ADR-1:
append-only records. W8 handles "return to distributor" as a reason-coded
adjustment. PCN-007: a supplier balance is Σ tracked invoice cost − cash paid −
supplier payments.

**The contradiction or gap.**

1. **A wrongly entered purchase has no correction.** `count_correction` can put
   the stock right, but not the purchase: a mistyped unit cost distorts margin
   for every unit sold from that batch, and a mistyped quantity or cost
   overstates or understates what the shop owes that supplier, permanently. T2
   promises a compensating entry; none exists.
2. **A distributor return reduces stock but not the payable.** Before PCN-007
   there was no payable to reduce. Since PCN-007 there is, and a return recorded
   as an adjustment leaves the supplier balance overstated by the value
   returned.

**Options.**

- **A. Edit the purchase rows.** Rejected: ADR-1, T2, and the app role cannot
  update event tables.
- **B. Two compensating records.** A _purchase correction_ referencing the
  original purchase line (quantity change and/or corrected unit cost, with a
  reason), and a _supplier return_ (supplier, batch, quantity, credit value).
- **C. Reverse whole purchases and re-enter them.** One record kind, but a
  reversal of a partly sold batch drives it below zero and loses the batch's
  identity, and a one-line typo costs a twenty-line re-entry.
- **D. Document the limits and wait.** The margin and payable errors are
  silent, which is what T4 exists to prevent.

**Recommendation.** B.

- **Purchase correction.** Owner-only, online-only (like supplier payments).
  A quantity change moves that line's batch through ADR-8's sanctioned stock
  functions; a reduction larger than the batch still holds is refused, with
  the plain advice to record a count correction instead. A cost correction is
  applied by derivation, never by editing `batches` or allocations: reports and
  supplier balances read the corrected cost, and allocations made afterwards use
  it too. Supplier balances use the corrected invoice value.
- **Supplier return.** Records supplier, batch, quantity and a credit value
  defaulting to quantity × that batch's effective unit cost (editable). Reduces
  stock like an adjustment and reduces the supplier balance. Existing
  `distributor_return` adjustments stay readable; new returns use this record.
- Both are keyboard-driven, listed in the owner's daily view (T1), and become
  event kinds in the stock-rebuild suite.

**Decision.** 2026-10-22, the owner: adopt the recommendation (**B**).

**Applied.** 2026-10-22, uncommitted on `claude/epic-euler-jdspyu`. Phase 5 §3
and §5 invariant 1, Phase 9 §3/§4 and W7/W8 amended (master plan and phase
files). Migration `0011_purchase_corrections` adds `purchase_corrections` and
`supplier_returns`, both in `EVENT_TABLES` (INSERT-only for the app role).
Writers `commitPurchaseCorrection` and `commitSupplierReturn`, idempotent on a
client id; a correction locks the line's batch, so two corrections to one line
serialise. `batchLedger`/`rebuildQuantity` count both, so `db:verify` stays
exact. Supplier balances (one and all) add correction invoice deltas over
tracked purchases and subtract return credit. The data export now includes
`supplier_payments` (missing since PCN-007) and both new tables.

The open question is settled as expected: each correction records the batch's
`effective_unit_cost_paisa` after it, and `reportFigures` values every
allocation (and every restocked return) from a corrected batch at the latest
one — so units sold before the mistake was found are re-valued too. New
allocations still snapshot `batches.unit_cost_paisa`; reports override it, so
nothing else needs to read corrections. A correction that adds units does not
resolve the pending layer (a purchase or count correction still does).

UI: the invoice review page shows the corrected total beside the entered one,
the history, and one owner-only link to `/purchases/[id]/correct`, where both
forms live; both acts appear on the Day screen. Tests:
`purchase-correction.test.ts`, `supplier-return.test.ts`,
`commit-purchase-correction.integration.test.ts` (ledger and balance terms each
seen failing when removed), the stock-rebuild suite (two new event kinds and an
independent supplier-balance invariant; seen failing with the return term
dropped), `e2e/corrections.spec.ts`.

---

## PCN-010 — reconcile the plan with local-first and the pilot

Session: gap audit (Day 20) · Raised: 2026-10-22 · Status: decided, applied

**Plan sections in tension.** The gap audit (2026-10-22) compared the master
plan with the code after PCN-004 (local-first), PCN-006 (perpetual licence) and
PCN-007 (supplier payables):

- **Payables.** PCN-007 admitted supplier payables, but the consolidated
  master plan still excludes them: Phase 2 "What We Are NOT Building" ("Supplier
  accounting / payables ledger"), Phase 5 §2 Supplier ("No payables"), Phase 5
  §6 ("supplier balances/payables"), and Phase 13 §6's ledger. PCN-007 amended
  `docs/planning/phase-05` but not `MASTER_PLAN.md`, which is authoritative.
- **Phase 12** still describes a cloud deployment: Railway configuration,
  Sentry and uptime alerting, TLS at the platform, a nightly verifier nothing
  schedules. None of it exists for a local install.
- **Phase 13 §3** is the original build week, now history; there is no
  pilot-readiness plan.
- **Phase 3 §3/§5** keeps subscription, 14-day-trial and Rs 2,000/month wording
  that PCN-006 superseded.
- **W11** promises the owner's view "from anywhere"; it is LAN-only. **W1**
  promises "drawer opens"; nothing opens a drawer. **Phase 13 §2** targets a
  1,500–3,000-product verified catalogue head; 138 are verified.
- **OPERATIONS.md** says counters are added in Settings (there is no such
  section) and that 58 mm receipts work (the print CSS is 80 mm only).

**The contradiction or gap.** The authoritative plan no longer describes the
product being piloted, and decisions the pilot depends on were never recorded.

**Options.** A. Apply the amendments below to the master plan, the phase files
and OPERATIONS.md. B. Leave the plan as is and rely on PCNs. Rejected: the
plan wins every disagreement (CLAUDE.md), so a stale plan is a wrong spec.

**Recommendation.** A.

**Decision.** 2026-10-22, the owner, recorded for the pilot:

1. **Customer.** Neighbourhood pharmacies, mostly not tech-literate. Setup,
   opening stock and training are founder-done; development continues in
   parallel with the pilot.
2. **One counter** for the pilot. Multi-counter (a LAN, wired or Wi-Fi; no
   internet needed) follows later and needs: a way to add counters, a session
   that works over LAN HTTP, a refreshing search index, and a concurrency test.
3. **Remote owner access is LAN-only in V1.** W11 is restated accordingly; the
   cloud route stays in roadmap Phase 3.
4. **Updates are installer-based through the pilot.** The in-app updater stays
   deferred to roadmap Phase 2. The running version is shown in the app and a
   one-page update procedure is written.
5. **Backups are local and/or to a USB drive.** The backup folder is set from
   Settings and the last successful backup is visible to the owner; offsite
   backup stays in roadmap Phase 3.
6. **Tenders are cash and udhaar.** Digital wallets (JazzCash, Easypaisa) are
   the next tender type, soon after the pilot starts.
7. **Prescriptions and controlled-drug registers stay out of V1**, as a
   conscious exclusion rather than an oversight. The product makes no
   regulatory-compliance claim. A product-level "scheduled drug" flag remains
   possible later if a regulator or customer requires it.
8. Expired stock: PCN-008. Purchase corrections and supplier returns: PCN-009.

Open, not decided here: pilot pricing (free fixed-term pilot with written terms
and a founding price was recommended), and remote screen-share support for
non-technical shops (Phase 12 §7 currently excludes remote-control software).

**Applied.** 2026-10-23, uncommitted on `claude/epic-euler-jdspyu`, in
`MASTER_PLAN.md` and the matching phase files:

- **Phase 2:** the payables exclusion amended to PCN-007; the prescriptions
  exclusion widened to controlled-drug registers, with no compliance claim; a
  "First customers" paragraph (decision 1); the owner success criterion now
  reads "a phone on the shop's network".
- **Phase 3:** pricing restated as a one-time licence fee, figure not set,
  pilot terms open; collection amended; §5 items 4–6 amended. Superseded text
  retained. **§4's revenue illustration (Rs 20,000/year) is left as written**:
  it is arithmetic on a subscription price nobody now charges, and replacing it
  needs the figure the pilots will set.
- **Phase 5:** §2 Supplier carries the derived owed position; §6 adds
  controlled-drug registers and carries PCN-007's amendment into the master.
- **Phase 7:** W1 says nothing opens a drawer; W11 is LAN-only and depends on
  the LAN session.
- **Phase 12:** rewritten for the local install. Backup visibility, the nightly
  verifier, owner password/PIN change and LAN sessions are stated as **not yet
  built**, not described as if they existed.
- **Phase 13:** §2 restates the catalogue (138 verified, 3,819 reference); §3
  is now "Pilot readiness" with a status table, keeping the build-week record
  and cut order; §5, §6 and §7 amended.
- `phase-03` and `phase-12` were regenerated from the master blocks (keeping
  their own status line); the other phase files were edited in step. A drift
  check shows no non-status differences between master and phase files for
  Phases 2, 3, 5, 7, 12 and 13.
- **OPERATIONS.md:** 58 mm is not yet supported, the receipt printer is set as
  the Windows default and a test receipt printed; §6 "Adding a second counter"
  now says it is not yet possible and names the three missing prerequisites.

## PCN-011 — a credit with a supplier is shown nowhere

Session: Day 20 follow-up · Raised: 2026-10-23 · Status: decided, applied

**Plan sections in tension.** PCN-007 made what a pharmacy owes a supplier a
derived, signed position, "the mirror of a customer balance (invariant 3)".
The customer side shows both directions on purpose (`domain/udhaar/position.ts`:
an advance is "real money the shop is holding, so it must be visible"). PCN-009
added supplier returns, whose credit routinely exceeds what is owed.

**The contradiction or gap.** A negative supplier balance (an overpayment, or
credit for goods sent back from an invoice already paid) was legal and correctly
derived, but invisible: the owed list kept only balances above zero, the Day
total floored each supplier at zero, and that line hid itself at zero. A
supplier holding Rs 56 of the shop's money simply vanished from every screen.
Demonstrated against a scratch database on 2026-10-23.

**Options.** A. Show credit separately, as the customer side does, and warn
before a payment that leaves credit. B. Refuse overpayments. Rejected:
distributors take round sums and advances, and returns create credit with no
payment at all. C. Net credits against debts. Rejected: one supplier's credit
does not pay another's invoice.

**Recommendation.** A.

**Decision.** 2026-10-23, the owner: A, as recommended.

**Applied.** 2026-10-23 on `claude/epic-euler-jdspyu`.
`domain/suppliers/supplier-position.ts` holds the meaning (book summary, payment
effect). The Purchases panel lists "Credit with suppliers" beneath "Owed to
suppliers"; a payment larger than what is owed says how much will stay as credit
before it is recorded (a warning, never a block). The Day screen adds "Rs X
credit with N suppliers" beside the owed figure, only when there is credit.
Owed and credit are never netted. Phase 5 §6 notes it.

Not addressed here: a credit from a return against a purchase entered before
supplier credit existed (PCN-007's untracked history) is shown like any other,
although that invoice counts as owing nothing; the supplier payment action still
mints its idempotency id on the server, so a double submit can record twice.

## PCN-012 — pharmacists work in boxes and strips; Mehvar does the arithmetic

Session: unit review (post Day 20) · Raised: 2026-10-24 · Status: decided, applied to the plan (not yet implemented)

**Principle this note proposes (P9). Sophisticated inside, simple outside.**
The owner and the salesman never need to understand base units, paisa
conversions, batch valuation or migrations to sell a strip of medicine; those
are Mehvar's job. _Test: does anyone at the counter have to convert, divide or
know a stored figure to finish this task? If yes, the design is wrong._

### Plan sections in tension

- Phase 5 §2 says products have "selling prices **per unit level**", but Phase 9
  stores one `default_price_per_base_unit`, and purchase costs and sale prices
  are per base unit too. The plan intended per-level prices; the schema did not
  carry them.
- W7 says purchase quantity is entered at "any unit level", but the built
  purchase, opening-stock (W9) and adjustment (W8) screens accept base units
  only ("Qty (tab)", "Units to add"), with cost per tablet.
- Phase 9 §1 allows reference entities to edit "never anything a report derives
  from", yet a product's base unit and pack factors can be edited after stock
  exists, which silently changes the meaning of every recorded quantity.
- W5 and Phase 10 §4 put the unit behind the Tab key; the price column shows
  the per-tablet price even on a strip line.

### The problem, from the counter

An owner knows what a box or a strip costs and sells for. Nobody in the shop
counts tablets. Today Mehvar asks for both: cost per tablet on a box invoice,
tablets on the opening-stock screen, a per-tablet price on the product form.
Per-tablet storage also cannot represent real pack prices: a box of 14 at
Rs 250 is 1,785.7 paisa a tablet, so the box sells for Rs 250.04 or Rs 249.90,
and a box invoice drifts from the distributor's paper.

### Options

- **A. Units and prices per pack, conversions internal.** Recommended; detailed
  below.
- **B. Keep per-base-unit storage and convert in the screens.** Rejected: the
  rounding is in the stored figures, so no screen can make a box total exact.
- **C. Track stock per pack level (sealed boxes, open strips).** Rejected:
  every cut strip becomes a stock movement nobody records, and the counts drift
  from the shelf. Base-unit stock stays the single truth (Phase 5 §2, ADR-8).

### Recommendation: A

**What the owner and salesman see**

1. **A product's units, in its own words.** "1 strip = 10 tablets, 1 box = 10
   strips", pre-filled from the catalogue and confirmed against the pack. A
   bottle, tube, vial or piece has one unit and shows no unit choice at all.
2. **A price per unit, typed as the owner knows it.** Enter the strip price;
   Mehvar suggests the box and loose prices (editable). Each saved price is
   stored exactly. MRP is entered as printed, against the unit it is printed
   for.
3. **Only relevant units are offered.**
   - Shop level, asked once at setup: "Do you sell loose tablets/capsules?" It
     sets the default for new products.
   - Product level: one tick per unit, "Sell by tablet / strip / box". A unit
     not ticked never appears at the counter.
   - No other unit settings.
4. **One quantity control everywhere.** Large unit buttons labelled with the
   product's own words (Tab · Strip · Box), with **− qty +**, as in the sale
   line. Same control on sale, purchase, opening stock, adjustments, returns,
   supplier returns and corrections. Keyboard shortcuts remain for speed but are
   never required.

   | Screen                       | Units offered                                                | Default                                                      |
   | ---------------------------- | ------------------------------------------------------------ | ------------------------------------------------------------ |
   | Sale                         | units ticked "Sell"                                          | last unit used for that product, else the smallest sold unit |
   | Purchase                     | pack units (never loose)                                     | the largest pack                                             |
   | Opening stock / count        | one box per offered unit: Boxes [ ] Strips [ ] (Tablets [ ]) | —                                                            |
   | Adjust, returns, corrections | as sale or purchase                                          | the unit originally used                                     |

5. **Prices and costs follow the chosen unit.** "× Rs 27.60" per strip at the
   counter; "Cost per box" and "Bonus (boxes)" on a purchase. Opening-stock cost
   is per unit too, and required (see decision 5).
6. **Stock is stated as an amount, never as a shelf Mehvar has not seen.**
   _(Modified on approval.)_ A quantity is the same amount written in the
   product's own units, largest first: **"12 boxes, 3 strips, 7 tablets"**. It
   says _how much_ there is, and nothing about what condition it is in: no
   "loose", "open", "sealed" or "cut" anywhere, because Mehvar does not record
   which packs are opened and a word implying it would be a claim it cannot
   back. Rules:
   - only units the product has, only non-zero parts, unit names as the owner
     set them;
   - the remainder is always shown, in the smallest unit, even when the shop
     does not sell that unit, because hiding it would understate stock;
   - each batch shows its own amount the same way beside its expiry, so the
     product total is the sum of what is listed;
   - negative stock reads "Short by 2 strips"; never a minus sign;
   - the exact smallest-unit total is on the product's detail page, never
     required.

   A physical count is entered the same way (Boxes, Strips, Tablets as they sit
   on the shelf), so what the owner types and what Mehvar shows use one
   vocabulary.

**What Mehvar does inside**

- Stock, batches, FEFO, the pending layer and the ADR-8 verifier stay in
  integer base units, unchanged.
- Every transaction line stores what was actually entered and charged: the
  unit, the count, the price or cost per that unit, and the exact line amount.
  Invoices, receipts, sale totals and supplier balances add up line amounts, so
  they match paper to the paisa.
- **Margin-cost reconciliation** _(modified on approval)._ Each batch carries
  its exact total cost (what was paid for the line, bonus units included at no
  extra cost). Allocations are costed **cumulatively**: the cost of the first
  _n_ units taken from a batch is the batch total × _n_ ÷ units received,
  rounded **up** to the paisa, and each allocation's cost is the difference
  between the running figure after it and before it. Both properties are
  tested:
  - at every point, recognised cost is never less than the true proportional
    cost, so a reported margin is never better than the real one;
  - when a batch is used up, its allocation costs add up to exactly what was
    paid. No paisa is lost or invented.

  Corrections (PCN-009) restate the batch total and apply the same rule to
  units taken afterwards; returns restock at the cost the units left with.

- **Correction to Day 6's rule.** `effectiveUnitCostPaisa` floors the per-unit
  cost and claims this keeps margin "never better than the truth". It does the
  opposite: a lower cost reports a higher margin. The error is at most one
  paisa per unit, but the stated guarantee is false; the cumulative rule above
  replaces it when this note is implemented.

### Protecting pack configurations

- Once any batch, purchase, sale, adjustment or return references a product,
  its smallest unit and every existing pack size are **locked**. Adding a larger
  pack (e.g. a carton) and renaming a label stay allowed.
- Units get a stable internal key, so renaming "Tab" to "Tablet" never orphans
  history; lines also keep the name as it was shown.
- Pack sizes must nest: a box holds a whole number of strips.
- A pack entered wrong after trading starts is fixed by a guided "replace this
  product": a new product with the right pack, with stock moved across through
  reason-coded adjustments, so history stays true.

### Data model

| Table                                                                          | Change                                                                                                                                                                                                                            |
| ------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `products`                                                                     | `units` JSONB: `[{key, name, factor, pricePaisa, sell}]`, smallest first; `mrp_paisa` + `mrp_unit_key`. The old `base_unit_name`, `pack_levels` and `default_price_per_base_unit` are kept in step for one release, then retired. |
| `tenants.settings`                                                             | `sellsLoose` boolean (no schema change).                                                                                                                                                                                          |
| `sale_lines`                                                                   | add `unit_key`, `unit_name`, `unit_count`, `unit_price_paisa_entered`, `line_amount_paisa` (before line discount). `qty_base` stays.                                                                                              |
| `purchase_lines`                                                               | add `unit_key`, `unit_name`, `unit_count`, `bonus_unit_count`, `unit_cost_paisa_entered`, `line_cost_paisa`.                                                                                                                      |
| `batches`                                                                      | add `cost_total_paisa`, and `prices_at_receiving` JSONB (each unit's price when the batch arrived, so D1's batch-price rule applies per unit).                                                                                    |
| `adjustments`, `sale_return_lines`, `supplier_returns`, `purchase_corrections` | add `unit_key`, `unit_name`, `unit_count` for display; corrections also the entered cost.                                                                                                                                         |
| `global_products`                                                              | `reference_mrp_unit` beside `reference_mrp_paisa`; the catalogue CSV import asks whether a list's price is per pack (default) or per unit.                                                                                        |
| Offline records (ADR-3)                                                        | carry the same entered fields; schema version bumped.                                                                                                                                                                             |

### Migration and backward compatibility

- **History is never rewritten (ADR-1).** New event-table columns are nullable;
  old rows are read through a fallback (line amount = per-base price × base
  quantity), which is exactly what was charged or invoiced at the time. No
  backfill touches an event row.
- **Products** (reference rows) are converted once: each pack level's price =
  per-base price × factor, every unit ticked "Sell", `sellsLoose` = true for
  existing shops, so nothing they sell today disappears.
- **Figures do not move.** Every receipt reprints identically; day totals come
  from stored sale totals; supplier balances, stock and margins for existing
  rows are unchanged to the paisa (asserted by tests below).
- **Offline skew:** ingestion accepts the previous record version for at least
  one release; an old record is ingested as base units.
- **Rollout (P8):** additive migration through the normal installer update; no
  owner action, no counter downtime beyond the update itself. Export gains the
  new columns.

### Tests

1. **Exact amounts:** a box of 14 at Rs 250 charges Rs 250.00; a mixed-unit
   invoice totals the paper figure; supplier balance equals Σ line costs exactly.
2. **Margin-cost reconciliation:** for every batch and every prefix of its
   allocations, recognised cost ≥ the exact proportional cost; once a batch is
   used up, Σ allocation costs = batch cost total exactly; per-unit flooring
   must fail this test before it is believed (Day 8).
3. **Crown suite (extended, not forked):** random sales, purchases, adjustments,
   returns and corrections in random units; assert base-stock rebuild, Σ line
   amounts − discounts = sale subtotal, Σ line costs = invoice total, plus every
   existing Phase 5 §5 invariant.
4. **Units:** nesting validation; conversion; display equivalence (never more,
   never less than the base quantity; no sealed/opened claim); negative stock.
5. **Guards:** editing a locked unit is refused; adding a larger pack and
   renaming a label are allowed; history still displays after a rename.
6. **Compatibility:** a database holding pre-change rows produces identical
   receipts, day figures, supplier balances, stock and margins after the
   migration (run against a restored pre-change dump, as the restore drill does).
7. **Sync:** old and new record versions ingest to identical effects; replay N
   times stays exactly-once.
8. **E2E:** sell by strip and by box with the buttons (mouse and keyboard);
   receive in boxes with cost per box; opening stock as boxes + strips; stock
   view; a shop that does not sell loose tablets never sees a Tab button; no
   stock view contains "loose", "open" or "sealed".

### Out of scope

- **Whole-rupee checkout rounding** (e.g. Rs 27.60 → Rs 28) is a separate
  decision; nothing here assumes it.
- The open PCN-011 items (untracked-history credit, server-minted supplier
  payment id) are unaffected.

### Plan amendments

Phase 4 §1 (P9); Phase 5 §2 and the Purchase/Sale entries; W5, W7, W8, W9;
Phase 9 §1 conventions and the `products`, `purchase_lines`, `sale_lines`,
`batches` definitions; Phase 10 §4.

### Decisions put to the owner

1. Adopt P9 as a product principle.
2. Selling prices per unit and exact line amounts (option A) rather than
   per-base-unit prices.
3. Unit configuration: one shop question ("sell loose?") plus one "Sell" tick
   per unit per product, and nothing else.
4. Margin valuation: exact batch cost total, allocation cost rounded down.
   _Replaced on approval by the cumulative rule above._
5. Opening-stock cost: required, pre-filled from that product's last purchase
   when one exists. Alternative: allow "cost not known", which keeps the batch
   out of margin figures.
6. History: old rows read through the fallback, never backfilled.
7. Wrong pack after trading starts: "replace this product" with stock moved
   across, rather than allowing edits.
8. Stock wording: "12 boxes, 3 strips + 7 loose" as an amount, with the exact
   smallest-unit total on the product detail page only. _Replaced on approval:
   "12 boxes, 3 strips, 7 tablets", with no condition words._
9. Delivery order: the locks and nesting check first (they enforce Phase 9 §1
   as written), then the data model, then the shared quantity control, then the
   stock display.

**Decision.** 2026-10-24, the owner: **approved**. Decisions 1–3, 5–7 and 9 as
recommended (opening-stock cost required, pre-filled from the last purchase; a
wrong pack fixed by "replace this product"), with two modifications:

1. **Margin-cost reconciliation** replaces decision 4: allocations are costed
   cumulatively, rounding up, so recognised cost is never understated and a
   used-up batch reconciles exactly to what was paid.
2. **Truthful stock wording** replaces decision 8: stock is stated as an amount
   in the product's units ("12 boxes, 3 strips, 7 tablets"), with no word
   implying opened, loose or sealed packs.

Whole-rupee checkout rounding remains a separate, undecided question.

**Applied.** 2026-10-24, to the plan only: Phase 4 §1 (P9), Phase 5 §2 and the
Purchase/Sale entries, W5, W7, W8, W9, Phase 9 §1 and its table definitions,
and Phase 10 §4, in `MASTER_PLAN.md` and the matching phase files. CLAUDE.md's
identifier list now reads P1–P9, and its Day 6 costing lesson is marked
superseded. Implementation follows decision 9's order.

**Step 1 implemented** (2026-10-24, on `claude/epic-euler-jdspyu`):
pack sizes must nest (a level holds a whole number of the level below), and a
product with any batch, sale line, purchase line or adjustment refuses a change
to its base unit or existing pack sizes, while price edits and a larger pack on
top stay allowed. Levels a product already had before nesting existed are
grandfathered for unrelated edits. The edit form says the units are fixed
before Save. **Renames are refused for now**, stricter than this note's end
state: a unit's name is still its identity (barcodes and sale lines refer to it
by name); renames become allowed with the stable unit keys of step 2. A wrong
pack is fixed today by adding the product again; the guided "replace this
product" flow lands with step 2.
