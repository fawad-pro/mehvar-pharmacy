# Phase 8 — Architecture, Technology Stack & ADRs

Status: Draft for review
Informed by: Phases 1–7. Satisfies exports from Phases 3 (§5), 5 (§7), 6 (§7), 7.

---

## 1. Architecture overview

One product, one codebase, one deployment: a **multi-tenant web application** — a single full-stack monolith serving every pharmacy, with a browser client engineered for counter resilience. No microservices, no separate API service, no mobile app (the owner's phone uses the same responsive web app). Every piece of this shape is chosen for a solo founder operating at near-zero marginal support cost (Phase 3) within a one-week build (charter constraint).

Three runtime surfaces, one system:
- **Counter client** (desktop browser, keyboard-first): the sale surface; locally resilient (ADR-3, ADR-4).
- **Owner surface** (any browser, phone-first layouts for W10/W11 views): read-heavy.
- **Server**: source of truth, all writes committed as immutable records (ADR-1), all derivations verifiable (ADR-8).

## 2. Technology stack

| Layer | Choice | Note |
|---|---|---|
| Framework | Next.js (App Router) + TypeScript | Founder's proven stack; speed via muscle memory (Phase 3 rationale) |
| UI | Tailwind + shadcn/ui | Restyled to Mehvar Pharmacy tokens (Phase 4 §5); no default-theme shipping |
| Database | PostgreSQL | Single instance, single schema, tenant-scoped rows (ADR-2) |
| Data access | Drizzle ORM | Thin, SQL-transparent — invariants live in SQL, not ORM magic |
| Hosting | Railway (app + Postgres) | Founder-operated already; automated backups mandatory (Phase 12) |
| Client resilience | PWA: service worker + IndexedDB | Scoped precisely by ADR-3/ADR-4 |
| Auth | Own session auth + counter PINs | Deliberate deviation from Clerk — ADR-7 |
| Printing | HTML/CSS 80mm receipts, kiosk silent print | ADR-6 |

No Redis, no queue infrastructure, no search service, no websockets in V1. Each absence is a P6 decision; the monolith plus Postgres covers every workflow in Phase 7 at single-pharmacy scale with headroom for hundreds of tenants.

## 3. Architecture Decision Records

### ADR-1: Append-only records, derived truth
**Decision:** All business events (Phase 5 §3) are immutable rows. No UPDATE/DELETE on committed records; corrections are compensating rows referencing their target. All balances and reports derive from records.
**Why:** This is Phase 5 §1 made physical — the entire trust posture (P4, T1–T4) as a schema property. Inherits Mehvar's proven ledger discipline (Mehvar ADR-2/ADR-18 lineage) scaled down.
**Consequence:** Phase 9 forbids mutable business columns; the invariant-6 rebuild test (Phase 5 §5) becomes implementable.

### ADR-2: Multi-tenancy — one database, row-scoped
**Decision:** Single Postgres, `tenant_id` on every tenant-owned row, enforced in the data-access layer with composite indexes; no schema-per-tenant, no database-per-tenant.
**Why:** Phase 3 requires multi-tenant day one; row scoping is the only variant compatible with one-week delivery and solo operations. Cross-tenant leakage is guarded by a single query-layer chokepoint (Phase 9 §5) rather than scattered WHERE clauses.
**Consequence:** Tenant export (Phase 3 §5.2) is a scoped dump; suspension is a tenant flag; global catalog tables live alongside, tenant-free (Phase 6 §2).

### ADR-3: Connectivity resilience — offline capture for money-critical events only
**Decision:** The counter client is a PWA that keeps working through disruptions for exactly: cash sales, udhaar sales, settlements, and quick-item creation (W1–W3, W6). These commit locally (IndexedDB, client-generated IDs) and sync automatically on reconnect, idempotently. Everything else — purchases, adjustments, reports, catalog edits — requires a connection and says so calmly.
**Why:** Charter demands uninterrupted *selling*, not an offline-first product; Phase 1 downgraded outages to exceptional. This scope keeps the hard problem small: append-only events with client IDs make sync conflict-free by construction — there is nothing to merge, only to deliver.
**Consequence:** The receipt prints from local state instantly (rule 3, Phase 7); unsynced-record count is a visible semantic state (I7) and surfaces in the daily view once synced late.

### ADR-4: Search — client-side index over the tenant catalog
**Decision:** The counter loads the tenant's catalog (products, prices, barcodes, customers) into a client-side index (IndexedDB-backed, in-memory served). Every keystroke searches locally: normalized tokens + fuzzy matching tuned for Roman-Urdu-flavored misspellings; barcode hits resolve locally. Global-catalog assist (W7 inline create) searches the server. The index refreshes on catalog changes and on session start.
**Why:** I2's near-instant expectation cannot depend on network round-trips per keystroke; a tenant catalog of a few thousand items is trivially memory-resident. This one decision simultaneously delivers speed, the offline sale path (ADR-3 needs local product data anyway), and server simplicity (no search infrastructure).
**Consequence:** Index staleness is bounded and harmless (prices confirmed at commit); Phase 10 designs the search interaction knowing latency is effectively zero.

### ADR-5: Batch consumption resolved server-side at commit/sync
**Decision:** Sale lines record product + quantity. FEFO batch allocation (D1) and pending-layer creation (D2) happen in the server transaction that commits the sale — for online sales immediately, for offline sales at sync ingestion. The client never allocates batches.
**Why:** Allocation needs authoritative batch state; doing it client-side would require syncing batch quantities outward and inviting conflicts. Server-side allocation makes offline sales and online sales identical at ingestion — one code path, one invariant set.
**Consequence:** A batch-price difference (D1's display duty) uses the client's last-known price at sale time; final allocation may adjust recorded margin, never the customer's charged price. Daily view shows any such variances (T1).

### ADR-6: Receipts — HTML/CSS 80mm, silent print via kiosk mode
**Decision:** Receipts render as print-CSS HTML sized for 80mm (58mm variant) thermal paper. The counter browser runs with silent-printing enabled (Chrome `--kiosk-printing`, configured at install); fallback is the normal print dialog. No print agent, no driver integration, in V1.
**Why:** T5 demands professional receipts every time; a custom local agent is a support liability (P8) a solo founder shouldn't ship in week one. Kiosk-mode silent print is a documented, one-time setup step that fits assisted onboarding (Phase 3).
**Consequence:** The install guide (Phase 12) owns printer setup; receipt templates are product surface (Phase 10); the FBR seam, if ever needed, wraps receipt generation server-side (Phase 1 §3).

### ADR-7: Auth — own sessions + counter PINs (no Clerk)
**Decision:** Tenant device login (long-lived session on the counter machine) with in-app user switching by PIN per salesman/owner; owner logs in normally from any device. Implemented in-house with standard session cookies and hashing; no third-party auth service.
**Why:** The counter is a *shared terminal* — the real auth act is "which person is acting now," a PIN-switch interaction no hosted auth product models well. Clerk (the Mehvar choice) adds per-MAU cost, a network dependency in the sale path (violating ADR-3), and no benefit for PIN ergonomics. This is a deliberate, justified deviation from the founder's default stack.
**Consequence:** Every record's attribution (T1) comes from the active PIN user; session security posture documented in Phase 12; password reset is founder-assisted at V1 scale (P6).

### ADR-8: Derived state — transactional running quantities, always rebuildable
**Decision:** `batches.qty_remaining` (and only that) is maintained transactionally as an optimization; every other figure computes on read from records via indexed SQL. A rebuild routine recomputes all running quantities from records; an automated verifier runs it against live values on schedule and after sync ingestion.
**Why:** Pure compute-on-read keeps FEFO allocation queries hot-path expensive; pure caching invites drift. One cached quantity with a mechanical verifier is the smallest honest compromise — and the verifier operationalizes Phase 5 invariant 6 as a running production check, not just a test.
**Consequence:** Phase 11's core suite = rebuild-equivalence tests; any verifier mismatch is a sev-1 signal (it means the trust promise broke).

## 4. Cross-cutting notes

- **Commit latency (Phase 7 rule 3):** online commits are one server transaction; offline commits are local and instant; nothing in a sale path awaits anything slower than the local machine except the final online commit, which the operator does not wait on for receipt printing (print from committed-local state; ADR-3).
- **Suspension (Phase 3 §5.3):** tenant flag gates writes; export endpoint remains open regardless.
- **Trial = production (Phase 3 §5.4):** trivially satisfied — a trial tenant is a tenant.
- **Future seams honored, unbuilt:** FBR (wraps ADR-6 server-side), local deployment (the monolith containerizes; Phase 3 Option E), multi-branch (tenant model extends; nothing in ADR-2 precludes it).

## 5. Exports

- Phase 9: implements ADR-1/2/5/8 as schema; client-ID idempotency columns from ADR-3.
- Phase 10: designs against zero-latency search (ADR-4), PIN switching (ADR-7), unsynced-state visibility (ADR-3), receipt templates (ADR-6).
- Phase 11: rebuild-equivalence suite (ADR-8), sync idempotency tests (ADR-3).
- Phase 12: kiosk print setup, backup policy, session security, verifier alerting.
