# Phase 12 — Deployment Operations, Security & Backups

Status: Draft for review
Informed by: Phases 3 (commercial), 8 (ADRs), 9 (schema), 11 (workflow). Governed by P8 — the shop opens tomorrow.

This document answers P8's test directly: *describe the worst thing that can happen on our side tonight, then show why the counter still sells at 9am.*

---

## 1. Topology & environments

**Production:** Railway — one Next.js service, one PostgreSQL instance, one region. Custom domain under the parent brand (Phase 4 §6). TLS terminated at the platform; HTTPS only, HSTS on.

**Environments:** `local` (developer machine), `staging` (Railway, own database, seeded demo pharmacy — doubles as the sales demo environment per Phase 11 §5), `production`. Three, no more; each additional environment is maintenance a solo founder pays for weekly.

**Configuration:** environment variables only, held in Railway; no secrets in the repository, no `.env` committed. Secret rotation is a documented manual procedure at this scale (P6).

## 2. Release procedure (P8 made operational)

1. **Release window:** deploys happen late night (after 11pm PKT) or Sunday mornings — never during counter hours, never mid-rush. This is a rule, not a preference.
2. **Forward-only migrations, committed with their feature** (Phase 11 §4). Every migration must be additive-safe: new columns nullable or defaulted, no destructive column drops in the same release that stops using them (drop in a later release, once verified). Deploys therefore never require a maintenance window.
3. **Pre-deploy gate:** typecheck + full test suite green, `db:reset && db:migrate && db:seed` clean from zero, W1 E2E passing (Phase 11 §3.5).
4. **Post-deploy verification:** run the ADR-8 rebuild verifier against production immediately after migration; confirm the sale path with one test transaction on the demo tenant; confirm receipt renders.
5. **Rollback posture:** application rollback is a platform redeploy of the previous image (minutes). Because migrations are additive-safe, the previous image runs against the migrated schema — this is *why* additive-safety is mandatory rather than tidy. Data is never rolled back; append-only records make forward correction the only honest repair (ADR-1).
6. **Client version skew:** the counter client may be running yesterday's build when a deploy lands. Offline-captured records carry client IDs and a schema version; ingestion accepts prior-version payloads for at least one release cycle (ADR-3 idempotency plus tolerance). A hard-refresh prompt appears only between sales, never mid-cart.

**P8 answer:** the counter client holds its catalog index locally and can capture sales without us (ADR-3/4). If our service is down at 9am, the pharmacy opens, sells, prints, and syncs later. If our latest release is broken, the previous image is minutes away and the schema still accepts it. Nothing about tomorrow's trading depends on tonight going well.

## 3. Backups & recovery

The pharmacy's entire business lives in one database; backup is a trust feature (T3), not an IT chore.

- **Platform backups:** Railway automated daily snapshots, retained per plan.
- **Independent nightly dump:** `pg_dump` to separate object storage outside the hosting provider, 30-day retention. One provider failure must not take the backups with the database — this is the single most important line in this document.
- **Targets:** RPO ≤ 24 hours for catastrophic loss (realistically minutes, since counter clients retain unsynced local records and the loss window is server-side only); RTO ≤ 4 hours to a restored, verified service.
- **Restore drill:** performed once before first paying customer and quarterly thereafter — restore latest dump into a scratch database, run the ADR-8 verifier, confirm invariants (Phase 5 §5) hold. An untested backup is not a backup.
- **Tenant self-service export** (Phase 3 §5.2, Phase 9 §8) is always available, in every payment state. It is simultaneously the trust argument, the retention ethic, and a customer-side backup we don't have to operate.

## 4. Monitoring & the verifier

- **Error tracking** (Sentry or platform-equivalent) with a hard rule: any exception on the sale commit or sync ingestion path pages the founder. Everything else is a queue reviewed daily.
- **Uptime check** on the sale surface, 5-minute interval, alerting to phone.
- **ADR-8 rebuild verifier on schedule** (nightly) and after every sync-ingestion batch. A mismatch is sev-1: it means a derived number disagreed with the records, which is precisely the promise the product sells (P4/T4). Alert loudly, investigate before anything else ships.
- **Business-health glance** (founder-side, weekly): tenants active, sales volume per tenant, unsynced-record ages, pending-layer backlog, quick-item completion queue depth. Unsynced ages and pending backlogs are early warnings of a pharmacy quietly falling out of the system — the churn signal that matters more than logins.

## 5. Security posture

Scaled honestly to a two-role, single-shop product holding no clinical data.

- **Tenant isolation:** the `scoped.ts` chokepoint (ADR-2, Phase 11 §1) is the guarantee; a test asserts that no query path constructs without tenant context. Postgres RLS remains the documented post-V1 hardening step.
- **Sessions:** device-bound long-lived session cookie for the counter (HttpOnly, Secure, SameSite=Lax), short-lived sessions for owner remote logins. PIN switching (ADR-7) changes the acting user within the device session; PINs are hashed (Argon2id), rate-limited, lockout after repeated failures with owner override.
- **Authorization** is enforced server-side per role on every mutation — never by hiding UI. Salesman scope per Phase 5 §2.
- **Data minimization as a genuine asset:** the product stores customer *name and phone only* (charter boundary) and no health or prescription data whatsoever. This is worth stating in sales conversations — there is no sensitive patient dataset to leak, by design.
- **Transport & storage:** HTTPS only; database encrypted at rest by the platform; backup dumps encrypted before upload to independent storage.
- **Counter machine hygiene** (documented in the setup guide, not enforceable by us): dedicated browser profile, no shared personal browsing, screen lock, UPS. Physical access to the counter machine is the realistic threat model, which is exactly why PIN attribution exists (T1).
- **Dependencies:** lockfile committed; monthly patch review; no unmaintained packages in the money path.

## 6. Counter setup guide (onboarding artifact)

A one-page, screenshot-led document the founder or channel partner follows per pharmacy:

1. Hardware check: PC minimums, 80mm (or 58mm) thermal printer, USB scanner, UPS.
2. Printer install; print a test receipt from the app.
3. Browser: dedicated profile, `--kiosk-printing` shortcut created (ADR-6), app pinned, PWA installed, autostart on boot.
4. Scanner: verify it emits Enter after the code; scan test.
5. Tenant setup: receipt header/footer, users and PINs, expiry horizons.
6. Opening stock (W9) — assisted, the adoption gate.
7. First live sale together, with the salesman driving.
8. Hand over: WhatsApp support number, the one-page keyboard cheat sheet (Phase 10 §3) printed and taped to the counter.

## 7. Support model

WhatsApp-first, founder-answered, at V1 scale — the channel this market already lives in. Response expectation set explicitly at sale: same-day for questions, immediate for anything blocking selling. Every support contact is logged in one place with its cause; recurring causes become product fixes, not FAQ entries (P5/P6 discipline). Remote assistance uses the owner surface plus screen-share; no remote-control software installed on counter machines.

## 8. Incident posture

Severity 1 = selling is blocked, or a derived number disagrees with records (verifier mismatch). Response: acknowledge to affected pharmacies by WhatsApp within minutes, restore selling first (the offline path usually means selling never stopped — say so plainly, it is reassurance backed by architecture), diagnose second. Corrections to data are always compensating records (ADR-1/T2), never edits, even during incidents. Every sev-1 gets a written note to self: cause, fix, and the test or guard that prevents recurrence.

## 9. Exports

- Phase 13: restore drill and printer setup are scheduled items in the launch sequence, not implied work.
- Master plan: this document owns every operational promise the commercial strategy makes (Phase 3 §5.3 suspension outcome, §5.2 export, uptime posture behind the subscription).
