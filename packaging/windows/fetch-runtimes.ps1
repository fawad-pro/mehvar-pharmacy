#Requires -Version 5.1
<#
.SYNOPSIS
    Fetch the pinned Node runtime and PostgreSQL binaries into dist\package.

.DESCRIPTION
    Kept out of `npm run package:build` on purpose: these are large, change
    about once a year, and are identical between builds. Re-downloading them on
    every application build would be the slowest possible way to get the same
    bytes.

    Both are pinned. A pharmacy's runtime must not change because an upstream
    "latest" moved -- the whole point of bundling is that the shop machine runs
    what was tested, not what is current.

    PostgreSQL comes from EDB's ZIP archive rather than their interactive
    installer: the installer is GUI-driven and versioned independently of us,
    which is unacceptable in a silent install.

    UNVERIFIED -- see README.md. Never executed on Windows.
#>
[CmdletBinding()]
param(
    <#
        Deliberately NOT defaulted to a $PSScriptRoot expression.

        Parameter defaults are evaluated during binding, and $PSScriptRoot can
        be empty there -- which is how this script died on a real Windows box
        before running a single line of its own logic. `Join-Path` refuses an
        empty -Path, so the only error anyone saw named Join-Path and said
        nothing about $PSScriptRoot or even which script had failed.

        The rule: never dereference $PSScriptRoot in a parameter default. Bind
        it empty and resolve in the body, where it is reliable.
    #>
    [string] $OutputRoot,
    [switch] $Force
)

$ErrorActionPreference = 'Stop'

# Resolved after binding, with fallbacks: $MyInvocation carries the path in
# some hosts where $PSScriptRoot does not, and the current directory is a
# last resort that beats throwing from inside a helper.
$scriptRoot =
    if (-not [string]::IsNullOrWhiteSpace($PSScriptRoot)) { $PSScriptRoot }
    elseif (-not [string]::IsNullOrWhiteSpace($MyInvocation.MyCommand.Path)) {
        Split-Path -Parent $MyInvocation.MyCommand.Path
    }
    else { (Get-Location).Path }

if ([string]::IsNullOrWhiteSpace($OutputRoot)) {
    $OutputRoot = Join-Path $scriptRoot '..\..\dist\package'
}

# Relative paths resolve against the session's location, not .NET's current
# directory -- those disagree whenever the session has changed location.
# Normalising also means errors name `C:\Mehvar\dist\package` rather than
# `C:\Mehvar\packaging\windows\..\..\dist\package`.
if (-not [System.IO.Path]::IsPathRooted($OutputRoot)) {
    $OutputRoot = Join-Path (Get-Location).Path $OutputRoot
}
$OutputRoot = [System.IO.Path]::GetFullPath($OutputRoot)

# Pinned deliberately. Bump these together, and re-run the restore drill after.
$NodeVersion     = '22.11.0'
$PostgresVersion = '17.2-1'
$WinSwVersion    = '2.12.0'

$NodeUrl     = "https://nodejs.org/dist/v$NodeVersion/node-v$NodeVersion-win-x64.zip"
$PostgresUrl = "https://get.enterprisedb.com/postgresql/postgresql-$PostgresVersion-windows-x64-binaries.zip"
$WinSwUrl    = "https://github.com/winsw/winsw/releases/download/v$WinSwVersion/WinSW-x64.exe"

<#
    WinSW is the service host: node.exe cannot be a Windows service on its own
    (it never answers the Service Control Manager, so the SCM kills it with
    1053), and WinSW is a service-aware process that runs node as a child.
    MIT licensed, single self-contained executable, no runtime prerequisite.

    The hash is pinned because this one becomes a service running as SYSTEM on
    every pharmacy machine. A download that silently changed would be the worst
    possible thing to take on trust, and "it downloaded fine" is not integrity.
#>
$WinSwSha256 = '05B82D46AD331CC16BDC00DE5C6332C1EF818DF8CEEFCD49C726553209B3A0DA'

# Same class of bug as the parameter default, one line further down: an unset
# environment variable makes Join-Path throw before any of this script's own
# logic runs. LOCALAPPDATA is absent under some service accounts and on any
# non-Windows host, so it gets a fallback rather than being assumed.
$cacheRoot =
    if (-not [string]::IsNullOrWhiteSpace($env:LOCALAPPDATA)) { $env:LOCALAPPDATA }
    else { [System.IO.Path]::GetTempPath() }
