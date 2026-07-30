# Mehvar Pharmacy

Trust-first pharmacy POS and operations platform for independent Pakistani
pharmacies.

> **"Software that's faster than the register — and can't lie."**

## Status

Planning complete. **Session 0 (bootstrap) complete.** Feature implementation
begins with Session 1 (Phase 13, Day 1): the Phase 9 schema, the tenant
chokepoint, migrations and seed, the app shell, and device login with PIN
switching.

## Specification

The authoritative specification is **`docs/MASTER_PLAN.md`** — the consolidated
thirteen-phase planning package. The individual phase documents live under
`docs/planning/`. `CLAUDE.md` is the short-form working agreement for
implementation sessions; `docs/PLAN_CHANGE_NOTES.md` is where a discovered flaw
in the plan gets raised rather than patched around.

## Architecture in one paragraph

One multi-tenant Next.js (App Router) monolith on Railway with one PostgreSQL
database, serving three surfaces from one codebase: the keyboard-first counter
client, the owner's phone views, and the server as source of truth. All business
events are immutable rows; every balance, stock level and report is derived from
them (ADR-1). Tenancy is row-scoped through a single data-access chokepoint
(ADR-2). The counter keeps selling through a connectivity disruption by
capturing money-critical events locally and syncing them idempotently through
the same server-side writer that handles online sales (ADR-3, ADR-5). Search runs
against a client-side index of the tenant catalog, so keystroke latency is
effectively zero (ADR-4). Money is integer paisa; stock is integer base units.

## Getting started

Requires Node 22+ and Docker (for the local database).

```bash
npm install
npm run hooks:install          # pre-push: typecheck + lint + tests

cp .env.example .env           # then set SESSION_SECRET
docker compose up -d postgres

npm run db:reset && npm run db:migrate && npm run db:seed
npm run dev
```

`db:reset && db:migrate && db:seed` must always produce a working demo pharmacy
(Phase 11 §4) — the demo is a build artifact, always one command away. From
Session 1 onward it seeds ~50 curated products with real pack structures, a
customer with a balance, opening batches, and an open purchase draft.

## Commands

| Command                                       | Purpose                                              |
| --------------------------------------------- | ---------------------------------------------------- |
| `npm run dev` / `build` / `start`             | Next.js                                              |
| `npm run typecheck`                           | `tsc --noEmit` (strict; `any` forbidden)             |
| `npm run lint`                                | ESLint — includes the layering and token rules below |
| `npm run test`                                | Vitest: unit and invariant suites                    |
| `npm run e2e`                                 | Playwright: the single W1 keyboard path              |
| `PLAYWRIGHT_CHROMIUM_PATH=… npm run e2e`      | …against a Chromium already installed on the machine |
| `npm run verify`                              | typecheck + lint + test (what pre-push runs)         |
| `npm run db:generate`                         | Generate a migration from the Drizzle schema         |
| `npm run db:migrate` / `db:reset` / `db:seed` | Database lifecycle                                   |

## Repository layout (Phase 11 §1)

Structured by domain, not by technical layer. Each directory carries a
`README.md` stating its contract.

```
src/
  app/          routes: counter surfaces + owner phone views
  domain/       THE CORE — sales, purchases, inventory, udhaar, cash, catalog, reporting
  db/           schema.ts (Phase 9 verbatim), scoped.ts (the tenant chokepoint), migrations
  client/       search (local index), sync (offline queue), keyboard (one key registry), print
  components/   shadcn restyled to tokens
  lib/          branded types, money/quantity math, business-day helpers
```

## Rules the tooling enforces for you

- `domain/` cannot import `app/`, `components/`, or framework code.
- Nothing outside `src/db` can import `drizzle-orm`, `pg`, or `db/client.ts` —
  every query goes through the tenant chokepoint (ADR-2).
- No raw hex colours in `components/` or `app/`; `src/app/globals.css` is the
  single home for token values (Phase 10 §6/§9).
- TypeScript strict, `any` is an error, unused locals are errors.

Everything else is enforced by review against `CLAUDE.md` and the master plan.

## Tooling decisions

The planning package deliberately leaves these open; they are not architectural
and are cheap to reverse: **npm**, **Node 22**, **Vitest**, **Playwright**,
**ESLint flat config + Prettier**, **Tailwind v4** with tokens as CSS variables.

There is deliberately **no CI** — Phase 11 §4: "No CI in week one; the pre-push
script runs typecheck + tests (P6: ceremony proportional to team size)."

`npm audit` currently reports advisories in transitive build tooling
(`eslint-config-next`, `drizzle-kit`, Next's own `postcss`/`sharp`). Every
available "fix" is a major downgrade of the direct dependency, so none is
applied. None sits in the money path. Re-checked at the monthly patch review
(Phase 12 §5).

## Not yet built

Everything with business behaviour. Session 0 delivered the scaffold, the
tooling, the design tokens and the unit primitives — no schema, no domain logic,
no screens. See the session table in `CLAUDE.md`.
