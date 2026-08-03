#Requires -Version 5.1
<#
.SYNOPSIS
    Create the desktop shortcut the counter actually uses.

.DESCRIPTION
    ADR-6 and Phase 12 §6: a dedicated browser profile, kiosk printing, app
    mode, pinned and autostarted. The operator double-clicks one icon and gets
    the sale screen — no address bar, no tabs, no other browsing.

    The dedicated profile is not tidiness. `--kiosk-printing` suppresses the
    print dialog for every page the profile opens, so it must not be the
    profile someone uses for anything else. It also keeps the counter's
    IndexedDB outbox (ADR-3) away from a profile a person might clear.

    Run with -CounterHost to point a second counter at the Node over the LAN.
    Use an IP, not a hostname: name resolution on a shop LAN is unreliable, and
    a counter that cannot resolve the server is a counter that cannot sell.

    UNVERIFIED — see README.md. Never executed on Windows.
#>
[CmdletBinding()]
param(
    [string] $CounterHost = 'localhost',
    [int]    $Port = 3000,
    [string] $ProfileDir = (Join-Path $env:LOCALAPPDATA 'Mehvar\counter-profile'),
    [switch] $Autostart
)

$ErrorActionPreference = 'Stop'

$url = "http://${CounterHost}:${Port}/sale"

$browsers = @(
    "$env:ProgramFiles\Google\Chrome\Application\chrome.exe",
    "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe",
    "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe",
    "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe",
    "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe"
)

$browser = $browsers | Where-Object { Test-Path $_ } | Select-Object -First 1
if (-not $browser) {
    throw 'Neither Chrome nor Edge was found. Install Chrome, then re-run this script.'
}

if (-not (Test-Path $ProfileDir)) {
    New-Item -ItemType Directory -Path $ProfileDir -Force | Out-Null
}

$arguments = @(
    "--app=$url"                      # No address bar, no tabs.
    "--user-data-dir=`"$ProfileDir`"" # Dedicated profile — see above.
    '--kiosk-printing'                # ADR-6: receipts print without a dialog.
    '--no-first-run'
    '--no-default-browser-check'
    '--disable-features=TranslateUI'
) -join ' '

function New-Shortcut {
    param([string] $Path)

    $shell = New-Object -ComObject WScript.Shell
    $link = $shell.CreateShortcut($Path)
    $link.TargetPath = $browser
    $link.Arguments = $arguments
    $link.WorkingDirectory = Split-Path $browser -Parent
    $link.Description = 'Mehvar Pharmacy — counter'
    $link.Save()
}

$desktop = [Environment]::GetFolderPath('CommonDesktopDirectory')
New-Shortcut -Path (Join-Path $desktop 'Mehvar Counter.lnk')
Write-Host "  Desktop shortcut created for $url"

# Start Menu too. mehvar.iss deliberately does not create this one: only this
# script knows where Chrome actually landed on this machine.
$startMenu = Join-Path ([Environment]::GetFolderPath('CommonPrograms')) 'Mehvar'
if (-not (Test-Path $startMenu)) { New-Item -ItemType Directory -Path $startMenu -Force | Out-Null }
New-Shortcut -Path (Join-Path $startMenu 'Mehvar Counter.lnk')

if ($Autostart) {
    # The shop's morning is: turn the PC on. Nothing else should be required.
    $startup = [Environment]::GetFolderPath('CommonStartup')
    New-Shortcut -Path (Join-Path $startup 'Mehvar Counter.lnk')
    Write-Host '  Counter will open automatically at startup'
}

Write-Host "  Browser: $browser"
Write-Host "  Profile: $ProfileDir"
