# Research note — commercialization architecture & roadmap

**Status: frozen, and in implementation.** **PCN-004 was approved on 2026-08-03**,
so the gate in §0 is cleared and Part 2 is being executed phase by phase.
Roadmap Phase 1 is in progress.

The roadmap is frozen in the sense that matters: phase boundaries and ordering
are settled and are not re-litigated mid-phase. What a phase learns from real
hardware still feeds the *next* phase's design — that is the point of sequencing
it this way, not a loophole in the freeze.

**Read this before anything packaging-, installer-, licensing-, update- or
ecosystem-adjacent.** It preserves the reasoning, not just the conclusions, in
the same spirit as `fbr-compliance.md`.

---

## §0 — The gate: this contradicts Phase 3

The founder requires Mehvar to run as **locally installed software**. Phase 3 §3
decided the opposite:

> **Deployment: cloud, single multi-tenant service, browser-based, one
> codebase.**

Phase 3 §2 rejected on-premise explicitly (Options C and D), and Phase 12 §1
built Railway on top of that decision. This is a reversal, not a gap.

There is a door already cut in the wall. Option **E** — "Hybrid: cloud product
with an optional local install" — was **deferred, not rejected**, on the stated
grounds that it "doubles operational surface for a customer who hasn't asked
yet." A customer has now asked. So the change is narrower than overturning
Phase 3: **promote E from deferred to primary, and invert which deployment
leads.**

`CLAUDE.md`'s one rule applies without exception: *a discovered flaw is raised
as a plan-change note, decided, then implemented — never silently patched
around.* PCN-004 was filed and nothing was built until it was decided. Writing
an installer first would have been exactly the silent re-litigation the project
forbids, on the largest question in the package.

**PCN-004 was approved on 2026-08-03.** The master-plan amendments it lists
(Phase 3 §2/§3/§5.1/§6, Phase 12 §1/§2/§3) are applied in the source phases,
following the C1–C5 precedent. This section is kept as the record of why, not as
a live gate.

### Phase 3's objections, answered on the record

An approved decision is not reversed by preferring a different one.

| Phase 3 objection | Answer |
| --- | --- |
| One-time revenue, perpetual support obligation | **Fully answered.** Billing stays a subscription. Only *deployment* changes. Option C's flaw was perpetual *licensing*, which nothing here proposes. |
| Piracy rampant and unpoliceable | **Largely answered**, by declining the frame — Part 1 §6. |
| Support liability on aging Windows machines | **Only partly answered.** The real cost, accepted rather than eliminated. Part 3 §1. |
| Updates never reach the field | **Answered**, and it is the roadmap's largest engineering item. Without the updater this objection stands and the plan fails. |
| Owner's remote phone visibility disappears | **Answered with a delay.** LAN at launch; cloud relay in roadmap Phase 3. A real, time-boxed regression against a charter promise. |

Two fully answered, two answered at a cost, one accepted as a standing
liability. That is the honest ledger.

### What is gained

- **The trust objection inverts.** Phase 3 §2 conceded cloud is "weakest on the
  'where is my data' objection." Local answers it completely, in a market where
  it is a real objection.
- **P8 gets stronger.** *"The shop opens tomorrow"* is currently answered by the
  offline layer compensating for our downtime. Locally there is no our-downtime.
  The dependency disappears rather than being mitigated.
- **I2 stops depending on Pakistani consumer internet.** Sale-path latency
  becomes localhost.
- **Marginal hosting cost goes to zero**, which changes Phase 3 §4's revenue
  arithmetic at low tenant counts.

---

## §0.1 — The design principle this roadmap is built on

> **The roadmap optimizes for the first paying pharmacy, and every decision in
> it must survive to the hundredth without an architectural rewrite.** Where the
> two pull apart, build the simple thing now and check that the harder thing is
> still reachable from it — not the reverse. Nothing is built speculatively for
> scale; nothing is built in a way that scale would have to undo.

This is a description of decisions already taken, not an aspiration. Three
places it binds, each a case where the cheap thing and the durable thing turned
out to be the same thing:

- **The tenant chokepoint stays in single-tenant installs** (Part 1 §1). Keeping
  it costs nothing today; removing it would mean re-scoping every query in the
  system the day a chain or a cloud tenant appears.
