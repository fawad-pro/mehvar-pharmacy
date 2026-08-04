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
    "latest" moved — the whole point of bundling is that the shop machine runs
    what was tested, not what is current.

    PostgreSQL comes from EDB's ZIP archive rather than their interactive
    installer: the installer is GUI-driven and versioned independently of us,
    which is unacceptable in a silent install.

    UNVERIFIED — see README.md. Never executed on Windows.
#>
[CmdletBinding()]
param(
    <#
        Deliberately NOT defaulted to a $PSScriptRoot expression.

        Parameter defaults are evaluated during binding, and $PSScriptRoot can
        be empty there — which is how this script died on a real Windows box
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
# directory — those disagree whenever the session has changed location.
# Normalising also means errors name `C:\Mehvar\dist\package` rather than
# `C:\Mehvar\packaging\windows\..\..\dist\package`.
if (-not [System.IO.Path]::IsPathRooted($OutputRoot)) {
    $OutputRoot = Join-Path (Get-Location).Path $OutputRoot
}
$OutputRoot = [System.IO.Path]::GetFullPath($OutputRoot)

# Pinned deliberately. Bump both together, and re-run the restore drill after.
$NodeVersion     = '22.11.0'
$PostgresVersion = '17.2-1'

$NodeUrl     = "https://nodejs.org/dist/v$NodeVersion/node-v$NodeVersion-win-x64.zip"
$PostgresUrl = "https://get.enterprisedb.com/postgresql/postgresql-$PostgresVersion-windows-x64-binaries.zip"

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

# Fail here rather than inside the installer on a shop machine.
foreach ($required in @('runtime\node.exe', 'pgsql\bin\initdb.exe', 'pgsql\bin\pg_ctl.exe', 'pgsql\bin\pg_dump.exe')) {
    $path = Join-Path $OutputRoot $required
    if (-not (Test-Path $path)) { throw "Expected $required in the payload, but it is missing." }
}

Write-Host "`n  Runtimes staged in $OutputRoot`n"
