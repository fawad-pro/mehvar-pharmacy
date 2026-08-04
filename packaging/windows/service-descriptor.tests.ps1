<#
.SYNOPSIS
    Regression tests for the WinSW service descriptor.

.DESCRIPTION
    Service registration has now failed twice on real hardware: sc.exe exit
    1639 (a command line sc.exe could not parse) and the 1053 that would have
    followed it (node.exe is not service-aware). Both were string- and
    hosting-level mistakes that no test could see, because there was no
    function to test.

    These assertions pin the descriptor WinSW is handed. Plain assertions
    rather than Pester, because a suite that needs a module installed first is
    a suite that does not run on the machine that matters. Exits non-zero on
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

. (Join-Path $scriptRoot 'lib-service.ps1')

$script:Failures = 0

function Assert-True {
    param([string] $Name, [bool] $Condition)
    if ($Condition) { Write-Host "  [ ok ] $Name"; return }
    Write-Host "  [FAIL] $Name"
    $script:Failures++
}

function Test-IsXml {
    param([string] $Text)
    try { [void][xml]$Text; return $true } catch { return $false }
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

$descriptor = New-WinSwDescriptor `
    -ServiceId        'MehvarNode' `
    -DisplayName      'Mehvar Node' `
    -Description      'Runs the Mehvar Pharmacy counter server.' `
    -NodeExe          'C:\Program Files\Mehvar\runtime\node.exe' `
    -ServerScript     'C:\Program Files\Mehvar\app\bin\ops\serve.js' `
    -WorkingDirectory 'C:\Program Files\Mehvar\app' `
    -LogDirectory     'C:\ProgramData\Mehvar\logs' `
    -EnvFile          'C:\ProgramData\Mehvar\.env'

Write-Host ''
Write-Host '  WinSW descriptor'
Write-Host ''

Assert-True 'is well-formed XML' (Test-IsXml $descriptor)

$xml = [xml]$descriptor

Assert-True 'declares the service id the installer registers' ($xml.service.id -eq 'MehvarNode')
Assert-True 'starts automatically at boot'                    ($xml.service.startmode -eq 'Automatic')

# The whole point of WinSW: node.exe is supervised directly, so the PID the
# SCM watches is the PID actually serving.
Assert-True 'executes node.exe directly, not cmd.exe' `
    ($xml.service.executable -like '*node.exe' -and $xml.service.executable -notlike '*cmd.exe*')

# Paths with spaces are the normal case on Windows. An unquoted argument
# truncates at "C:\Program".
Assert-True 'quotes the server script argument' ($xml.service.arguments -eq '"C:\Program Files\Mehvar\app\bin\ops\serve.js"')

Assert-True 'runs from the app directory so node_modules resolves' `
    ($xml.service.workingdirectory -eq 'C:\Program Files\Mehvar\app')

# .env must stay authoritative: an owner editing MEHVAR_BACKUP_DIR and
# restarting must get what they asked for.
Assert-True 'passes DOTENV_CONFIG_PATH rather than freezing the environment' `
    (($xml.service.env | Where-Object { $_.name -eq 'DOTENV_CONFIG_PATH' }).value -eq 'C:\ProgramData\Mehvar\.env')
Assert-True 'freezes no other environment variable into the descriptor' `
    (@($xml.service.env).Count -eq 1)

Write-Host ''
Write-Host '  Restart policy and logging'
Write-Host ''

Assert-True 'restarts on failure three times, escalating' `
    (@($xml.service.onfailure).Count -eq 3 -and
     (@($xml.service.onfailure) | Where-Object { $_.action -ne 'restart' }).Count -eq 0)

# Restarting forever hides the fault it papers over.
Assert-True 'stops after the third restart rather than looping forever' `
    ((@($xml.service.onfailure)[-1]).delay -eq '30 sec')

Assert-True 'resets the failure count daily' ($xml.service.resetfailure -eq '1 day')

# node.log on a machine nobody administers must not fill the disk.
Assert-True 'rolls logs by size'      ($xml.service.log.mode -eq 'roll-by-size')
Assert-True 'keeps a bounded history' ([int]$xml.service.log.keepFiles -gt 0)
Assert-True 'logs where the support bundle looks' ($xml.service.logpath -eq 'C:\ProgramData\Mehvar\logs')

Assert-True 'stops the parent first so node is not orphaned' `
    ($xml.service.stopparentprocessfirst -eq 'true')

Write-Host ''
Write-Host '  Escaping and refusal'
Write-Host ''

# A shop named "Ali & Sons" reaches nothing here, but a path might, and an
# unescaped ampersand produces XML WinSW cannot parse at all.
$escaped = New-WinSwDescriptor -ServiceId 'MehvarNode' -DisplayName 'Ali & Sons <Counter>' `
    -Description 'A & B' -NodeExe 'C:\a\node.exe' -ServerScript 'C:\a\serve.js' `
    -WorkingDirectory 'C:\a' -LogDirectory 'C:\a\logs' -EnvFile 'C:\a\.env'

Assert-True 'escapes ampersands and angle brackets into valid XML' (Test-IsXml $escaped)
Assert-True 'round-trips an escaped display name' (([xml]$escaped).service.name -eq 'Ali & Sons <Counter>')

Assert-Throws 'refuses an empty node path' {
    New-WinSwDescriptor -ServiceId 'X' -DisplayName 'X' -Description 'X' -NodeExe '' `
        -ServerScript 'C:\a.js' -WorkingDirectory 'C:\a' -LogDirectory 'C:\l' -EnvFile 'C:\e'
}
Assert-Throws 'refuses an empty server script' {
    New-WinSwDescriptor -ServiceId 'X' -DisplayName 'X' -Description 'X' -NodeExe 'C:\n.exe' `
        -ServerScript '' -WorkingDirectory 'C:\a' -LogDirectory 'C:\l' -EnvFile 'C:\e'
}

Write-Host ''
if ($script:Failures -gt 0) {
    Write-Host "  $($script:Failures) assertion(s) FAILED."
    exit 1
}
Write-Host '  All service descriptor assertions passed.'