$cacheDir = Join-Path $cacheRoot 'Mehvar\build-cache'

function Get-Cached {
    param([string] $Url, [string] $FileName)

    if (-not (Test-Path $cacheDir)) { New-Item -ItemType Directory -Path $cacheDir -Force | Out-Null }
    $cached = Join-Path $cacheDir $FileName

    if ((Test-Path $cached) -and -not $Force) {
        Write-Host "  Using cached $FileName"
        return $cached
    }

    Write-Host "  Downloading $FileName ..."
    # Progress rendering makes Invoke-WebRequest an order of magnitude slower.
    $previous = $ProgressPreference
    $ProgressPreference = 'SilentlyContinue'
    try {
        Invoke-WebRequest -Uri $Url -OutFile $cached -UseBasicParsing
    } finally {
        $ProgressPreference = $previous
    }
    return $cached
}

function Expand-Into {
    param([string] $Archive, [string] $Destination, [string] $StripTopLevel)

    $staging = Join-Path ([System.IO.Path]::GetTempPath()) ([System.Guid]::NewGuid().ToString('N'))
    New-Item -ItemType Directory -Path $staging -Force | Out-Null

    try {
        Expand-Archive -Path $Archive -DestinationPath $staging -Force

        # Both archives wrap everything in a single top-level folder whose name
        # carries the version. Strip it so the payload layout stays stable
        # across version bumps and mehvar.iss never has to change.
        $source = if ($StripTopLevel) {
            $top = Get-ChildItem -Path $staging -Directory | Select-Object -First 1
            if (-not $top) { throw "Archive $Archive had no top-level directory to strip." }
            $top.FullName
        } else {
            $staging
        }

        if (Test-Path $Destination) { Remove-Item -Path $Destination -Recurse -Force }
        New-Item -ItemType Directory -Path (Split-Path $Destination -Parent) -Force | Out-Null
        Move-Item -Path $source -Destination $Destination
    } finally {
        if (Test-Path $staging) { Remove-Item -Path $staging -Recurse -Force -ErrorAction SilentlyContinue }
    }
}

if (-not (Test-Path $OutputRoot)) {
    throw "No package at $OutputRoot. Run 'npm run package:build' first."
}

Write-Host "`n  Node $NodeVersion"
$nodeZip = Get-Cached -Url $NodeUrl -FileName "node-v$NodeVersion-win-x64.zip"
Expand-Into -Archive $nodeZip -Destination (Join-Path $OutputRoot 'runtime') -StripTopLevel 'yes'

Write-Host "`n  PostgreSQL $PostgresVersion"
$pgZip = Get-Cached -Url $PostgresUrl -FileName "postgresql-$PostgresVersion-windows-x64-binaries.zip"
Expand-Into -Archive $pgZip -Destination (Join-Path $OutputRoot 'pgsql') -StripTopLevel 'yes'

Write-Host "`n  WinSW $WinSwVersion"
$winSwCached = Get-Cached -Url $WinSwUrl -FileName "WinSW-x64-$WinSwVersion.exe"

$actual = (Get-FileHash -Path $winSwCached -Algorithm SHA256).Hash
if ($actual -ne $WinSwSha256) {
    # Remove it: a cached file that failed verification must not be trusted by
    # the next run just because it is already on disk.
    Remove-Item -Path $winSwCached -Force -ErrorAction SilentlyContinue
    throw "WinSW hash mismatch. Expected $WinSwSha256, got $actual. Refusing to package it."
}
Write-Host '  SHA256 verified'

$winSwDir = Join-Path $OutputRoot 'winsw'
if (-not (Test-Path $winSwDir)) { New-Item -ItemType Directory -Path $winSwDir -Force | Out-Null }
Copy-Item -Path $winSwCached -Destination (Join-Path $winSwDir 'WinSW.exe') -Force

# Fail here rather than inside the installer on a shop machine.
foreach ($required in @('runtime\node.exe', 'pgsql\bin\initdb.exe', 'pgsql\bin\pg_ctl.exe', 'pgsql\bin\pg_dump.exe', 'winsw\WinSW.exe')) {
    $path = Join-Path $OutputRoot $required
    if (-not (Test-Path $path)) { throw "Expected $required in the payload, but it is missing." }
}

Write-Host "`n  Runtimes staged in $OutputRoot`n"
