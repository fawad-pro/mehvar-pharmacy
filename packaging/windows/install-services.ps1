#Requires -Version 5.1
<#
.SYNOPSIS
    Bring a fresh Mehvar install to the point where a pharmacy can sell.

.DESCRIPTION
    Called by mehvar.iss after files are copied. Everything a developer would
    do by hand — create a database cluster, provision roles, migrate, grant,
    register services — happens here, silently, because a pharmacy has no
    developer tools and no terminal.

    Idempotent throughout. A repair install, or a re-run after a failure, must
    converge on a working system rather than a second broken one.

    UNVERIFIED — see README.md. Never executed on Windows.
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory)] [string] $InstallDir,
    [Parameter(Mandatory)] [string] $DataDir,
    [Parameter(Mandatory)] [string] $ShopName,
    [Parameter(Mandatory)] [string] $OwnerPin,
    [string] $OwnerName = 'Owner',
    [string] $ShopAddress = '',
    [string] $ShopPhone = '',
    [int]    $Port = 3000
)

$ErrorActionPreference = 'Stop'

$PgBin      = Join-Path $InstallDir 'pgsql\bin'
$NodeExe    = Join-Path $InstallDir 'runtime\node.exe'
$AppDir     = Join-Path $InstallDir 'app'
# Inside app\ so the bundled scripts resolve app\node_modules at runtime.
$BinDir     = Join-Path $InstallDir 'app\bin'
$PgData     = Join-Path $DataDir 'pgdata'
$LogDir     = Join-Path $DataDir 'logs'
$EnvFile    = Join-Path $DataDir '.env'

$PgService   = 'MehvarPostgres'
$AppService  = 'MehvarNode'
$DbName      = 'mehvar_pharmacy'
$DbOwner     = 'mehvar'
$AppRole     = 'mehvar_app'
$PgPort      = 5433   # Not 5432: a shop machine may already have Postgres.

$StatusFile = Join-Path $DataDir 'install-status.txt'

foreach ($dir in @($DataDir, $LogDir)) {
    if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }
}

$script:LogFile = Join-Path $LogDir ("install-{0:yyyy-MM-dd-HHmmss}.log" -f (Get-Date))
$script:CurrentStep = 'starting up'

<#
    Everything this script does goes to one file, in order, with timestamps.

    The first real install failed with nothing but "code 1" and an empty log
    directory, because nothing here wrote a log and the only thing that did —
    the service wrappers — is created at the very last step. So the log is
    opened before any work, and every step and every child process writes to it
    whether it succeeds or not. Diagnosing a machine you cannot see is the whole
    job (Phase 12 §7); a silent installer makes that impossible.
#>
function Write-Log {
    param([string] $Message, [string] $Level = 'INFO')

    $line = "{0:HH:mm:ss} [{1,-5}] {2}" -f (Get-Date), $Level, $Message
    Add-Content -Path $script:LogFile -Value $line -Encoding utf8
    Write-Host $line
}

function Write-Status {
    param([string] $State, [string] $Step = '', [string] $Detail = '')

    # Read by mehvar.iss so the installer can name the failing step instead of
    # showing an exit code the operator cannot act on.
    @(
        "STATE=$State"
        "STEP=$Step"
        "DETAIL=$($Detail -replace '\r?\n', ' ')"
        "LOG=$($script:LogFile)"
        "WHEN=$(Get-Date -Format 's')"
    ) | Set-Content -Path $StatusFile -Encoding utf8
}

<#
    Step boundaries: each call closes out the previous step with its duration
    and opens the next. So the log shows both "-> Applying migrations" and
    "<- Applying migrations (0.8s)", and a step that never closed is exactly
    the one that failed.
#>
$script:StepStarted = $null
function Write-Step {
    param([string] $Message)

    if ($null -ne $script:StepStarted) {
        Write-Log ("<- {0} ({1:N1}s)" -f $script:CurrentStep, ((Get-Date) - $script:StepStarted).TotalSeconds)
    }
    $script:CurrentStep = $Message
    $script:StepStarted = Get-Date
    Write-Log "-> $Message"
}

<#
    Any terminating error, anywhere below, lands here.

    A script-scope trap rather than one big try/catch: the provisioning steps
    stay flat and readable, and nothing can fail *outside* the handler. The
    status file is what mehvar.iss reads to name the failing step, which is the
    whole difference between this and "code 1".
