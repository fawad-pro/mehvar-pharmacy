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
