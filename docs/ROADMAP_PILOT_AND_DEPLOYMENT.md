# Mehvar Pharmacy — the way forward: offline, online, and the pilot

## Context

The offline (local) product is nearly done: Windows installer (`packaging/windows`),
licensing (PCN-006), offline outbox (ADR-3), catalogue packs (`domain/catalog/pack.ts`,
`scripts/catalog/*`). Still open: redesign sessions D–G, Step 6 (staff accounts and
permissions), barcode generation for local products, a 10–15k catalogue, and an
online version for the pilot. The owner wants the pilot served **without forking or
bending the product**, and a clear model for databases, updates and sync.

The direction is already decided and is the base for everything below:
PCN-004 (local-first, optional cloud, **one codebase, one image, `scoped.ts` in every
install**) and PCN-010 (pilot decisions). Roadmap Phase 4 already lists "optionally
cloud-hosted tenants, same image". This plan pulls that one item forward for the pilot;
it does not change the product's direction.

---

## 1. The model: one product, three ways to run it

|                           | **Local (Offline)** — default           | **Online (Cloud)** — pilot                                                      | **Hybrid** — later                     |
| ------------------------- | --------------------------------------- | ------------------------------------------------------------------------------- | -------------------------------------- |
| Where the server runs     | Shop PC (Node + Postgres)               | Railway, shared                                                                 | Shop PC, plus a cloud copy             |
| Database                  | Local Postgres, 1 tenant                | One Postgres, many tenants                                                      | Local is the truth; cloud holds a copy |
| Internet blackout         | No effect at all                        | Counter keeps selling (outbox, local print); receiving, reports, day close wait | No effect; copy catches up             |
| Owner sees shop from home | LAN only                                | Yes                                                                             | Yes                                    |
| Backups                   | Nightly local + USB                     | Railway backups + nightly dump                                                  | Local + cloud copy                     |
| App updates               | Installer (rare, optional)              | Automatic on deploy                                                             | Installer / updater                    |
| Catalogue updates         | Catalogue pack file, import in Settings | Applied once, all tenants get it                                                | Same as local                          |

Rules that keep it one product:

- **Same code, same migrations, same image.** The only difference is configuration
  (`MEHVAR_DEPLOYMENT=local|cloud`): licence source, backup job, and which setup
  screens show. No `if (cloud)` in `domain/`.
- **No two-way sync, ever planned.** Hybrid is a **one-way copy** local → cloud. ADR-1
  (append-only) + UUIDv7 ids make that simple: ship new event rows, never edits. The
  shop stays the single source of truth.
- **Migrations stay forward-only and additive** (Phase 12 §2), so an old offline
  install and the newest cloud run against compatible schemas, and an offline shop
  that never updates is never broken by the cloud moving ahead.
- **Online → Offline is a move, not a rewrite**: the full export already covers every
  event table (`export-coverage.test.ts`); a later "move tenant" import lets an online
  customer go local (or local go hybrid) without data loss.

## 2. URLs and hosting

- DNS stays at Hostinger. `app.getmehvar.com` stays the hospital product.
- Pharmacy online: **`pharmacy.getmehvar.com`** → CNAME to the Railway service domain
  (Railway issues TLS). Later: `getmehvar.com` = marketing site;
  `updates.getmehvar.com` = catalogue packs, licences, update manifest (roadmap Phase 2–3).
- Railway project "Mehvar Pharmacy": one Next.js service + one Postgres (+ a staging
  environment). Deploy from `main`; migrations run as the pre-deploy command.

## 3. Updates — how each thing reaches each customer

- **Bug fixes / features**: merge to `main` → cloud updates itself. Offline gets a
  tagged installer **only when worth it** (target: a few times a year). The offline
  build is frozen as **v1.0** once redesign + Step 6 + barcodes land; after that only
  serious fixes ship to offline shops.
- **Catalogue (the thing offline shops actually need)**: never needs an app update.
  Packs are versioned data, applied idempotently, refused if from a newer format
  (Day 10). Delivery: (a) file on USB/WhatsApp → Settings → Import catalogue;
  (b) later, auto-download when the shop happens to be online. Cloud applies a pack
  once — `global_products` has no tenant column, so every online tenant gets it.
- Honest note: "never update offline" is not fully achievable (Windows, printers and
  real bugs happen), but this design makes app updates rare and catalogue updates
  routine and safe.

## 4. Order of work (one Claude session each, Sonnet where marked)

1. **PCN-019 — cloud-hosted tenants for the pilot** (docs only, short). Records §1–§3
   above: Online mode pulled forward from roadmap Phase 4, licence per tenant in cloud
   mode, what Online cannot do during a blackout (stated to the pilot in writing).
