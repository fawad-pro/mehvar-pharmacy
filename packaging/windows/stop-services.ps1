<#
.SYNOPSIS
    Stop the Mehvar services so an update can replace files and migrate safely.

.DESCRIPTION
    Run by mehvar.iss from PrepareToInstall, AFTER pre-update-backup.ps1 has
    taken its dump and BEFORE a single file is replaced. Extracted to {tmp}
    with lib-service.ps1 (Flags: dontcopy), so it runs from the new installer
    whatever state the installed copy is in.

    Exits 0 when nothing is left running, including on a first install where
    the services do not exist. Exits 1 if a service would not stop; in that
    case Stop-MehvarServices has already started again whatever it stopped,
    and Setup stops with nothing changed. install-services.ps1 starts both
    services again once the new files and schema are in place.
#>
[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'

$MyRoot =
    if (-not [string]::IsNullOrWhiteSpace($PSScriptRoot)) { $PSScriptRoot }
    elseif (-not [string]::IsNullOrWhiteSpace($MyInvocation.MyCommand.Path)) {
        Split-Path -Parent $MyInvocation.MyCommand.Path
    }
    else { (Get-Location).Path }

. (Join-Path $MyRoot 'lib-service.ps1')

$result = Stop-MehvarServices -Names @('MehvarNode', 'MehvarPostgres')
Write-Host $result.Message
if (-not $result.Ok) {
    Write-Host 'Setup has not changed anything. The pharmacy keeps running on the installed version.'
    exit 1
}
exit 0
