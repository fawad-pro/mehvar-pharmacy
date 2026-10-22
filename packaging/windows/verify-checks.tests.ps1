<#
.SYNOPSIS
    Regression tests for how verify-install.ps1 runs tools and reads answers.

.DESCRIPTION
    The first real install produced this, and it is the opposite of a problem:

        [FAIL] Event tables are immutable (ADR-1 / PCN-001)
               -- ERROR:  permission denied for table sales

    Two defects, one masking the other:

      1. Under $ErrorActionPreference = 'Stop', a native command's own
         diagnostics become a terminating error before $LASTEXITCODE can be
         read. The check never reached its own logic; the message printed was
         psql's, not the script's.
      2. The assertion counted ANY non-zero exit as success. A refused
         connection or a missing psql.exe would have "proved" immutability --
         a check that passes when it could not run, guarding the one property
         PCN-001 exists to keep from being decorative.

    Both are now assertable without a database and without Windows. The first
    is exercised for real against a native command that exits non-zero and
    writes to stderr, under 'Stop', which is precisely the shape that failed.

    Plain assertions rather than Pester, for the reason given in
    service-descriptor.tests.ps1: a suite needing a module installed first is a
    suite that does not run on the machine that matters. Exits non-zero on any
    failure; npm run lint:ps runs it.
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

. (Join-Path $scriptRoot 'lib-verify.ps1')

$script:Failures = 0

function Assert-True {
    param([string] $Name, [bool] $Condition)
    if ($Condition) { Write-Host "  [ ok ] $Name"; return }
    Write-Host "  [FAIL] $Name"
    $script:Failures++
}

function Assert-Equal {
    param([string] $Name, $Expected, $Actual)
    if ($Expected -eq $Actual) { Write-Host "  [ ok ] $Name"; return }
    Write-Host "  [FAIL] $Name -- expected '$Expected', got '$Actual'"
    $script:Failures++
}

Write-Host "`n  verify-install argument and verdict assertions`n"

# ---------------------------------------------------------------------------
# The verdict. Pure, so the reasoning that was wrong on real hardware is
# assertable on any machine.
# ---------------------------------------------------------------------------

Assert-Equal 'permission denied is the pass -- ADR-1 holding, not failing' `
    'immutable' (Get-ImmutabilityVerdict -ExitCode 1 -Output 'ERROR:  permission denied for table sales')

Assert-Equal 'psql exit 0 means the UPDATE was accepted -- sev-1' `
    'writable' (Get-ImmutabilityVerdict -ExitCode 0 -Output 'UPDATE 0')

Assert-Equal 'a refused connection proves nothing, and must not pass' `
    'inconclusive' (Get-ImmutabilityVerdict -ExitCode 2 `
        -Output 'psql: error: connection to server at "127.0.0.1", port 5432 failed: Connection refused')

Assert-Equal 'a mistyped table proves nothing, and must not pass' `
    'inconclusive' (Get-ImmutabilityVerdict -ExitCode 1 -Output 'ERROR:  relation "salez" does not exist')

Assert-Equal 'a command that never ran proves nothing, and must not pass' `
    'inconclusive' (Get-ImmutabilityVerdict -ExitCode -1 -Output 'The term ''psql.exe'' is not recognized')

Assert-True 'the sev-1 message says the UPDATE succeeded' `
    ((Get-ImmutabilityMessage -Verdict 'writable' -ExitCode 0 -Output 'UPDATE 0') -match 'SUCCEEDED')

Assert-True 'the inconclusive message carries the tool''s own words' `
    ((Get-ImmutabilityMessage -Verdict 'inconclusive' -ExitCode 2 -Output 'Connection refused') -match 'Connection refused')

Assert-True 'the inconclusive message does not claim immutability was proved' `
    ((Get-ImmutabilityMessage -Verdict 'inconclusive' -ExitCode 2 -Output 'Connection refused') -match 'proves nothing')

# ---------------------------------------------------------------------------
# The default printer. --kiosk-printing sends receipts to it without a dialog;
# a PDF "printer" there turned every receipt into a downloaded file.
# ---------------------------------------------------------------------------

Assert-True 'Microsoft Print to PDF as the default is warned about, by name' `
    ((Get-DefaultPrinterWarning -PrinterName 'Microsoft Print to PDF') -match 'Microsoft Print to PDF')

Assert-True 'the XPS writer, OneNote and Fax are warned about too' `
    ($null -ne (Get-DefaultPrinterWarning -PrinterName 'Microsoft XPS Document Writer') -and
     $null -ne (Get-DefaultPrinterWarning -PrinterName 'OneNote (Desktop)') -and
     $null -ne (Get-DefaultPrinterWarning -PrinterName 'Fax'))

Assert-True 'no default printer at all is warned about' `
    ((Get-DefaultPrinterWarning -PrinterName '') -match 'No default printer')

Assert-Equal 'a thermal receipt printer as the default needs no warning' `
    $null (Get-DefaultPrinterWarning -PrinterName 'BlackCopper BC-85AC')

Assert-True 'the warning says what to do next' `
    ((Get-DefaultPrinterWarning -PrinterName 'Microsoft Print to PDF') -match 'Print test receipt')

# ---------------------------------------------------------------------------
# Invoke-Native. Run for real against a command that exits non-zero AND writes
# to stderr, with both terminating-error mechanisms armed -- the exact
# conditions under which the old code threw before reading its exit code.
# ---------------------------------------------------------------------------

$ErrorActionPreference = 'Stop'
$PSNativeCommandUseErrorActionPreference = $true

if ($IsWindows -or $null -eq $IsWindows) {
    $shell = "$env:SystemRoot\System32\cmd.exe"
    $failArgs = @('/c', 'echo boom 1>&2 & exit /b 3')
    $passArgs = @('/c', 'echo fine')
} else {
    $shell = '/bin/sh'
    $failArgs = @('-c', 'echo boom 1>&2; exit 3')
    $passArgs = @('-c', 'echo fine')
}

$failed = Invoke-Native $shell $failArgs
Assert-Equal 'a failing native command returns its exit code instead of throwing' 3 $failed.ExitCode
Assert-True  'its stderr is captured, not lost to a hidden window' ($failed.Output -match 'boom')

$passed = Invoke-Native $shell $passArgs
Assert-Equal 'a succeeding native command reports 0' 0 $passed.ExitCode
Assert-True  'and its stdout comes back' ($passed.Output -match 'fine')

# The whole point: exit code intact after a failure, so the caller's own logic
# runs. Under the old code this line was never reached.
$verdict = Get-ImmutabilityVerdict -ExitCode $failed.ExitCode -Output $failed.Output
Assert-Equal 'a failure for the wrong reason is inconclusive end to end' 'inconclusive' $verdict

$absent = Invoke-Native (Join-Path $scriptRoot 'no-such-tool-at-all.exe')
Assert-Equal 'a command that does not exist reports -1, never 0' -1 $absent.ExitCode
Assert-True  'and says which command was missing, rather than a bare code' `
    ($absent.Output -match 'no-such-tool-at-all\.exe')

# Invoke-Native must not leak its own relaxation into the caller.
Assert-Equal 'the caller keeps ErrorActionPreference = Stop afterwards' 'Stop' $ErrorActionPreference
Assert-Equal 'and keeps its native-error preference' $true $PSNativeCommandUseErrorActionPreference

if ($script:Failures -gt 0) {
    Write-Host "`n  $($script:Failures) assertion(s) FAILED.`n"
    exit 1
}

Write-Host "`n  All verifier assertions passed.`n"
