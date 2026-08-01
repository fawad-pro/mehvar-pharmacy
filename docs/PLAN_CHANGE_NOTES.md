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
10 §7 requires *that same row* to print a receipt with a footer showing "the
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

## Decided notes

_None._

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