#>
trap {
    Write-Log "!! FAILED during: $script:CurrentStep" 'ERROR'
    Write-Log "   $($_.Exception.Message)" 'ERROR'
    if ($_.ScriptStackTrace) { Write-Log "   $($_.ScriptStackTrace)" 'DEBUG' }
    Write-Status -State 'FAILED' -Step $script:CurrentStep -Detail $_.Exception.Message
    Write-Log "Log written to $script:LogFile"
    exit 1
}

function New-Secret {
    # 32 bytes of CSPRNG, base64, symbol-free so it survives a connection URL.
    $bytes = New-Object byte[] 32
    [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
    return ([Convert]::ToBase64String($bytes) -replace '[+/=]', '')
}

<#
    Run a child process, capturing BOTH streams into the log.

    `2>&1` merges native stderr into the pipeline, so a failure carries the
    tool's own explanation rather than just an exit code — `migrate` saying
    which folders it searched is the difference between a fix and another
    round-trip.
#>
function Invoke-Tool {
    param([string] $FilePath, [string[]] $Arguments, [hashtable] $Environment = @{})

    foreach ($key in $Environment.Keys) {
        Set-Item -Path "env:$key" -Value $Environment[$key]
    }

    $name = [System.IO.Path]::GetFileName($FilePath)
    Write-Log "   run: $name $($Arguments -join ' ')" 'DEBUG'

    $output = & $FilePath @Arguments 2>&1
    $exit = $LASTEXITCODE

    foreach ($line in $output) {
        Write-Log "   | $line" 'DEBUG'
    }

    if ($exit -ne 0) {
        $tail = ($output | Select-Object -Last 8) -join ' / '
        throw "$name exited with code $exit. Output: $tail"
    }
}

Write-Log "Mehvar install starting"
Write-Log "  InstallDir $InstallDir"
Write-Log "  DataDir    $DataDir"
Write-Log "  Shop       $ShopName"
Write-Status -State 'RUNNING' -Step 'starting up'

# ---------------------------------------------------------------------------
# 1. The database cluster
# ---------------------------------------------------------------------------
if (-not (Test-Path (Join-Path $PgData 'PG_VERSION'))) {
    Write-Step 'Creating the database cluster'

    $ownerPassword = New-Secret
    # GetTempPath() always returns something; $env:TEMP is not guaranteed to
    # be set for a service account, and Join-Path throws on a null -Path.
    $passwordFile  = Join-Path ([System.IO.Path]::GetTempPath()) 'mehvar-initdb.txt'
    Set-Content -Path $passwordFile -Value $ownerPassword -NoNewline -Encoding ascii

    try {
        # scram-sha-256 rather than trust: the Node connects over TCP, and a
        # trust-authenticated cluster on a shop LAN is open to every machine
        # on it.
        Invoke-Tool -FilePath (Join-Path $PgBin 'initdb.exe') -Arguments @(
            '--pgdata', $PgData
            '--username', $DbOwner
            '--auth-local', 'scram-sha-256'
            '--auth-host', 'scram-sha-256'
            '--pwfile', $passwordFile
            '--encoding', 'UTF8'
            '--locale', 'C'
        )
    } finally {
        Remove-Item -Path $passwordFile -Force -ErrorAction SilentlyContinue
    }

    Add-Content -Path (Join-Path $PgData 'postgresql.conf') -Value @"

# Mehvar: a counter machine, not a server. Modest and predictable.
port = $PgPort
listen_addresses = 'localhost'
max_connections = 50
shared_buffers = 256MB
"@

    # Stash the owner password for the connection URLs written below.
    Set-Content -Path (Join-Path $DataDir '.pgpass-owner') -Value $ownerPassword -NoNewline -Encoding ascii
} else {
    Write-Step 'Database cluster already present'
}

# ---------------------------------------------------------------------------
# 2. PostgreSQL as a service
# ---------------------------------------------------------------------------
Write-Step 'Registering the PostgreSQL service'
if (-not (Get-Service -Name $PgService -ErrorAction SilentlyContinue)) {
    Invoke-Tool -FilePath (Join-Path $PgBin 'pg_ctl.exe') -Arguments @(
        'register', '-N', $PgService, '-D', $PgData, '-S', 'auto'
    )
}
Start-Service -Name $PgService
Set-Service  -Name $PgService -StartupType Automatic

# pg_ctl returns before the postmaster accepts connections.
$ready = $false
foreach ($attempt in 1..30) {
    & (Join-Path $PgBin 'pg_isready.exe') -h localhost -p $PgPort -q
    if ($LASTEXITCODE -eq 0) { $ready = $true; break }
    Start-Sleep -Seconds 1
}
if (-not $ready) { throw "PostgreSQL did not become ready on port $PgPort." }

# ---------------------------------------------------------------------------
# 3. Roles and database — PCN-001's two-role model
# ---------------------------------------------------------------------------
Write-Step 'Provisioning the database and roles'

$ownerPassword = Get-Content -Path (Join-Path $DataDir '.pgpass-owner') -Raw
$appPassword   = if (Test-Path (Join-Path $DataDir '.pgpass-app')) {
    Get-Content -Path (Join-Path $DataDir '.pgpass-app') -Raw
} else {
    $generated = New-Secret
    Set-Content -Path (Join-Path $DataDir '.pgpass-app') -Value $generated -NoNewline -Encoding ascii
    $generated
}

$adminUrl = "postgresql://${DbOwner}:${ownerPassword}@localhost:${PgPort}/${DbName}"
$appUrl   = "postgresql://${AppRole}:${appPassword}@localhost:${PgPort}/${DbName}"
$maintUrl = "postgresql://${DbOwner}:${ownerPassword}@localhost:${PgPort}/postgres"

$psql = Join-Path $PgBin 'psql.exe'

# CREATE DATABASE cannot run inside a transaction, hence the existence probe.
$exists = & $psql $maintUrl -tAc "SELECT 1 FROM pg_database WHERE datname = '$DbName'"
if ($exists -ne '1') {
    Invoke-Tool -FilePath $psql -Arguments @($maintUrl, '-v', 'ON_ERROR_STOP=1', '-c', "CREATE DATABASE $DbName OWNER $DbOwner")
}

# The app role is created here; db:grants configures what it may do.
Invoke-Tool -FilePath $psql -Arguments @(
    $maintUrl, '-v', 'ON_ERROR_STOP=1', '-c',
    "DO `$`$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '$AppRole') THEN CREATE ROLE $AppRole LOGIN PASSWORD '$appPassword'; END IF; END `$`$;"
)

# ---------------------------------------------------------------------------
# 4. Configuration
# ---------------------------------------------------------------------------
Write-Step 'Writing configuration'

$sessionSecret = if (Test-Path $EnvFile) {
    # Rotating this on every repair install would log every counter out.
    ((Get-Content $EnvFile | Where-Object { $_ -like 'SESSION_SECRET=*' }) -split '=', 2)[1]
} else {
    # 32 raw bytes base64-encoded comfortably clears env.ts's 32-character floor.
    New-Secret
}

@"
APP_ENV=production
NODE_ENV=production
PORT=$Port
DATABASE_URL=$appUrl
DATABASE_ADMIN_URL=$adminUrl
APP_DB_ROLE=$AppRole
APP_DB_PASSWORD=$appPassword
SESSION_SECRET=$sessionSecret
TENANT_TIME_ZONE=Asia/Karachi
MEHVAR_DATA_DIR=$DataDir
MEHVAR_LOG_DIR=$LogDir
MEHVAR_PG_BIN=$PgBin
"@ | Set-Content -Path $EnvFile -Encoding ascii

# The config holds database credentials. Administrators and SYSTEM only.
$acl = Get-Acl $EnvFile
$acl.SetAccessRuleProtection($true, $false)
foreach ($identity in @('SYSTEM', 'Administrators')) {
    $acl.AddAccessRule((New-Object System.Security.AccessControl.FileSystemAccessRule(
        $identity, 'FullControl', 'Allow')))
}
Set-Acl -Path $EnvFile -AclObject $acl

# ---------------------------------------------------------------------------
# 5. Migrate, then GRANT — never one without the other
# ---------------------------------------------------------------------------
Write-Step 'Applying migrations'
<#
    MEHVAR_MIGRATIONS_DIR is not optional decoration.

    `migrate` used to derive its folder from the working directory, which under
    Setup is wherever it launched PowerShell. It found nothing, treated that as
    "no migrations yet", and exited ZERO against an empty database — so grants
    failed on the first missing table and the operator saw only "code 1". The
    script now refuses rather than no-ops, and this tells it exactly where the
    files are rather than leaving it to infer.
#>
$MigrationsDir = Join-Path $InstallDir 'migrations'
if (-not (Test-Path $MigrationsDir)) {
    throw "No migrations folder at $MigrationsDir — the payload is incomplete."
}
Write-Log "   migrations: $MigrationsDir"

Invoke-Tool -FilePath $NodeExe -Arguments @((Join-Path $BinDir 'db\migrate.js')) -Environment @{
    DOTENV_CONFIG_PATH     = $EnvFile
    DATABASE_URL           = $appUrl
    DATABASE_ADMIN_URL     = $adminUrl
    MEHVAR_MIGRATIONS_DIR  = $MigrationsDir
}

<#
    PCN-001, and the reason this is a step rather than a note: a REVOKE against
    the role that OWNS the tables is silently inert in PostgreSQL. Skip this and
    the pharmacy runs with ADR-1's immutability guarantee unenforced *and
    looking enforced* — the failure PCN-001 was filed to prevent, reintroduced
    at the installer layer. verify-install.ps1 proves it afterwards.
#>
Write-Step 'Applying grants (ADR-1 immutability)'
Invoke-Tool -FilePath $NodeExe -Arguments @((Join-Path $BinDir 'db\grants.js')) -Environment @{
    DOTENV_CONFIG_PATH = $EnvFile
    DATABASE_ADMIN_URL = $adminUrl
    APP_DB_ROLE        = $AppRole
    APP_DB_PASSWORD    = $appPassword
}

# ---------------------------------------------------------------------------
# 6. The pharmacy itself
# ---------------------------------------------------------------------------
Write-Step 'Provisioning the pharmacy'
Invoke-Tool -FilePath $NodeExe -Arguments @((Join-Path $BinDir 'db\init.js')) -Environment @{
    DOTENV_CONFIG_PATH   = $EnvFile
    DATABASE_URL         = $appUrl
    MEHVAR_DATA_DIR      = $DataDir
    MEHVAR_SHOP_NAME     = $ShopName
    MEHVAR_SHOP_ADDRESS  = $ShopAddress
    MEHVAR_SHOP_PHONE    = $ShopPhone
    MEHVAR_OWNER_NAME    = $OwnerName
    MEHVAR_OWNER_PIN     = $OwnerPin
}

# ---------------------------------------------------------------------------
# 7. The application service
# ---------------------------------------------------------------------------
Write-Step 'Registering the Mehvar Node service'

if (-not (Get-Service -Name $AppService -ErrorAction SilentlyContinue)) {
    <#
        `sc.exe` supervises any executable; the wrapper exists only to load the
        configuration and point Node at server.js from the right directory.

        The .env file is parsed by cmd rather than by `node -r dotenv/config`.
        Next's standalone server does not load dotenv itself, and dotenv is a
        devDependency that Next never traces into the standalone tree — so the
        preload would fail to resolve and the service would not start at all.
        The `for /f` loop needs nothing but cmd. `eol=#` skips comments and
        `tokens=1,* delims==` keeps values containing `=` intact, which matters
        because connection URLs and base64 secrets both can.
    #>
    $wrapper = Join-Path $InstallDir 'mehvar-node.cmd'
    @"
@echo off
cd /d "$AppDir"
for /f "usebackq eol=# tokens=1,* delims==" %%a in ("$EnvFile") do set "%%a=%%b"
"$NodeExe" "$AppDir\server.js" >> "$LogDir\node.log" 2>&1
"@ | Set-Content -Path $wrapper -Encoding ascii

    & sc.exe create $AppService binPath= "cmd.exe /c `"$wrapper`"" start= auto DisplayName= "Mehvar Node" | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "Could not create the $AppService service (sc.exe exit $LASTEXITCODE)." }

    & sc.exe description $AppService "Runs the Mehvar Pharmacy counter server." | Out-Null

    # Restart on failure, three times, then leave it for someone to look at.
    # A counter that silently stops restarting is worse than one that is down.
    & sc.exe failure $AppService reset= 86400 actions= restart/5000/restart/10000/restart/30000 | Out-Null
}

Start-Service -Name $AppService
Set-Service  -Name $AppService -StartupType Automatic

# ---------------------------------------------------------------------------
# 8. Nightly backup, and the LAN
# ---------------------------------------------------------------------------
Write-Step 'Scheduling the nightly backup'

<#
    The task runs as SYSTEM, whose environment carries none of the settings
    written above. Pointing schtasks straight at node.exe would give the backup
    no DATABASE_URL and no MEHVAR_PG_BIN, so it would fail every night —
    silently, until somebody read a support bundle and noticed the backup-age
    warning. The wrapper supplies the configuration, mirroring mehvar-node.cmd.
#>
$backupWrapper = Join-Path $InstallDir 'mehvar-backup.cmd'
@"
@echo off
cd /d "$AppDir"
set "DOTENV_CONFIG_PATH=$EnvFile"
for /f "usebackq eol=# tokens=1,* delims==" %%a in ("$EnvFile") do set "%%a=%%b"
"$NodeExe" "$BinDir\ops\backup.js" >> "$LogDir\backup.log" 2>&1
"@ | Set-Content -Path $backupWrapper -Encoding ascii

<#
    The Start Menu's "Support bundle" entry, for the same reason: the bundle's
    most useful sections are the verifier and backup age, and both need the
    configuration. A shortcut straight to node.exe would produce a bundle
    reporting "DATABASE_URL is not set" — which describes the shortcut, not the
    pharmacy, and would send the founder chasing the wrong thing.

    Pauses at the end because a support bundle is run by a person who needs to
    read where the file was written.
#>
$supportWrapper = Join-Path $InstallDir 'mehvar-support.cmd'
@"
@echo off
cd /d "$AppDir"
set "DOTENV_CONFIG_PATH=$EnvFile"
for /f "usebackq eol=# tokens=1,* delims==" %%a in ("$EnvFile") do set "%%a=%%b"
"$NodeExe" "$BinDir\ops\support-bundle.js"
echo.
pause
"@ | Set-Content -Path $supportWrapper -Encoding ascii

& schtasks.exe /Create /F /TN 'Mehvar\NightlyBackup' /TR "`"$backupWrapper`"" /SC DAILY /ST 02:30 /RU SYSTEM | Out-Null
if ($LASTEXITCODE -ne 0) { throw "Could not schedule the nightly backup (schtasks exit $LASTEXITCODE)." }

Write-Step 'Opening the LAN port for additional counters'
if (-not (Get-NetFirewallRule -DisplayName 'Mehvar Node' -ErrorAction SilentlyContinue)) {
    New-NetFirewallRule -DisplayName 'Mehvar Node' -Direction Inbound -Action Allow `
        -Protocol TCP -LocalPort $Port -Profile Private | Out-Null
}

# ---------------------------------------------------------------------------
# 9. Prove the outcome before claiming it
# ---------------------------------------------------------------------------
<#
    The last install reported failure while leaving a Finish page offering a
    pairing key that was never written. Nothing checked; the two halves simply
    disagreed. These assertions are what let mehvar.iss tell the truth: STATE
    is only OK when the things a working install must have are actually there.
#>
Write-Step 'Confirming the install'

$firstRun = Join-Path $DataDir 'first-run.txt'
if (-not (Test-Path $firstRun)) {
    throw "Provisioning did not produce $firstRun — the pharmacy was not created."
}

$appSvc = Get-Service -Name $AppService -ErrorAction SilentlyContinue
if (-not $appSvc) { throw "The $AppService service was not registered." }
if ($appSvc.Status -ne 'Running') { throw "The $AppService service is $($appSvc.Status), not Running." }

$pgSvc = Get-Service -Name $PgService -ErrorAction SilentlyContinue
if (-not $pgSvc -or $pgSvc.Status -ne 'Running') { throw "The $PgService service is not running." }

Write-Log ("<- {0} ({1:N1}s)" -f $script:CurrentStep, ((Get-Date) - $script:StepStarted).TotalSeconds)
$script:StepStarted = $null

Write-Status -State 'OK' -Step 'complete'
Write-Log "Mehvar install completed successfully."

Write-Host "`n  Mehvar is installed and running on port $Port.`n"
