# `src/db` — schema, chokepoint, migrations

| File          | Role                                                             |
| ------------- | ---------------------------------------------------------------- |
| `schema.ts`   | Drizzle schema — **Phase 9, verbatim**. Session 1.               |
| `scoped.ts`   | **THE** tenant chokepoint (ADR-2, Phase 9 §5.2). Session 1.      |
| `client.ts`   | Raw pool + Drizzle handle. Importable only from within `src/db`. |
| `migrations/` | Forward-only, additive-safe, committed with their feature.       |

## Rules

- **Nothing outside `src/db` imports `drizzle-orm`, `pg`, or `client.ts`.**
  Enforced by lint. Row-scoped multi-tenancy means isolation is guaranteed by
  one disciplined module, not by the database — that module is `scoped.ts`.
- **Migrations are forward-only and additive-safe** (Phase 12 §2.2): new columns
  nullable or defaulted, no destructive drop in the same release that stops
  using a column. This is _why_ rollback works — the previous image must run
  against the migrated schema.
- **Event tables accept INSERT only** (ADR-1, Phase 9 §5.1). UPDATE/DELETE are
  REVOKEd for the app role. The only doors are allocation resolution and
  `qty_remaining`, and they open forward only.
- `db:reset && db:migrate && db:seed` must always produce a working demo
  pharmacy (Phase 11 §4).
