# ReaLink Node Setup -- one-click Windows gateway installer

Replaces the manual multi-script process in `..` (the parent `windows/`
folder) with a single GUI: `ReaLink-Node-Setup.exe`. **This orchestrates
the existing, already-hardened scripts** (`0-probe-capabilities.ps1`,
`enroll.ps1`, `1-provision-gateway.ps1`, `heartbeat.ps1`, `watchdog.ps1`) --
it does not reimplement their logic. A fix to the WireGuard/ICS/NAT
provisioning sequence still only needs to happen once, in those scripts;
the installer picks it up automatically the next time it's packaged.

## What it does, step by step

1. Self-elevates (UAC prompt) if not already run as Administrator.
2. Runs `0-probe-capabilities.ps1` and shows the result.
3. Installs WireGuard for Windows silently if not already present
   (downloads the official installer from wireguard.com, runs it with
   `/S`) -- **new**, this was a manual step before.
4. Runs `enroll.ps1` with the enrollment token + VPS URL you type into the
   GUI (get the token from the admin panel's Starlink tab -> "Create
   enrollment token").
5. Runs `1-provision-gateway.ps1` (WireGuard service, NAT, firewall,
   heartbeat + watchdog scheduled tasks) against the Wi-Fi adapter you
   pick from a dropdown -- **new**, this replaces the script's own
   `Read-Host` prompt (which would hang if launched non-interactively from
   a GUI) with a proper picker.
6. Runs `heartbeat.ps1` once immediately and checks the response for
   `health_state`, instead of leaving the operator to go check the admin
   panel manually -- **new**, this is the connectivity-verification step.
7. Shows a live checklist the whole time (Prerequisites / WireGuard /
   Node registered / Tunnel / NAT / Firewall / Heartbeat / Watchdog /
   Connectivity), matching the "one-click checklist" concept from the
   Infrastructure Wizard idea -- this is the Windows-specific instance of
   that same pattern.

## Honest limitation -- read this before assuming "zero manual steps" always holds

`docs/STARLINK_WINDOWS_HANDOFF.md` section 21 documents a real, still-open
Windows ICS bug: `EnableSharing` can throw `0x80040201` on some post-reboot
or toggle sequences, and the root cause isn't fully pinned down yet (two
hypotheses remain, neither confirmed). This installer runs the exact same
`Clear-GhostHomeNetEntries` mitigation `watchdog.ps1` already has, which
resolves most cases -- but if NAT still fails to bind, the wizard says so
plainly in the checklist ("NAT" step shows FAIL) and tells the operator the
one documented manual fallback (Wi-Fi properties -> Sharing -> toggle once),
which -- combined with `EnableRebootPersistConnection=1` (already asserted
by the provisioning step) -- then persists across reboots. This is not
hidden or glossed over in the UI; overclaiming "guaranteed zero manual
PowerShell" when a known open bug exists would be worse than being honest
about the one remaining edge case.

## Building the actual .exe

**Not done in this repo/session** -- there is no Windows machine, no NSIS,
and no Wine available in the Linux VPS this was written on. The build
recipe (`ReaLink-Node-Setup.nsi`) is a real, complete, standard NSIS
script, just not literally compiled here. Two ways to actually produce
`ReaLink-Node-Setup.exe`:

**On a Windows machine, one-time NSIS install:**
```powershell
choco install nsis -y
# or download from https://nsis.sourceforge.io/Download
cd deploy\starlink\gateway\windows\installer
makensis ReaLink-Node-Setup.nsi
# -> ReaLink-Node-Setup.exe in this same folder
```

**Via GitHub Actions (no Windows machine needed)** -- add a step to a
`windows-latest` job, same pattern already established for the Android/iOS
release pipelines (see `.github/workflows/release-apk.yml` /
`ios-testflight.yml` for the existing tag-triggered-build convention this
would follow):
```yaml
runs-on: windows-latest
steps:
  - uses: actions/checkout@v4
    with: { lfs: false }   # installer doesn't need the APK LFS objects
  - run: choco install nsis -y
  - run: makensis deploy\starlink\gateway\windows\installer\ReaLink-Node-Setup.nsi
  - uses: actions/upload-artifact@v4
    with:
      name: ReaLink-Node-Setup
      path: deploy\starlink\gateway\windows\installer\ReaLink-Node-Setup.exe
```
This is the same "build in CI, not on the 1GB VPS" principle already
governing every other release in this repo -- not written as an actual
workflow file yet since it wasn't asked for, but the recipe above is
copy-pasteable into one.

## Testing status

**Not exercised against real hardware or a real Windows/NSIS toolchain** --
same standing caveat as every Windows script in this repo (no Windows box
in this environment). Verified: PowerShell script is ASCII-only with
balanced braces/parens (checked programmatically, no `pwsh` available to
run the real parser). NSIS script follows the standard, documented NSIS
scripting patterns (`SilentInstall`, `SetOutPath`, `File`, `ExecShell`) --
review both before running on the actual gateway hardware, same as every
other script in this directory.