- **UUIDv7 ids keep installations mergeable** (Part 1 §5). No work is being done
  now to enable chain consolidation — but nothing is being done that would
  prevent it either, and that is the whole discipline.
- **Licensing is staged by when each capability's problem becomes real**
  (Part 1 §6). Pharmacy #1 gets no licensing code at all; the design still has a
  place for activation limits when install #40 needs them.

The counter-example the principle exists to refuse: building fleet management,
an organization hierarchy, or online activation now, for customers who do not
exist. Every one of those is in the roadmap — in the phase where its problem
first appears, and not before.

Note on reading phase numbers in this document: **master-plan phases are written
"Phase 3 §2"; this document's own roadmap phases are always written "roadmap
Phase 2".** The two numbering systems are unrelated and both appear throughout.

---

# Part 1 — Recommended Architecture

## 1. The core idea: one codebase, two homes

**Nothing in the domain, schema, or trust model changes.** This is a
repackaging problem. Next.js plus Postgres runs identically on a mini-PC under
the counter and on Railway; the MVP is already, structurally, a local-first
application that happened to be deployed remotely.

The single most important design rule:

> **The tenant chokepoint stays, even where only one tenant exists.**

`src/db/scoped.ts` costs nothing at runtime in a single-tenant install, and it
is the only thing preventing a fork into a "local edition" and a "cloud
edition." One image, two deployment targets, forever. Phase 3 §5.1's
"multi-tenant from day one" survives intact in the form that mattered: the
*isolation mechanism* ships everywhere; multi-*tenancy* becomes a deployment
option rather than a deployment fact.

### The insight that makes local updates safe

**ADR-3's offline outbox, built for internet outages, is exactly what makes a
local software update safe.**

When the Node restarts to apply an update, the counter browser does what it
already does when the internet drops: keeps selling from IndexedDB, prints from
local state, drains the outbox when the server returns. The resilience layer
built for one problem solves a second one it was never designed for, at zero
cost.

Most products going on-premise must *invent* a story for "what happens during
the upgrade." Mehvar shipped one on Day 5. This is the strongest single piece of
evidence that local deployment is an evolution of this architecture rather than
a departure from it.

Two corollaries, both binding:

- The updater needs no maintenance window, which resolves Phase 12 §2's
  release-window rule for a shop with no quiet hour.
- The updater **must wait for an empty outbox** before restarting, or the
  guarantee is theoretical. This is an acceptance criterion, not a detail.

## 2. Components

**Mehvar Node** — one Windows machine in the shop, "the counter server." Bundles
the Next.js standalone build, a pinned Node runtime, PostgreSQL as a Windows
service, the updater, and the backup job. Auto-starts on boot; restarts on
failure; no console, no terminal, no visible technology.

**Counters** — Chrome in kiosk mode against the Node: `localhost` on the server
machine, a LAN address on any second counter. Secondary counters install nothing
but a shortcut. Phase 12 §6's setup guide survives nearly verbatim.

**Mehvar Cloud** — deliberately additive, optional, and later. Exactly three
jobs, ever: licence issuing, update-manifest hosting, offsite backup plus owner
remote view. **Never on the path of a sale.** If it is down, every pharmacy
trades normally and nobody notices.

## 3. Deployment: local-only vs cloud vs hybrid

| | Local-only | Cloud | **Hybrid (recommended)** |
| --- | --- | --- | --- |
| Sells during internet outage | Yes | Yes (ADR-3 outbox) | Yes |
| Sells during our outage | Yes | Degraded, then yes | Yes |
| Owner remote view | No | Yes | Yes, from roadmap Phase 3 |
| Offsite backup | No | Yes | Yes, from roadmap Phase 3 |
| "Where is my data" objection | Strongest | Weakest | Strongest |
| Update reach | Manual | Instant | Automatic |
| Marginal hosting cost | Zero | Per tenant | Near zero |
| Support surface | Highest | Lowest | High |
| Sale-path latency | localhost | Internet | localhost |

**Recommendation: hybrid, arrived at incrementally, local leading.**

```
Roadmap Phase 1   local only
Roadmap Phase 2   local + cloud update & licence services
Roadmap Phase 3   local + cloud backup and owner remote view
Roadmap Phase 4   optionally cloud-hosted tenants, same image, customer's choice
```

