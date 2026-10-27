# Phase 12 — Deployment Operations, Security & Backups

Status: Draft for review
Informed by: Phases 3 (commercial), 8 (ADRs), 9 (schema), 11 (workflow). Governed by P8 — the shop opens tomorrow.

This document answers P8's test directly: *describe the worst thing that can happen on our side tonight, then show why the counter still sells at 9am.*

---

## 1. Topology & environments

> **Rewritten 2026-10-22 by PCN-010** for the local install PCN-004 chose. The
> cloud-era text it replaces (Railway production, platform TLS, Sentry and an
> uptime check, platform snapshots) is in this file's history and in PCN-004.

**Production: the Mehvar Node — one Windows machine per pharmacy**, installed by
one `MehvarSetup` `.exe`. It bundles the Next.js standalone build, a pinned Node
runtime, PostgreSQL as a Windows service (`MehvarPostgres`, port 5433,
listening on `localhost` only), the counter service (`MehvarNode`, port 3000,
hosted by WinSW), the nightly backup task and the support tools. Both services
start automatically and restart on failure. Data lives in
`C:\ProgramData\Mehvar`; program files in `C:\Program Files\Mehvar`.

**Counters.** The pilot runs **one counter**: Chrome in kiosk mode against
`localhost` on the Node itself. Further counters are browsers on the shop LAN
(wired or Wi-Fi; no internet needed), and are **not yet possible**: they need a
way to add a counter with its own receipt prefix, a session that works over
plain HTTP on a LAN (the session cookie is `Secure`, which browsers keep only
on HTTPS or `localhost`), a search index that refreshes while open, and a test
of two counters selling at once.

**Railway is retained** for the sales demo and for the cloud services roadmap
Phase 3 adds (offsite backup, owner remote view, licence and update services).
Nothing on it is on the path of a sale.

**Environments:** `local` (developer machine), `staging`/demo (Railway), and
each pharmacy's Node.

**Configuration:** `C:\ProgramData\Mehvar\.env`, written by the installer with
an ACL restricted to SYSTEM and Administrators. The installer owns its keys
(credentials, paths, port) and rewrites them on every install; every other line
is the shop's and is kept verbatim across updates. The build machine's `.env`
never enters the payload (stripped, then refused if present). No secrets in the
repository.

## 2. Release procedure (P8 made operational)

