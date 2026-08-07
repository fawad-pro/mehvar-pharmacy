<#
.SYNOPSIS
    Building the WinSW service descriptor, correctly and testably.

.DESCRIPTION
    Extracted from install-services.ps1 so it can be asserted against rather
    than adjusted by trial and error. `service-descriptor.tests.ps1` is the
    regression suite; `npm run lint:ps` runs it.

    WHY WinSW

    node.exe is not a Windows service. A service image must call
    StartServiceCtrlDispatcher and answer the Service Control Manager within
    about thirty seconds; node does not, so the SCM kills it with 1053 no matter
    how the service was registered. Two rounds were spent on the registration
    command line (sc.exe exit 1639) before that became the visible problem --
    the command line was genuinely broken, but fixing it only moved the failure.

    WinSW is a service-aware host: the SCM talks to WinSW, WinSW runs node as a
    child and supervises it. MIT licensed, a single self-contained .exe, no
    runtime prerequisite, configured by one XML file beside it. It also brings
    the restart policy and log rotation that would otherwise be `sc.exe failure`
    plus a hand-rolled log roller.

    WHY THIS FILE IS SEPARATE

    Everything below is string construction, and string construction is exactly
    what has failed repeatedly here. As a function it can be asserted against on
    any machine; inline in the installer it could only be tested by installing.
#>

<#
.SYNOPSIS
    XML-escape a value destined for an element body or attribute.

.DESCRIPTION
    The descriptor carries real Windows paths and a generated password. An
    ampersand or angle bracket that reaches the XML unescaped produces a file
    WinSW cannot parse, and the service then fails to install for a reason that
    has nothing to do with the service.
#>
function ConvertTo-XmlText {
    [CmdletBinding()]
    param([Parameter(Mandatory)] [AllowEmptyString()] [string] $Value)

    return $Value.
        Replace('&', '&amp;').
        Replace('<', '&lt;').
        Replace('>', '&gt;').
        Replace('"', '&quot;').
        Replace("'", '&apos;')
}

<#
.SYNOPSIS
    The WinSW XML descriptor for the Mehvar counter service.

.DESCRIPTION
    Deliberately explicit about the restart policy and log handling, because
    both are promises the product makes elsewhere:

      - onfailure restart, three escalating delays, then stop. A counter that
        restarts forever hides the fault it is papering over; one that never
        restarts turns a transient error into a closed shop.
      - roll-by-size logging, so node.log cannot fill the disk of a machine
        nobody administers. The support bundle reads the newest of these.
      - resetfailure daily, so a shop that crashes once a month is not treated
        as a shop that crashed three times.

    Environment comes from the .env file at runtime via serve.js, NOT from <env>
    elements here. That keeps .env the single source of truth: an owner who
    edits MEHVAR_BACKUP_DIR and restarts the service gets what they asked for,
    rather than the value frozen into this XML at install time.
#>
function New-WinSwDescriptor {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)] [string] $ServiceId,
        [Parameter(Mandatory)] [string] $DisplayName,
        [Parameter(Mandatory)] [string] $Description,
        [Parameter(Mandatory)] [string] $NodeExe,
        [Parameter(Mandatory)] [string] $ServerScript,
        [Parameter(Mandatory)] [string] $WorkingDirectory,
        [Parameter(Mandatory)] [string] $LogDirectory,
        [Parameter(Mandatory)] [string] $EnvFile
    )

    foreach ($pair in @(
        @{ Name = 'ServiceId';        Value = $ServiceId },
        @{ Name = 'NodeExe';          Value = $NodeExe },
        @{ Name = 'ServerScript';     Value = $ServerScript },
        @{ Name = 'WorkingDirectory'; Value = $WorkingDirectory },
        @{ Name = 'LogDirectory';     Value = $LogDirectory },
        @{ Name = 'EnvFile';          Value = $EnvFile }
    )) {
        if ([string]::IsNullOrWhiteSpace($pair.Value)) {
            throw "New-WinSwDescriptor: $($pair.Name) is empty."
        }
    }

    $id      = ConvertTo-XmlText $ServiceId
    $name    = ConvertTo-XmlText $DisplayName
    $desc    = ConvertTo-XmlText $Description
    $exe     = ConvertTo-XmlText $NodeExe
    $script  = ConvertTo-XmlText $ServerScript
    $workdir = ConvertTo-XmlText $WorkingDirectory
    $logs    = ConvertTo-XmlText $LogDirectory
    $envPath = ConvertTo-XmlText $EnvFile

    return @"
<service>
  <id>$id</id>
  <name>$name</name>
  <description>$desc</description>

  <executable>$exe</executable>
  <arguments>"$script"</arguments>
  <workingdirectory>$workdir</workingdirectory>

  <!-- serve.js reads this and loads the file itself, so .env stays the single
       source of truth rather than being frozen into this descriptor. -->
  <env name="DOTENV_CONFIG_PATH" value="$envPath" />

  <logpath>$logs</logpath>
  <log mode="roll-by-size">
    <sizeThreshold>10240</sizeThreshold>
    <keepFiles>8</keepFiles>
  </log>

  <startmode>Automatic</startmode>

  <!-- Escalating restarts, then stop and leave it for someone to look at. -->
  <onfailure action="restart" delay="5 sec" />
  <onfailure action="restart" delay="10 sec" />
  <onfailure action="restart" delay="30 sec" />
  <resetfailure>1 day</resetfailure>

  <!-- Give Next time to close connections before the process is killed. -->
  <stoptimeout>15 sec</stoptimeout>
  <stopparentprocessfirst>true</stopparentprocessfirst>
</service>
"@
}
