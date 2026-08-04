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
Source: "{#PayloadDir}\app\*";        DestDir: "{app}\app";        Flags: ignoreversion recursesubdirs createallsubdirs
Source: "{#PayloadDir}\migrations\*"; DestDir: "{app}\migrations"; Flags: ignoreversion recursesubdirs createallsubdirs
Source: "{#PayloadDir}\runtime\*";    DestDir: "{app}\runtime";    Flags: ignoreversion recursesubdirs createallsubdirs
Source: "{#PayloadDir}\pgsql\*";      DestDir: "{app}\pgsql";      Flags: ignoreversion recursesubdirs createallsubdirs
Source: "{#PayloadDir}\VERSION";      DestDir: "{app}";            Flags: ignoreversion
Source: "{#ScriptsDir}install-services.ps1";  DestDir: "{app}\packaging"; Flags: ignoreversion
Source: "{#ScriptsDir}verify-install.ps1";    DestDir: "{app}\packaging"; Flags: ignoreversion
Source: "{#ScriptsDir}counter-shortcut.ps1";  DestDir: "{app}\packaging"; Flags: ignoreversion
Source: "{#ScriptsDir}uninstall-services.ps1";DestDir: "{app}\packaging"; Flags: ignoreversion

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
    pass. Everything the Finish page offers is gated on it. }
  ProvisioningOk: Boolean;
  FailureSummary: String;

procedure InitializeWizard;
begin
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

function PowerShellArgs(ScriptName, Extra: String): String;
begin
  Result := '-NoProfile -ExecutionPolicy Bypass -File "' + ExpandConstant('{app}\packaging\')
    + ScriptName + '" ' + Extra;
end;

function ShellQuote(Value: String): String;
begin
  Result := '"' + Value + '"';
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

{ Only true when provisioning wrote the file the shortcut would open. The last
  install offered a pairing key that did not exist, which is how a failed
  install still managed to look finished. }
function PairingKeyAvailable(): Boolean;
begin
  Result := ProvisioningOk and FileExists(ExpandConstant('{commonappdata}\Mehvar\first-run.txt'));
end;

procedure CurStepChanged(CurStep: TSetupStep);
var
  ResultCode: Integer;
  Args: String;
  DataDir: String;
  Step: String;
  Detail: String;
  LogPath: String;
begin
  if CurStep <> ssPostInstall then
    Exit;

  DataDir := ExpandConstant('{commonappdata}\Mehvar');
  ProvisioningOk := False;

  Args := PowerShellArgs('install-services.ps1',
      '-InstallDir '  + ShellQuote(ExpandConstant('{app}')) +
      ' -DataDir '    + ShellQuote(DataDir) +
      ' -ShopName '   + ShellQuote(ShopPage.Values[0]) +
      ' -ShopAddress '+ ShellQuote(ShopPage.Values[1]) +
      ' -ShopPhone '  + ShellQuote(ShopPage.Values[2]) +
      ' -OwnerName '  + ShellQuote(ShopPage.Values[3]) +
      ' -OwnerPin '   + ShellQuote(PinPage.Values[0]));

  Exec('powershell.exe', Args, '', SW_HIDE, ewWaitUntilTerminated, ResultCode);

  { The status file, not the exit code, is the source of truth: it names the
    step. An exit code alone is what produced "code 1" and a wasted round-trip. }
  Step    := StatusValue('STEP');
  Detail  := StatusValue('DETAIL');
  LogPath := StatusValue('LOG');
  if LogPath = '' then
    LogPath := DataDir + '\logs';

  ProvisioningOk := (StatusValue('STATE') = 'OK') and (ResultCode = 0);

  if not ProvisioningOk then
  begin
    if Step = '' then
      Step := 'starting up (the installer did not get far enough to say)';

    FailureSummary :=
      'Setup could not finish configuring Mehvar.' + #13#10 + #13#10 +
      'Failed at:  ' + Step + #13#10 +
      'Reason:     ' + Detail + #13#10 + #13#10 +
      'Nothing has been lost, and no pharmacy data was created.' + #13#10 +
      'Send this file to Mehvar support:' + #13#10 + LogPath;

    MsgBox(FailureSummary, mbCriticalError, MB_OK);
    Exit;
  end;

  Exec('powershell.exe', PowerShellArgs('counter-shortcut.ps1', '-Autostart'), '', SW_HIDE,
       ewWaitUntilTerminated, ResultCode);

  { Phase 12 §2.4: verify after deploying, always. A machine that fails this
    must not be handed over, and the person installing needs to be told so
    plainly rather than left to discover it during trading. }
  if not Exec('powershell.exe',
        PowerShellArgs('verify-install.ps1',
          '-InstallDir ' + ShellQuote(ExpandConstant('{app}')) +
          ' -DataDir '   + ShellQuote(DataDir)),
        '', SW_SHOW, ewWaitUntilTerminated, ResultCode) or (ResultCode <> 0) then
  begin
    ProvisioningOk := False;
    FailureSummary :=
      'Mehvar installed, but the post-install checks did not all pass.' + #13#10 + #13#10 +
      'Do not hand this machine over yet.' + #13#10 +
      'Send this file to Mehvar support:' + #13#10 + LogPath;
    MsgBox(FailureSummary, mbError, MB_OK);
  end;
end;

{ Setup always shows a final page, so the honest thing is to make that page say
  what actually happened rather than "finished installing" over a failure. }
procedure CurPageChanged(CurPageID: Integer);
begin
  if (CurPageID = wpFinished) and (not ProvisioningOk) then
  begin
    WizardForm.FinishedHeadingLabel.Caption := 'Mehvar Setup did not finish';
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

; The three .cmd wrappers are written by install-services.ps1 at post-install,
; not installed by Setup — so Setup does not know to remove them, and without
; these lines an uninstall leaves {app} behind holding three orphaned files.
Type: files; Name: "{app}\mehvar-node.cmd"
Type: files; Name: "{app}\mehvar-backup.cmd"
Type: files; Name: "{app}\mehvar-support.cmd"

; NOTE: {commonappdata}\Mehvar is deliberately NOT deleted. It holds the
; database and every backup. An uninstall that destroys a pharmacy's records
; because someone was troubleshooting is not recoverable, and no amount of
; confirmation dialog makes it a reasonable default.
