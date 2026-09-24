<#
.SYNOPSIS
    Regression tests for pre-update-backup.ps1's decisions.

.DESCRIPTION
    The script decides whether Setup may continue. Two ways to get that wrong:
    refuse a first install (nothing to lose, and the installer would never run
    anywhere), or wave an upgrade through without a backup (the defect it
    exists to fix). These pin the branches that need no database; the ones
    that do -- a real dump, a refused password, a server that is down -- need a
    live cluster and are exercised by the upgrade rehearsal.

    Each case runs the script in a CHILD PowerShell, because the script ends
    with `exit`. Plain assertions, like the other suites here. Exits non-zero on
    any failure.
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

$script:Failures = 0
$target = Join-Path $scriptRoot 'pre-update-backup.ps1'
$shell  = (Get-Process -Id $PID).Path

function Assert-True {
    param([string] $Name, [bool] $Condition)
    if ($Condition) { Write-Host "  [ ok ] $Name"; return }
    Write-Host "  [FAIL] $Name"
    $script:Failures++
}

function Invoke-Backup {
    param([string] $InstallDir, [string] $DataDir, [string] $PgBin)
    $ErrorActionPreference = 'Continue'
    $PSNativeCommandUseErrorActionPreference = $false
    $output = & $shell -NoProfile -ExecutionPolicy Bypass -File $target `
        -InstallDir $InstallDir -DataDir $DataDir -PgService '' -PgBin $PgBin 2>&1
    return [pscustomobject]@{
        ExitCode = $LASTEXITCODE
        Output   = (@($output) | ForEach-Object { $_.ToString() }) -join "`n"
    }
}

$root = Join-Path ([System.IO.Path]::GetTempPath()) ("mehvar-preupdate-tests-" + [guid]::NewGuid())
New-Item -ItemType Directory -Path $root | Out-Null
try {
    $install = Join-Path $root 'install'
    $data    = Join-Path $root 'data'
    $emptyBin = Join-Path $root 'no-postgres-here'
    New-Item -ItemType Directory -Path $install, $data, $emptyBin | Out-Null

    Write-Host 'First install:'
    $first = Invoke-Backup -InstallDir $install -DataDir $data -PgBin $emptyBin
    Assert-True 'no database cluster: lets Setup continue (exit 0)' ($first.ExitCode -eq 0)
    Assert-True 'and says why, in the log' ($first.Output -match 'first install')
    $missing = Invoke-Backup -InstallDir $install -DataDir (Join-Path $root 'never-created') -PgBin $emptyBin
    Assert-True 'a data directory that does not exist yet is a first install too' ($missing.ExitCode -eq 0)

    Write-Host 'An existing installation it cannot back up:'
    $pgdata = Join-Path $data 'pgdata'
    New-Item -ItemType Directory -Path $pgdata | Out-Null
    Set-Content -LiteralPath (Join-Path $pgdata 'PG_VERSION') -Value '17' -Encoding ascii

    $noCreds = Invoke-Backup -InstallDir $install -DataDir $data -PgBin $emptyBin
    Assert-True 'a cluster without its owner password: REFUSES (exit 1)' ($noCreds.ExitCode -eq 1)
    Assert-True 'and names the missing file' ($noCreds.Output -match '\.pgpass-owner')
    Assert-True 'and says nothing was changed' ($noCreds.Output -match 'has not changed anything')

    Set-Content -LiteralPath (Join-Path $data '.pgpass-owner') -Value 'secret' -NoNewline -Encoding ascii
    $noTools = Invoke-Backup -InstallDir $install -DataDir $data -PgBin $emptyBin
    Assert-True 'no PostgreSQL tools to dump with: REFUSES (exit 1)' ($noTools.ExitCode -eq 1)
    Assert-True 'and names the tool it looked for' ($noTools.Output -match 'psql was not found')

    $default = Invoke-Backup -InstallDir $install -DataDir $data -PgBin ''
    Assert-True 'defaults to the installed pgsql\bin, and refuses when it is absent' (
        $default.ExitCode -eq 1 -and $default.Output -match 'pgsql')

    Assert-True 'never prints the owner password' (
        -not (($noCreds.Output + $noTools.Output + $default.Output) -match 'secret'))
} finally {
    Remove-Item -LiteralPath $root -Recurse -Force -ErrorAction SilentlyContinue
}

if ($script:Failures -gt 0) {
    Write-Host "`n  $($script:Failures) pre-update backup assertion(s) FAILED."
    exit 1
}
Write-Host "`n  All pre-update backup assertions passed."
