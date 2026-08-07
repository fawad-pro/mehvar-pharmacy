# Windows packaging — **installs on real hardware**

> **Read this first.** Know exactly how much of this has been run.

An install has now completed on a clean Windows laptop: payload, the PostgreSQL
service, the whole provisioning chain, WinSW registering and starting the
counter service, and the installer's own wizard and logging. What failed on that
machine was the **post-install verification**, twice, and both were bugs in the
checks rather than in the install — see "What the first successful install
found" below.

| Piece                                            | Status                                                                                                                                                                                                       |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| The installer, end to end                        | **Run on Windows.** Wizard pages, payload, PostgreSQL service, provisioning, WinSW registration and start, logging and the status file                                                                       |
| `install-services.ps1`                           | **Run on Windows**, and before that on PowerShell 7 against a real PostgreSQL cluster: logging, step boundaries, the failure trap, the status file, `initdb`                                                 |
| The provisioning chain                           | **Run end to end** with the _bundled_ scripts against a real database from a deliberately wrong working directory: migrate → grants → init → `first-run.txt` → verify                                        |
| `fetch-runtimes.ps1`                             | **Run for real**: binding, download, cache hit, extraction, top-level strip, `runtime/node.exe` in place                                                                                                     |
| `verify-install.ps1` + `lib-verify.ps1`          | **Run on Windows.** Two of its checks were wrong, and are fixed; the reasoning is pinned by `verify-checks.tests.ps1` and the immutability verdict was reproduced against a real cluster in all three states |
| `uninstall-services.ps1`, `counter-shortcut.ps1` | **Parse only**, plus the shortcut having been launched by the installer. Neither has been asserted against                                                                                                   |
| `mehvar.iss`                                     | **Compiled and run on Windows.** Never compiled _here_ — Inno Setup is Windows-only and jrsoftware.org is unreachable from the dev container — so `npm run lint:ps` cross-checks it against the `.ps1` files |
| `serve.js` (what WinSW supervises)               | **Run for real**: bundled, then started with an empty environment and the wrong working directory -- loaded `.env`, booted Next, answered HTTP 200 on `/login`                                               |
| WinSW fetch + SHA-256 pin                        | **Run for real**, including refusing a tampered binary                                                                                                                                                       |

Roadmap Phase 1's own risk section named this: _"real shop hardware is the
unknown, and it is deliberately met here with the founder physically present."_
This directory is where that got discovered, five rounds of it.

## What the first successful install found

Both failures were in the checks, not the install — which is its own lesson: a
verifier is code, and unverified code that guards a trust promise is the worst
place to be sloppy.

1. **The immutability check reported a passing guarantee as a failure.** It
   printed `ERROR: permission denied for table sales`, which is precisely what
   ADR-1 requires. Two defects, one hiding the other; both are rule 7 below.
2. **The restore drill could not drop its own scratch database** — the ADR-8
   verifier's connection pool was still on it. `src/db/client.ts` builds that
   pool lazily and never closes it, which is right for a server and fatal for a
   script that drops the database it just verified.
3. **The Finish page said "Mehvar Setup did not finish"** over a machine that
   had a working pharmacy on it, and withheld the pairing key — so the operator
   could not open the counter to look at what the checks were complaining
   about. Installation failing and verification failing are different events;
   they now get different words, and the pairing key is gated on the install,
   never on the checks.

## The logging invariant

**If Setup shows an error dialog, a log file explaining it already exists.**

That invariant is enforced by `mehvar.iss`, not by the PowerShell it launches,
and the distinction is the whole point. The second failed install produced no
log because `install-services.ps1` failed to _parse_ — no line of it ran, so
nothing it could have contained would have helped. Only the process that shows
the dialog can guarantee the dialog comes with a log.

So Setup:

1. writes `C:\ProgramData\Mehvar\logs\setup.log` **before** launching anything;
2. runs PowerShell through `cmd.exe /c ... > console.log 2>&1`, so parse errors
   — which happen before the script exists as far as the script is concerned —
   are captured instead of vanishing into a hidden window;
3. reads that console log back and puts its tail in both the log and the dialog;
4. says so explicitly if the log itself could not be written, rather than
   pointing at a file that will not be there.

## Service hosting: WinSW

**node.exe cannot be a Windows service.** A service image must call
`StartServiceCtrlDispatcher` and answer the Service Control Manager within about
thirty seconds. Node never does, so the SCM kills it with **1053** however the
service was registered. Two rounds went into the registration command line
(`sc.exe` exit **1639**) before that became visible: the command line was
genuinely broken, but fixing it only moved the failure.

