#Requires -Version 5.1
<#
.SYNOPSIS
    Remove Mehvar's services, scheduled task, firewall rule and shortcuts.

.DESCRIPTION
    Called by mehvar.iss during uninstall, before the files the services run
    from are deleted.

    **This deliberately does not touch C:\ProgramData\Mehvar.** That directory
    holds the database and every backup. An uninstall that destroys a
    pharmacy's records because somebody was troubleshooting is not recoverable,
    and no confirmation dialog makes it a reasonable default. Removing the data
    stays a separate, deliberate, manual act — the same posture ADR-1 takes
    toward every other irreversible operation in the product.

    Best-effort throughout: an uninstall must finish even if a piece is already
    gone, or the machine is left half-removed and unfixable through the UI.

    UNVERIFIED — see README.md. Never executed on Windows.
#>
[CmdletBinding()]
param(
    # Not a $PSScriptRoot expression — see fetch-runtimes.ps1 for what that
    # costs. It matters more here: this runs during uninstall, and a script
    # that throws during parameter binding leaves both services registered
    # against files the uninstaller is about to delete.
    [string] $InstallDir
)

# Best-effort: keep going and report, rather than aborting half-done.
$ErrorActionPreference = 'Continue'

$scriptRoot =
    if (-not [string]::IsNullOrWhiteSpace($PSScriptRoot)) { $PSScriptRoot }
    elseif (-not [string]::IsNullOrWhiteSpace($MyInvocation.MyCommand.Path)) {
        Split-Path -Parent $MyInvocation.MyCommand.Path
    }
    else { (Get-Location).Path }

if ([string]::IsNullOrWhiteSpace($InstallDir)) {
    # packaging\ sits directly under the install root.
    $InstallDir = Join-Path $scriptRoot '..'
}
if (-not [System.IO.Path]::IsPathRooted($InstallDir)) {
    $InstallDir = Join-Path (Get-Location).Path $InstallDir
}
$InstallDir = [System.IO.Path]::GetFullPath($InstallDir)

$PgService  = 'MehvarPostgres'
$AppService = 'MehvarNode'

function Remove-ServiceSafely {
    param([string] $Name)

    $service = Get-Service -Name $Name -ErrorAction SilentlyContinue
    if (-not $service) {
        Write-Host "  $Name is not installed"
        return
    }

    if ($service.Status -ne 'Stopped') {
        Write-Host "  Stopping $Name ..."
        Stop-Service -Name $Name -Force -ErrorAction SilentlyContinue
        # sc.exe delete on a still-stopping service leaves it marked for
        # deletion until reboot, which blocks a reinstall.
        $service.WaitForStatus('Stopped', (New-TimeSpan -Seconds 30)) 2>$null
    }

    & sc.exe delete $Name | Out-Null
    Write-Host "  Removed service $Name"
}

Write-Host "`n  Removing Mehvar services`n"

# Application first: it holds the database connections.
Remove-ServiceSafely -Name $AppService

# pg_ctl unregister is the clean path; sc.exe delete is the fallback.
$pgCtl = Join-Path $InstallDir 'pgsql\bin\pg_ctl.exe'
if (Test-Path $pgCtl) {
    Stop-Service -Name $PgService -Force -ErrorAction SilentlyContinue
    & $pgCtl unregister -N $PgService 2>$null | Out-Null
}
Remove-ServiceSafely -Name $PgService

Write-Host "`n  Removing the scheduled backup"
& schtasks.exe /Delete /TN 'Mehvar\NightlyBackup' /F 2>$null | Out-Null

Write-Host "  Removing the firewall rule"
Get-NetFirewallRule -DisplayName 'Mehvar Node' -ErrorAction SilentlyContinue |
    Remove-NetFirewallRule -ErrorAction SilentlyContinue

Write-Host "  Removing shortcuts"
foreach ($shortcut in @(
    (Join-Path ([Environment]::GetFolderPath('CommonDesktopDirectory')) 'Mehvar Counter.lnk'),
    (Join-Path ([Environment]::GetFolderPath('CommonStartup')) 'Mehvar Counter.lnk'),
    (Join-Path ([Environment]::GetFolderPath('CommonPrograms')) 'Mehvar\Mehvar Counter.lnk')
)) {
    Remove-Item -Path $shortcut -Force -ErrorAction SilentlyContinue
}

$programData = if (-not [string]::IsNullOrWhiteSpace($env:ProgramData)) { $env:ProgramData }
              else { 'C:\ProgramData' }
$dataDir = Join-Path $programData 'Mehvar'
Write-Host "`n  Mehvar's services are removed."
Write-Host "  Your records and backups have been KEPT in:"
Write-Host "    $dataDir"
Write-Host "  Delete that folder by hand if you really mean to destroy them.`n"
