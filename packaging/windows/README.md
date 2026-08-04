# Windows packaging — **partly verified**

> **Read this first.** Know exactly how much of this has been run, because the
> honest answer is "some of it, and none of it on Windows."

| Piece                                                  | Status                                                                                                                                                                                                       |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| All five `.ps1` files                                  | **Parsed** by PowerShell — `npm run lint:ps`                                                                                                                                                                 |
| `install-services.ps1`                                 | **Run** on PowerShell 7 against a real PostgreSQL cluster: logging, step boundaries, the failure trap, the status file, and `initdb` all exercised. Stops at `Get-Service`, which does not exist off Windows |
| The provisioning chain                                 | **Run end to end** with the _bundled_ scripts against a real database from a deliberately wrong working directory: migrate → grants → init → `first-run.txt` → verify                                        |
| `fetch-runtimes.ps1`                                   | **Run for real**: binding, download, cache hit, extraction, top-level strip, `runtime/node.exe` in place. Only the PostgreSQL download is unexercised, and only because that host is network-blocked         |
| `uninstall-services.ps1`                               | Binds and enters its body; stops at `Get-Service`                                                                                                                                                            |
| `verify-install.ps1`, `counter-shortcut.ps1`           | **Parse only.** Almost entirely Windows-specific cmdlets                                                                                                                                                     |
| `mehvar.iss`                                           | **Never compiled.** Inno Setup is Windows-only and jrsoftware.org is unreachable from the dev container. Reviewed, and cross-checked against `install-services.ps1` by `npm run lint:ps`                     |
| Service registration, kiosk shortcut, the installer UI | **Never executed.** `sc.exe`, `schtasks`, firewall rules and Inno's own `[Code]` are Windows-only                                                                                                            |

So: syntax and argument handling are real evidence now. Service registration,
`initdb`, the kiosk shortcut and the installer itself are still first drafts.

Roadmap Phase 1's own risk section named this: _"real shop hardware is the
unknown, and it is deliberately met here with the founder physically present."_
This directory is where that gets discovered.

## Rules that cost round-trips

Each of these shipped, failed on a real machine, and is now enforced by
`npm run lint:ps`.

1. **Never dereference `$PSScriptRoot` in a parameter default.** Defaults are
   evaluated during binding, where it can be empty; `Join-Path` then throws
   before the script's first line, reporting only `Join-Path` — not the
   variable, not even which script.
2. **Never `Join-Path $env:SOMETHING` without a guard.** `LOCALAPPDATA` and
   `TEMP` are unset for some service accounts. This one bit three times.
3. **Never derive a path from `process.cwd()` in a script the installer runs.**
   Under Setup the working directory is wherever it launched PowerShell. This
   is what made the first real install create an empty database and report
   success.

## What the log tells you

`install-services.ps1` writes `C:\ProgramData\Mehvar\logs\install-<stamp>.log`
from its first line, and `install-status.txt` beside it:

```
STATE=FAILED
STEP=Applying migrations
DETAIL=migrate.js exited with code 1. Output: No migrations folder found...
LOG=C:\ProgramData\Mehvar\logs\install-2026-08-04-105629.log
```

Setup reads that file rather than the exit code, so it names the failing step.
A step that opened (`-> Applying migrations`) without closing
(`<- Applying migrations (0.8s)`) is the one that failed.

## Build order

Everything runs from the repository root, on **Windows**.

```powershell
# 1. Windows-native dependencies. The packager refuses without them, because a
#    Linux argon2 binary fails at the first PIN hash — i.e. at the login screen.
npm install --os=win32 --cpu=x64 --include=optional

# 2. Assemble the application payload into dist\package
npm run package:build

# 3. Fetch the Node runtime and PostgreSQL binaries (large, cached, yearly)
powershell -ExecutionPolicy Bypass -File packaging\windows\fetch-runtimes.ps1

# 4. Compile the installer  (finds ISCC.exe itself; Inno Setup 5-7)
npm run package:installer
```

Output: `dist\MehvarSetup-<version>.exe`.

`package:installer` searches `Program Files` and `Program Files (x86)` for
Inno Setup 7, 6 then 5, newest first, and stamps the version from
`package.json`. Override with `set ISCC=D:\Tools\InnoSetup\ISCC.exe` for a
portable copy. It also preflights the payload, because ISCC's own message for a
missing directory (`No files found matching "...\pgsql\*"`) is true and does
not mention that the fix is to run `fetch-runtimes.ps1`.

## What the installer does

1. Copies the payload to `C:\Program Files\Mehvar`.
2. Creates `C:\ProgramData\Mehvar` for the database, backups, logs and the
   installation record.
3. `initdb`, then registers **PostgreSQL** as an automatic service.
4. Creates the two database roles — owner and non-owning app role — per
   PCN-001, and writes `.env`.
5. Runs `migrate`, then **`grants`**.
6. Runs `init` with the shop details collected on the installer's own wizard
   page, then shows the pairing key.
7. Registers **Mehvar Node** as an automatic service with restart-on-failure.
8. Creates the counter shortcut (dedicated Chrome profile, `--kiosk-printing`).
9. Registers the nightly backup as a scheduled task.
10. Opens a firewall rule so a second counter on the LAN can reach the Node.

## Why `db:grants` is step 5 and not documentation

PCN-001 established that a `REVOKE` against the role that owns the tables is
**silently inert** in PostgreSQL. An installer that skips grants produces a shop
where ADR-1's immutability guarantee is decorative _and appears enforced_ — the
exact failure PCN-001 was filed to prevent, reintroduced at a new layer.

`verify-install.ps1` asserts it afterwards by attempting an `UPDATE` on an event
table and requiring it to fail. If that check ever passes, the install is bad
regardless of how well everything else went.

## Known unknowns

These are the things most likely to break first, listed so the first Windows
session knows where to look:

- **Service registration for a Node process.** Windows has no native supervisor
  for a plain executable. `install-services.ps1` uses `sc.exe` with a wrapper;
  NSSM is the fallback if restart-on-failure misbehaves.
- **PostgreSQL data-directory ACLs** on a locked-down profile. `initdb` refuses
  to run as an administrator with a writable-by-others data directory.
- **Antivirus and SmartScreen** against an unsigned installer that registers two
  services and schedules a task. Open question 7 in the research note; expect
  friction until the code-signing certificate exists.
- **Chrome's path.** The shortcut assumes a standard install location and falls
  back to Edge; a shop with neither needs a manual step.
- **Static IP for LAN counters.** Name resolution on a shop LAN is unreliable,
  so the second-counter shortcut is written against an IP, not a hostname.