2. **Cloud deploy for the pilot.** Dockerfile from the existing `standalone` build
   (`next.config.ts`, `scripts/package/build.mjs`); Railway service + Postgres;
   pre-deploy `db:migrate` then `db:grants`; tenant provisioning via
   `src/db/provisioning.ts` (a script: create pharmacy, owner, device); cloud-mode
   licence handling (reuse `scripts/licence/issue.ts`, one licence per tenant);
   nightly `pg_dump` to a Railway bucket; DNS CNAME at Hostinger. Pilot sees a demo
   on `pharmacy.getmehvar.com` — **with demo data only** (see the gate below).

   Keep room for online subscriptions (PCN-019 decision 10): read entitlement
   through one seam chosen by `MEHVAR_DEPLOYMENT`, keep a cloud tenant's
   entitlement in its own record, and leave the offline licence untouched.
   No billing is built now.

   > **Gate — no real pharmacy data online until verified.** Deploying early and
   > demonstrating is fine; the pilot's real stock, sales and customers go into the
   > cloud only after all three are checked and written down: (a) **authentication**
   > over the internet — device pairing, PIN lockout, secure session cookies, HTTPS
   > only; (b) **tenant isolation** — step 3 done and its cross-tenant test seen to
   > fail with the policy dropped; (c) **backups** — a nightly dump exists and one
   > restore drill into a scratch database has succeeded. Until then the demo tenant
   > is labelled demo and is wiped before go-live.

3. **Tenant isolation hardening** — before real pilot data, and before any second online tenant. Keep `scoped.ts`
   as the chokepoint and add Postgres **row-level security** as the second wall:
   `scoped.ts` does `SET LOCAL app.tenant_id` per transaction; a policy on every
   tenant table; app role without BYPASSRLS; integration test that tenant A can
   never read/write tenant B and that a query with no tenant set returns nothing.
   Own PCN (it touches ADR-2). Also: login/device pairing resolves exactly one tenant;
   per-tenant rate limits.
4. **Step 6 — staff accounts** (partly built: `owner`/`salesman` roles,
   `auth/owner-approval.ts`, owner-only "entered by mistake"). Audit first, then fill
   gaps: one owner; one account + PIN per salesperson; **"Can receive stock"** tick
   per salesperson; owner-only by default for discounts above a cap, reversals
   (PCN-013 cancellations), removing customers/suppliers. Needs a short PCN. Do this
   **before redesign G**, so G redesigns the final Settings screen.
5. **Redesign D** — Invoices/suppliers + Customers (Sonnet). Per `docs/redesign/PRIMER.md`.
6. **Redesign E** — Receipts and Returns (Opus, medium).
7. **Redesign F** — Products (Sonnet).
8. **Barcode generation for local/Ubqari products** (PCN first). Products with no
   maker barcode get an in-store code (EAN-13 in GS1's in-store range `20–29`, so it
   can never clash with a real GTIN), stored through the existing barcode linking;
   print labels on the receipt printer or an A4 sticker sheet. Fits naturally after F
   (Products).
9. **Redesign G** — Stock/Adjust + Day + Settings (Sonnet).
10. **Offline v1.0 release**: tag, build installer, Windows validation checklist
    (existing artifact), freeze.
11. **Catalogue to 10–15k** — mostly data work, runs alongside everything above
    with little Claude quota: collect distributor price lists / DRAP lists / local and
    herbal ranges as CSV → `scripts/catalog/import-csv.ts` → `validate.ts` →
    `build-pack.ts` → ship as a pack. Popular gaps (e.g. Reltus) first.

**Later (after the pilot proves the product)**

12. **Hybrid cloud copy** (roadmap Phase 3): local install pushes new event rows to the
    cloud when online; owner remote view + offsite backup. Never on the sale path.
13. **Online subscription management** for cloud tenants (unscheduled; its own PCN).
    The offline licence is untouched. See PCN-019 decision 10.
14. **Online catalogue/licence/update service** at `updates.getmehvar.com` (roadmap Phase 2).
15. **Insights** (Ailaaj One-style): only from tenants who opt in, aggregated and
    anonymised, built on the hybrid copy. One cheap step now: put a data-use/consent
    clause in the pilot and licence terms so the option exists later.

## 5. What not to do for the pilot

- No pilot-only branch, no pilot-only features in code paths (PCN-004 Option D was
  rejected for this reason). Pilot wishes go through a PCN like everything else.
- No two-way sync. No cloud dependency on the local sale path.

## Verification

- Cloud: `pharmacy.getmehvar.com` serves over HTTPS; W1 sale by keyboard works; cut
  the network in the browser → sale still completes and prints, badge shows unsynced,
  drains on reconnect; `npm run db:verify` clean on the Railway database.
- Go-live gate: auth, isolation and a restore drill each signed off in the PCN before
  the pilot's real data is entered online.
- Isolation: the cross-tenant integration test passes with RLS on, and fails if the
  policy is dropped (Day 8: see it fail first).
- Offline: installer on a clean Windows PC, validation checklist passes, catalogue
  pack import from USB works with no internet.
- Each session: `npm run verify` and the PRIMER's "Done, per batch" set.
