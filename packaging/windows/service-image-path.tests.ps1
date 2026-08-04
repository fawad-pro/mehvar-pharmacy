<#
.SYNOPSIS
    Regression tests for the service ImagePath construction.

.DESCRIPTION
    The service registration failed on a real machine with sc.exe exit 1639,
    ERROR_INVALID_COMMAND_LINE, and the installer did not log the invocation, so
    the argument string could not be inspected. These assertions exist so that
    can never again be a mystery: the construction is now a function with a
    pinned output.

    Run by `npm run lint:ps` wherever PowerShell is installed. Plain assertions
    rather than Pester, because a test suite that needs a module installed first
    is a test suite that does not run on the machine that matters.

    Exits non-zero on the first failure.
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

. (Join-Path $scriptRoot 'lib-service.ps1')

$script:Failures = 0

function Assert-Equal {
    param([string] $Name, [string] $Expected, [string] $Actual)

    if ($Expected -ceq $Actual) {
        Write-Host "  [ ok ] $Name"
        return
    }
    Write-Host "  [FAIL] $Name"
    Write-Host "         expected <$Expected>"
    Write-Host "         actual   <$Actual>"
    $script:Failures++
}

function Assert-Throws {
    param([string] $Name, [scriptblock] $Action)

    try {
        & $Action
        Write-Host "  [FAIL] $Name -- expected it to throw, but it returned"
        $script:Failures++
    } catch {
        Write-Host "  [ ok ] $Name"
    }
}

Write-Host ''
Write-Host '  Service ImagePath construction'
Write-Host ''

# The exact case that failed in production: Program Files has a space, and so
# does nothing else about it -- which is why the unquoted form truncated.
Assert-Equal 'quotes an interpreter and script path containing spaces' `
    '"C:\Windows\System32\cmd.exe" /c "C:\Program Files\Mehvar\mehvar-node.cmd"' `
    (New-ServiceImagePath -Interpreter 'C:\Windows\System32\cmd.exe' `
                          -ScriptPath  'C:\Program Files\Mehvar\mehvar-node.cmd')

# Quoting unconditionally: a path without spaces still gets quotes, because a
# rule with an exception is a rule someone eventually gets wrong.
Assert-Equal 'quotes even when neither path needs it' `
    '"C:\Windows\System32\cmd.exe" /c "C:\Mehvar\mehvar-node.cmd"' `
    (New-ServiceImagePath -Interpreter 'C:\Windows\System32\cmd.exe' `
                          -ScriptPath  'C:\Mehvar\mehvar-node.cmd')

# The SCM splits ImagePath with CommandLineToArgvW rules. Every quote must be
# balanced or the service points somewhere else entirely.
$path = New-ServiceImagePath -Interpreter 'C:\Windows\System32\cmd.exe' `
                             -ScriptPath  'C:\Program Files\Mehvar\mehvar-node.cmd'
Assert-Equal 'has balanced quotes' 'True' `
    ((($path.ToCharArray() | Where-Object { $_ -eq '"' }).Count % 2 -eq 0).ToString())

# Backslash-escaped quotes are exactly what sc.exe could not parse. The value
# handed to CreateService must contain none.
Assert-Equal 'contains no backslash-escaped quotes' 'True' `
    ((-not $path.Contains('\"')).ToString())

Assert-Equal 'starts with a quoted interpreter, so a spaced path cannot truncate' 'True' `
    ($path.StartsWith('"').ToString())

Assert-Throws 'refuses an empty interpreter' { New-ServiceImagePath -Interpreter '' -ScriptPath 'C:\x.cmd' }
Assert-Throws 'refuses an empty script path' { New-ServiceImagePath -Interpreter 'C:\cmd.exe' -ScriptPath '' }
Assert-Throws 'refuses a path containing a double quote' {
    New-ServiceImagePath -Interpreter 'C:\cmd.exe' -ScriptPath 'C:\we"ird.cmd'
}

Write-Host ''
Write-Host '  cmd.exe resolution'
Write-Host ''

Assert-Equal 'addresses cmd.exe absolutely from SystemRoot' `
    'C:\Windows\System32\cmd.exe' `
    (Get-CmdExePath -SystemRoot 'C:\Windows')

# Join-Path throws on a null -Path. This has cost three round-trips already.
Assert-Equal 'falls back when SystemRoot is unset' `
    'C:\Windows\System32\cmd.exe' `
    (Get-CmdExePath -SystemRoot '')

Write-Host ''
if ($script:Failures -gt 0) {
    Write-Host "  $($script:Failures) assertion(s) FAILED."
    exit 1
}
Write-Host '  All service-argument assertions passed.'