Internet is never required to sell, at any stage. Cloud is always additive.
Roadmap Phase 4 closes the loop: the cloud deployment Phase 3 §3 originally
decided becomes a *customer-selectable option* — which is what Option E always
described, in both directions.

## 4. The complete lifecycle

### 4.1 Development — unchanged

Next.js, Postgres, Drizzle, Docker, GitHub, exactly as today. Docker stays a
*developer* tool and never reaches a customer. This is deliberate: the
development loop is working, and changing it would be cost with no customer
benefit.

### 4.2 Packaging — build once, on GitHub Actions

`next build` with `output: 'standalone'` produces a self-contained server
directory (Next traces the actual dependency graph, so no `npm install` runs on
a customer machine — the single most important packaging property). That plus a
pinned Node runtime, the PostgreSQL binaries and the migration files is the
payload. Inno Setup wraps it into one signed `.exe`.

**Inno Setup over MSI/WiX** — free, one readable script, mature, and produces
the single-file `.exe` a non-technical buyer expects. WiX buys enterprise
deployment features (GPO, transforms) that this market will never use, at a
significant authoring cost. This is the "prefer the simpler solution" rule
applied to the first real decision.

**PostgreSQL from the official zip archive**, not the EDB interactive installer:
`initdb` at install time, `pg_ctl register` for the service, data directory
under `ProgramData`. The EDB installer is interactive and versioned
independently of us — unacceptable in a silent install.

**Bundle Postgres; do not replace it.** SQLite would be smaller, and the answer
is still no: the two-role grant model (PCN-001), the `SECURITY DEFINER`
`resolve_sale_line_allocation` (migration 0003), partial indexes and JSONB
settings are all Postgres-specific. Replacing them is precisely the disruptive
rework this plan exists to avoid, in exchange for a smaller download.

### 4.3 Installation — one `.exe`, no decisions

Double-click → next → next → done. The installer registers two Windows services
(PostgreSQL, Mehvar Node) set to automatic start with restart-on-failure, runs
`initdb`, runs migrations, **runs `db:grants`**, mints an `installation_id`,
creates the kiosk shortcut, and opens the browser at the first-run wizard.

`db:grants` is called out because PCN-001 established that a `REVOKE` against
the table owner is silently inert in Postgres. An installer that skips it leaves
ADR-1's immutability guarantee decorative *and appearing enforced* — the exact
failure PCN-001 was filed to prevent, reintroduced at a new layer. It belongs in
the installer's automated verification, not its documentation.

### 4.4 First-time setup — a wizard, not a manual

Shop name → receipt header/footer → owner PIN → printer test print → optional
opening stock. This replaces the pairing-key login for local installs by
*pre-provisioning* it, not by forking the auth: the installer calls
`src/db/provisioning.ts` (already the sanctioned path for the non-scopeable
`tenants` table) and writes the device pairing locally.

Phase 12 §6's eight-step counter setup guide already specifies this flow; it
becomes software instead of a checklist.

### 4.5 Daily operation — invisible

The PC boots, services start, the operator double-clicks the Mehvar shortcut,
Chrome opens kiosk-mode on the sale screen. There is no terminal, no Docker
Desktop, no npm. If the Node is restarting, the counter keeps selling offline —
ADR-3 again.

**Printing:** ADR-6's `--kiosk-printing` flag on a dedicated Chrome profile, set
by the installer. Unchanged from Phase 12 §6.

**Local networking and multiple counters:** the Node listens on the LAN; second
and third counters are shortcuts to `http://<hostname>:3000`. `devices` already
exists with `unique(tenant_id, receipt_prefix)` (PCN-001), so two counters
cannot collide on receipt numbers — the hard part of multi-counter was solved on
Day 1. Practical caveat: name resolution on a shop LAN is unreliable, so the
shortcut should use a **static IP**, set during install.

### 4.6 Updates — the largest engineering item

- **Application:** the updater polls a signed manifest (GitHub Releases is
  sufficient and free at launch), verifies signature and hash, waits for an
  **empty outbox**, backs up, installs silently, restarts.
- **Migrations:** unchanged. Phase 12 §2's forward-only additive-safe rule was
  written so the previous image runs against the migrated schema. That rule now
  earns its keep a second time: it is what makes local rollback survivable.
- **Rollback:** retain the previous installer plus the pre-update dump. Roll the
  application back, never the data — ADR-1 makes forward correction the only
  honest repair.
