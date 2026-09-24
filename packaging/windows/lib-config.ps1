<#
.SYNOPSIS
    Writing C:\ProgramData\Mehvar\.env without destroying what is already there.

.DESCRIPTION
    install-services.ps1 used to regenerate .env from a fixed template on every
    run, keeping only SESSION_SECRET. On an upgrade that silently deleted every
    setting the shop had made -- MEHVAR_BACKUP_DIR among them, which
    OPERATIONS.md tells the owner to point at a USB drive. The first nightly
    backup after the upgrade then went back to the system disk, and nothing
    said so.

    The rule now:

      * Installer-owned keys are written every run. They describe THIS machine
        (credentials from .pgpass-*, paths under the install, the port the
        firewall rule and shortcut are built on), and a stale copy of one is a
        broken install. When one had a different value it is reported by NAME
        -- never by value, since most of them are credentials.
      * Keys listed in -KeepExisting take the shop's value when it has one and
        the installer's only when it has none (SESSION_SECRET: rotating it
        would log every counter out).
      * Every other line -- the shop's own settings, comments, blank lines --
        is kept exactly as it was, in the order it was.

    Pure apart from Write-EnvFile, so config.tests.ps1 can assert it on any
    machine; `npm run lint:ps` runs that suite.
#>

$script:EnvAssignment = '^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_.-]*)\s*=(.*)$'

<#
.SYNOPSIS
    Merge the installer's settings into the lines of an existing .env.

.OUTPUTS
    [pscustomobject] with
      Lines     the merged file, one string per line
      Replaced  installer-owned keys whose existing value was different
      Kept      keys from the existing file the installer does not own
#>
function Merge-EnvLines {
    [CmdletBinding()]
    param(
        [AllowNull()] [AllowEmptyCollection()] [string[]] $Existing,
        [Parameter(Mandatory)] [System.Collections.IDictionary] $Settings,
        [string[]] $KeepExisting = @()
    )

    if ($null -eq $Existing) { $Existing = @() }

    $lines    = New-Object System.Collections.Generic.List[string]
    $written  = @{}
    $replaced = New-Object System.Collections.Generic.List[string]
    $kept     = New-Object System.Collections.Generic.List[string]

    foreach ($line in $Existing) {
        $match = [regex]::Match($line, $script:EnvAssignment)
        if (-not $match.Success) {
            # Comments, blank lines, continuation lines: the shop's, untouched.
            $lines.Add($line)
            continue
        }

        $key   = $match.Groups[1].Value
        $value = $match.Groups[2].Value

        if (-not $Settings.Contains($key)) {
            $lines.Add($line)
            if (-not $kept.Contains($key)) { $kept.Add($key) }
            continue
        }

        # One line per key the installer manages. dotenv and the .cmd wrappers
        # both let the LAST duplicate win, so a second copy left behind would
        # quietly override the line just written.
        if ($written.ContainsKey($key)) { continue }
        $written[$key] = $true

        if ($KeepExisting -contains $key -and -not [string]::IsNullOrWhiteSpace($value)) {
            $lines.Add($line)
            continue
        }

        $wanted = [string] $Settings[$key]
        if ($value.Trim() -ne $wanted -and ($KeepExisting -notcontains $key)) {
            $replaced.Add($key)
        }
        $lines.Add("$key=$wanted")
    }

    # Anything the installer needs that the file did not have yet -- all of
    # them, in template order, on a first install.
    foreach ($key in $Settings.Keys) {
        if ($written.ContainsKey($key)) { continue }
        $lines.Add("$key=$([string] $Settings[$key])")
    }

    return [pscustomobject]@{
        Lines    = $lines.ToArray()
        Replaced = $replaced.ToArray()
        Kept     = $kept.ToArray()
    }
}

<#
.SYNOPSIS
    Read .env as the application reads it: UTF-8, BOM tolerated.
#>
function Read-EnvFile {
    [CmdletBinding()]
    param([Parameter(Mandatory)] [string] $Path)

    if (-not (Test-Path -LiteralPath $Path)) { return @() }
    # ReadAllLines, not Get-Content: Windows PowerShell 5.1's Get-Content reads a
    # BOM-less file as the ANSI code page, which would mangle any non-ASCII
    # value a shop had written (a backup path, a note) on the way back out.
    return [System.IO.File]::ReadAllLines($Path)
}

<#
.SYNOPSIS
    Write .env as UTF-8 WITHOUT a byte-order mark.

.DESCRIPTION
    Not Set-Content -Encoding utf8: on Windows PowerShell 5.1 that writes a BOM,
    and a BOM glues itself to the first key -- dotenv and the .cmd wrappers'
    `for /f` would both read "\uFEFFAPP_ENV", and APP_ENV would vanish.
    Written in place, so the file keeps the restricted ACL it already has.
#>
function Write-EnvFile {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)] [string] $Path,
        # AllowEmptyString: a blank line is an empty element, and a Mandatory
        # [string[]] refuses one -- which failed the upgrade rehearsal on the
        # first .env a person had edited.
        [Parameter(Mandatory)] [AllowEmptyCollection()] [AllowEmptyString()] [string[]] $Lines
    )

    $text = ($Lines -join "`r`n") + "`r`n"
    [System.IO.File]::WriteAllText($Path, $text, (New-Object System.Text.UTF8Encoding($false)))
}

<#
.SYNOPSIS
    Step 4 of install-services.ps1: merge the installer's settings into .env.

.OUTPUTS
    The Merge-EnvLines result, for the caller to log.
#>
function Update-EnvFile {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)] [string] $Path,
        [Parameter(Mandatory)] [System.Collections.IDictionary] $Settings,
        [string[]] $KeepExisting = @()
    )

    $merge = Merge-EnvLines -Existing (Read-EnvFile -Path $Path) -Settings $Settings -KeepExisting $KeepExisting
    Write-EnvFile -Path $Path -Lines $merge.Lines
    return $merge
}
