#Requires -Version 5.1
<#
.SYNOPSIS
    Prove the install is sound before anyone tries to sell on it.

.DESCRIPTION
    Phase 12 section 2.4 requires post-deploy verification. On a platform deployment
    that meant checking a URL; on a shop machine it means checking that the
    services came up, the grants took, and the verifier agrees with the records.

    The grant assertion is the one that matters most. PCN-001 established that a
    REVOKE against the table owner is silently inert, so "the installer ran
    grants" is not evidence -- the only evidence is an UPDATE that fails. If
    this script's UPDATE ever SUCCEEDS, the install is bad no matter how
    healthy everything else looks.

    UNVERIFIED -- see README.md. Never executed on Windows.
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory)] [string] $InstallDir,
    [Parameter(Mandatory)] [string] $DataDir,
    [int] $Port = 3000
)

$ErrorActionPreference = 'Stop'

$NodeExe = Join-Path $InstallDir 'runtime\node.exe'
$BinDir  = Join-Path $InstallDir 'app\bin'
$PgBin   = Join-Path $InstallDir 'pgsql\bin'
$EnvFile = Join-Path $DataDir '.env'

$failures = @()
function Check {
    param([string] $Name, [scriptblock] $Test)
    try {
        & $Test
        Write-Host "  [ ok ] $Name"
    } catch {
        Write-Host "  [FAIL] $Name -- $($_.Exception.Message)"
        $script:failures += $Name
    }
}

function Get-EnvValue {
    param([string] $Key)
    $line = Get-Content $EnvFile | Where-Object { $_ -like "$Key=*" } | Select-Object -First 1
    if (-not $line) { throw "$Key is not set in $EnvFile" }
    return ($line -split '=', 2)[1]
}

Write-Host "`n  Verifying the Mehvar install`n"

Check 'PostgreSQL service is running' {
    if ((Get-Service -Name 'MehvarPostgres').Status -ne 'Running') { throw 'not running' }
}

Check 'Mehvar Node service is running' {
    if ((Get-Service -Name 'MehvarNode').Status -ne 'Running') { throw 'not running' }
}

Check 'Both services start automatically' {
    foreach ($name in @('MehvarPostgres', 'MehvarNode')) {
        $mode = (Get-CimInstance Win32_Service -Filter "Name='$name'").StartMode
        if ($mode -ne 'Auto') { throw "$name start mode is $mode" }
    }
}

Check 'The counter answers on the sale screen' {
    # Startup is a one-time cost; give it room rather than measuring it.
    $deadline = (Get-Date).AddSeconds(60)
    do {
        try {
            $response = Invoke-WebRequest -Uri "http://localhost:$Port/login" -UseBasicParsing -TimeoutSec 5
            if ($response.StatusCode -eq 200) { return }
        } catch { Start-Sleep -Seconds 2 }
    } while ((Get-Date) -lt $deadline)
    throw "no 200 from http://localhost:$Port/login within 60s"
}

Check 'Static assets are present (standalone omits them)' {
    if (-not (Test-Path (Join-Path $InstallDir 'app\.next\static'))) {
        throw 'app\.next\static is missing -- the packager did not copy it'
    }
}

<#
    The load-bearing check. ADR-1 says event rows are physically immutable for
    the application role; PCN-001 says that guarantee is decorative unless the
    app connects as a NON-OWNING role. An UPDATE that succeeds here means the
    app is connecting as the owner, or grants never ran.
#>
Check 'Event tables are immutable for the app role (ADR-1 / PCN-001)' {
    $appUrl = Get-EnvValue 'DATABASE_URL'
    $psql   = Join-Path $PgBin 'psql.exe'

    & $psql $appUrl -v ON_ERROR_STOP=1 -c 'UPDATE sales SET total_paisa = total_paisa WHERE false' 2>$null
    if ($LASTEXITCODE -eq 0) {
        throw 'UPDATE on sales SUCCEEDED -- the app role can rewrite history'
    }
}

Check 'The verifier agrees with the records (ADR-8)' {
    $env:DOTENV_CONFIG_PATH = $EnvFile
    & $NodeExe (Join-Path $BinDir 'db\verify.js')
    if ($LASTEXITCODE -ne 0) { throw 'db:verify reported a mismatch -- this is sev-1' }
}

Check 'A backup can be taken and restored' {
    $env:DOTENV_CONFIG_PATH = $EnvFile
    & $NodeExe (Join-Path $BinDir 'ops\backup.js')
    if ($LASTEXITCODE -ne 0) { throw 'ops:backup failed' }

    # Phase 12 section 3: an untested backup is not a backup. The drill is the test,
    # and running it once at install is what makes the first one trustworthy.
    & $NodeExe (Join-Path $BinDir 'ops\restore-drill.js')
    if ($LASTEXITCODE -ne 0) { throw 'the restore drill failed' }
}

Check 'The nightly backup is scheduled' {
    & schtasks.exe /Query /TN 'Mehvar\NightlyBackup' | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'scheduled task Mehvar\NightlyBackup not found' }
}

if ($failures.Count -gt 0) {
    Write-Host "`n  $($failures.Count) check(s) FAILED. Do not hand this machine over.`n"
    exit 1
}

Write-Host "`n  All checks passed. The counter is ready to sell.`n"
