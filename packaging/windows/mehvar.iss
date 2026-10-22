; Mehvar Pharmacy — Windows installer
;
; Roadmap Phase 1 (PCN-004): "a non-technical pharmacy can install Mehvar and
; begin trading without developer tools." This file is what that sentence
; reduces to. One .exe, a few questions, then selling.
;
; Inno Setup over MSI/WiX deliberately: one readable script, no authoring
; toolchain, and the single-file .exe a non-technical buyer expects. WiX buys
; GPO deployment and transforms, which this market will never use.
;
; UNVERIFIED — see README.md. This has never been compiled: Inno Setup is
; Windows-only and jrsoftware.org is unreachable from the dev container, so
; every fix below comes from review rather than from a compiler.
;
; Build:  npm run package:installer   (locates ISCC.exe itself)
;    or:  ISCC.exe /DAppVersion=1.2.3 packaging\windows\mehvar.iss

#define AppName        "Mehvar Pharmacy"
#define AppPublisher   "Mehvar"
#define PayloadDir     AddBackslash(SourcePath) + "..\..\dist\package"
#define ScriptsDir     AddBackslash(SourcePath)

; Passed by the build: ISCC.exe /DAppVersion=1.2.3 mehvar.iss
; Defaulted so a local compile works, but a release must pass it explicitly —
; an installer that cannot say which version it is makes support guesswork.
#ifndef AppVersion
  #define AppVersion "0.0.0-dev"
#endif

