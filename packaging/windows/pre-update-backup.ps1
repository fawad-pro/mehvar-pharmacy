<#
.SYNOPSIS
    Back up the pharmacy's database before Setup changes anything.

.DESCRIPTION
    Run by mehvar.iss from PrepareToInstall -- after the operator clicks
    Install, BEFORE a single file is replaced and before install-services.ps1
    migrates the schema. Extracted to {tmp} for the purpose (Flags: dontcopy),
    so it runs against the installation exactly as it stands.

    The upgrade test found that an update took no backup at all: the newest
    copy of a shop's records was whatever the 02:30 job had written, and a
    failed migration would have cost everything since.

    Fails CLOSED. If an existing pharmacy database is here and it cannot be
    backed up, this exits non-zero and Setup stops with nothing changed. The
    only paths that exit 0 without a dump are the ones with nothing to lose: no
    database cluster yet (a first install), or a cluster in which the pharmacy
    database was never created (a first install that died early).

    Deliberately depends on nothing but the PostgreSQL binaries already
    installed -- the same ones the running database uses. Not node.exe, not
    backup.js, not .env: a repair install is exactly when those may be broken,
    and a backup step that needs a healthy app would block the repair.

    Output goes to stdout; mehvar.iss captures it into Setup's log.

.OUTPUTS
    A custom-format dump in <DataDir>\backups\pre-update\, named like the
    nightly ones. Nightly retention never touches that folder. To drill one:
        set MEHVAR_BACKUP_DIR=C:\ProgramData\Mehvar\backups\pre-update
        then run the restore drill as OPERATIONS.md describes.
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory)] [string] $InstallDir,
    [Parameter(Mandatory)] [string] $DataDir,
    [string] $PgService = 'MehvarPostgres',
    # Where pg_dump/psql live. Defaults to the installed copy; overridable so the
    # script can be exercised against a cluster on a non-Windows machine.
    [string] $PgBin = ''
)

$ErrorActionPreference = 'Stop'

<#
    Invoke-Native: every native tool below goes through it. Under 'Stop',
    Windows PowerShell 5.1 turns a native tool's stderr into a terminating
    error before its exit code can be read (verify-checks.tests.ps1 pins why).
    mehvar.iss extracts lib-verify.ps1 into {tmp} beside this script.
#>
$MyRoot =
    if (-not [string]::IsNullOrWhiteSpace($PSScriptRoot)) { $PSScriptRoot }
    elseif (-not [string]::IsNullOrWhiteSpace($MyInvocation.MyCommand.Path)) {
        Split-Path -Parent $MyInvocation.MyCommand.Path
    }
    else { (Get-Location).Path }

. (Join-Path $MyRoot 'lib-verify.ps1')

# The same constants install-services.ps1 provisions with (pinned by
# tests/pre-update-backup.test.ts).
$PgPort  = 5433
$DbName  = 'mehvar_pharmacy'
$DbOwner = 'mehvar'

if ([string]::IsNullOrWhiteSpace($PgBin)) { $PgBin = Join-Path $InstallDir 'pgsql\bin' }

function Find-PgTool {
    param([string] $Name)
    foreach ($candidate in @((Join-Path $PgBin "$Name.exe"), (Join-Path $PgBin $Name))) {
        if (Test-Path -LiteralPath $candidate) { return $candidate }
    }
    throw "The installed PostgreSQL tool $Name was not found in $PgBin."
}

function Stop-Refusing {
    param([string] $Reason)
    Write-Host "PRE-UPDATE BACKUP FAILED: $Reason"
    Write-Host 'Setup has not changed anything. The pharmacy keeps running on the installed version.'
    exit 1
}

Write-Host "Pre-update backup: install $InstallDir, data $DataDir"

# --- Is there anything to protect? ----------------------------------------
if (-not (Test-Path -LiteralPath (Join-Path (Join-Path $DataDir 'pgdata') 'PG_VERSION'))) {
    Write-Host 'No Mehvar database on this machine yet (first install). Nothing to back up.'
    exit 0
}

$ownerFile = Join-Path $DataDir '.pgpass-owner'
if (-not (Test-Path -LiteralPath $ownerFile)) {
    # install-services.ps1 writes it in the same step that creates the cluster,
    # so a cluster without it was not made by Mehvar's installer, or was damaged.
    Stop-Refusing "a database cluster exists but $ownerFile is missing, so it cannot be read."
}
$ownerPassword = (Get-Content -LiteralPath $ownerFile -Raw).Trim()

