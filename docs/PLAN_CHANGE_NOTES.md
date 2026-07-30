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

_None._

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