[Setup]
AppId={{8F3A1C64-2E7D-4B19-9A5E-7C6D0B4F2E11}
AppName={#AppName}
AppVersion={#AppVersion}
AppPublisher={#AppPublisher}
DefaultDirName={autopf}\Mehvar
DefaultGroupName=Mehvar
OutputDir={#SourcePath}..\..\dist
; Carries the version, so two builds are never the same file on a USB stick.
OutputBaseFilename=MehvarSetup-{#AppVersion}
Compression=lzma2/max
SolidCompression=yes
; The services and ProgramData layout both require elevation.
PrivilegesRequired=admin
ArchitecturesInstallIn64BitMode=x64compatible
ArchitecturesAllowed=x64compatible
WizardStyle=modern
DisableProgramGroupPage=yes
; The pharmacy is not choosing components; it is installing a product.
DisableDirPage=yes
UninstallDisplayName={#AppName}

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"

[Files]
; Never installed: extracted to {tmp} by PrepareToInstall, which backs up the
; database before a single file is replaced. lib-verify.ps1 goes with it
; (Invoke-Native); it is also installed normally, below. FIRST in [Files] on
; purpose: with SolidCompression, ExtractTemporaryFile on an entry listed after
; the payload has to decompress the whole payload to reach it.
Source: "{#ScriptsDir}pre-update-backup.ps1"; DestDir: "{tmp}"; Flags: dontcopy
Source: "{#ScriptsDir}lib-verify.ps1";        DestDir: "{tmp}"; Flags: dontcopy
; Also extracted by PrepareToInstall, after the backup: stops the services so
; no file is locked and the old application never runs against a new schema.
Source: "{#ScriptsDir}stop-services.ps1";     DestDir: "{tmp}"; Flags: dontcopy
Source: "{#ScriptsDir}lib-service.ps1";       DestDir: "{tmp}"; Flags: dontcopy
; Excludes: the build machine's .env must never ship (scripts/package/payload-env.ts).
; package:build strips it and package:installer refuses a payload holding one;
; this is the last layer, because Next loads app\.env at startup on the shop machine.
Source: "{#PayloadDir}\app\*";        DestDir: "{app}\app";        Flags: ignoreversion recursesubdirs createallsubdirs; Excludes: ".env,.env.*"
Source: "{#PayloadDir}\migrations\*"; DestDir: "{app}\migrations"; Flags: ignoreversion recursesubdirs createallsubdirs
; The starter catalogue. Not skipifsourcedoesntexist: a payload built without
; one is a broken build, and a pharmacy opening on an empty catalogue starts
; with data entry (Phase 6 §1). install-services.ps1 tolerates a failed IMPORT;
; it does not tolerate a missing file being passed off as success.
Source: "{#PayloadDir}\catalog\*";      DestDir: "{app}\catalog";     Flags: ignoreversion recursesubdirs createallsubdirs
Source: "{#PayloadDir}\runtime\*";    DestDir: "{app}\runtime";    Flags: ignoreversion recursesubdirs createallsubdirs
Source: "{#PayloadDir}\pgsql\*";      DestDir: "{app}\pgsql";      Flags: ignoreversion recursesubdirs createallsubdirs
Source: "{#PayloadDir}\winsw\*";      DestDir: "{app}\winsw";      Flags: ignoreversion recursesubdirs createallsubdirs
Source: "{#PayloadDir}\VERSION";      DestDir: "{app}";            Flags: ignoreversion
Source: "{#ScriptsDir}lib-service.ps1";       DestDir: "{app}\packaging"; Flags: ignoreversion
; install-services.ps1 dot-sources this too: it merges .env rather than rewriting it.
Source: "{#ScriptsDir}lib-config.ps1";        DestDir: "{app}\packaging"; Flags: ignoreversion
; verify-install.ps1 dot-sources this. Shipping one without the other kills the
; whole verification step at its first line.
Source: "{#ScriptsDir}lib-verify.ps1";        DestDir: "{app}\packaging"; Flags: ignoreversion
Source: "{#ScriptsDir}install-services.ps1";  DestDir: "{app}\packaging"; Flags: ignoreversion
Source: "{#ScriptsDir}verify-install.ps1";    DestDir: "{app}\packaging"; Flags: ignoreversion
Source: "{#ScriptsDir}counter-shortcut.ps1";  DestDir: "{app}\packaging"; Flags: ignoreversion
Source: "{#ScriptsDir}uninstall-services.ps1";DestDir: "{app}\packaging"; Flags: ignoreversion

[InstallDelete]
; Installers before scripts/package/payload-env.ts shipped the BUILD machine's
; .env as {app}\app\.env, and [Files] never deletes -- so without this an
; upgraded shop would keep it forever, and Next loads it at every start. Runs
; after PrepareToInstall's backup and before the new files are copied.
Type: files; Name: "{app}\app\.env"
Type: files; Name: "{app}\app\.env.*"

[Dirs]
Name: "{commonappdata}\Mehvar"; Permissions: admins-full
Name: "{commonappdata}\Mehvar\logs"
Name: "{commonappdata}\Mehvar\backups"

[Icons]
; The counter shortcut itself is created by counter-shortcut.ps1, which is the
; only thing that knows where Chrome landed on this machine.
; Points at the wrapper install-services.ps1 writes, not at node.exe
; directly: the bundle's most useful section is the verifier, and that
; needs the configuration a bare shortcut would not supply.
Name: "{group}\Support bundle";   Filename: "{app}\mehvar-support.cmd"; Comment: "Collect diagnostics to send to Mehvar support"
Name: "{group}\Uninstall Mehvar"; Filename: "{uninstallexe}"

[Code]
var
  ShopPage: TInputQueryWizardPage;
  PinPage: TInputQueryWizardPage;
  { False until install-services.ps1 reports STATE=OK *and* its own assertions
    pass. This is "is there a working Mehvar on this machine". }
  ProvisioningOk: Boolean;
  { False when verify-install.ps1 finds something wrong AFTERWARDS. Kept apart
    from ProvisioningOk deliberately: the first real successful install failed
    two post-install checks and was told "Mehvar Setup did not finish", which
    was untrue -- and worse, it withheld the pairing key, so the operator could
    not even open the counter to look at what the checks were complaining
    about. Installation failing and verification failing are different events
    and need different words. }
  ChecksOk: Boolean;
  FailureSummary: String;
  { Set if SaveStringToFile ever fails, so a failure dialog never points at a
    log that does not exist. }
  LogUnwritable: Boolean;
  { True when PrepareToInstall stopped the services for this run, and
    install-services.ps1 has not yet been started to bring them back. Read by
    DeinitializeSetup so a cancelled or failed copy never leaves the shop with
    no counter. }
  ServicesStopped: Boolean;
  PostInstallStarted: Boolean;
  { Decided once, when the wizard opens -- see IsExistingPharmacy. }
  ExistingPharmacy: Boolean;

{ An installed pharmacy already exists on this machine. installation.json is
  written by init.js only once a pharmacy has been created, and nothing deletes
  it -- unlike first-run.txt, which holds the pairing key and owner password in
  plain text and which a careful shop removes after pairing. }
function IsExistingPharmacy(): Boolean;
begin
  Result := FileExists(ExpandConstant('{commonappdata}\Mehvar\installation.json'));
end;

{ An upgrade or repair keeps the pharmacy, its name and its owner PIN exactly as
  they are (init.js does nothing when one exists). Asking for them again would
  let an owner believe a new PIN had been set when it had not. }
function ShouldSkipPage(PageID: Integer): Boolean;
begin
  Result := ExistingPharmacy and ((PageID = ShopPage.ID) or (PageID = PinPage.ID));
end;

procedure InitializeWizard;
begin
  ExistingPharmacy := IsExistingPharmacy();

  { Everything `mehvar init` needs, asked once, in the installer, because there
    is no wizard in the product for roadmap Phase 1 — the Settings screen
    already covers the rest. }
  ShopPage := CreateInputQueryPage(wpSelectDir,
    'Your pharmacy', 'Tell us about the shop',
    'This appears on every printed receipt. You can change it later in Settings.');
  ShopPage.Add('Pharmacy name:', False);
  ShopPage.Add('Address (optional):', False);
  ShopPage.Add('Phone (optional):', False);
  ShopPage.Add('Owner name:', False);

  PinPage := CreateInputQueryPage(ShopPage.ID,
    'Owner PIN', 'Choose a 4-digit PIN',
    'The owner types this to unlock reports and settings at the counter.');
  PinPage.Add('4-digit PIN:', True);

  ShopPage.Values[3] := 'Owner';
end;

function NextButtonClick(CurPageID: Integer): Boolean;
var
  Index: Integer;
  Pin: String;
begin
  Result := True;

  if CurPageID = ShopPage.ID then
  begin
    if Trim(ShopPage.Values[0]) = '' then
    begin
      MsgBox('Please enter the pharmacy name. It prints on every receipt.', mbError, MB_OK);
      Result := False;
    end;
  end
  else if CurPageID = PinPage.ID then
  begin
    { Matches isWellFormedPin in src/auth/pin-policy.ts — exactly four digits.
      Checked here so a bad PIN fails on this page rather than deep inside
      install-services.ps1, where the message would be unreadable. }
    Pin := Trim(PinPage.Values[0]);
    if Length(Pin) <> 4 then
    begin
      MsgBox('The PIN must be exactly 4 digits.', mbError, MB_OK);
      Result := False;
      Exit;
    end;
    for Index := 1 to 4 do
      if (Pin[Index] < '0') or (Pin[Index] > '9') then
      begin
        MsgBox('The PIN must be 4 digits, numbers only.', mbError, MB_OK);
        Result := False;
        Exit;
      end;
  end;
end;

{ ------------------------------------------------------------------------
  Setup's own log.

  THE INVARIANT: if Setup shows an error dialog, a log file explaining it
  already exists. Nothing below may weaken that.

  It is written by SETUP, not by the PowerShell it launches, because the
  failure that made this necessary was PowerShell refusing to parse the
  script at all -- no line ran, so nothing the script could have done would
  have produced a log. Only the process that shows the dialog can guarantee
  the dialog is accompanied by one.
  ------------------------------------------------------------------------ }

function LogDir(): String;
begin
  Result := ExpandConstant('{commonappdata}\Mehvar\logs');
end;

function SetupLogPath(): String;
begin
  Result := LogDir() + '\setup.log';
end;

procedure AppendLog(Line: String);
begin
  { ForceDirectories first: [Dirs] runs during installation, and this is
    called from wizard events that can happen earlier. }
  ForceDirectories(LogDir());
  if not SaveStringToFile(SetupLogPath(), GetDateTimeString('yyyy-mm-dd hh:nn:ss', '-', ':')
    + '  ' + Line + #13#10, True) then
    { The last hole in the invariant. If the log cannot be written, the dialog
      must say so rather than pointing at a file that will not be there --
      otherwise "send me the log" sends the operator to an empty folder, which
      is exactly the round-trip this whole mechanism exists to prevent. }
    LogUnwritable := True;
end;

{ Appended to any failure message when the log could not be written. }
function LogAdvice(): String;
begin
  if LogUnwritable then
    Result := 'Setup could NOT write its log (permission denied at' + #13#10 +
              LogDir() + ').' + #13#10 +
              'Re-run Setup as Administrator, or send a photo of this message.'
  else
    Result := 'Send this file to Mehvar support:' + #13#10 + SetupLogPath();
end;

{ The last Count lines of a file, for putting a tool's own words in front of
  whoever is reading the dialog. }
function TailOf(FileName: String; Count: Integer): String;
var
  Lines: TArrayOfString;
  Index, First: Integer;
begin
  Result := '';
  if not LoadStringsFromFile(FileName, Lines) then
    Exit;

  First := GetArrayLength(Lines) - Count;
  if First < 0 then
    First := 0;

  for Index := First to GetArrayLength(Lines) - 1 do
    if Trim(Lines[Index]) <> '' then
      Result := Result + Lines[Index] + #13#10;
end;

function PowerShellArgs(ScriptPath, Extra: String): String;
begin
  Result := '-NoProfile -ExecutionPolicy Bypass -File "' + ScriptPath + '" ' + Extra;
end;

{ Run PowerShell with EVERY stream redirected to a file.

  Through cmd.exe rather than Exec directly, because Exec cannot capture
  output -- and the output is the whole point. A script that fails to PARSE
  never runs a line, so its own logging is irrelevant; the only record of why
  is what powershell.exe printed to stderr. That used to go to a hidden window
  and vanish. Now it lands in a file Setup reads back. }
{ Takes a full path: the pre-update backup runs from Setup's temporary folder,
  before anything is installed in the application folder. }
function RunPowerShellFileLogged(ScriptPath, Extra, ConsoleLog: String; var Output: String): Integer;
var
  ResultCode: Integer;
  Command: String;
  ScriptName: String;
begin
  ScriptName := ExtractFileName(ScriptPath);
  DeleteFile(ConsoleLog);

  Command := '/c ""' + ExpandConstant('{sys}\WindowsPowerShell\v1.0\powershell.exe') + '" '
    + PowerShellArgs(ScriptPath, Extra) + ' > "' + ConsoleLog + '" 2>&1"';

  AppendLog('run: cmd.exe ' + Command);

  if not Exec(ExpandConstant('{cmd}'), Command, '', SW_HIDE, ewWaitUntilTerminated, ResultCode) then
  begin
    AppendLog('FAILED to start cmd.exe at all.');
    Output := 'Setup could not start cmd.exe.';
    Result := -1;
    Exit;
  end;

  Output := TailOf(ConsoleLog, 20);
  AppendLog(ScriptName + ' exited with code ' + IntToStr(ResultCode));
  if Trim(Output) <> '' then
    AppendLog('--- output of ' + ScriptName + ' ---' + #13#10 + Output)
  else
    AppendLog(ScriptName + ' produced no output at all.');

  Result := ResultCode;
end;

{ The scripts install-services.ps1 and friends, installed in the application
  folder's packaging subfolder. }
function RunPowerShellLogged(ScriptName, Extra, ConsoleLog: String; var Output: String): Integer;
begin
  Result := RunPowerShellFileLogged(ExpandConstant('{app}\packaging\') + ScriptName, Extra,
    ConsoleLog, Output);
end;

function ShellQuote(Value: String): String;
begin
  Result := '"' + Value + '"';
end;

{ ------------------------------------------------------------------------
  Backup before update.

  Inno calls this after the operator clicks Install and BEFORE any file is
  replaced; install-services.ps1 migrates the schema later still. So the dump
  pre-update-backup.ps1 takes is of the installation exactly as it stands.

  A non-empty result stops Setup on the Preparing to Install page with nothing
  changed. That is the point: the upgrade test found an update that took no
  backup at all, so a failed migration would have cost everything since the
  last 02:30 job. If a pharmacy's records exist and cannot be backed up, the
  update does not happen. On a first install there is no database, the script
  says so, and this returns '' at once.

  Both scripts are Flags: dontcopy entries -- extracted to Setup's temporary
  folder for this and never installed -- because nothing in the application
  folder can be trusted to be current yet, and on a first install nothing is
  there at all.
  ------------------------------------------------------------------------ }
function PrepareToInstall(var NeedsRestart: Boolean): String;
var
  ResultCode: Integer;
  Output: String;
  ConsoleLog: String;
begin
  Result := '';
  ConsoleLog := LogDir() + '\pre-update-backup-console.log';

  AppendLog('=== Mehvar {#AppVersion}: backing up before changing anything ===');
  ExtractTemporaryFile('lib-verify.ps1');
  ExtractTemporaryFile('pre-update-backup.ps1');

  ResultCode := RunPowerShellFileLogged(ExpandConstant('{tmp}\pre-update-backup.ps1'),
      '-InstallDir ' + ShellQuote(ExpandConstant('{app}')) +
      ' -DataDir '   + ShellQuote(ExpandConstant('{commonappdata}\Mehvar')),
      ConsoleLog, Output);

  if ResultCode <> 0 then
  begin
    AppendLog('PRE-UPDATE BACKUP FAILED. Setup stopped before changing anything.');
    Result :=
      'Mehvar could not back up this pharmacy''s records, so Setup has stopped' + #13#10 +
      'before changing anything. The installed version is untouched and keeps' + #13#10 +
      'working.' + #13#10 + #13#10 +
      Output + #13#10 +
      LogAdvice();
    Exit;
  end;

  { Backed up; now stop the services. Windows will not overwrite a running
    node.exe, MehvarNode.exe or postgres.exe, and the old application must not
    be serving while the schema migrates. If one will not stop, stop-services.ps1
    has already started again whatever it stopped. }
  ExtractTemporaryFile('lib-service.ps1');
  ExtractTemporaryFile('stop-services.ps1');
  ResultCode := RunPowerShellFileLogged(ExpandConstant('{tmp}\stop-services.ps1'), '',
      LogDir() + '\stop-services-console.log', Output);
  if ResultCode <> 0 then
  begin
    AppendLog('STOPPING SERVICES FAILED. Setup stopped before changing anything.');
    Result :=
      'Mehvar''s services could not be stopped for the update, so Setup has' + #13#10 +
      'stopped before changing anything. The installed version keeps working.' + #13#10 + #13#10 +
      Output + #13#10 +
      LogAdvice();
    Exit;
  end;
  ServicesStopped := True;
end;

{ Setup is exiting. If it stopped the services and never reached
  install-services.ps1 -- cancelled during the copy, or the copy failed -- start
  them again: the update did not happen, and the counter must not stay down
  because of it. Best effort; both services also start with Windows. }
procedure DeinitializeSetup();
var
  ResultCode: Integer;
begin
  if ServicesStopped and not PostInstallStarted then
  begin
    AppendLog('Setup ended before provisioning; starting the services it had stopped.');
    Exec(ExpandConstant('{sys}\sc.exe'), 'start MehvarPostgres', '', SW_HIDE, ewWaitUntilTerminated, ResultCode);
    Exec(ExpandConstant('{sys}\sc.exe'), 'start MehvarNode', '', SW_HIDE, ewWaitUntilTerminated, ResultCode);
  end;
end;

{ One line of install-status.txt, which install-services.ps1 writes. }
function StatusValue(Key: String): String;
var
  Lines: TArrayOfString;
  Index: Integer;
  Prefix: String;
begin
  Result := '';
  if not LoadStringsFromFile(ExpandConstant('{commonappdata}\Mehvar\install-status.txt'), Lines) then
    Exit;

  Prefix := Key + '=';
  for Index := 0 to GetArrayLength(Lines) - 1 do
    if Pos(Prefix, Lines[Index]) = 1 then
    begin
      Result := Copy(Lines[Index], Length(Prefix) + 1, Length(Lines[Index]));
      Exit;
    end;
end;

{ Only true when provisioning wrote the file the shortcut would open. An early
  install offered a pairing key that did not exist, which is how a failed
  install still managed to look finished.

  Note what this is NOT gated on: ChecksOk. A machine that installed cleanly and
  then failed a post-install check still has a real pharmacy in its database and
  a real pairing key, and whoever is standing in front of it needs that key to
  open the counter and see what the check was complaining about. Withholding it
  turns a diagnosable problem into a dead end. }
function PairingKeyAvailable(): Boolean;
begin
  Result := ProvisioningOk and FileExists(ExpandConstant('{commonappdata}\Mehvar\first-run.txt'));
end;

{ What a provisioning failure means for the shop's records. }
function UpgradeFailureAdvice(): String;
begin
  if ExistingPharmacy then
    Result := 'The pharmacy''s records were backed up before anything changed, to' + #13#10 +
              ExpandConstant('{commonappdata}\Mehvar\backups\pre-update') + '.' + #13#10 +
              'Run Setup again; do not delete anything.' + #13#10
  else
    Result := 'Nothing has been lost, and no pharmacy data was created.' + #13#10;
end;

procedure CurStepChanged(CurStep: TSetupStep);
var
  ResultCode: Integer;
  DataDir: String;
  Step: String;
  Detail: String;
  Output: String;
  ConsoleLog: String;
begin
  if CurStep <> ssPostInstall then
    Exit;

  DataDir := ExpandConstant('{commonappdata}\Mehvar');
  ConsoleLog := LogDir() + '\install-console.log';
  PostInstallStarted := True;
  ProvisioningOk := False;
  ChecksOk := True;

  { Written before anything can fail. From here on the invariant holds: a log
    exists, so no dialog can appear without one. }
  AppendLog('=== Mehvar {#AppVersion} provisioning ===');
  AppendLog('InstallDir ' + ExpandConstant('{app}'));
  AppendLog('DataDir    ' + DataDir);

  ResultCode := RunPowerShellLogged('install-services.ps1',
      '-InstallDir '  + ShellQuote(ExpandConstant('{app}')) +
      ' -DataDir '    + ShellQuote(DataDir) +
      ' -ShopName '   + ShellQuote(ShopPage.Values[0]) +
      ' -ShopAddress '+ ShellQuote(ShopPage.Values[1]) +
      ' -ShopPhone '  + ShellQuote(ShopPage.Values[2]) +
      ' -OwnerName '  + ShellQuote(ShopPage.Values[3]) +
      ' -OwnerPin '   + ShellQuote(PinPage.Values[0]),
      ConsoleLog, Output);

  Step   := StatusValue('STEP');
  Detail := StatusValue('DETAIL');
  ProvisioningOk := (StatusValue('STATE') = 'OK') and (ResultCode = 0);

  if not ProvisioningOk then
  begin
    { No status file means the script never got far enough to write one --
      usually that it never started. The console output is then the ONLY
      evidence, which is exactly why it is captured. }
    if Step = '' then
    begin
      Step := 'launching install-services.ps1 (it never reported a step)';
      if Trim(Output) <> '' then
        Detail := Output
      else
        Detail := 'PowerShell produced no output. Exit code ' + IntToStr(ResultCode) + '.';
    end;

    FailureSummary :=
      'Setup could not finish configuring Mehvar.' + #13#10 + #13#10 +
      'Failed at:  ' + Step + #13#10 +
      'Reason:' + #13#10 + Detail + #13#10 + #13#10 +
      UpgradeFailureAdvice() +
      LogAdvice();

    AppendLog('PROVISIONING FAILED at: ' + Step);
    MsgBox(FailureSummary, mbCriticalError, MB_OK);
    Exit;
  end;

  AppendLog('Provisioning OK.');

  RunPowerShellLogged('counter-shortcut.ps1', '-Autostart',
    LogDir() + '\shortcut-console.log', Output);

  { Phase 12 section 2.4: verify after deploying, always. A machine that fails
    this must not be handed over, and the person installing needs to be told so
    plainly rather than left to discover it during trading. }
  ResultCode := RunPowerShellLogged('verify-install.ps1',
      '-InstallDir ' + ShellQuote(ExpandConstant('{app}')) +
      ' -DataDir '   + ShellQuote(DataDir),
      LogDir() + '\verify-console.log', Output);

  { Exit 2: every check passed, but the default printer will not print
    receipts (verify-install.ps1). Said once, plainly; not a failure. }
  if ResultCode = 2 then
  begin
    AppendLog('Post-install checks passed with a printer warning.');
    MsgBox('Mehvar is installed and verified, but receipts will not print yet.' + #13#10 + #13#10 +
      Output, mbInformation, MB_OK);
  end
  else if ResultCode <> 0 then
  begin
    { ProvisioningOk stays True. This machine HAS Mehvar on it: the database,
      both services and the pharmacy record all exist. What did not pass is the
      separate step that proves it is safe to trade on. Saying "Setup did not
      finish" here sends the founder looking for an installation problem that
      is not there. }
    ChecksOk := False;
    FailureSummary :=
      'Mehvar is installed, but the post-install checks did not all pass.' + #13#10 + #13#10 +
      'Installation itself completed -- the database, both services and the' + #13#10 +
      'pharmacy record were all created. These checks are the separate step' + #13#10 +
      'that proves the install is safe to trade on, and at least one did not.' + #13#10 + #13#10 +
      Output + #13#10 +
      'Do not hand this machine over until they pass. The shop data is intact,' + #13#10 +
      'and the pairing key is still offered on the next page so you can open' + #13#10 +
      'the counter and look.' + #13#10 +
      LogAdvice();
    AppendLog('INSTALL OK, POST-INSTALL CHECKS FAILED.');
    MsgBox(FailureSummary, mbError, MB_OK);
  end;
end;

{ Setup always shows a final page, so the honest thing is to make that page say
  what actually happened rather than "finished installing" over a failure.

  Three outcomes, three headings. The middle one exists because the first
  successful install was told the second one, which was wrong in the direction
  that matters: it read as "you have nothing", when what the founder had was a
  working shop and two verifier bugs. }
procedure CurPageChanged(CurPageID: Integer);
begin
  if CurPageID <> wpFinished then
    Exit;

  if not ProvisioningOk then
  begin
    WizardForm.FinishedHeadingLabel.Caption := 'Mehvar Setup did not finish';
    WizardForm.FinishedLabel.Caption := FailureSummary;
  end
  else if not ChecksOk then
  begin
    WizardForm.FinishedHeadingLabel.Caption := 'Mehvar is installed, but not yet verified';
    WizardForm.FinishedLabel.Caption := FailureSummary;
  end;
end;

[Run]
; Doubled quotes are Inno's escape, so notepad receives a quoted path.
; Check: only offered when provisioning actually wrote the file.
Filename: "notepad.exe"; Parameters: """{commonappdata}\Mehvar\first-run.txt"""; \
  Description: "Show the counter pairing key"; Flags: postinstall skipifsilent; \
  Check: PairingKeyAvailable

[UninstallRun]
; Services must be removed before the files they run from.
Filename: "powershell.exe"; \
  Parameters: "-NoProfile -ExecutionPolicy Bypass -File ""{app}\packaging\uninstall-services.ps1"""; \
  RunOnceId: "MehvarServices"; Flags: waituntilterminated runhidden

[UninstallDelete]
; app\ carries the server, node_modules and the compiled bin\ scripts.
Type: filesandordirs; Name: "{app}\app"

; The .cmd wrappers are written by install-services.ps1 at post-install,
; not installed by Setup — so Setup does not know to remove them, and without
; these lines an uninstall leaves {app} behind holding orphaned files.
Type: files; Name: "{app}\mehvar-backup.cmd"
Type: files; Name: "{app}\mehvar-support.cmd"
Type: files; Name: "{app}\mehvar-restore.cmd"

; WinSW's service host, descriptor and its own logs, all written post-install.
Type: files; Name: "{app}\MehvarNode.exe"
Type: files; Name: "{app}\MehvarNode.xml"
Type: files; Name: "{app}\MehvarNode.*.log"

; NOTE: {commonappdata}\Mehvar is deliberately NOT deleted. It holds the
; database and every backup. An uninstall that destroys a pharmacy's records
; because someone was troubleshooting is not recoverable, and no amount of
; confirmation dialog makes it a reasonable default.
