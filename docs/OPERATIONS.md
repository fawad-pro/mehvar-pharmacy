# Operations — installing and running Mehvar in a pharmacy

Roadmap Phase 1 of `docs/research/commercialization.md`, made procedural. This
is Phase 12 §6's counter setup guide, updated for local deployment (PCN-004).

The milestone this document serves: **a non-technical pharmacy can install
Mehvar and begin trading without developer tools.** If any step below requires
the shop to open a terminal, that is a bug in the product, not a gap in the
guide.

> **Status: the installer works on real hardware.** A clean Windows laptop has
> been taken from `MehvarSetup.exe` to a registered, running counter service:
> payload, PostgreSQL, provisioning, WinSW, wizard and logging all exercised.
> Two **post-install checks** failed on that machine and both were bugs in the
> checks, now fixed. Uninstall has still never been run.
> `packaging/windows/README.md` has the line-by-line status. The first install
> is a debugging session with the founder present, and roadmap Phase 1's risk
> section says so on purpose.

---

## 1. Before you go (founder, at home)

|          |                                                                                                                                                                |
| -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Hardware | 4 GB RAM minimum, 64-bit Windows 10/11, SSD. A dedicated machine, not the shop's household PC.                                                                 |
| Printer  | 80 mm thermal (58 mm supported). Install its driver and print a Windows test page **first** — a printer that does not work in Notepad will not work in Mehvar. |
| Scanner  | USB, configured to send Enter after the code.                                                                                                                  |
| UPS      | Strongly recommended. A power cut mid-write is the one hardware failure the append-only design cannot fully absorb.                                            |
| Network  | Not required to sell. Required only if the owner wants a second counter.                                                                                       |

Build the installer (on Windows):

```powershell
npm install --os=win32 --cpu=x64 --include=optional
npm run package:build
powershell -ExecutionPolicy Bypass -File packaging\windows\fetch-runtimes.ps1
npm run package:installer
```

Carry `dist\MehvarSetup-<version>.exe` on a USB stick. It needs no internet to install.

## 2. Installing (at the shop, ~30 minutes)

1. Run `MehvarSetup-<version>.exe` as administrator.
2. Answer the two wizard pages: pharmacy name, address, phone, owner name; then
   a 4-digit owner PIN. **The owner chooses the PIN, not you.**
3. Wait. The installer creates the database, provisions both roles, migrates,
   grants, provisions the pharmacy, registers both services, schedules the
   nightly backup, and runs the post-install checks.
4. The pairing key appears in Notepad at the end. **Keep this window open.**
5. Double-click **Mehvar Counter** on the desktop. Enter the shop slug and the
   pairing key once.
6. Print a test receipt. If it prints without a dialog appearing, ADR-6's kiosk
   printing is working.

If anything fails, Setup names the step that failed and points at the log. **Do
not hand the machine over.** Send `C:\ProgramData\Mehvar\logs\install-*.log`
to support; `install-status.txt` beside it carries the one-line summary.

### Read the Finish page carefully — it says one of three things

| Heading                                     | What it means                                                                                                                                                                                         |
| ------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| _Completing the Mehvar Setup Wizard_        | Everything installed and every post-install check passed. Trade on it.                                                                                                                                |
| _Mehvar is installed, but not yet verified_ | The shop exists — database, both services, pharmacy record — and at least one check that proves it safe to trade on did not pass. The pairing key is still offered; open the counter and investigate. |
| _Mehvar Setup did not finish_               | Provisioning failed. There is no working pharmacy on this machine. The page names the step and the reason.                                                                                            |

The pairing-key option only appears when provisioning actually produced the
file. It is **not** withheld when only the checks failed: you need the counter
open to diagnose them.

## 3. Opening stock (W9) — the adoption gate

Assisted, and the longest part of the visit. Phase 12 §6 puts it at step 6 for a
reason: a pharmacy with no stock in the system cannot sell from it, and this is
where an install either becomes a working shop or quietly stalls.

Products → Opening stock. Batch, expiry and quantity per shelf line.

## 4. Daily operation

The shop's morning is: **turn the PC on.** Both services start automatically and
the counter shortcut is in Startup.

Nothing else is required — no terminal, no Docker, no npm, no commands.

### If the counter looks stuck

1. Is the Mehvar Node service running? (Services → Mehvar Node)
2. Restart it. **Selling continues during the restart** — ADR-3's outbox holds
   captured sales in the browser and drains them when the server returns.
3. Still stuck: Start Menu → **Support bundle**, and send the file over
   WhatsApp.

The service is hosted by WinSW, which restarts the counter automatically three
times (after 5s, 10s and 30s) before giving up and leaving it stopped for
someone to look at. If it stopped itself, something is wrong that restarting
will not fix — send the bundle rather than restarting it a fourth time.

### What "the counter keeps selling" actually means

Sales, settlements, quick items and customers captured while the server is down
are held in the browser and delivered afterwards, strictly in order. Receipts
print from local state, not from a server response (Phase 7 rule 3). This is the
same machinery that handles an internet outage; it is why a local restart is
safe, and it is why updates need no maintenance window.

## 5. Backups

|           |                                                             |
| --------- | ----------------------------------------------------------- |
| When      | Nightly, 02:30, as a Windows scheduled task                 |
| Where     | `C:\ProgramData\Mehvar\backups`                             |
| Retention | 30 days                                                     |
| Format    | `pg_dump` custom format, restorable into a scratch database |

