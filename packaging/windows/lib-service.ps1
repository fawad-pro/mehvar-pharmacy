<#
.SYNOPSIS
    Building a Windows service ImagePath, correctly and testably.

.DESCRIPTION
    Extracted from install-services.ps1 so it can be asserted against rather
    than adjusted by trial and error. `service-image-path.tests.ps1` is the
    regression suite; `npm run lint:ps` runs it.

    WHY THIS EXISTS

    Registering the service with `sc.exe` failed on a real machine with exit
    1639, ERROR_INVALID_COMMAND_LINE:

        sc.exe create MehvarNode binPath= "cmd.exe /c `"$wrapper`"" ...

    The argument array PowerShell builds is correct -- `binPath=` and its value
    are separate arguments, confirmed by echoing raw argv. The corruption is one
    layer lower. Windows has no argv: PowerShell must serialise those arguments
    back into a single command-line STRING, and `sc.exe` re-parses it. A value
    holding both spaces and embedded quotes gets backslash-escaped quotes on the
    way out, and sc.exe's parser does not implement that escaping.

    The fix is not a better escape. It is to stop serialising: `New-Service`
    hands -BinaryPathName to the Win32 CreateService API as a string, with no
    command line in between and nothing to re-parse. That is why this fix does
    not depend on knowing exactly which escaping rule sc.exe applies -- there is
    no longer a command line for any rule to apply to.

    The one quoting that remains is Windows' own: the SCM parses ImagePath with
    CommandLineToArgvW rules, so a path containing spaces must be quoted. That
    is a documented, stable rule, and it is what the tests pin.
#>

<#
.SYNOPSIS
    An ImagePath that runs $ScriptPath through a command interpreter.

.DESCRIPTION
    Both paths are quoted unconditionally. "C:\Program Files\..." is the normal
    case on Windows, not the exception, and quoting a path that needs no quotes
    is harmless -- whereas the reverse silently truncates at the first space and
    produces a service pointing at "C:\Program".
#>
function New-ServiceImagePath {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)] [string] $Interpreter,
        [Parameter(Mandatory)] [string] $ScriptPath
    )

    if ([string]::IsNullOrWhiteSpace($Interpreter)) {
        throw 'New-ServiceImagePath: Interpreter is empty.'
    }
    if ([string]::IsNullOrWhiteSpace($ScriptPath)) {
        throw 'New-ServiceImagePath: ScriptPath is empty.'
    }
    <#
        A double quote inside either path cannot be represented here and is not
        a real Windows path anyway. Refusing beats emitting an ImagePath that
        parses into something else entirely.
    #>
    if ($Interpreter.Contains('"') -or $ScriptPath.Contains('"')) {
        throw 'New-ServiceImagePath: paths must not contain double quotes.'
    }

    return ('"{0}" /c "{1}"' -f $Interpreter, $ScriptPath)
}

<#
.SYNOPSIS
    cmd.exe, addressed absolutely.

.DESCRIPTION
    A service ImagePath is resolved by the SCM, not by a shell, so a bare
    "cmd.exe" depends on the service's PATH. %SystemRoot% is guarded because
    Join-Path throws on a null -- the rule that has already cost three
    round-trips.
#>
function Get-CmdExePath {
    [CmdletBinding()]
    param([string] $SystemRoot = $env:SystemRoot)

    $root = if (-not [string]::IsNullOrWhiteSpace($SystemRoot)) { $SystemRoot } else { 'C:\Windows' }

    <#
        Joined with a literal backslash rather than Join-Path. Join-Path is
        PowerShell-provider aware, so it resolves "C:" against the drive list
        and fails outright anywhere the C: drive does not exist -- which makes
        the function untestable off Windows for no benefit. A service ImagePath
        is a plain Windows string; build it as one.
    #>
    return ($root.TrimEnd('\') + '\System32\cmd.exe')
}