- **Backups:** nightly `pg_dump` locally from roadmap Phase 1; encrypted offsite
  from roadmap Phase 3.
- **Catalogue updates:** signed data packs, versioned, applied like migrations.
  This is where Phase 6's "catalogue as strategic asset" finally becomes
  distributable.
- **Downtime:** effectively none, because of §1's outbox property.

### 4.7 Support — WhatsApp-first, unchanged

Phase 12 §7 survives. What local deployment adds is the need for a **support
bundle**: a one-click "export diagnostics" producing logs, version,
`installation_id` and verifier output as one file the owner can send over
WhatsApp. Without it, remote diagnosis of a machine you cannot see is guesswork.
Cheap to build, and it is the difference between a ten-minute and a two-hour
support call — the highest-leverage support investment in the whole plan.

### 4.8 Scaling — one pharmacy to hundreds

The fleet is the new operational surface. Phase 12 §4's business-health glance
becomes cross-installation: versions in the field, backup success, verifier
status, unsynced ages. Deferred to roadmap Phase 4 because with fewer than ~20
installations a spreadsheet genuinely is enough, and building fleet tooling
before there is a fleet is the archetypal solo-founder mistake.

## 5. Identity model

Extend; do not redesign. Most of it already exists in `src/db/schema.ts`.

```
Mehvar Account (the paying customer)      NEW — cloud-side, roadmap Phase 3
  └─ Organization (a chain)               NEW — roadmap Phase 4, first chain only
       └─ Branch  = tenants               EXISTS  (slug, status, settings)
            ├─ Counter = devices          EXISTS  (receipt_prefix, pairing_key_hash)
            └─ User    = users            EXISTS  (role, pin_hash, password_hash)

Installation                              NEW — roadmap Phase 1 (file only)
Licence                                   NEW — roadmap Phase 2
```

**Tenant stays the branch.** Every query in the system is scoped by it. Do not
re-point it at "customer" to serve billing; billing is cloud-side and can
reference tenants without becoming one.