**Point `MEHVAR_BACKUP_DIR` at a USB drive or a second physical disk.** A backup
on the same disk as the database survives a mistake; it does not survive the
disk. Set it in `C:\ProgramData\Mehvar\.env` and restart the Mehvar Node service.

> **Known gap, and it is deliberate.** Phase 12 §3 requires an offsite copy —
> "one provider failure must not take the backups with the database." Roadmap
> Phase 1 does not deliver one. Until roadmap Phase 3, **a fire or a theft takes
> the records with the machine.** Say this to the customer plainly rather than
> letting them assume otherwise; a USB drive kept off-site narrows the gap.

### The restore drill — the only thing that makes a backup real

```
npm run ops:restore-drill
```

Restores the newest dump into a scratch database, runs the ADR-8 verifier,
confirms Phase 5 §5 invariants, drops the scratch database. Never touches the
live one.

The drill closes its own database connection before the drop, and forces the
drop past anything else still attached. Without the first of those it used to
verify the dump successfully and then fail at cleanup with
`database "mehvar_restore_drill" is being accessed by other users` — which
reads like a backup problem and is not one.

Phase 12 §3: **once before the first paying customer, then quarterly.** An
untested backup is not a backup, and a drill you have not run is a claim, not a
fact.

## 6. Adding a second counter

The second machine installs nothing.

1. Give the server machine a **static IP** (name resolution on a shop LAN is
   unreliable — a counter that cannot resolve the server cannot sell).
2. On the second machine:
   ```powershell
   powershell -File counter-shortcut.ps1 -CounterHost 192.168.1.50 -Autostart
   ```
3. Add the device in Settings so it gets its own receipt prefix. `B-1`, `B-2`
   cannot collide with `A-1` — `unique(tenant_id, receipt_prefix)` has enforced
   that since Day 1 (PCN-001).

## 7. Support

WhatsApp-first (Phase 12 §7). Every contact starts the same way:

**Start Menu → Support bundle**, then send the file.

It contains machine details, the installation id, backup age, verifier status
and recent logs. It contains **no sales, customer, price or stock data** — the
owner can send it without thinking about what is in it.

The most useful line in it is backup age. A shop whose backups stopped two
months ago looks perfectly healthy until somebody asks.

## 8. Incidents

Phase 12 §8 unchanged. Severity 1 is: selling is blocked, or `db:verify`
reports a mismatch.

- **Selling blocked** — restart the Mehvar Node service. The counter has been
  capturing offline throughout; say so, it is reassurance backed by
  architecture.
- **Verifier mismatch** — sev-1. A derived number disagrees with the records,
  which is precisely the promise the product sells. Investigate before anything
  else ships.
- **Corrections are always compensating records**, never edits, even during an
  incident (ADR-1 / T2).

## 9. Uninstalling

Uninstall from Add/Remove Programs. It stops and removes both services, the
scheduled task, the firewall rule and the shortcuts.

**It does not delete `C:\ProgramData\Mehvar`** — the database and every backup
stay. Removing a pharmacy's records is a separate, deliberate, manual act.

---

## Command reference (founder, not customer)

| Command                      | Purpose                                                    |
| ---------------------------- | ---------------------------------------------------------- |
| `npm run init`               | Provision a pharmacy. Idempotent; refuses if one exists.   |
| `npm run db:migrate`         | Apply migrations. Forward-only, additive-safe.             |
| `npm run db:grants`          | **Required after any migration adding a table** (PCN-001). |
| `npm run db:verify`          | ADR-8 verifier. Non-zero exit on mismatch.                 |
| `npm run ops:backup`         | Take a dump now.                                           |
| `npm run ops:restore-drill`  | Prove the newest dump restores and verifies.               |
| `npm run ops:support-bundle` | Collect diagnostics.                                       |
| `npm run package:build`      | Assemble the installer payload.                            |

## The medicine catalogue

The catalogue travels as a **pack** — one versioned JSON file — so it can be
updated without shipping a new build of Mehvar.

    node "C:\Program Files\Mehvar\app\bin\catalog\import-pack.js" <path-to-pack.json>

The installer applies the bundled starter pack automatically. If that step
fails, the installation is still complete and usable: the catalogue is a
convenience, every product in it can be created by hand, and W6's quick item
means an unknown medicine never blocks a sale. Run the command above afterwards.

**Importing is always safe to repeat.** Packs are idempotent on medicine
identity (brand + strength + form + manufacturer), so a re-run after an
interrupted import updates rather than duplicates.

**Importing never changes a pharmacy's products, prices or stock.** A pack
carries identity only — what medicines exist in the world, not what this shop
sells or charges.

Two version numbers, for two different reasons:

- `format` is the shape of the file. A pack from a newer Mehvar is refused
  outright rather than partly read, and the message says to update Mehvar.
- `catalogVersion` (`YYYY.MM.N`) is how fresh the data is. Importing an older
  one than is already applied warns and proceeds — rolling back to a known-good
  catalogue is a legitimate thing to do on a support call.

To see what a machine is on, read the newest row of `catalog_versions`; the
import history is kept, so "which catalogue is this shop running?" always has
an answer.

To build a pack from the source list:

    npm run catalog:build -- --version 2026.08.1

It refuses to build if two entries are the same medicine, because that is a
curation error to fix before distribution rather than after.