[WinSW](https://github.com/winsw/winsw) (MIT) is a service-aware host. The SCM
talks to WinSW; WinSW runs node as a supervised child.

|                |                                                                                                                      |
| -------------- | -------------------------------------------------------------------------------------------------------------------- |
| Binary         | `winsw/WinSW.exe`, pinned to v2.12.0 and **SHA-256 verified** at fetch time                                          |
| Registered as  | `MehvarNode.exe` + `MehvarNode.xml` in the install root — WinSW takes its identity from its own filename             |
| Runs           | `runtime\node.exe "app\bin\ops\serve.js"`, working directory `app\`                                                  |
| Restart policy | three escalating restarts (5s, 10s, 30s), then stop; failure count resets daily                                      |
| Logs           | `C:\ProgramData\Mehvar\logs`, rolled by size, 8 kept                                                                 |
| Removal        | `MehvarNode.exe stop` then `uninstall` — never `sc delete`, which deregisters the service while leaving node running |

`serve.js` exists because the two obvious alternatives fail: pointing the
service at `server.js` gives a server with no configuration (Next's standalone
server reads `process.env` and never loads a `.env` file), and
`node -r dotenv/config server.js` cannot resolve `dotenv`, which Next does not
trace into the standalone tree. `serve.js` is bundled with `dotenv` compiled in,
loads the environment, and hands over to the standalone server **in the same
process** — so the PID WinSW watches is the PID actually serving, which is what
makes its restart policy mean anything.

The descriptor is built by `New-WinSwDescriptor` in `lib-service.ps1` and pinned
by 20 assertions in `service-descriptor.tests.ps1`. It registered and started on
real Windows hardware first time.

The environment is **not** frozen into the descriptor: WinSW passes only
`DOTENV_CONFIG_PATH`, and `serve.js` reads the file at startup. So an owner who
edits `MEHVAR_BACKUP_DIR` in `.env` and restarts the service gets what they
asked for.

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
4. **Never register a service with `sc.exe create ... binPath=`.** Windows has
   no argv: PowerShell serialises the argument array back into one command-line
   string for sc.exe to re-parse, and a value holding both spaces and quotes
   acquires backslash-escaped quotes sc.exe cannot parse (exit 1639,
   ERROR_INVALID_COMMAND_LINE). Use `New-Service -BinaryPathName`, which reaches
   `CreateService` with no command line in between. `service-image-path.tests.ps1`
   pins the built string.
5. **Never register node.exe as a Windows service directly**, with `sc.exe
create` or `New-Service`. It cannot start (1053). WinSW hosts it.
6. **Never put a non-ASCII character in a `.ps1`.** Windows PowerShell 5.1
   reads a no-BOM `.ps1` using the system ANSI code page, not UTF-8. An em dash
   (`E2 80 94`) then arrives as three characters ending in U+201D — and
   PowerShell accepts curly quotes as string delimiters, so a dash inside a
   string closes it and the file fails to parse. **A file that fails to parse
   runs no line at all**, which is why the second install produced no log.
   `pwsh` reads `.ps1` as UTF-8 and parsed these files happily; checking on the
   wrong runtime is the same mistake as checking on the wrong platform.
7. **Never write a check as "run the tool, then look at `$LASTEXITCODE`."**
   `$ErrorActionPreference = 'Stop'` — correct for cmdlets — also changes what a
   _native_ command does, differently on each runtime: Windows PowerShell 5.1
   turns a redirected stderr line into a terminating ErrorRecord, and
   PowerShell 7's `$PSNativeCommandUseErrorActionPreference` does the same for a
   non-zero exit. Either way the throw lands before the exit code is read, and
   the check's own `throw` never runs. The giveaway in a log is a failure
   message in the _tool's_ words rather than the script's. Use `Invoke-Native`
   in `lib-verify.ps1`. And while fixing it, notice the bug underneath: an
   assertion of the form "non-zero means it failed, so we pass" also passes when
   the tool could not run at all. Require the specific refusal.
8. **Never ship a script without the library it dot-sources.** `[Files]` is
   checked against every `. (Join-Path $Root 'lib-*.ps1')` by `npm run lint:ps`;
   the omission would only ever surface on a shop machine, at the script's
   first line.

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

# 3. Fetch Node, PostgreSQL and WinSW (large, cached, yearly; WinSW hash-pinned)
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
table and requiring PostgreSQL to refuse it **for lack of privilege**. Three
outcomes, and only one of them passes:

| psql said                                                            | Verdict        |
| -------------------------------------------------------------------- | -------------- |
| exit non-zero, `permission denied`                                   | `immutable`    |
| exit 0                                                               | `writable`     |
| anything else — refused connection, typo'd table, missing `psql.exe` | `inconclusive` |

`writable` means the install is bad regardless of how well everything else went.
`inconclusive` is also a failure, and deliberately so: a check that passes when
it could not run is PCN-001's own failure mode wearing the verifier's clothes.

## Known unknowns

These are the things most likely to break first, listed so the first Windows
session knows where to look:

- **Uninstall has never been run.** `uninstall-services.ps1` stops and removes
  two services, a scheduled task, a firewall rule and the shortcuts, and none of
  that has executed on Windows. It is the last unexercised path in the lifecycle.
- **PostgreSQL data-directory ACLs** on a locked-down profile. `initdb` refuses
  to run as an administrator with a writable-by-others data directory.
- **Antivirus and SmartScreen** against an unsigned installer that registers two
  services and schedules a task. Open question 7 in the research note; expect
  friction until the code-signing certificate exists.
- **Chrome's path.** The shortcut assumes a standard install location and falls
  back to Edge; a shop with neither needs a manual step.
- **Static IP for LAN counters.** Name resolution on a shop LAN is unreliable,
  so the second-counter shortcut is written against an IP, not a hostname.
