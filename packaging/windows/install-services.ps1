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
$BinDir     = Join-Path $InstallDir 'bin'
$PgData     = Join-Path $DataDir 'pgdata'
$LogDir     = Join-Path $DataDir 'logs'
$EnvFile    = Join-Path $DataDir '.env'

$PgService   = 'MehvarPostgres'
$AppService  = 'MehvarNode'
$DbName      = 'mehvar_pharmacy'
$DbOwner     = 'mehvar'
$AppRole     = 'mehvar_app'
$PgPort      = 5433   # Not 5432: a shop machine may already have Postgres.

function Write-Step { param([string] $Message) Write-Host "`n  == $Message" }

function New-Secret {
    # 32 bytes of CSPRNG, base64, symbol-free so it survives a connection URL.
    $bytes = New-Object byte[] 32
    [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
    return ([Convert]::ToBase64String($bytes) -replace '[+/=]', '')
}

function Invoke-Tool {
    param([string] $FilePath, [string[]] $Arguments, [hashtable] $Environment = @{})

    foreach ($key in $Environment.Keys) {
        Set-Item -Path "env:$key" -Value $Environment[$key]
    }
    & $FilePath @Arguments
    if ($LASTEXITCODE -ne 0) {
        throw "$([System.IO.Path]::GetFileName($FilePath)) $($Arguments -join ' ') failed with exit code $LASTEXITCODE"
    }
}

foreach ($dir in @($DataDir, $LogDir)) {
    if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }
}

# ---------------------------------------------------------------------------
# 1. The database cluster
# ---------------------------------------------------------------------------
if (-not (Test-Path (Join-Path $PgData 'PG_VERSION'))) {
    Write-Step 'Creating the database cluster'

    $ownerPassword = New-Secret
    $passwordFile  = Join-Path $env:TEMP 'mehvar-initdb.txt'
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
Invoke-Tool -FilePath $NodeExe -Arguments @((Join-Path $BinDir 'db\migrate.js')) -Environment @{
    DOTENV_CONFIG_PATH = $EnvFile
    DATABASE_URL       = $appUrl
    DATABASE_ADMIN_URL = $adminUrl
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
    # `sc.exe` supervises any executable; the wrapper exists only to load the
    # .env file and point Node at server.js with the right working directory.
    $wrapper = Join-Path $InstallDir 'mehvar-node.cmd'
    @"
@echo off
cd /d "$AppDir"
set "DOTENV_CONFIG_PATH=$EnvFile"
"$NodeExe" -r dotenv/config "$AppDir\server.js" >> "$LogDir\node.log" 2>&1
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
$backupCmd = "`"$NodeExe`" `"$(Join-Path $BinDir 'ops\backup.js')`""
& schtasks.exe /Create /F /TN 'Mehvar\NightlyBackup' /TR $backupCmd /SC DAILY /ST 02:30 /RU SYSTEM | Out-Null

Write-Step 'Opening the LAN port for additional counters'
if (-not (Get-NetFirewallRule -DisplayName 'Mehvar Node' -ErrorAction SilentlyContinue)) {
    New-NetFirewallRule -DisplayName 'Mehvar Node' -Direction Inbound -Action Allow `
        -Protocol TCP -LocalPort $Port -Profile Private | Out-Null
}

Write-Host "`n  Mehvar is installed and running on port $Port.`n"
