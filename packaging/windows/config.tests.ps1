<#
.SYNOPSIS
    Regression tests for merging C:\ProgramData\Mehvar\.env (lib-config.ps1).

.DESCRIPTION
    The upgrade test found every installer run regenerating .env from a
    template: the shop's MEHVAR_BACKUP_DIR (its USB backup drive) and backup
    retention were deleted, and the next nightly backup went back to the system
    disk without a word. These pin the merge that replaced it.

    Plain assertions rather than Pester, like the other suites here, so they run
    on the machine that matters. Exits non-zero on any failure.
#>
[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'

$scriptRoot =
    if (-not [string]::IsNullOrWhiteSpace($PSScriptRoot)) { $PSScriptRoot }
    elseif (-not [string]::IsNullOrWhiteSpace($MyInvocation.MyCommand.Path)) {
        Split-Path -Parent $MyInvocation.MyCommand.Path
    }
    else { (Get-Location).Path }

. (Join-Path $scriptRoot 'lib-config.ps1')

$script:Failures = 0

function Assert-True {
    param([string] $Name, [bool] $Condition)
    if ($Condition) { Write-Host "  [ ok ] $Name"; return }
    Write-Host "  [FAIL] $Name"
    $script:Failures++
}

function Assert-Lines {
    param([string] $Name, [string[]] $Actual, [string[]] $Expected)
    $same = ($Actual.Count -eq $Expected.Count)
    if ($same) {
        for ($i = 0; $i -lt $Expected.Count; $i++) {
            if ($Actual[$i] -cne $Expected[$i]) { $same = $false; break }
        }
    }
    Assert-True $Name $same
    if (-not $same) {
        Write-Host '         expected:'; $Expected | ForEach-Object { Write-Host "           $_" }
        Write-Host '         actual:';   $Actual   | ForEach-Object { Write-Host "           $_" }
    }
}

# What install-services.ps1 hands the merge, with recognisable values.
function New-Settings {
    param([string] $AppPassword = 'app-pw-NEW', [string] $Port = '3000')
    return [ordered]@{
        APP_ENV            = 'production'
        NODE_ENV           = 'production'
        PORT               = $Port
        DATABASE_URL       = "postgresql://mehvar_app:$AppPassword@localhost:5433/mehvar_pharmacy"
        DATABASE_ADMIN_URL = 'postgresql://mehvar:owner-pw@localhost:5433/mehvar_pharmacy'
        APP_DB_ROLE        = 'mehvar_app'
        APP_DB_PASSWORD    = $AppPassword
        SESSION_SECRET     = 'FRESH-SECRET-FROM-THIS-RUN'
        TENANT_TIME_ZONE   = 'Asia/Karachi'
        MEHVAR_DATA_DIR    = 'C:\ProgramData\Mehvar'
        MEHVAR_LOG_DIR     = 'C:\ProgramData\Mehvar\logs'
        MEHVAR_PG_BIN      = 'C:\Program Files\Mehvar\pgsql\bin'
    }
}
$keep = @('SESSION_SECRET', 'TENANT_TIME_ZONE')

# A file the previous installer wrote, then the owner edited per OPERATIONS.md.
$shopFile = @(
    'APP_ENV=production'
    'NODE_ENV=production'
    'PORT=3000'
    'DATABASE_URL=postgresql://mehvar_app:app-pw-OLD@localhost:5433/mehvar_pharmacy'
    'DATABASE_ADMIN_URL=postgresql://mehvar:owner-pw@localhost:5433/mehvar_pharmacy'
    'APP_DB_ROLE=mehvar_app'
    'APP_DB_PASSWORD=app-pw-OLD'
    'SESSION_SECRET=the-shops-existing-secret'
    'TENANT_TIME_ZONE=Asia/Dubai'
    'MEHVAR_DATA_DIR=C:\ProgramData\Mehvar'
    'MEHVAR_LOG_DIR=C:\ProgramData\Mehvar\logs'
    'MEHVAR_PG_BIN=C:\Program Files\Mehvar\pgsql\bin'
    ''
    '# backups to the USB drive (OPERATIONS.md section 5)'
    'MEHVAR_BACKUP_DIR=E:\MehvarBackups'
    'MEHVAR_BACKUP_RETENTION_DAYS=90'
    'MEHVAR_LICENCE_URL=https://licence.example/api?a=1&b=2'
)

Write-Host 'First install (no existing file):'
$first = Merge-EnvLines -Existing @() -Settings (New-Settings) -KeepExisting $keep
Assert-Lines 'writes every setting, in template order' $first.Lines @(
    'APP_ENV=production'
    'NODE_ENV=production'
    'PORT=3000'
    'DATABASE_URL=postgresql://mehvar_app:app-pw-NEW@localhost:5433/mehvar_pharmacy'
    'DATABASE_ADMIN_URL=postgresql://mehvar:owner-pw@localhost:5433/mehvar_pharmacy'
    'APP_DB_ROLE=mehvar_app'
    'APP_DB_PASSWORD=app-pw-NEW'
    'SESSION_SECRET=FRESH-SECRET-FROM-THIS-RUN'
    'TENANT_TIME_ZONE=Asia/Karachi'
    'MEHVAR_DATA_DIR=C:\ProgramData\Mehvar'
    'MEHVAR_LOG_DIR=C:\ProgramData\Mehvar\logs'
    'MEHVAR_PG_BIN=C:\Program Files\Mehvar\pgsql\bin'
)
Assert-True 'reports nothing replaced and nothing kept' ($first.Replaced.Count -eq 0 -and $first.Kept.Count -eq 0)
$nullExisting = Merge-EnvLines -Existing $null -Settings (New-Settings) -KeepExisting $keep
Assert-True 'treats a missing file ($null lines) as a first install' ($nullExisting.Lines.Count -eq 12)

Write-Host 'Upgrade over a file the shop has edited:'
$up = Merge-EnvLines -Existing $shopFile -Settings (New-Settings) -KeepExisting $keep
Assert-Lines 'keeps every shop line and comment in place; updates only installer-owned values' $up.Lines @(
    'APP_ENV=production'
    'NODE_ENV=production'
    'PORT=3000'
    'DATABASE_URL=postgresql://mehvar_app:app-pw-NEW@localhost:5433/mehvar_pharmacy'
    'DATABASE_ADMIN_URL=postgresql://mehvar:owner-pw@localhost:5433/mehvar_pharmacy'
    'APP_DB_ROLE=mehvar_app'
    'APP_DB_PASSWORD=app-pw-NEW'
    'SESSION_SECRET=the-shops-existing-secret'
    'TENANT_TIME_ZONE=Asia/Dubai'
    'MEHVAR_DATA_DIR=C:\ProgramData\Mehvar'
    'MEHVAR_LOG_DIR=C:\ProgramData\Mehvar\logs'
    'MEHVAR_PG_BIN=C:\Program Files\Mehvar\pgsql\bin'
    ''
    '# backups to the USB drive (OPERATIONS.md section 5)'
    'MEHVAR_BACKUP_DIR=E:\MehvarBackups'
    'MEHVAR_BACKUP_RETENTION_DAYS=90'
    'MEHVAR_LICENCE_URL=https://licence.example/api?a=1&b=2'
)
Assert-True 'names the installer-owned keys whose value changed, and only those' (
    ($up.Replaced -join ',') -eq 'DATABASE_URL,APP_DB_PASSWORD')
Assert-True 'lists the shop settings it kept' (
    ($up.Kept -join ',') -eq 'MEHVAR_BACKUP_DIR,MEHVAR_BACKUP_RETENTION_DAYS,MEHVAR_LICENCE_URL')

$again = Merge-EnvLines -Existing $up.Lines -Settings (New-Settings) -KeepExisting $keep
Assert-Lines 'is idempotent: merging its own output changes nothing' $again.Lines $up.Lines
Assert-True 'and a second run reports nothing replaced' ($again.Replaced.Count -eq 0)

Write-Host 'Edge cases:'
$legacy = @(
    '# a pre-merge file missing keys added since'
    'APP_ENV=production'
    'DATABASE_URL=postgresql://mehvar_app:app-pw-OLD@localhost:5433/mehvar_pharmacy'
    'MEHVAR_BACKUP_DIR=E:\MehvarBackups'
)
$filled = Merge-EnvLines -Existing $legacy -Settings (New-Settings) -KeepExisting $keep
Assert-True 'appends installer-owned keys the file lacks' ($filled.Lines -contains 'MEHVAR_PG_BIN=C:\Program Files\Mehvar\pgsql\bin')
Assert-True 'fills in a missing SESSION_SECRET rather than leaving it empty' ($filled.Lines -contains 'SESSION_SECRET=FRESH-SECRET-FROM-THIS-RUN')
Assert-True 'keeps the leading comment first' ($filled.Lines[0] -eq '# a pre-merge file missing keys added since')

$empty = Merge-EnvLines -Existing @('SESSION_SECRET=', 'TENANT_TIME_ZONE=   ') -Settings (New-Settings) -KeepExisting $keep
Assert-True 'replaces an EMPTY kept value (the app refuses a blank secret)' (
    $empty.Lines -contains 'SESSION_SECRET=FRESH-SECRET-FROM-THIS-RUN' -and $empty.Lines -contains 'TENANT_TIME_ZONE=Asia/Karachi')

$dupes = Merge-EnvLines -Existing @('PORT=3000', 'MEHVAR_BACKUP_DIR=E:\x', 'PORT=4000') -Settings (New-Settings) -KeepExisting $keep
Assert-True 'collapses a duplicated installer key to ONE line (last-wins would override it)' (
    @($dupes.Lines | Where-Object { $_ -like 'PORT=*' }).Count -eq 1)
Assert-True 'and keeps the shop line between the duplicates' ($dupes.Lines[1] -eq 'MEHVAR_BACKUP_DIR=E:\x')

$exported = Merge-EnvLines -Existing @('export APP_DB_PASSWORD=old', 'export MEHVAR_BACKUP_DIR=E:\x') -Settings (New-Settings) -KeepExisting $keep
Assert-True 'recognises the `export KEY=` form dotenv accepts' (
    ($exported.Lines[0] -eq 'APP_DB_PASSWORD=app-pw-NEW') -and ($exported.Lines[1] -eq 'export MEHVAR_BACKUP_DIR=E:\x'))

$spaced = Merge-EnvLines -Existing @('APP_DB_PASSWORD = old') -Settings (New-Settings) -KeepExisting $keep
Assert-True 'recognises `KEY = value` with spaces' ($spaced.Lines[0] -eq 'APP_DB_PASSWORD=app-pw-NEW')

$port = Merge-EnvLines -Existing $shopFile -Settings (New-Settings -Port '3100') -KeepExisting $keep
Assert-True 'PORT is installer-owned: the firewall rule and shortcut are built on it' (
    ($port.Lines -contains 'PORT=3100') -and ($port.Replaced -contains 'PORT'))

Write-Host 'Writing the file:'
$dir  = Join-Path ([System.IO.Path]::GetTempPath()) ("mehvar-config-tests-" + [guid]::NewGuid())
New-Item -ItemType Directory -Path $dir | Out-Null
try {
    $path = Join-Path $dir '.env'
    Assert-True 'reads a missing file as no lines' (@(Read-EnvFile -Path $path).Count -eq 0)

    # A shop value outside ASCII must survive the round trip byte for byte.
    $withBom = [System.Text.Encoding]::UTF8.GetPreamble() + [System.Text.Encoding]::UTF8.GetBytes(
        "APP_ENV=production`r`nMEHVAR_BACKUP_DIR=E:\Backups\" + [char]0x0645 + [char]0x062D + "`r`n")
    [System.IO.File]::WriteAllBytes($path, $withBom)

    $result = Update-EnvFile -Path $path -Settings (New-Settings) -KeepExisting $keep
    $bytes  = [System.IO.File]::ReadAllBytes($path)
    Assert-True 'writes no byte-order mark (it would glue itself to the first key)' (
        -not ($bytes.Length -ge 3 -and $bytes[0] -eq 0xEF -and $bytes[1] -eq 0xBB -and $bytes[2] -eq 0xBF))
    $text = [System.IO.File]::ReadAllText($path)
    Assert-True 'preserves a non-ASCII shop value exactly' ($text.Contains("MEHVAR_BACKUP_DIR=E:\Backups\" + [char]0x0645 + [char]0x062D))
    Assert-True 'starts with the first key, not a mangled one' ($text.StartsWith('APP_ENV=production'))
    Assert-True 'ends with a newline' ($text.EndsWith("`r`n"))
    Assert-True 'returns the merge for the caller to log' ($result.Kept -contains 'MEHVAR_BACKUP_DIR')

    # The rehearsal's failure: a hand-edited file with a blank line and a
    # comment went through Merge fine and then could not be WRITTEN.
    [System.IO.File]::WriteAllLines($path, [string[]] $shopFile)
    $edited = $null
    try { $edited = Update-EnvFile -Path $path -Settings (New-Settings) -KeepExisting $keep } catch { Write-Host "         threw: $($_.Exception.Message)" }
    Assert-True 'writes a file containing blank lines (a hand-edited .env)' ($null -ne $edited)
    Assert-True 'and keeps the blank line and the comment' (
        ([System.IO.File]::ReadAllLines($path) -contains '') -and
        ([System.IO.File]::ReadAllLines($path) -contains '# backups to the USB drive (OPERATIONS.md section 5)'))
} finally {
    Remove-Item -LiteralPath $dir -Recurse -Force -ErrorAction SilentlyContinue
}

Write-Host 'Masking the install log:'
Assert-True 'drops the password from a psql connection URL, keeps the user and host' (
    (Protect-LogText 'run: psql.exe postgresql://mehvar:Abc123xyz@localhost:5433/postgres -v ON_ERROR_STOP=1') -eq
    'run: psql.exe postgresql://mehvar:<redacted>@localhost:5433/postgres -v ON_ERROR_STOP=1')
Assert-True "masks init's one-time credentials" (
    (Protect-LogText '   | Pairing key  gtud-jfcb-rj4x') -eq '   | Pairing key  <redacted>' -and
    (Protect-LogText '   | Owner pass   jcsk-t26s-nbwf') -eq '   | Owner pass   <redacted>')
Assert-True 'masks a secret-named setting' ((Protect-LogText 'APP_DB_PASSWORD=hunter2') -eq 'APP_DB_PASSWORD=<redacted>')
Assert-True 'leaves an ordinary line exactly as it was' (
    (Protect-LogText '   kept the shop''s own settings: MEHVAR_BACKUP_DIR') -eq '   kept the shop''s own settings: MEHVAR_BACKUP_DIR')

if ($script:Failures -gt 0) {
    Write-Host "`n  $($script:Failures) config assertion(s) FAILED."
    exit 1
}
Write-Host "`n  All config assertions passed."