**`installation_id` is new and distinct from tenant.** UUIDv7, minted at install,
stored in local config *and* the database. Tenant is *business* identity
("Al-Shifa Medical Store"); installation is *machine* identity ("the PC this
runs on"). Licensing, updates, support and telemetry key off installation.
Conflating the two makes "the customer replaced their PC" an unanswerable
support ticket.

**`organization_id` only when a real chain exists.** A nullable column on
`tenants`, and not before.

**UUIDv7 is the sleeper asset — do not change it.** `src/lib/uuid.ts` generates
client-side, time-ordered ids because ADR-3 needed the counter to mint a durable
sale identity with no server in reach. The unplanned consequence: **two
independent installations' data can be merged later without a single
collision.** That is what makes chain consolidation, cloud migration, and
Hospital↔Pharmacy integration tractable rather than a data-cleaning project. Any
future proposal to switch to sequential ids should be refused on these grounds.

**Receipt prefixes already work for chains** — `unique(tenant_id,
receipt_prefix)` is enforced today; a chain gets a branch letter in the prefix.
No schema change.

## 6. Licensing philosophy

> **Licensing is a business system, not a DRM system. Optimize for the honest
> customer's renewal experience, not for defeating a determined pirate.**

A pirated copy in a pharmacy that was never going to pay costs nothing that was
ever going to be collected. A false lockout at 9am on a Monday costs the
reference customer, the referral behind them, and the reputation that is the
entire launch channel. These risks are not symmetric, and Phase 3's "piracy is
rampant and unpoliceable" is best answered by declining to fight that war.

This is already project policy — Phase 3 §5.3 is binding:

> The customer's data is never held hostage — export remains available
> regardless of payment state.

**Never block a sale.** P2 is not suspended for billing. An expired licence
shows the owner a banner; it does not stop the counter. Anything else makes the
licensing system a P2 violation.

### When each capability becomes worth introducing

| Capability | Introduce when | Why not earlier |
| --- | --- | --- |
| Universal installer (no per-customer build) | Phase 2 | Trivially cheap and prevents a build-per-customer habit that never gets undone |
| Nothing at all — trust | Phases 1–2, pharmacies 1–3 | Founder-installed, personally known. Licensing code protects against nobody here |
| Signed offline licence file (Ed25519, expiry, grace) | Phase 3, ~pharmacy 4 | The first install the founder does not personally attend |
| Branch licensing | With the first multi-branch customer | A count in the licence file; meaningless until a chain exists |
| Online activation | ~20+ installs | Manual issuing is fine below that and requires no service to operate |
| Activation limits | With online activation | Needs a server to count |
| Licence transfer (self-service) | With activation limits | Only becomes necessary once limits can block someone |
| Hardware fingerprinting | **Defer as long as possible** | Generates a support ticket the day a customer replaces a disk — precisely when they are already unhappy. When forced, use a soft fingerprint with self-service transfer |

The pattern: each capability arrives the release *after* the problem it solves
becomes real, never before.

## 7. The Mehvar ecosystem

The instinct with a second product is to unify infrastructure. That instinct is
wrong here, and expensively so for one maintainer. **Cohere at the edges; stay
independent at the core.**

**1. A shared identity and licensing plane** (the Mehvar Account). One customer,
one subscription, one login across products. Cheapest cohesion to build, most
visible to the buyer — it is what makes two products feel like one company.

**2. A shared design system** — tokens, key bar, terminology, receipt shape, the
three-numbers idea. But **copy first; extract to a package only when the second
product genuinely needs it.** A premature shared UI library converts every
styling decision into a cross-repo release. `CLAUDE.md`'s vocabulary discipline
is more of the shared identity than a component library would be.

**3. Integration through a narrow, versioned, append-only local event
exchange.** Hospital emits a dispense request; Pharmacy ingests through a door
shaped exactly like `src/domain/sync/ingest.ts` — idempotent on client id,
holding no business rules of its own, routing to the writer that already owns
each record. Pharmacy emits dispensed/charged back the same way. Two products,
two databases, one LAN, one idempotent contract.

Day 5's rule carries over verbatim: *"a rule appearing in ingest means an
offline sale has started meaning something different from an online one."*
Substitute "hospital-originated" for "offline" and it is the same guarantee.

**4. Independent deployability preserved.** Each installs and runs standalone.
Integration activates only when both are present and configured. A customer
buying only Pharmacy never carries Hospital's surface area.

**Explicitly rejected:** one shared database (destroys the tenant chokepoint's
meaning and couples two release cycles permanently); a monorepo mega-application
(two products, two buyers, two cadences); a message bus (infrastructure one
person would operate for two applications on the same LAN).

The integration seam is a door the codebase already built for a different
reason. That is the whole argument.

---

# Part 2 — Commercialization Roadmap

Sized in focused engineering days for one person. **Phases 1–2 are the "2–3
days" ask** and together produce a pharmacy trading on a local install.

---

## Phase 0 — Decide · ½ day

**Objective.** Get PCN-004 decided and amend the master plan.

**Rationale.** The roadmap contradicts Phase 3 §3. `CLAUDE.md`'s one rule
requires a decision before implementation.

**Success criteria.** A written decision with rationale; Phase 3 §2/§3/§5.1/§6
and Phase 12 §1/§2/§3 amended in the source phases, following the C1–C5
precedent of fixing the plan rather than working around it downstream.

**Dependencies.** None.

**Risks.** Deciding against, which invalidates Phases 1–5. That is a legitimate
outcome and is why this phase exists.

**Why here.** Nothing else is safe to build. Building first and asking later is
the failure mode the plan-change process exists to prevent.

---

## Phase 1 — First Paying Pharmacy · ~2–3 days

**Objective.** **A non-technical pharmacy can install Mehvar and begin trading
without developer tools.** No Docker, no npm, no PowerShell, no migrations, no
Git — one `.exe`, then selling.

That sentence is the whole phase. Anything not required by it is excluded, and
anything required by it is in scope no matter how unglamorous.

**Rationale.** *"This is exactly what needs to happen before the first pharmacy
can start using Mehvar."* The runtime work (services, bundled Postgres) and the
packaging work (installer, backups, setup) were originally two phases; they are
one, because neither delivers a trading pharmacy on its own and the boundary
between them was an engineering convenience, not a customer milestone. A phase
should end at something a customer can use.

**Steps**, in dependency order:

1. `output: 'standalone'` in `next.config.ts` — Next traces the real dependency
   graph, so **no `npm install` ever runs on a customer machine.** The single
   most important packaging property.
2. Pin the Node runtime; PostgreSQL 17 from the official zip (`initdb`, data
   directory under `ProgramData`, `pg_ctl register` as an automatic service).
3. Provision both roles per PCN-001 — owner for migrations, non-owning app role
   for `DATABASE_URL` — then `db:migrate` and **`db:grants`**.
4. Register the Node as a Windows service, restart-on-failure, automatic start.
5. `mehvar init` — the one provisioning door for a real shop: tenant, owner,
   first device, installation id. Wraps `src/db/provisioning.ts`.
6. Kiosk shortcut: dedicated Chrome profile, `--kiosk-printing` (ADR-6), static
   IP, autostart.
7. **Nightly `pg_dump`, a scripted restore, and one rehearsed restore drill.**
8. Support-bundle export (logs, version, installation id, verifier output).
9. Inno Setup script wrapping all of it into one `.exe`.

**No first-run wizard.** The Settings screen already edits receipt header and
footer (`updateTenantSettings`); `mehvar init` covers the rest. A guided wizard
is worth building at roadmap Phase 2, when installs outrun the founder's
presence — building it now would be new UI added before a single real install
has been survived, which §0.1 exists to refuse.

**Success criteria.** Cold boot → services up unattended, no console window →
sale → printed receipt. The founder installs on shop hardware in under 30
minutes without opening a terminal. One pharmacy trades for a week. A restore
drill passes into a scratch database with Phase 5 §5 invariants intact.
`db:verify` clean. Immutability assertions pass against the app role — which is
what proves `db:grants` actually ran, since per PCN-001 they silently skip
without it.

**Dependencies.** Phase 0 (PCN-004 decided). Nothing else.

**Risks.** Real shop hardware is the unknown, and it is deliberately met here
with the founder physically present: old Windows, no admin rights, antivirus
blocking service registration, printers that only work through their own driver.
This is Phase 3 §2's "aging Windows machines" objection meeting reality for the
first time. Secondary: Windows service registration for a Node process is
fiddly — budget for NSSM or a small wrapper — and Postgres on a locked-down
profile may need explicit data-directory ACLs.

**Deliberately excluded.** Licensing, auto-update, cloud, multi-counter,
self-service install, first-run wizard. Each is cheaper to build after real
hardware has been survived once, and none is needed for a founder-installed
first customer.

**Why here rather than later.** Backups are in this phase, not a later one,
because going local moves backup risk from Railway's platform to a shop with one
disk. Phase 12 §3 already ruled that "an untested backup is not a backup" — and
the first pharmacy's data is exactly as irreplaceable as the hundredth's.

**Why here rather than earlier.** Nothing precedes it but the decision. It is
the first phase, and its own internal ordering (runtime proven before packaging
wraps it) is what the merged step list preserves.

---

## Phase 2 — Pharmacies 2–10 without you on site · ~3–5 days

**Objective.** A pharmacy the founder has never visited runs current software
under a valid licence.

**Rationale.** The moment installs outrun the founder's physical presence, two
things that were optional become mandatory: updates that arrive by themselves,
and a licence that expresses the commercial relationship. Both are also the
first things §0.1 permits to be built — their problem is now real.

**Steps.** Auto-updater (signed manifest on GitHub Releases; **wait for empty
outbox**; back up before migrating; retain previous installer for rollback);
offline-verifiable Ed25519 licence file (expiry, generous grace, banner only,
export always available per Phase 3 §5.3); guided first-run wizard; LAN
multi-counter; code-signed installer.

**Success criteria.** A remote install updates itself across a release without
contact. A rollback is rehearsed successfully. An expired licence shows a banner
and **does not stop a sale**.

**Dependencies.** Roadmap Phase 1. **Code-signing certificate procured** — start
this during roadmap Phase 1; the lead time is the schedule risk, not the code.

**Risks.** The updater is the highest-consequence component in the plan: it can
break every installation simultaneously. It needs the same posture as
`commitSale` — staged rollout, and a rehearsed rollback before first use.

**Why here.** Phase 3 §2's "updates never reach the field" objection stands
until this ships. But building it before roadmap Phase 1 would mean shipping
updates to nobody, against hardware assumptions not yet tested.

---

## Phase 3 — Cloud services · ~5–7 days

**Objective.** Restore what local deployment gave up, as additive services.

**Rationale.** Two charter promises are in deficit once roadmap Phase 1 ships:
offsite backup (Phase 12 §3's "one provider failure must not take the backups
with the database") and the owner's remote phone visibility (Phase 3 §5.5). This
phase closes both.

**Steps.** Encrypted offsite backup; owner remote view via periodic summary
push; signed catalogue data packs; online activation.

**Success criteria.** A shop losing its PC entirely is restored from offsite
backup. An owner sees the three numbers from outside the shop.

**Dependencies.** Roadmap Phase 2 (licence identity and the manifest
infrastructure).

**Risks.** Scope creep into "cloud as a dependency." The rule holds: cloud is
never on the sale path.

**Why here.** It is the first phase whose value is not required to trade. Every
earlier phase is.

---

## Phase 4 — Scale and ecosystem · ongoing

**Objective.** Support hundreds of installations; make the ecosystem real.

**Steps.** Fleet health (Phase 12 §4's glance, cross-installation);
`organization_id` and chains; Hospital integration over the idempotent local
contract; optionally cloud-hosted tenants on the same image.

**Success criteria.** Founder can answer "which installations are behind, failing
backup, or reporting a verifier mismatch" in one screen. A hospital's pharmacy
runs both products as one experience.

**Dependencies.** Roadmap Phase 3; a real chain customer; Mehvar Hospital
reaching equivalent maturity.

**Risks.** Building fleet tooling before a fleet exists. Below ~20 installations
a spreadsheet genuinely is enough.

**Why here.** Every item is triggered by a customer who does not exist yet.
Speculative construction is exactly what this roadmap's sequencing rejects.

---

# Part 3 — Open Questions

Genuine uncertainties. The honest ones are load-bearing.

**1. The Windows support burden is only partly answered.** Phase 3's strongest
objection, conceded in §0. Auto-update, hardware minimums and the support bundle
reduce it; nothing eliminates it. Needs validation on real pharmacy hardware
before pharmacy #4 — and if it proves worse than expected, the correct response
may be to revisit Phase 3 rather than push through.

**2. Who owns backup failure.** When the shop's only disk dies and nobody
checked the backup for two months, whose failure is it? Phase 2 makes this the
customer's risk in a way cloud never did. Phase 4 is the technical answer; the
commercial and contractual answer is unwritten.

**3. Pricing under a local model.** Phase 3's Rs 2,000/month assumed cloud
economics and cloud value framing. Local removes a hosting cost, adds a support
cost, and removes the "your data survives your PC dying" pitch until roadmap
Phase 3. The figures were always an opening position — Phase 3 §3 said so — but for a
different product shape.

**4. Whether the owner remote view justifies cloud complexity at all**, or
whether LAN access from the owner's phone while in the shop is enough for V1.
This determines whether roadmap Phase 3 is essential or optional.

**5. Code-signing procurement** for a Pakistani sole proprietor — cost, lead
time, and whether an EV certificate is needed to clear SmartScreen. Unsigned
installers produce a warning a non-technical owner reads as "this software is
dangerous." A roadmap Phase 2 blocker with a long lead time, which is why it
is named as a dependency there and should be started during roadmap Phase 1.

**6. Update timing with no reliable low-traffic window.** Phase 12 §2.1's
deep-night rule assumes a fleet with a shared quiet hour. §1's outbox property
mostly dissolves this — "mostly" is doing real work in that sentence.

**7. Antivirus and SmartScreen behaviour** against a bundled Node plus Postgres
plus a self-updating service. This is a plausible install-blocker on real shop
machines and is untested.

**8. PostgreSQL footprint on low-end Windows.** Whether a lighter embedded
database is warranted. **Leaning strongly no**, for the reasons in §4.2 —
recorded here so it is not relitigated casually rather than because it is
genuinely open.

---

## What a future session should do with this note

PCN-004 is decided and the master plan is amended, so the gate is behind us.

1. **Read §0.1 first.** It is the test every decision in a phase has to pass,
   and the reason things are excluded from phases they could technically fit in.
2. Find the current roadmap phase and work only inside it. A phase ends at
   something a customer can use; if a change does not serve this phase's
   objective, it belongs to a later one.
3. Treat the phase boundaries as frozen. What real hardware teaches feeds the
   *next* phase's design — it is not licence to widen the current one.
4. If something genuinely cannot be built as written, that is a new PCN, not an
   assumption. The same rule that produced PCN-004 still applies.
