<#
.SYNOPSIS
    Running a native tool from a check, and reading the answer correctly.

.DESCRIPTION
    Extracted from verify-install.ps1 for the same reason lib-service.ps1 was
    extracted from install-services.ps1: the logic here has already been wrong
    once on a real machine, and inline it could only be tested by installing.
    `verify-checks.tests.ps1` is the regression suite; `npm run lint:ps` runs it.

    WHAT WENT WRONG

    The first real install reported this, and it is the OPPOSITE of a problem:

        [FAIL] Event tables are immutable (ADR-1 / PCN-001)
               -- ERROR:  permission denied for table sales

    Permission denied is exactly what ADR-1 requires. The check was written as
    "run psql, then look at $LASTEXITCODE", and it never reached the second
    half. verify-install.ps1 sets $ErrorActionPreference = 'Stop', which is
    right for cmdlets and also changes what a NATIVE command does -- in two
    different ways on the two runtimes this script can meet:

      Windows PowerShell 5.1  Redirecting a native command's stderr (2>$null,
                              2>&1) makes PowerShell wrap each stderr line in
                              an ErrorRecord. Under 'Stop' the first one throws.
      PowerShell 7            $PSNativeCommandUseErrorActionPreference makes a
                              non-zero exit code throw.

    Either way the throw happens BEFORE $LASTEXITCODE is read, and the check's
    own `throw` string never runs. The giveaway in the install log was that the
    reported message was psql's words, not the script's.

    THE SECOND BUG, WHICH THE FIRST WAS HIDING

    The assertion was also one-sided: any non-zero exit counted as success. A
    typo in the table name, a refused connection, a missing psql.exe -- all of
    them "prove" immutability. PCN-001 exists because a guarantee can be
    decorative while appearing enforced; a check that passes when it could not
    run is the same failure wearing the verifier's clothes.

    So the verdict below requires the specific words "permission denied".
    Anything else is inconclusive, and inconclusive is a failure.
#>

<#
.SYNOPSIS
    Run a native command; return its exit code and everything it said.

.DESCRIPTION
    Neutralises both terminating-error mechanisms above for the duration of the
    call. Assigning the preference variables inside a function shadows the
    script-level ones and restores them on return, so the rest of the script
    keeps 'Stop'.

    $PSNativeCommandUseErrorActionPreference does not exist in Windows
    PowerShell 5.1; assigning it there creates an unused local, which is
    harmless and cheaper than a version test.

    ExitCode is -1 when the command never ran at all (not found, not
    executable). $LASTEXITCODE is only set by the engine once a native command
    completes, so a null after the call means there was nothing to exit -- and
    reporting that as 0 would let "psql.exe is missing" read as "the UPDATE
    succeeded", which is the worst possible mistranslation here.

    A missing command is resolved up front rather than after the fact, because
    a CommandNotFoundException is raised before the 2>&1 redirection applies:
    it would print to the console and leave Output empty, so the log would
    carry a bare exit code and none of the reason.
#>
function Invoke-Native {
    param(
        [Parameter(Mandatory)] [string] $FilePath,
        [string[]] $Arguments = @()
    )

    $ErrorActionPreference = 'Continue'
    $PSNativeCommandUseErrorActionPreference = $false

    if ($null -eq (Get-Command $FilePath -ErrorAction SilentlyContinue)) {
        return [pscustomobject]@{
            ExitCode = -1
            Output   = "The command '$FilePath' was not found, so nothing ran."
        }
    }

    $global:LASTEXITCODE = $null
    $captured = & $FilePath @Arguments 2>&1

    $code = $LASTEXITCODE
    if ($null -eq $code) { $code = -1 }

    $text = ''
    if ($null -ne $captured) {
        $text = (@($captured) | ForEach-Object { $_.ToString() }) -join [Environment]::NewLine
    }

    return [pscustomobject]@{
        ExitCode = [int] $code
        Output   = $text
    }
}

<#
.SYNOPSIS
    Classify an attempted UPDATE on an event table.

.DESCRIPTION
    Pure: exit code and text in, one of three words out. Pure so that the
    reasoning that was wrong on a real machine can be asserted on any machine.

      immutable     PostgreSQL refused for lack of privilege. The only pass.
      writable      The UPDATE was accepted. The app role can rewrite history;
                    grants never took (PCN-001) or the app connects as owner.
      inconclusive  It failed for some other reason, so it proves nothing.
#>
function Get-ImmutabilityVerdict {
    param(
        [Parameter(Mandatory)] [int] $ExitCode,
        [string] $Output = ''
    )

    if ($ExitCode -eq 0) { return 'writable' }
    if ($Output -match 'permission denied') { return 'immutable' }
    return 'inconclusive'
}

<#
.SYNOPSIS
    The sentence a failed immutability check should print.

.DESCRIPTION
    Kept beside the verdict so the two cannot drift, and so the wording is
    itself under test. 'writable' is the sev-1: the install is unsound however
    healthy the rest of it looks.
#>
function Get-ImmutabilityMessage {
    param(
        [Parameter(Mandatory)] [string] $Verdict,
        [Parameter(Mandatory)] [int] $ExitCode,
        [string] $Output = ''
    )

    if ($Verdict -eq 'writable') {
        return 'UPDATE on sales SUCCEEDED -- the app role can rewrite history. ' +
               'Grants did not take, or the app is connecting as the table owner (PCN-001).'
    }

    return 'UPDATE on sales failed, but NOT for lack of privilege, so it proves nothing. ' +
           "psql exit $ExitCode. Output: $Output"
}

<#
.SYNOPSIS
    What to tell the installer about the default printer, or $null if nothing.

.DESCRIPTION
    The counter prints with Chrome's --kiosk-printing, which sends every receipt
    to the default printer without a dialog. With no receipt printer as the
    default, Windows usually defaults to "Microsoft Print to PDF", and every
    receipt then becomes a PDF file instead of paper -- which is exactly what
    the spare-laptop test did. A warning, never a failure: a shop may be
    installed before its printer arrives.

    Pure: the printer's name in, a sentence or $null out.
#>
function Get-DefaultPrinterWarning {
    param([AllowNull()] [AllowEmptyString()] [string] $PrinterName)

    $advice = 'Set the receipt printer as the Windows default (and turn off "Let Windows ' +
              'manage my default printer"), then use Settings -> Print test receipt.'

    if ([string]::IsNullOrWhiteSpace($PrinterName)) {
        return "No default printer is set, so receipts cannot print. $advice"
    }
    if ($PrinterName -match 'PDF|XPS|OneNote|Fax') {
        return "The default printer is ""$PrinterName"", which saves a file instead of printing a receipt. $advice"
    }
    return $null
}