try {
    $psql   = Find-PgTool 'psql'
    $pgDump = Find-PgTool 'pg_dump'
    $pgRestore = Find-PgTool 'pg_restore'
    $pgIsReady = Find-PgTool 'pg_isready'
} catch {
    Stop-Refusing $_.Exception.Message
}

# --- The database must be up to be dumped ---------------------------------
# Guarded: Get-Service exists only on Windows, and the suite runs elsewhere too.
if ($PgService -and (Get-Command Get-Service -ErrorAction SilentlyContinue)) {
    $svc = Get-Service -Name $PgService -ErrorAction SilentlyContinue
    if ($svc -and $svc.Status -ne 'Running') {
        Write-Host "$PgService is $($svc.Status); starting it for the backup."
        try { Start-Service -Name $PgService } catch { Stop-Refusing "could not start ${PgService}: $($_.Exception.Message)" }
    }
}

$ready = $false
foreach ($attempt in 1..30) {
    if ((Invoke-Native -FilePath $pgIsReady -Arguments @('-h', 'localhost', '-p', "$PgPort", '-q')).ExitCode -eq 0) {
        $ready = $true; break
    }
    Start-Sleep -Seconds 1
}
if (-not $ready) { Stop-Refusing "PostgreSQL is not accepting connections on port $PgPort." }

# Credentials through the environment, never on a command line Setup logs.
$env:PGPASSWORD = $ownerPassword
try {
    $maintUrl = "postgresql://${DbOwner}@localhost:${PgPort}/postgres"
    $probe = Invoke-Native -FilePath $psql -Arguments @($maintUrl, '-tAc', "SELECT 1 FROM pg_database WHERE datname = '$DbName'")
    if ($probe.ExitCode -ne 0) { Stop-Refusing "could not query the database server: $($probe.Output)" }
    if ($probe.Output.Trim() -ne '1') {
        Write-Host "The cluster has no $DbName database (an earlier install stopped before creating it). Nothing to back up."
        exit 0
    }

    # --- The dump -----------------------------------------------------------
    $target = Join-Path (Join-Path $DataDir 'backups') 'pre-update'
    if (-not (Test-Path -LiteralPath $target)) { New-Item -ItemType Directory -Path $target -Force | Out-Null }

    # The nightly name (src/lib/backup.ts backupFileName): UTC, sortable.
    $stamp = (Get-Date).ToUniversalTime().ToString("yyyy-MM-dd'T'HH-mm-ss-fff", [Globalization.CultureInfo]::InvariantCulture)
    $file  = Join-Path $target "mehvar-$stamp.dump"
    $dbUrl = "postgresql://${DbOwner}@localhost:${PgPort}/${DbName}"

    # Exactly scripts/ops/backup.ts's flags, so a pre-update dump restores the
    # way every nightly one does.
    $dump = Invoke-Native -FilePath $pgDump -Arguments @('--format=custom', '--no-owner', '--no-acl', '--file', $file, $dbUrl)
    if ($dump.ExitCode -ne 0) {
        Remove-Item -LiteralPath $file -Force -ErrorAction SilentlyContinue
        Stop-Refusing "pg_dump exited with code $($dump.ExitCode): $($dump.Output)"
    }
    if (-not (Test-Path -LiteralPath $file) -or (Get-Item -LiteralPath $file).Length -eq 0) {
        Remove-Item -LiteralPath $file -Force -ErrorAction SilentlyContinue
        Stop-Refusing 'pg_dump produced an empty file.'
    }

    # Read the dump's table of contents back: a truncated or unreadable file
    # fails here, now, rather than on the day somebody needs it.
    $listing = Invoke-Native -FilePath $pgRestore -Arguments @('--list', $file)
    if ($listing.ExitCode -ne 0) {
        Stop-Refusing "the dump was written but cannot be read back: $($listing.Output)"
    }
} finally {
    Remove-Item Env:\PGPASSWORD -ErrorAction SilentlyContinue
}

$size = (Get-Item -LiteralPath $file).Length
Write-Host ("Backed up to {0} ({1:N1} MB, {2} entries)." -f $file, ($size / 1MB), @($listing.Output -split "`r?`n" | Where-Object { $_ -notmatch '^\s*;' -and $_.Trim() -ne '' }).Count)
Write-Host 'Pre-update backup OK.'
exit 0
