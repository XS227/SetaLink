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
#ifndef WebView2Bootstrapper
  #define WebView2Bootstrapper "build\MicrosoftEdgeWebview2Setup.exe"
#endif
#ifndef VpnFilesDir
  #define VpnFilesDir "build\VpnFiles"
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
; Branded wizard: the gold RealGram coin (same source as the app's own
; icon, mobile-app/ios/.../AppIcon-1024.png) on a navy banner for the
; Welcome/Finish pages, plus a small matching header logo on every inner
; page. Generated once via Pillow — see WizardImage.png/WizardSmallImage.png;
; regenerate the same way if the app icon ever changes.
WizardImageFile=WizardImage.png
WizardSmallImageFile=WizardSmallImage.png
WizardImageStretch=no
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
; recursesubdirs matters more than it looks: as of 2026-08-24 AppFiles has a
; Bundle\ subfolder holding index.windows.bundle (the app's JavaScript) plus
; its images/fonts. Without that folder on disk next to setalink.exe the app
; installs fine and then dies on launch with no message — see
; release-windows.yml's "Stage installer inputs" step for the full story.
; Excludes: .pdb/sourcemaps are debug artifacts MSBuild drops in the same
; output dir; they're a third of the installer's size and nothing reads them
; on a user's machine.
Source: "{#AppFilesDir}\*"; DestDir: "{app}"; Excludes: "*.pdb,sourcemaps\*"; Flags: ignoreversion recursesubdirs createallsubdirs
; Staged by CI next to AppFiles, not inside it — installed to {tmp} and run
; only when WebView2 is missing (see [Run]/NeedsWebView2 below), never shipped
; into {app}.
Source: "{#WebView2Bootstrapper}"; DestDir: "{tmp}"; Flags: deleteafterinstall
; xray.exe + tun2socks.exe + wintun.dll + RealGramVpnService.exe — staged by
; CI into a "vpn" folder (see release-windows.yml) separate from AppFiles so
; the service's own binaries never get swept up as loose app DLLs.
Source: "{#VpnFilesDir}\*"; DestDir: "{app}\vpn"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{group}\{#AppName}"; Filename: "{app}\{#AppExeName}"
Name: "{group}\Uninstall {#AppName}"; Filename: "{uninstallexe}"
Name: "{userdesktop}\{#AppName}"; Filename: "{app}\{#AppExeName}"; Tasks: desktopicon

[Run]
; Install the WebView2 runtime first, and only if it's actually missing — the
; app's in-app Shahnameh/TrustAI screens are WebView-backed and render blank
; without it. Not fatal: RealGram's chat and VPN screens don't touch WebView,
; so a failure here shouldn't block the install (hence no check of the exit
; code beyond Inno's own, and runascurrentuser is deliberately NOT used — the
; installer is already elevated for {autopf}).
Filename: "{tmp}\{#ExtractFileName(WebView2Bootstrapper)}"; Parameters: "/silent /install"; \
  StatusMsg: "Installing Microsoft WebView2 runtime..."; Check: NeedsWebView2; \
  Flags: waituntilterminated runhidden skipifdoesntexist
; RealGram VPN service — owns the WinTun tunnel + xray-core/tun2socks child
; processes as SYSTEM, so the (unelevated, unpackaged) RealGram.exe never
; needs to run elevated itself. See mobile-app/windows/vpn-service/ for what
; this actually does; the app's native XrayModule talks to it over a named
; pipe (mobile-app/windows/shared/PipeProtocol.h). Stop+delete before create
; so a re-install/upgrade picks up a new binary rather than erroring on an
; already-registered service name — sc.exe's exit code isn't checked (Inno
; doesn't examine it for a plain [Run] entry), so a fresh install's harmless
; "service does not exist" failures on stop/delete don't block anything.
Filename: "{sys}\sc.exe"; Parameters: "stop RealGramVpnService"; \
  Flags: runhidden waituntilterminated
Filename: "{sys}\sc.exe"; Parameters: "delete RealGramVpnService"; \
  Flags: runhidden waituntilterminated
Filename: "{sys}\sc.exe"; \
  Parameters: "create RealGramVpnService binPath= ""{app}\vpn\RealGramVpnService.exe"" start= auto DisplayName= ""RealGram VPN Service"""; \
  StatusMsg: "Installing RealGram VPN service..."; Flags: runhidden waituntilterminated
Filename: "{sys}\sc.exe"; Parameters: "start RealGramVpnService"; \
  StatusMsg: "Starting RealGram VPN service..."; Flags: runhidden waituntilterminated
Filename: "{app}\{#AppExeName}"; Description: "Launch {#AppName}"; Flags: nowait postinstall skipifsilent
; "Make it a real setup" (Khabat) — also offer to open the website on
; finish, same pattern as the app launch above (shellexec hands the URL to
; the default browser; Inno doesn't run URLs as a local process).
Filename: "{#AppURL}"; Description: "Open {#AppURL}"; Flags: shellexec nowait postinstall skipifsilent

[UninstallRun]
; Tear down the VPN service so uninstalling RealGram doesn't leave a SYSTEM
; process (and, if still connected, a live tunnel) behind. Exit codes not
; checked, same reasoning as the [Run] install-time entries above.
Filename: "{sys}\sc.exe"; Parameters: "stop RealGramVpnService"; \
  Flags: runhidden waituntilterminated; RunOnceId: "StopRealGramVpnService"
Filename: "{sys}\sc.exe"; Parameters: "delete RealGramVpnService"; \
  Flags: runhidden waituntilterminated; RunOnceId: "DeleteRealGramVpnService"

[Code]
{ True when the WebView2 Evergreen runtime isn't registered on this machine.
  Microsoft's documented detection: a non-empty pv value under the WebView2
  client key. Per-machine installs land in HKLM (under WOW6432Node on x64),
  per-user ones in HKCU — check all three before deciding it's missing. }
function NeedsWebView2: Boolean;
var
  Version: String;
begin
  Result := True;
  if RegQueryStringValue(HKLM, 'SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}', 'pv', Version) then
    if Version <> '' then Result := False;
  if Result and RegQueryStringValue(HKLM, 'SOFTWARE\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}', 'pv', Version) then
    if Version <> '' then Result := False;
  if Result and RegQueryStringValue(HKCU, 'SOFTWARE\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}', 'pv', Version) then
    if Version <> '' then Result := False;
end;
