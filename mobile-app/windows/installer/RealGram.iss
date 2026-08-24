; RealGram for Windows — single-file installer.
;
; Replaces the old "download a zip, unzip, open Dependencies\, double-click
; each .appx by hand, THEN run setalink.exe, click through SmartScreen"
; flow (see release-windows.yml's history comment on why the zip has a
; Dependencies\ folder at all) with one .exe: download, double-click,
; Next/Next/Finish, app launches. The VCLibs .appx files are installed
; silently in [Run], before the app's own shortcut is offered — same
; Microsoft-signed packages as before, just no manual step.
;
; Compiled by CI (release-windows.yml) via ISCC.exe, which windows-2022
; runners ship with Inno Setup 6 preinstalled — no separate install step.
; Expects two build inputs, staged by the workflow before calling ISCC:
;   AppFiles\      -- the loose Release x64 output (setalink.exe + DLLs)
;   Dependencies\  -- the VCLibs/WinUI redistributable .appx files
; Both paths are passed in as ISCC /D command-line defines so this script
; never hardcodes a path that only exists inside the CI runner's temp dir.

#ifndef AppFilesDir
  #define AppFilesDir "AppFiles"
#endif
#ifndef DependenciesDir
  #define DependenciesDir "Dependencies"
#endif
#ifndef AppVersion
  #define AppVersion "1.0.0"
#endif

#define AppName "RealGram"
#define AppExeName "setalink.exe"
#define AppPublisher "RealGram"
#define AppURL "https://realgram.no"

[Setup]
AppId={{8F2B6C1A-7E4D-4A9F-9C3E-4D1B2A5E7F60}
AppName={#AppName}
AppVersion={#AppVersion}
AppPublisher={#AppPublisher}
AppPublisherURL={#AppURL}
DefaultDirName={autopf}\{#AppName}
DefaultGroupName={#AppName}
DisableProgramGroupPage=yes
; No code-signing cert for v1 (same tradeoff release-windows.yml already
; made for the bare exe) — installer itself will still show Windows'
; generic "unknown publisher" SmartScreen prompt once, same as before.
OutputDir=Output
OutputBaseFilename=RealGram-Setup
SetupIconFile=RealGram.ico
Compression=lzma2/max
SolidCompression=yes
WizardStyle=modern
; Traditional x64 keyword (not the newer x64compatible) — safer against
; whatever exact Inno Setup 6.x point release windows-2022 happens to ship.
ArchitecturesAllowed=x64
ArchitecturesInstallIn64BitMode=x64
UninstallDisplayIcon={app}\{#AppExeName}

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"

[Tasks]
Name: "desktopicon"; Description: "Create a &desktop shortcut"; GroupDescription: "Additional shortcuts:"

[Files]
Source: "{#AppFilesDir}\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs
; Kept as a normal (permanent) install under {app}\Dependencies rather than
; extracted-to-temp-and-discarded: a few MB, and it means [Run] below can
; reference a fixed path instead of fighting Inno's temp-extraction API.
Source: "{#DependenciesDir}\*.appx"; DestDir: "{app}\Dependencies"; Flags: ignoreversion
Source: "Install-Dependencies.ps1"; DestDir: "{app}"; Flags: ignoreversion

[Icons]
Name: "{group}\{#AppName}"; Filename: "{app}\{#AppExeName}"
Name: "{group}\Uninstall {#AppName}"; Filename: "{uninstallexe}"
Name: "{userdesktop}\{#AppName}"; Filename: "{app}\{#AppExeName}"; Tasks: desktopicon

[Run]
; Silently install each Microsoft-signed VCLibs/WinUI redistributable the
; unpackaged exe needs (VCRUNTIME140_1_APP.DLL / MSVCP140_APP.DLL come from
; these) before the app can run. These are framework packages signed by
; Microsoft directly, so Add-AppxPackage never hits a "publisher could not
; be verified" prompt — no dev cert, no Developer Mode requirement. Logic
; lives in Install-Dependencies.ps1 (see that file for why it isn't an
; inline -Command string here: it collides with Inno's {constant} syntax).
Filename: "{sys}\WindowsPowerShell\v1.0\powershell.exe"; \
    Parameters: "-NoProfile -ExecutionPolicy Bypass -File ""{app}\Install-Dependencies.ps1"" -DependenciesPath ""{app}\Dependencies"""; \
    StatusMsg: "Installing required Windows runtime components..."; \
    Flags: runhidden waituntilterminated
Filename: "{app}\{#AppExeName}"; Description: "Launch {#AppName}"; Flags: nowait postinstall skipifsilent
