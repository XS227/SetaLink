#Requires -RunAsAdministrator
<#
.SYNOPSIS
    ReaLink Node Installer -- one-click GUI provisioning for a Windows
    Starlink gateway node. Packaged into ReaLink-Node-Setup.exe via
    ReaLink-Node-Setup.nsi (see that file's header for the build command).

.DESCRIPTION
    This is an ORCHESTRATOR, not a reimplementation. Every actual piece of
    provisioning logic here -- WireGuard tunnel install, NAT/firewall,
    scheduled tasks, ICS ghost-entry cleanup, handshake-based liveness --
    already exists in 0-probe-capabilities.ps1 / enroll.ps1 /
    1-provision-gateway.ps1 / heartbeat.ps1 / watchdog.ps1, hardened over
    many real debugging sessions against actual hardware (see
    docs/STARLINK_WINDOWS_HANDOFF.md sections 13-22). This script calls
    those, unmodified, as child processes and presents the result as a
    single guided GUI flow. It does NOT duplicate their logic -- fixing a
    bug in, say, the ICS bind sequence means fixing it once in
    1-provision-gateway.ps1 or watchdog.ps1, and this installer picks it up
    automatically on the next build (NSIS bundles whatever is in the
    sibling ..\ directory at packaging time).

    New here (did not exist before this installer):
      - Silent WireGuard for Windows install (previously a manual step --
        the README said "Install WireGuard for Windows... if not already
        present" with no automation).
      - A GUI wrapper around enroll.ps1 + 1-provision-gateway.ps1's prompts
        (adapter picker instead of a console Read-Host, which would hang a
        non-interactive child process launched from a GUI).
      - An automatic connectivity-verification step after provisioning
        (previously: "confirm this node shows ONLINE within ~90s" was a
        manual thing the operator had to go check in the admin panel).

    Honest limitation, not hidden: the Windows ICS bug documented in
    docs/STARLINK_WINDOWS_HANDOFF.md section 21 (EnableSharing throwing
    0x80040201 on some post-reboot/toggle sequences) is NOT resolved by
    this installer -- nothing could resolve it short-term, the root cause
    itself is still open. This tool runs the exact same
    Clear-GhostHomeNetEntries fix watchdog.ps1 already has, which handles
    most cases. If NAT still fails to bind after provisioning, the wizard
    says so plainly and points at the one documented manual fallback
    (Wi-Fi properties -> Sharing -> toggle once) rather than claiming
    "zero manual steps, guaranteed."

.NOTES
    Not exercised against real hardware -- this VPS has no Windows box to
    test against (same standing caveat as every other Windows script in
    this repo). Review before running on an actual Surface/gateway PC.
#>

[CmdletBinding()]
param()

# ---------------------------------------------------------------------------
# Self-elevation: if not already Administrator, relaunch elevated. A GUI
# double-clicked from Explorer won't have inherited an elevated shell, and
# #Requires -RunAsAdministrator alone just aborts with a cryptic error
# instead of prompting -- do the UAC prompt ourselves for a real "one-click"
# experience.
# ---------------------------------------------------------------------------
$currentPrincipal = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
if (-not $currentPrincipal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    $psi = [Diagnostics.ProcessStartInfo]::new()
    $psi.FileName = 'powershell.exe'
    $psi.Arguments = "-NoProfile -ExecutionPolicy Bypass -File `"$PSCommandPath`""
    $psi.Verb = 'runas'
    try {
        [Diagnostics.Process]::Start($psi) | Out-Null
    } catch {
        [System.Windows.Forms.MessageBox]::Show(
            'Administrator privileges are required to set up a ReaLink node, and the elevation prompt was cancelled or failed.',
            'ReaLink Node Setup', 'OK', 'Error') | Out-Null
    }
    exit
}

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
[System.Windows.Forms.Application]::EnableVisualStyles()

# Resolve the script's own directory without trusting $PSScriptRoot (same
# defensive pattern as heartbeat.ps1/watchdog.ps1 -- $PSScriptRoot has been
# observed empty on the actual Surface hardware this repo targets).
$InstallerDir = $PSScriptRoot
if (-not $InstallerDir -and $PSCommandPath) { $InstallerDir = Split-Path -Parent $PSCommandPath }
if (-not $InstallerDir) { $InstallerDir = (Get-Location).Path }
# The gateway scripts live one level up (installer/ is a subfolder of
# deploy/starlink/gateway/windows/). NSIS packages both into the same
# install directory, so in the packaged .exe this is just a sibling folder.
$GatewayDir = Split-Path -Parent $InstallerDir

$LogDir = Join-Path $InstallerDir 'setup-logs'
New-Item -ItemType Directory -Path $LogDir -Force | Out-Null
$SetupLogFile = Join-Path $LogDir "setup-$(Get-Date -Format yyyyMMdd-HHmmss).log"

function Write-SetupLog {
    param([string]$Message)
    $line = "$((Get-Date).ToUniversalTime().ToString('o')) $Message"
    Add-Content -Path $SetupLogFile -Value $line
}

# ---------------------------------------------------------------------------
# Main form
# ---------------------------------------------------------------------------
$form = New-Object System.Windows.Forms.Form
$form.Text = 'ReaLink Node Setup'
$form.Size = New-Object System.Drawing.Size(620, 640)
$form.StartPosition = 'CenterScreen'
$form.FormBorderStyle = 'FixedDialog'
$form.MaximizeBox = $false

$titleLabel = New-Object System.Windows.Forms.Label
$titleLabel.Text = 'ReaLink Node Setup'
$titleLabel.Font = New-Object System.Drawing.Font('Segoe UI', 14, [System.Drawing.FontStyle]::Bold)
$titleLabel.Location = New-Object System.Drawing.Point(20, 15)
$titleLabel.Size = New-Object System.Drawing.Size(560, 30)
$form.Controls.Add($titleLabel)

$subLabel = New-Object System.Windows.Forms.Label
$subLabel.Text = 'Provisions this Windows PC as a ReaLink Starlink gateway node. Requires an enrollment token from the admin panel (Starlink tab -> Create enrollment token).'
$subLabel.Location = New-Object System.Drawing.Point(20, 48)
$subLabel.Size = New-Object System.Drawing.Size(570, 40)
$form.Controls.Add($subLabel)

# --- Inputs ---
$yInput = 95

$lblUrl = New-Object System.Windows.Forms.Label
$lblUrl.Text = 'VPS enrollment URL:'
$lblUrl.Location = New-Object System.Drawing.Point(20, $yInput)
$lblUrl.Size = New-Object System.Drawing.Size(160, 20)
$form.Controls.Add($lblUrl)

$txtUrl = New-Object System.Windows.Forms.TextBox
$txtUrl.Text = 'https://api.setalink.no/starlink-enroll.php'
$txtUrl.Location = New-Object System.Drawing.Point(185, ($yInput - 3))
$txtUrl.Size = New-Object System.Drawing.Size(400, 20)
$form.Controls.Add($txtUrl)

$yInput += 30
$lblToken = New-Object System.Windows.Forms.Label
$lblToken.Text = 'Enrollment token:'
$lblToken.Location = New-Object System.Drawing.Point(20, $yInput)
$lblToken.Size = New-Object System.Drawing.Size(160, 20)
$form.Controls.Add($lblToken)

$txtToken = New-Object System.Windows.Forms.TextBox
$txtToken.Location = New-Object System.Drawing.Point(185, ($yInput - 3))
$txtToken.Size = New-Object System.Drawing.Size(400, 20)
$form.Controls.Add($txtToken)

$yInput += 30
$lblAdapter = New-Object System.Windows.Forms.Label
$lblAdapter.Text = 'Starlink Wi-Fi adapter:'
$lblAdapter.Location = New-Object System.Drawing.Point(20, $yInput)
$lblAdapter.Size = New-Object System.Drawing.Size(160, 20)
$form.Controls.Add($lblAdapter)

$cmbAdapter = New-Object System.Windows.Forms.ComboBox
$cmbAdapter.Location = New-Object System.Drawing.Point(185, ($yInput - 3))
$cmbAdapter.Size = New-Object System.Drawing.Size(300, 20)
$cmbAdapter.DropDownStyle = 'DropDownList'
$form.Controls.Add($cmbAdapter)

$btnRefreshAdapters = New-Object System.Windows.Forms.Button
$btnRefreshAdapters.Text = 'Refresh'
$btnRefreshAdapters.Location = New-Object System.Drawing.Point(495, ($yInput - 4))
$btnRefreshAdapters.Size = New-Object System.Drawing.Size(90, 23)
$form.Controls.Add($btnRefreshAdapters)

$yInput += 30
$chkIcs = New-Object System.Windows.Forms.CheckBox
$chkIcs.Text = 'Use ICS instead of WinNAT (only if the checklist below says WinNAT is unavailable -- see docs/STARLINK_WINDOWS_GATEWAY.md section 3 for why WinNAT is preferred)'
$chkIcs.Location = New-Object System.Drawing.Point(20, $yInput)
$chkIcs.Size = New-Object System.Drawing.Size(570, 32)
$form.Controls.Add($chkIcs)

function Populate-Adapters {
    $cmbAdapter.Items.Clear()
    try {
        $adapters = Get-NetAdapter -ErrorAction Stop | Where-Object { $_.MediaType -eq 'Native 802.11' }
        foreach ($a in $adapters) {
            $label = "$($a.Name) [$($a.Status)]"
            $cmbAdapter.Items.Add($label) | Out-Null
        }
        $upAdapters = @($adapters | Where-Object { $_.Status -eq 'Up' })
        if ($upAdapters.Count -eq 1) {
            $idx = 0
            for ($i = 0; $i -lt $cmbAdapter.Items.Count; $i++) {
                if ($cmbAdapter.Items[$i].ToString().StartsWith("$($upAdapters[0].Name) [")) { $idx = $i; break }
            }
            $cmbAdapter.SelectedIndex = $idx
        } elseif ($cmbAdapter.Items.Count -gt 0) {
            $cmbAdapter.SelectedIndex = 0
        }
    } catch {
        Write-SetupLog "WARN: could not enumerate adapters: $($_.Exception.Message)"
    }
}
$btnRefreshAdapters.Add_Click({ Populate-Adapters })

# --- Checklist ---
$yChecklist = $yInput + 35
$lblChecklist = New-Object System.Windows.Forms.Label
$lblChecklist.Text = 'Setup progress:'
$lblChecklist.Font = New-Object System.Drawing.Font('Segoe UI', 9, [System.Drawing.FontStyle]::Bold)
$lblChecklist.Location = New-Object System.Drawing.Point(20, $yChecklist)
$lblChecklist.Size = New-Object System.Drawing.Size(200, 20)
$form.Controls.Add($lblChecklist)

$checklistItems = [ordered]@{
    'prereqs'       = 'Prerequisites checked (OS, admin rights, NAT capability)'
    'wireguard'     = 'WireGuard for Windows installed'
    'enrolled'      = 'Node registered with the backend'
    'tunnel'        = 'WireGuard tunnel configured and running'
    'nat'           = 'NAT / internet sharing configured'
    'firewall'      = 'Windows Firewall rules configured'
    'heartbeat'     = 'Heartbeat scheduled task enabled'
    'watchdog'      = 'Watchdog scheduled task enabled'
    'connectivity'  = 'Connectivity verified (heartbeat reached the server)'
}
$checklist = New-Object System.Windows.Forms.CheckedListBox
$checklist.Location = New-Object System.Drawing.Point(20, ($yChecklist + 22))
$checklist.Size = New-Object System.Drawing.Size(570, 160)
$checklist.CheckOnClick = $false
foreach ($v in $checklistItems.Values) { $checklist.Items.Add("  $v") | Out-Null }
$form.Controls.Add($checklist)

function Set-ChecklistState {
    param([string]$Key, [ValidateSet('pending','running','ok','fail')][string]$State, [string]$Detail = '')
    $keys = @($checklistItems.Keys)
    $idx = $keys.IndexOf($Key)
    if ($idx -lt 0) { return }
    $label = $checklistItems[$Key]
    $prefix = switch ($State) {
        'running' { '[...]' }
        'ok'      { '[OK] ' }
        'fail'    { '[FAIL]' }
        default   { '[   ]' }
    }
    $text = "$prefix $label"
    if ($Detail) { $text += " -- $Detail" }
    $checklist.Items[$idx] = $text
    $checklist.SetItemChecked($idx, $State -eq 'ok')
    [System.Windows.Forms.Application]::DoEvents()
}
foreach ($k in $checklistItems.Keys) { Set-ChecklistState -Key $k -State 'pending' }

# --- Log box ---
$yLog = $yChecklist + 22 + 168
$lblLog = New-Object System.Windows.Forms.Label
$lblLog.Text = 'Details:'
$lblLog.Location = New-Object System.Drawing.Point(20, $yLog)
$lblLog.Size = New-Object System.Drawing.Size(200, 20)
$form.Controls.Add($lblLog)

$txtLog = New-Object System.Windows.Forms.TextBox
$txtLog.Location = New-Object System.Drawing.Point(20, ($yLog + 20))
$txtLog.Size = New-Object System.Drawing.Size(570, 120)
$txtLog.Multiline = $true
$txtLog.ScrollBars = 'Vertical'
$txtLog.ReadOnly = $true
$txtLog.Font = New-Object System.Drawing.Font('Consolas', 8)
$form.Controls.Add($txtLog)

function Write-UiLog {
    param([string]$Message)
    $txtLog.AppendText("$Message`r`n")
    Write-SetupLog $Message
    [System.Windows.Forms.Application]::DoEvents()
}

# --- Buttons ---
$yButtons = $yLog + 20 + 128
$btnStart = New-Object System.Windows.Forms.Button
$btnStart.Text = 'Start Setup'
$btnStart.Location = New-Object System.Drawing.Point(370, $yButtons)
$btnStart.Size = New-Object System.Drawing.Size(110, 32)
$btnStart.Font = New-Object System.Drawing.Font('Segoe UI', 9, [System.Drawing.FontStyle]::Bold)
$form.Controls.Add($btnStart)

$btnClose = New-Object System.Windows.Forms.Button
$btnClose.Text = 'Close'
$btnClose.Location = New-Object System.Drawing.Point(490, $yButtons)
$btnClose.Size = New-Object System.Drawing.Size(100, 32)
$form.Controls.Add($btnClose)
$btnClose.Add_Click({ $form.Close() })

# ---------------------------------------------------------------------------
# Step implementations. Each calls an existing script as a child process
# (never inline-reimplemented) and inspects its exit code / gateway-state.json
# / log output for success -- consistent with how remove-gateway.ps1 already
# reads gateway-state.json rather than guessing what was done.
# ---------------------------------------------------------------------------

function Invoke-ChildScript {
    param(
        [Parameter(Mandatory)][string]$ScriptPath,
        [string[]]$ScriptArgs = @()
    )
    if (-not (Test-Path $ScriptPath)) {
        return @{ ExitCode = -1; Output = "Script not found: $ScriptPath" }
    }
    $psi = [Diagnostics.ProcessStartInfo]::new()
    $psi.FileName = 'powershell.exe'
    $argList = @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', "`"$ScriptPath`"") + $ScriptArgs
    $psi.Arguments = $argList -join ' '
    $psi.RedirectStandardOutput = $true
    $psi.RedirectStandardError = $true
    $psi.UseShellExecute = $false
    $psi.CreateNoWindow = $true
    $proc = [Diagnostics.Process]::Start($psi)
    $stdout = $proc.StandardOutput.ReadToEnd()
    $stderr = $proc.StandardError.ReadToEnd()
    $proc.WaitForExit()
    return @{ ExitCode = $proc.ExitCode; Output = ($stdout + "`n" + $stderr).Trim() }
}

function Step-Prereqs {
    Set-ChecklistState -Key 'prereqs' -State 'running'
    Write-UiLog '== Checking prerequisites =='
    $result = Invoke-ChildScript -ScriptPath (Join-Path $GatewayDir '0-probe-capabilities.ps1')
    Write-UiLog $result.Output
    if ($result.ExitCode -eq 0 -or $result.ExitCode -eq $null) {
        Set-ChecklistState -Key 'prereqs' -State 'ok'
        # Surface a WinNAT-vs-ICS recommendation, same decision point the
        # manual README already flags -- do NOT silently choose for the
        # operator, this is exactly the kind of thing docs/
        # STARLINK_WINDOWS_GATEWAY.md section 3 says to bring back to
        # Khabat/a human before enabling automatically.
        if ($result.Output -match 'NetNat.*unavailable|VirtualMachinePlatformState:\s*Disabled') {
            Write-UiLog 'NOTE: WinNAT does not look available on this PC. You may need to check "Use ICS instead of WinNAT" above -- read docs/STARLINK_WINDOWS_GATEWAY.md section 3 first, ICS has real tradeoffs (see the checkbox label).'
        }
        return $true
    } else {
        Set-ChecklistState -Key 'prereqs' -State 'fail' -Detail "exit $($result.ExitCode)"
        return $false
    }
}

function Step-InstallWireGuard {
    Set-ChecklistState -Key 'wireguard' -State 'running'
    Write-UiLog '== Checking for WireGuard for Windows =='
    $existing = Get-Command 'wireguard.exe' -ErrorAction SilentlyContinue
    if ($existing) {
        Write-UiLog "Already installed: $($existing.Source)"
        Set-ChecklistState -Key 'wireguard' -State 'ok' -Detail 'already installed'
        return $true
    }
    Write-UiLog 'Not found -- downloading the official installer from wireguard.com...'
    # Official, stable download URL for the WireGuard for Windows installer
    # (documented at https://www.wireguard.com/install/, same source the
    # README already points a human installer at -- this just automates the
    # download+silent-install of exactly that).
    $installerUrl = 'https://download.wireguard.com/windows-client/wireguard-installer.exe'
    $installerPath = Join-Path $env:TEMP 'wireguard-installer.exe'
    try {
        Invoke-WebRequest -Uri $installerUrl -OutFile $installerPath -UseBasicParsing -TimeoutSec 60
    } catch {
        Set-ChecklistState -Key 'wireguard' -State 'fail' -Detail 'download failed'
        Write-UiLog "Download failed: $($_.Exception.Message). Install WireGuard for Windows manually from https://www.wireguard.com/install/ and click Start Setup again."
        return $false
    }
    Write-UiLog 'Installing silently (/S)...'
    try {
        # WireGuard's installer supports /S for a silent, no-UI install
        # (documented installer behavior for this specific installer).
        $p = Start-Process -FilePath $installerPath -ArgumentList '/S' -Wait -PassThru
        Start-Sleep -Seconds 3  # installer exits before PATH/services fully settle
        $installed = Get-Command 'wireguard.exe' -ErrorAction SilentlyContinue
        if ($installed) {
            Set-ChecklistState -Key 'wireguard' -State 'ok' -Detail 'installed'
            Write-UiLog "Installed: $($installed.Source)"
            return $true
        } else {
            Set-ChecklistState -Key 'wireguard' -State 'fail' -Detail "installer exit $($p.ExitCode)"
            Write-UiLog "wireguard.exe still not found after silent install (installer exit code $($p.ExitCode)). Install manually and retry."
            return $false
        }
    } catch {
        Set-ChecklistState -Key 'wireguard' -State 'fail'
        Write-UiLog "Silent install failed: $($_.Exception.Message)"
        return $false
    }
}

function Step-Enroll {
    param([string]$VpsUrl, [string]$Token)
    Set-ChecklistState -Key 'enrolled' -State 'running'
    Write-UiLog '== Registering this node with the backend =='
    if (-not $Token) {
        Set-ChecklistState -Key 'enrolled' -State 'fail' -Detail 'no token entered'
        Write-UiLog 'No enrollment token entered. Get one from the admin panel (Starlink tab -> Create enrollment token) and try again.'
        return $false
    }
    $result = Invoke-ChildScript -ScriptPath (Join-Path $GatewayDir 'enroll.ps1') `
        -ScriptArgs @('-EnrollmentToken', "`"$Token`"", '-VpsApiUrl', "`"$VpsUrl`"")
    Write-UiLog $result.Output
    if ($result.ExitCode -eq 0) {
        Set-ChecklistState -Key 'enrolled' -State 'ok'
        return $true
    } else {
        Set-ChecklistState -Key 'enrolled' -State 'fail' -Detail "exit $($result.ExitCode)"
        return $false
    }
}

function Step-Provision {
    param([string]$AdapterName, [bool]$UseIcs)
    Set-ChecklistState -Key 'tunnel' -State 'running'
    Set-ChecklistState -Key 'nat' -State 'running'
    Set-ChecklistState -Key 'firewall' -State 'running'
    Set-ChecklistState -Key 'heartbeat' -State 'running'
    Set-ChecklistState -Key 'watchdog' -State 'running'
    Write-UiLog '== Provisioning the gateway (WireGuard service, NAT, firewall, scheduled tasks) =='
    $args = @('-StarlinkAdapterName', "`"$AdapterName`"")
    if ($UseIcs) { $args += @('-NatMethod', 'ICS', '-AcknowledgeIcsIpConflictRisk') }
    $result = Invoke-ChildScript -ScriptPath (Join-Path $GatewayDir '1-provision-gateway.ps1') -ScriptArgs $args
    Write-UiLog $result.Output

    # 1-provision-gateway.ps1 writes gateway-state.json on success -- read it
    # back rather than trust the exit code alone, same principle
    # remove-gateway.ps1 already follows.
    $stateFile = Join-Path $GatewayDir 'gateway-state.json'
    $stateOk = (Test-Path $stateFile) -and $result.ExitCode -eq 0

    if ($stateOk) {
        Set-ChecklistState -Key 'tunnel' -State 'ok'
        Set-ChecklistState -Key 'firewall' -State 'ok'
        Set-ChecklistState -Key 'heartbeat' -State 'ok'
        Set-ChecklistState -Key 'watchdog' -State 'ok'
        # NAT is the one step known to sometimes need the manual UI-toggle
        # fallback (docs/STARLINK_WINDOWS_HANDOFF.md section 21) -- check the
        # provisioning output for its own success/warning language rather
        # than assume the whole script succeeding means NAT specifically bound.
        if ($result.Output -match 'ERROR:.*ICS bind|EnableSharing threw') {
            Set-ChecklistState -Key 'nat' -State 'fail' -Detail 'see details below'
            Write-UiLog 'NAT did not bind automatically. This is the known, still-open Windows ICS issue (docs/STARLINK_WINDOWS_HANDOFF.md section 21) -- not something this installer can force through. One-time manual fix: open Wi-Fi adapter properties -> Sharing tab -> toggle "Allow other network users to connect" off then on once, selecting the WireGuard tunnel adapter. After that one toggle it should persist across reboots (EnableRebootPersistConnection is already set by the provisioning step above).'
        } else {
            Set-ChecklistState -Key 'nat' -State 'ok'
        }
        return $true
    } else {
        Set-ChecklistState -Key 'tunnel' -State 'fail' -Detail "exit $($result.ExitCode)"
        Set-ChecklistState -Key 'nat' -State 'fail'
        Set-ChecklistState -Key 'firewall' -State 'fail'
        Set-ChecklistState -Key 'heartbeat' -State 'fail'
        Set-ChecklistState -Key 'watchdog' -State 'fail'
        return $false
    }
}

function Step-VerifyConnectivity {
    Set-ChecklistState -Key 'connectivity' -State 'running'
    Write-UiLog '== Verifying connectivity (running heartbeat.ps1 once and checking the response) =='
    # Run heartbeat.ps1 directly rather than just waiting for the scheduled
    # task to fire on its own timer -- gets a real answer in seconds instead
    # of leaving the operator staring at "pending" for up to a minute.
    $result = Invoke-ChildScript -ScriptPath (Join-Path $GatewayDir 'heartbeat.ps1')
    Write-UiLog $result.Output
    if ($result.Output -match 'Sent\. Server reports health_state=(\w+)') {
        $health = $Matches[1]
        Set-ChecklistState -Key 'connectivity' -State 'ok' -Detail "health_state=$health"
        Write-UiLog "Server confirmed this node: health_state=$health. Setup complete."
        return $true
    } else {
        Set-ChecklistState -Key 'connectivity' -State 'fail'
        Write-UiLog 'Could not confirm the server received a heartbeat. Check gateway.env has the right VPS_API_URL/NODE_ID/HEARTBEAT_TOKEN, check internet connectivity, and check the admin panel Starlink tab directly.'
        return $false
    }
}

$btnStart.Add_Click({
    $btnStart.Enabled = $false
    $txtLog.Clear()
    Write-UiLog "ReaLink Node Setup starting. Log: $SetupLogFile"

    if ($cmbAdapter.SelectedItem) {
        $adapterName = ($cmbAdapter.SelectedItem.ToString() -split ' \[')[0]
    } else {
        $adapterName = $null
    }

    $ok = Step-Prereqs
    if ($ok) { $ok = Step-InstallWireGuard }
    if ($ok) { $ok = Step-Enroll -VpsUrl $txtUrl.Text.Trim() -Token $txtToken.Text.Trim() }
    if ($ok -and -not $adapterName) {
        Write-UiLog 'No Wi-Fi adapter selected -- click Refresh and pick the adapter connected to the Starlink Mini.'
        $ok = $false
    }
    if ($ok) { $ok = Step-Provision -AdapterName $adapterName -UseIcs $chkIcs.Checked }
    if ($ok) { $ok = Step-VerifyConnectivity }

    if ($ok) {
        Write-UiLog ''
        Write-UiLog 'ALL STEPS COMPLETE. This node is registered and reporting. Confirm it shows in the admin panel Starlink tab before allowlisting real test devices.'
        [System.Windows.Forms.MessageBox]::Show('Setup complete. This node is registered and reporting to the server.', 'ReaLink Node Setup', 'OK', 'Information') | Out-Null
    } else {
        Write-UiLog ''
        Write-UiLog "Setup did not complete. Full log: $SetupLogFile -- share this file when asking for help."
        [System.Windows.Forms.MessageBox]::Show("Setup did not complete successfully. See the Details box and the log file:`n$SetupLogFile", 'ReaLink Node Setup', 'OK', 'Warning') | Out-Null
    }
    $btnStart.Enabled = $true
})

Populate-Adapters
[void]$form.ShowDialog()
