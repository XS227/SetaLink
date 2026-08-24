; RealGram for Windows — single-file installer.
;
; Replaces the old "download a zip, unzip, open Dependencies\, double-click
; each .appx by hand, THEN run setalink.exe, click through SmartScreen"
; flow (see release-windows.yml's history comment on why the zip had a
; Dependencies\ folder at all) with one .exe: download, double-click,
; Next/Next/Finish, app launches.
;
; 2026-08-24: this used to also silently `Add-AppxPackage` the VCLibs/WinUI
; redistributables in a [Run] step. Dropped after Khabat's field test:
; AppX/MSIX deployment failed outright on his actual test machine (Windows
; 10 22H2, unpatched since 2025-07) — both the scripted install and a
; manual double-click of the .appx errored, and the app still couldn't
; find its DLLs afterwards. Root cause turned out not to need AppX at all:
; the required _app-suffixed DLLs are just loose files inside the .appx
; zip containers, and setalink.exe (an unpackaged win32 exe) resolves them
; via normal DLL search order, not MSIX framework references. The build
; workflow now extracts those DLLs straight into AppFilesDir (see
; release-windows.yml's "Stage installer inputs" step) — this script just
; ships whatever's in there as plain files. No install step, no
; elevation, no AppX deployment service, no OS-version dependency.
;
; Compiled by CI (release-windows.yml) via ISCC.exe, which windows-2022
; runners ship with Inno Setup 6 preinstalled — no separate install step.
; AppFilesDir is passed in as an ISCC /D command-line define so this
; script never hardcodes a path that only exists inside the CI runner's
; temp dir.

#ifndef AppFilesDir
  #define AppFilesDir "AppFiles"
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

[Icons]
Name: "{group}\{#AppName}"; Filename: "{app}\{#AppExeName}"
Name: "{group}\Uninstall {#AppName}"; Filename: "{uninstallexe}"
Name: "{userdesktop}\{#AppName}"; Filename: "{app}\{#AppExeName}"; Tasks: desktopicon

[Run]
Filename: "{app}\{#AppExeName}"; Description: "Launch {#AppName}"; Flags: nowait postinstall skipifsilent
