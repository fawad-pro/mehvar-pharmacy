# Mehvar Pharmacy

Trust-first pharmacy POS and operations platform for independent Pakistani
pharmacies.

> **"Software that's faster than the register — and can't lie."**

## Status

Planning complete. **Sessions 0–1 complete** — the foundation is in: the Phase 9
schema, the tenant chokepoint, the demo pharmacy seed, the counter shell with its
key bar, and ADR-7 device login with PIN switching. Session 2 (Day 2) builds the
catalog and search.

One plan-change note is open for review: **PCN-001** (`docs/PLAN_CHANGE_NOTES.md`).

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

npm run db:setup               # migrate + grants + seed, in that order
npm run dev
```

`db:setup` is one command on purpose. The four steps are not independent:
`db:grants` is what CREATES the application role `mehvar_app`, and `db:seed`
connects as it. Run them separately and it is possible to stop halfway; the
symptom of skipping grants is not "role missing" but

    password authentication failed for user "mehvar_app"

because Postgres deliberately reports a non-existent role as an authentication
failure, which sends you looking at a password that was never wrong.

It also loads the bundled medicine catalogue (`catalog:seed`). Without it
`global_products` is empty and the Add Product picker finds nothing, for every
query — the catalogue is what makes adding a medicine a search and a price
rather than nine typed fields.

`db:setup` also brings an EXISTING development database up to date — run it
after pulling. It is safe to repeat: if the demo pharmacy is already there it is
kept, any seed products it is missing are added, and the medicine catalogue is
re-applied (idempotent on medicine identity).

What it deliberately does not do on a database that already has a demo pharmacy
is re-create sales, batches, cash movements or customers. Repeating those would
double the stock on every shelf and invent sales that never happened. For a
clean demo, ask for one:

```
npm run db:reset && npm run db:setup
```

`db:seed` prints the demo counter's setup key and the PINs it created.

### Licensing (PCN-006)

The product is **perpetually licensed**. A valid, founder-signed licence bound
to an installation authorizes it forever — there is no expiry, renewal, grace or
warn period. An **unlicensed** installation runs a **30-day evaluation** with
full functionality; after that, without activation, it becomes **restricted**:
new business is paused (new sales, quick items, new udhaar, new customers,
receiving, adjustments, product authoring) while **settling existing udhaar,
printing, exporting data, browsing and updating the catalogue, and activating a
licence always keep working**. Copying a licensed install onto another machine
reads as **unbound** (restricted), not a fresh evaluation.

`db:seed` gives the demo a dev perpetual licence bound to this machine, so a
fresh setup is authorized out of the box. Founder tooling: `npm run
licence:issue -- --slug <slug> --name "<Name>"` mints a perpetual token;
`npm run licence:inspect -- <token>` decodes and verifies one.

### Running the E2E suite

```
npm run e2e:reset              # db:reset + db:setup + playwright test
```

It needs a browser. Playwright downloads one on `npx playwright install`; where
that download is blocked but a Chromium is already present, point at it instead:

```
PLAYWRIGHT_CHROMIUM_PATH=/path/to/chrome npm run e2e:reset
```

The suite runs on one worker deliberately — one database, one paired device, one
receipt sequence. Parallel workers are counters contending for the same numbers.

`db:reset && db:setup` must always produce a working demo pharmacy
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

## Troubleshooting

- **`tsc` reports syntax errors inside `.next/dev/types/...`.** That directory
  is Next.js's generated route typing, not application code. Delete `.next`
  and rerun `typecheck`/`build` before investigating further — a stale or
  half-written generated file is a far more likely cause than a real error.
  Treat everything under `.next/` as disposable.

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

Two further guarantees are enforced by the database rather than by lint:

- **Event tables accept INSERT only.** `db:grants` REVOKEs UPDATE and DELETE from
  the application role, so ADR-1's immutability is a privilege, not a convention.
  This requires the app to connect as a **non-owning** role — a REVOKE against
  the table owner is silently inert. See `.env.example` and PCN-001.
- **`tenants` cannot be reached through a tenant scope.** It has no `tenant_id`
  column, so the chokepoint's type constraint rejects it at compile time;
  provisioning has its own narrow door in `src/db/provisioning.ts`.

Everything else is enforced by review against `CLAUDE.md` and the master plan.

## Tooling decisions

The planning package deliberately leaves these open; they are not architectural
and are cheap to reverse: **npm**, **Node 22**, **Vitest**, **Playwright**,
**ESLint 9 flat config + Prettier**, **Tailwind v4** with tokens as CSS
variables.

ESLint is pinned to 9.x because that is what Next 16 supports: the plugins
`eslint-config-next` bundles (`eslint-plugin-react`, `eslint-plugin-import`,
`eslint-plugin-jsx-a11y`) all cap their peer range at ESLint 9. Do not move to 10
until Next ships plugins that accept it.

There is deliberately **no CI** — Phase 11 §4: "No CI in week one; the pre-push
script runs typecheck + tests (P6: ceremony proportional to team size)."

`npm audit` currently reports advisories in transitive build tooling
(`eslint-config-next`, `drizzle-kit`, Next's own `postcss`/`sharp`). Every
available "fix" is a major downgrade of the direct dependency, so none is
applied. None sits in the money path. Re-checked at the monthly patch review
(Phase 12 §5).

## Testing

`npm test` runs unit and invariant suites. Suites ending `.integration.test.ts`
need Postgres and **skip themselves** when `DATABASE_URL` is absent, so a
checkout without a database still runs green — the pre-deploy gate (Phase 12
§2.3) runs them against a real database, which is where they count. The
immutability assertions additionally skip without `APP_DB_ROLE`, and say so.

## Not yet built

Everything from Day 2 onward: catalog and search, the sale commit, payment and
receipts, offline capture, purchases, reports and the owner surface. The counter
surfaces exist as routed placeholders naming the session that fills each one. See
the session table in `CLAUDE.md`.
