<#
.SYNOPSIS
    Regression tests for Stop-MehvarServices (lib-service.ps1).

.DESCRIPTION
    The upgrade test found Setup replacing node.exe and MehvarNode.exe under
    running services (Windows refuses to overwrite a running image) and
    migrating the schema beneath the old application. Setup now stops both
    services first. These pin the order, the timeout, and above all the
    put-it-back rule: an update that cannot begin must leave the counter
    running. The Service Control Manager is replaced by a fake, so every
    branch runs on any machine. Exits non-zero on any failure.
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

# A fake SCM: names -> status, a journal of calls, and services that refuse.
function New-Scm {
    param([hashtable] $Status, [string[]] $Refuse = @(), [string[]] $Hang = @())
    $scm = [pscustomobject]@{ Status = $Status; Calls = New-Object System.Collections.Generic.List[string]; Refuse = $Refuse; Hang = $Hang }
    return $scm
}
function Invoke-Stop {
    param($Scm)
    return Stop-MehvarServices -Names @('MehvarNode', 'MehvarPostgres') -TimeoutSeconds 3 `
        -GetStatus { param($n) if ($Scm.Status.ContainsKey($n)) { $Scm.Status[$n] } else { $null } }.GetNewClosure() `
        -StopOne   { param($n) $Scm.Calls.Add("stop $n"); if ($Scm.Refuse -contains $n) { throw "access denied" }; if ($Scm.Hang -notcontains $n) { $Scm.Status[$n] = 'Stopped' } }.GetNewClosure() `
        -StartOne  { param($n) $Scm.Calls.Add("start $n"); $Scm.Status[$n] = 'Running' }.GetNewClosure() `
        -Wait      { }
}

Write-Host 'First install (no services yet):'
$scm = New-Scm -Status @{}
$r = Invoke-Stop $scm
Assert-True 'succeeds with nothing to stop' ($r.Ok -and $r.Stopped.Count -eq 0 -and $scm.Calls.Count -eq 0)

Write-Host 'Upgrade with both services running:'
$scm = New-Scm -Status @{ MehvarNode = 'Running'; MehvarPostgres = 'Running' }
$r = Invoke-Stop $scm
Assert-True 'stops both' ($r.Ok -and $scm.Status.MehvarNode -eq 'Stopped' -and $scm.Status.MehvarPostgres -eq 'Stopped')
Assert-True 'application first, then the database it holds connections to' (($scm.Calls -join ',') -eq 'stop MehvarNode,stop MehvarPostgres')

Write-Host 'Something already stopped:'
$scm = New-Scm -Status @{ MehvarNode = 'Stopped'; MehvarPostgres = 'Running' }
$r = Invoke-Stop $scm
Assert-True 'leaves a stopped service alone' (($scm.Calls -join ',') -eq 'stop MehvarPostgres' -and $r.Ok)

Write-Host 'A service that refuses:'
$scm = New-Scm -Status @{ MehvarNode = 'Running'; MehvarPostgres = 'Running' } -Refuse @('MehvarPostgres')
$r = Invoke-Stop $scm
Assert-True 'reports failure, naming the service' ((-not $r.Ok) -and $r.Failed -eq 'MehvarPostgres' -and $r.Message -match 'access denied')
Assert-True 'starts the application again -- the counter is never left down' ($scm.Status.MehvarNode -eq 'Running' -and ($scm.Calls -contains 'start MehvarNode'))

Write-Host 'A service that never reaches Stopped:'
$scm = New-Scm -Status @{ MehvarNode = 'Running'; MehvarPostgres = 'Running' } -Hang @('MehvarNode')
$r = Invoke-Stop $scm
Assert-True 'gives up after the timeout' ((-not $r.Ok) -and $r.Failed -eq 'MehvarNode' -and $r.Message -match 'did not stop within 3 seconds')
Assert-True 'and never goes on to stop the database' (-not ($scm.Calls -contains 'stop MehvarPostgres'))

Write-Host 'Off Windows, with the real Service Control Manager calls:'
$real = Stop-MehvarServices -Names @('MehvarNode', 'MehvarPostgres')
Assert-True 'the default status probe finds nothing to stop rather than throwing' ($real.Ok -or (Get-Command Get-Service -ErrorAction SilentlyContinue))

if ($script:Failures -gt 0) { Write-Host "`n  $($script:Failures) service assertion(s) FAILED."; exit 1 }
Write-Host "`n  All service assertions passed."