1. **Updates are installer-based through the pilot** (PCN-010). An update is the
   newer `MehvarSetup` run over the old one, by the founder or with the founder
   on a call. Setup, in order: dumps the database to `backups\pre-update\` and
   **stops with nothing changed** if it cannot; stops both services, and stops
   with nothing changed if either refuses; replaces the files; migrates and
   re-applies grants; restarts and verifies. The shop name and PIN pages are
   skipped on an existing pharmacy.
2. **Forward-only migrations, committed with their feature** (Phase 11 §4),
   additive-safe: new columns nullable or defaulted, no destructive drop in the
   release that stops using a column. A migration is never renumbered once it
   has run anywhere (Day 19).
3. **Release gate:** `npm run verify` green with the database suites running;
   the E2E suite green; the installer built from a clean commit (a dirty tree is
   refused) and stamped `<version>+<commit>`; the Windows validation checklist
   run on real hardware for any release that changes the installer.
4. **Post-install verification** is built into Setup: services running and
   automatic, the counter answering, event tables immutable for the app role,
   the ADR-8 verifier clean, a backup taken and restore-drilled, the nightly
   task scheduled, and the default printer checked (a warning, not a failure).
5. **Rollback posture:** the pre-update dump plus the previous installer.
   Because migrations are additive-safe, the previous build runs against the
   migrated schema; data is never rolled back — append-only records make
   forward correction the only honest repair (ADR-1).
6. **The in-app updater is deferred** to roadmap Phase 2, when installs outrun
   the founder's visits. Its acceptance criteria stand: a signed manifest, a
   code-signed installer, **no restart while the counter holds unsynced
   records**, a backup before migrating, staged rollout and a rehearsed
   rollback.
7. **Client version skew:** offline-captured records carry client IDs and a
   schema version; ingestion accepts prior-version payloads for at least one
   release (ADR-3).

**P8 answer:** the counter sells from its local index and captures offline
(ADR-3/4), so a stopped Node during an update or a crash means the counter keeps
selling and syncs when the service returns. A broken release is undone by the
previous installer and the pre-update dump.

## 3. Backups & recovery

The pharmacy's entire business lives in one database on one machine; backup is
a trust feature (T3), not an IT chore.

- **Nightly dump:** `pg_dump` at 02:30 by the `Mehvar\NightlyBackup` task, to
  `MEHVAR_BACKUP_DIR` (a USB drive is the recommended target — PCN-010
  decision 5), 30-day retention, refusing to keep an empty dump.
- **Pre-update and pre-restore dumps:** every update and every restore dumps the
  live database first, and refuses to proceed without it.
- **Visible to the owner — not yet built.** The last successful backup's age
  belongs on the Day screen, and the backup folder belongs in Settings; today a
  failing backup is silent in the app and the folder is set by editing `.env`.
- **Offsite copy:** encrypted, outside the shop — **in deficit until roadmap
  Phase 3.** Local and USB copies are the accepted, time-boxed cost of a local
  install, and who owns a dead disk with no checked backup is a commercial
  question still open (`commercialization.md`, open question 2).
- **Restore drill:** run by Setup at install, and quarterly — the newest dump
  restored into a scratch database, migrated, granted, checked for immutability
  and verified as the app role. An untested backup is not a backup.
- **Replacing the counter PC:** install, then `mehvar-restore.cmd <dump>
  --replace`. The backup proves itself in a scratch database before it replaces
  anything; the replaced database is kept and dumped; a new pairing key is shown
  once; the licence moves from Settings → Licence.
- **Owner export** (Phase 3 §5.2, Phase 9 §8) is available in every licence
  state.
- **Targets:** RPO ≤ 24 hours (the nightly dump); RTO ≤ 4 hours to a restored,
  verified Node, given the USB drive and a Windows PC.

## 4. Monitoring & the verifier

There is no cloud monitoring in a local install, and nothing phones home.

- **Logs** in `C:\ProgramData\Mehvar\logs` (installer, services, backups),
  credentials masked before they are written.
- **Support bundle** (Start menu → Mehvar → Support bundle): build identity,
  verifier result, backup age, licence state and log tails, with secrets
  redacted, sent over WhatsApp.
- **ADR-8 verifier:** runs in post-install verification and in every restore
  drill. A **nightly run beside the backup, with a mismatch shown in the app, is
  not yet built**; until it is, a mismatch surfaces only when someone runs it. A
  mismatch is sev-1: a derived number disagreed with the records.
- **Founder glance** (weekly, from support bundles during the pilot): backup
  age, pending-layer backlog, unsynced-record ages, quick-item queue.

## 5. Security posture

Scaled honestly to a two-role, single-shop product holding no clinical data.

- **Tenant isolation:** the `scoped.ts` chokepoint (ADR-2); kept in a
  single-tenant install so one codebase serves both homes.
- **Database:** the app connects as a non-owning role; event tables are
  INSERT-only for it (PCN-001), proven at install by an UPDATE that must be
  refused. PostgreSQL listens on `localhost` only, with SCRAM authentication.
- **Sessions:** a long-lived device session for the counter, a 12-hour session
  for the owner's remote view; cookies are HttpOnly and SameSite=Lax, and
  `Secure` in production — which works on `localhost` and **blocks LAN counters
  and the owner's phone until the LAN-session decision is made and built.**
- **PINs and passwords:** Argon2id; four-digit PINs; five wrong PINs lock that
  person out for five minutes. The owner's password is generated at install.
  **Changing the owner's password or the owner's own PIN is not yet built.**
- **Authorization** is enforced server-side per role on every mutation, never by
  hiding UI; licence capabilities are checked at the action.
- **Data minimization:** customer name and phone only; no health or prescription
  data (Phase 2). There is no patient dataset to leak, by design.
- **Secrets:** none in the repository or the installer payload; the installer
  log and the support bundle mask credentials, pairing keys and passwords.
- **The machine:** physical access to the counter PC is the realistic threat,
  which is why PIN attribution exists (T1). Dedicated browser profile, screen
  lock, UPS — documented, not enforceable by us.
- **Dependencies:** lockfile committed; monthly patch review.

## 6. Counter setup guide (onboarding artifact)

Founder-done for the first pharmacies (PCN-010 decision 1). One page,
screenshot-led:

1. Hardware: 64-bit Windows 10/11, 4 GB RAM, SSD, a dedicated machine; an
   80 mm thermal printer (58 mm is not yet supported); a USB scanner that sends
   Enter; a UPS.
2. Printer driver installed, a Windows test page printed, the receipt printer
   set as the Windows default (Setup warns if the default is a PDF or similar).
3. Run `MehvarSetup` attended (a silent first install is not supported); enter
   the shop name and owner PIN; note the pairing key.
4. Open the counter, pair it, print a test receipt from Settings.
5. Settings: receipt header/footer, users & PINs, the licence.
6. Point backups at the USB drive (`MEHVAR_BACKUP_DIR` in `.env` until Settings
   has it) and confirm one lands.
7. Opening stock (W9), assisted — the adoption gate.
8. First live sale together, with the salesman driving.
9. Hand over: WhatsApp support number and the keyboard cheat sheet.

## 7. Support model

WhatsApp-first, founder-answered. Same-day for questions, immediate for anything
blocking selling. Every contact logged with its cause; recurring causes become
fixes. The support bundle is the first thing asked for. **Open (PCN-010):**
whether remote screen-share is allowed for non-technical shops; this section
previously excluded remote-control software.

## 8. Incident posture

Severity 1 = selling is blocked, or the verifier disagrees with the records.
Acknowledge on WhatsApp within minutes, restore selling first (usually the
counter never stopped — say so), diagnose second. Corrections to data are always
compensating records (ADR-1/T2), never edits, even during incidents. Every sev-1
gets a written note: cause, fix, and the test or guard that prevents recurrence.

## 9. Exports

- Phase 13: Windows validation, the restore drill and printer setup are
  scheduled pilot-readiness items, not implied work.
- Master plan: this document owns every operational promise the commercial
  strategy makes (Phase 3 §5.3 suspension outcome, §5.2 export).
