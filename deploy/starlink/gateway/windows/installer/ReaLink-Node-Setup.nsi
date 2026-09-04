; ReaLink Node Setup -- NSIS packaging script.
;
; Produces ReaLink-Node-Setup.exe: a single double-click executable that
; unpacks the gateway provisioning scripts to a working directory and
; launches the GUI installer (ReaLink-Node-Setup.ps1) immediately -- no
; separate "install, then find it in the Start Menu, then run it" flow.
; This is NOT run on this VPS (no Windows/NSIS here, no wine) -- it is
; provided as a real, complete build recipe for whoever has a Windows box
; or a CI runner with NSIS available. Nothing about this script is
; hypothetical/untested-in-concept: it is a standard NSIS packaging
; pattern, just not literally compiled in this environment.
;
; Build (on Windows, with NSIS installed -- https://nsis.sourceforge.io/):
;   makensis ReaLink-Node-Setup.nsi
;   -> produces ReaLink-Node-Setup.exe in this same directory.
;
; Build (via GitHub Actions, no local Windows machine needed): add a
; workflow step on a windows-latest runner:
;   - uses: actions/checkout@v4
;   - run: choco install nsis -y
;   - run: makensis deploy\starlink\gateway\windows\installer\ReaLink-Node-Setup.nsi
;   - uses: actions/upload-artifact@v4
;     with: { name: ReaLink-Node-Setup, path: deploy\starlink\gateway\windows\installer\ReaLink-Node-Setup.exe }
; (Same "build in CI, not on the 1GB VPS" pattern already established for
; the Android/iOS release pipelines -- see .github/workflows/release-apk.yml.)

!define APP_NAME "ReaLink Node Setup"
!define APP_VERSION "1.0.0"
!define OUT_FILE "ReaLink-Node-Setup.exe"

Name "${APP_NAME}"
OutFile "${OUT_FILE}"
; Unpacks to a per-run temp folder, not Program Files -- this is a
; provisioning TOOL that runs once (or occasionally, re-run to fix a node),
; not an application that needs to persist installed. Keeping it out of
; Program Files avoids leaving an uninstall entry for something that isn't
; really "installed" in the traditional sense.
InstallDir "$TEMP\ReaLinkNodeSetup"
RequestExecutionLevel admin
SilentInstall silent
ShowInstDetails nevershow

; -----------------------------------------------------------------------
Section "Main"
    SetOutPath "$INSTDIR"

    ; The GUI orchestrator itself.
    File "ReaLink-Node-Setup.ps1"

    ; Everything ReaLink-Node-Setup.ps1 calls as a child process -- bundled
    ; from the sibling gateway directory at PACKAGING time, so whatever is
    ; current in that directory when makensis runs is what ships. This is
    ; deliberate: it means the installer can never silently drift out of
    ; sync with the actual provisioning scripts the way a "re-download from
    ; GitHub at install time" approach could (e.g. pulling a newer script
    ; version than this installer build was tested against).
    SetOutPath "$INSTDIR\.."
    File "..\0-probe-capabilities.ps1"
    File "..\enroll.ps1"
    File "..\1-provision-gateway.ps1"
    File "..\heartbeat.ps1"
    File "..\watchdog.ps1"
    File "..\remove-gateway.ps1"
    File "..\config.template.env"
    File "..\wg-starlink-windows.conf.example"

    ; Launch the GUI immediately -- this IS the "one click" experience.
    ; ReaLink-Node-Setup.ps1 does its own UAC self-elevation check too, so
    ; this works whether or not the installer's own admin request already
    ; elevated the shell it's launched from.
    SetOutPath "$INSTDIR"
    ExecShell "" "powershell.exe" '-NoProfile -ExecutionPolicy Bypass -File "$INSTDIR\ReaLink-Node-Setup.ps1"'
SectionEnd
