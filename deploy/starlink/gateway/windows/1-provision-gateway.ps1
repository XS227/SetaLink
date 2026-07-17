#Requires -RunAsAdministrator
<#
.SYNOPSIS
    Provisions this Windows 11 Surface as a Phase 1 ReaLink Starlink gateway.

.DESCRIPTION
    Idempotent where possible. Run 0-probe-capabilities.ps1 FIRST and read
    docs/STARLINK_WINDOWS_GATEWAY.md before running this. This script:
      1. Detects (or asks once for) the Starlink Wi-Fi adapter and the
         WireGuard tunnel adapter.
      2. Enables IPv4 forwarding only (IPv6 forwarding stays off -- see
         doc section 7). Records the prior registry value for rollback.
      3. Sets up NAT via -NatMethod WinNAT (default) or -NatMethod ICS.
         ICS requires -AcknowledgeIcsIpConflictRisk because it can fight
         WireGuard for control of the tunnel adapter's IP -- see doc
         section 3. This script does not silently choose ICS for you.
      4. Adds least-privilege Windows Firewall rules: no new inbound rule
         for WireGuard itself (the Surface dials OUT to the VPS -- nothing
         needs to accept inbound connections), plus an explicit block rule
         stopping the tunnel subnet from reaching this machine's own local
         services.
      5. Installs the WireGuard tunnel as a persistent Windows service.
      6. Registers heartbeat.ps1 and watchdog.ps1 as Scheduled Tasks that
         start at boot and repeat.

    Does NOT touch the VPS. Does NOT enable any Windows optional feature
    without telling you first if -NatMethod WinNAT needs one -- it stops
    and asks rather than enabling it silently.

.PARAMETER NatMethod
    WinNAT (default) or ICS. See docs/STARLINK_WINDOWS_GATEWAY.md section 3.

.PARAMETER AcknowledgeIcsIpConflictRisk
    Required alongside -NatMethod ICS. Confirms you've read the risk in the
    architecture doc and want to proceed anyway.

.PARAMETER StarlinkAdapterName
    Optional. Skips the interactive adapter picker.

.PARAMETER TunnelConfigPath
    Path to the WireGuard .conf file (see wg-starlink-windows.conf.example).
    Defaults to .\wg-starlink0.conf next to this script.
#>

[CmdletBinding()]
param(
    [ValidateSet('WinNAT', 'ICS')]
    [string]$NatMethod = 'WinNAT',

    [switch]$AcknowledgeIcsIpConflictRisk,

    [string]$StarlinkAdapterName,

    [string]$TunnelConfigPath = (Join-Path $PSScriptRoot 'wg-starlink0.conf'),

    [string]$TunnelSubnet = '10.90.0.0/30',

    [string]$TunnelInternalAddress = '10.90.0.2'
)

$ErrorActionPreference = 'Stop'
$stateFile = Join-Path $PSScriptRoot 'gateway-state.json'

function Write-Step($msg) { Write-Host "`n==> $msg" -ForegroundColor Cyan }
function Write-Ok($msg)   { Write-Host "    OK: $msg" -ForegroundColor Green }
function Write-Warn2($msg){ Write-Host "    WARNING: $msg" -ForegroundColor Yellow }

if ($NatMethod -eq 'ICS' -and -not $AcknowledgeIcsIpConflictRisk) {
    throw "NatMethod ICS requires -AcknowledgeIcsIpConflictRisk. Read docs/STARLINK_WINDOWS_GATEWAY.md section 3 first -- ICS can override the WireGuard adapter's IP and break the tunnel's addressing. WinNAT (the default) does not have this problem."
}

$state = [ordered]@{
    ProvisionedAtUtc      = (Get-Date).ToUniversalTime().ToString('o')
    NatMethod             = $NatMethod
    StarlinkAdapterName   = $null
    TunnelAdapterName     = $null
    PriorIPEnableRouter   = $null
    NatObjectName         = 'ReaLinkStarlinkNat'
    FirewallRuleNames     = @()
    WireGuardServiceName  = $null
    TunnelConfigPath      = $TunnelConfigPath
}

# ---------------------------------------------------------------------------
Write-Step "Checking WireGuard for Windows is installed"
$wg = Get-Command 'wireguard.exe' -ErrorAction SilentlyContinue
if (-not $wg) {
    $defaultPath = "$env:ProgramFiles\WireGuard\wireguard.exe"
    if (Test-Path $defaultPath) { $wg = Get-Item $defaultPath } else {
        throw "WireGuard for Windows not found. Install from https://www.wireguard.com/install/ then re-run."
    }
}
$wgExe = if ($wg.Source) { $wg.Source } else { $wg.FullName }
Write-Ok "Found: $wgExe"

if (-not (Test-Path $TunnelConfigPath)) {
    throw "Tunnel config not found at $TunnelConfigPath. Copy wg-starlink-windows.conf.example there, fill in the VPS endpoint + your generated private key (never commit it), then re-run."
}

# ---------------------------------------------------------------------------
Write-Step "Selecting the Starlink Wi-Fi adapter"
if (-not $StarlinkAdapterName) {
    $wifiAdapters = Get-NetAdapter | Where-Object { $_.MediaType -eq 'Native 802.11' -and $_.Status -eq 'Up' }
    if ($wifiAdapters.Count -eq 1) {
        $StarlinkAdapterName = $wifiAdapters[0].Name
        Write-Ok "Auto-detected single active Wi-Fi adapter: $StarlinkAdapterName"
    } else {
        Write-Host "Multiple or zero active Wi-Fi adapters found:" -ForegroundColor Yellow
        Get-NetAdapter | Format-Table Name, InterfaceDescription, Status, MediaType -AutoSize | Out-String | Write-Host
        $StarlinkAdapterName = Read-Host "Enter the exact Name of the adapter connected to the Starlink Mini's Wi-Fi"
    }
}
$starlinkAdapter = Get-NetAdapter -Name $StarlinkAdapterName -ErrorAction Stop
if ($starlinkAdapter.Status -ne 'Up') { throw "Adapter '$StarlinkAdapterName' is not Up. Connect to the Starlink Mini's Wi-Fi first." }
$state.StarlinkAdapterName = $StarlinkAdapterName
Write-Ok "Using '$StarlinkAdapterName' as the Starlink-facing (public/egress) adapter."

# ---------------------------------------------------------------------------
Write-Step "Enabling IPv4 forwarding (IPv6 forwarding stays disabled -- see doc section 7)"
$fwdKey = 'HKLM:\SYSTEM\CurrentControlSet\Services\Tcpip\Parameters'
$prior = (Get-ItemProperty -Path $fwdKey -Name IPEnableRouter -ErrorAction SilentlyContinue).IPEnableRouter
$state.PriorIPEnableRouter = if ($null -ne $prior) { $prior } else { 0 }
$forwardingJustEnabled = ($prior -ne 1)
if ($prior -ne 1) {
    Set-ItemProperty -Path $fwdKey -Name IPEnableRouter -Value 1 -Type DWord
    Write-Warn2 "IPEnableRouter set to 1 (was: $($state.PriorIPEnableRouter)). This registry change is read by the TCP/IP driver at initialization -- a REBOOT is required before forwarding is actually active, not just this script finishing. Reboot before running the test plan."
} else {
    Write-Ok "IPEnableRouter already 1 -- no change."
}
# Ensure IPv6 forwarding is explicitly off on every interface (default is off,
# but make it explicit rather than relying on the default).
Get-NetIPInterface -AddressFamily IPv6 | Set-NetIPInterface -Forwarding Disabled -ErrorAction SilentlyContinue
Write-Ok "IPv6 forwarding explicitly disabled on all interfaces."

# ---------------------------------------------------------------------------
Write-Step "Installing the WireGuard tunnel as a persistent service"
# IMPORTANT: do not assume the tunnel/service name matches the .conf filename.
# WireGuard for Windows names the tunnel from whatever it decides at install
# time (or from a pre-existing tunnel someone added via the GUI under a
# different name) - this has been observed to diverge from the filename in
# practice (e.g. a tunnel named "Starlink" backed by
# Data\Configurations\Starlink.conf.dpapi, even though the source file here
# is wg-starlink0.conf). Every use below discovers the real name instead of
# assuming it, so this works regardless of what name WireGuard actually used.
$configDir = "$env:ProgramFiles\WireGuard\Data\Configurations"

function Get-WireGuardTunnelServiceNames {
    (Get-Service -Name 'WireGuardTunnel$*' -ErrorAction SilentlyContinue) |
        ForEach-Object { $_.Name -replace '^WireGuardTunnel\$', '' }
}

$existingTunnelNames = @(Get-WireGuardTunnelServiceNames)
$tunnelName = $null
$serviceName = $null

if ($existingTunnelNames.Count -ge 1) {
    if ($existingTunnelNames.Count -gt 1) {
        Write-Warn2 "Multiple WireGuard tunnel services already exist: $($existingTunnelNames -join ', '). Using the first one ($($existingTunnelNames[0])). If that's the wrong one, stop this script (Ctrl+C) and tell me which tunnel is actually the Starlink one before continuing."
    }
    $tunnelName = $existingTunnelNames[0]
    $serviceName = "WireGuardTunnel`$$tunnelName"
    Write-Ok "Found existing WireGuard tunnel service '$tunnelName' (service: $serviceName) - reusing it, not installing a duplicate."
} else {
    $before = @()
    if (Test-Path $configDir) { $before = @((Get-ChildItem $configDir -Filter '*.conf.dpapi' -ErrorAction SilentlyContinue).BaseName) }

    & $wgExe /installtunnelservice $TunnelConfigPath
    Start-Sleep -Seconds 2

    # Discover the ACTUAL assigned name by diffing Data\Configurations
    # before/after (authoritative - this is what the service really launches
    # against), falling back to whatever WireGuardTunnel$ service now exists.
    $after = @()
    if (Test-Path $configDir) { $after = @((Get-ChildItem $configDir -Filter '*.conf.dpapi' -ErrorAction SilentlyContinue).BaseName) }
    $newNames = @($after | Where-Object { $_ -notin $before })

    if ($newNames.Count -eq 1) {
        $tunnelName = $newNames[0]
    } else {
        $svcNames = @(Get-WireGuardTunnelServiceNames)
        if ($svcNames.Count -eq 1) {
            $tunnelName = $svcNames[0]
        } else {
            throw "Could not determine the installed tunnel name automatically after /installtunnelservice (new config files: $($newNames -join ', '); tunnel services: $($svcNames -join ', ')). Check $configDir by hand and re-run with the discovered name."
        }
    }
    $serviceName = "WireGuardTunnel`$$tunnelName"
    Write-Ok "WireGuard assigned tunnel name '$tunnelName' (service: $serviceName) - using this from now on, regardless of the .conf filename ($([System.IO.Path]::GetFileNameWithoutExtension($TunnelConfigPath)))."
}

$existingSvc = Get-Service -Name $serviceName -ErrorAction SilentlyContinue
if (-not $existingSvc) { throw "Tunnel service $serviceName did not appear - check $TunnelConfigPath for syntax errors, or Windows Event Viewer." }
if ($existingSvc.Status -ne 'Running') {
    Start-Service -Name $serviceName
    Write-Ok "Started $serviceName."
} else {
    Write-Ok "$serviceName already running."
}
$state.WireGuardServiceName = $serviceName
$state.TunnelName = $tunnelName

Write-Step "Waiting for the WireGuard tunnel adapter to appear"
$tunnelAdapter = $null
for ($i = 0; $i -lt 15; $i++) {
    $tunnelAdapter = Get-NetAdapter | Where-Object { $_.InterfaceDescription -like '*WireGuard*' -and $_.Name -like "*$tunnelName*" }
    if ($tunnelAdapter) { break }
    Start-Sleep -Seconds 2
}
if (-not $tunnelAdapter) {
    $tunnelAdapter = Get-NetAdapter | Where-Object { $_.InterfaceDescription -like '*WireGuard*' } | Select-Object -First 1
}
if (-not $tunnelAdapter) { throw "No WireGuard adapter found after installing the service. Check 'Get-Service $serviceName' and Windows Event Viewer." }
$state.TunnelAdapterName = $tunnelAdapter.Name
Write-Ok "Tunnel adapter: $($tunnelAdapter.Name) (ifIndex $($tunnelAdapter.ifIndex))"

# ---------------------------------------------------------------------------
Write-Step "Configuring NAT ($NatMethod)"
if ($NatMethod -eq 'WinNAT') {
    if (-not (Get-Command New-NetNat -ErrorAction SilentlyContinue)) {
        throw "New-NetNat is not available on this system. Re-run 0-probe-capabilities.ps1 and check VirtualMachinePlatformState -- if it's Disabled, that feature needs to be enabled for WinNAT to exist, and that decision needs your explicit sign-off first (see docs/STARLINK_WINDOWS_GATEWAY.md section 3). Alternatively re-run this script with -NatMethod ICS -AcknowledgeIcsIpConflictRisk, understanding the tradeoff described there."
    }
    $natName = $state.NatObjectName
    $existingNat = Get-NetNat -Name $natName -ErrorAction SilentlyContinue
    if ($existingNat) {
        Write-Ok "NAT object '$natName' already exists (internal prefix $($existingNat.InternalIPInterfaceAddressPrefix))."
    } else {
        # Client Windows (10/11, non-Server) only supports a SINGLE active
        # WinNAT instance system-wide. Hyper-V's "Default Switch" (created
        # automatically once Hyper-V, WSL2, or Docker Desktop is installed)
        # silently owns that one slot on most dev/admin machines, and a
        # second New-NetNat call then fails with the WinNAT driver reporting
        # a generic "Invalid class" COM error rather than a clear conflict
        # message. Check for ANY existing NAT (not just ours by name) first
        # so the failure -- if it happens anyway -- comes with a real cause.
        $anyExistingNat = @(Get-NetNat -ErrorAction SilentlyContinue)
        if ($anyExistingNat.Count -gt 0) {
            Write-Warn2 "Found $($anyExistingNat.Count) existing NAT object(s) on this system: $($anyExistingNat.Name -join ', '). Client Windows allows only one active WinNAT instance -- this is the most common cause of 'New-NetNat : Invalid class'. If one of these is Hyper-V's 'Default Switch' NAT (created by WSL2/Docker Desktop), either remove it (Remove-NetNat -Name '<name>', breaking WSL2/Docker networking until re-created) or use -NatMethod ICS instead."
        }
        try {
            New-NetNat -Name $natName -InternalIPInterfaceAddressPrefix $TunnelSubnet -ErrorAction Stop | Out-Null
            Write-Ok "Created WinNAT object '$natName' translating $TunnelSubnet out through whichever interface holds the default route for it (the Starlink Wi-Fi adapter, since forwarding is scoped to that subnet only)."
        } catch {
            Write-Warn2 "New-NetNat failed: $($_.Exception.Message)"
            Write-Warn2 "Diagnostics -- Get-NetNat: $((Get-NetNat -ErrorAction SilentlyContinue | Format-Table -AutoSize | Out-String).Trim())"
            Write-Warn2 "Diagnostics -- WinNat service: $((Get-Service WinNat -ErrorAction SilentlyContinue | Format-Table -AutoSize | Out-String).Trim())"
            throw "New-NetNat could not create '$natName'. If no conflicting NAT was listed above, the WinNat driver's internal state is likely stale (common after sleep/resume or a previous incomplete Remove-NetNat) -- try 'Restart-Service WinNat -Force' (or a reboot) and re-run this script. If a conflicting NAT WAS listed above, resolve that first (see warning) or re-run with -NatMethod ICS."
        }
    }
    Write-Warn2 "WinNAT NATs by internal subnet, not by explicit adapter binding. Verify with 'Get-NetRoute' that $TunnelSubnet's next hop / egress resolves to '$StarlinkAdapterName', not some other interface, before trusting step 8 of the test plan."
}
elseif ($NatMethod -eq 'ICS') {
    Write-Warn2 "Using ICS as acknowledged. This WILL attempt to take ownership of the tunnel adapter's IP configuration."
    $hnet = New-Object -ComObject HNetCfg.HNetShare
    $connections = $hnet.EnumEveryConnection
    $publicConn = $null; $privateConn = $null
    foreach ($conn in $connections) {
        $props = $hnet.NetConnectionProps.Invoke($conn)
        if ($props.Name -eq $StarlinkAdapterName) { $publicConn = $conn }
        if ($props.Name -eq $tunnelAdapter.Name)   { $privateConn = $conn }
    }
    if (-not $publicConn -or -not $privateConn) {
        throw "Could not resolve ICS connection objects for '$StarlinkAdapterName' / '$($tunnelAdapter.Name)'. ICS via COM automation is version-sensitive -- this is exactly the kind of thing section 3 of the doc warns is not safe to assume works. Recommend falling back to -NatMethod WinNAT or the GL.iNet/Pi hardware path instead."
    }
    $hnet.INetSharingConfigurationForINetConnection.Invoke($publicConn).EnableSharing(0)  # 0 = public
    $hnet.INetSharingConfigurationForINetConnection.Invoke($privateConn).EnableSharing(1) # 1 = private
    Write-Ok "ICS sharing enabled. VERIFY IMMEDIATELY: Get-NetIPAddress -InterfaceIndex $($tunnelAdapter.ifIndex) -- if it no longer matches $TunnelInternalAddress, ICS has overridden it and the VPS-side WireGuard peer will not be able to reach this machine. If that happens, stop, run remove-gateway.ps1, and switch to -NatMethod WinNAT."
}
$state.FirewallRuleNames = @()

# ---------------------------------------------------------------------------
Write-Step "Configuring Windows Firewall (least privilege)"
$blockRuleName = 'ReaLink-Starlink-Block-Tunnel-To-LocalServices'
if (-not (Get-NetFirewallRule -DisplayName $blockRuleName -ErrorAction SilentlyContinue)) {
    # Note: -Protocol Any does not accept -LocalPort/-RemotePort (those only
    # apply to TCP/UDP) -- this rule intentionally covers every protocol and
    # every local port by simply omitting them.
    New-NetFirewallRule -DisplayName $blockRuleName `
        -Direction Inbound -Action Block `
        -RemoteAddress $TunnelSubnet `
        -Protocol Any `
        -Profile Any `
        -Description 'Prevents the ReaLink Starlink tunnel subnet from reaching this machine''s own local services (file sharing, RDP, etc.) -- the tunnel exists for egress only, not for this machine to be reachable from it.' | Out-Null
    $state.FirewallRuleNames += $blockRuleName
    Write-Ok "Added inbound block rule: tunnel subnet -> this machine's local services."
} else {
    Write-Ok "Block rule already present."
}
# WireGuard's own installer already adds the firewall rules it needs for the
# service to run; we deliberately do not add any inbound allow rule here --
# the Surface only ever dials out (brief requirement: "expose no service
# directly to the public internet").
Write-Ok "No inbound rule added for the tunnel itself -- by design, the Surface only dials out."

# ---------------------------------------------------------------------------
Write-Step "Registering heartbeat.ps1 as a Scheduled Task (every 60s, runs at startup)"
$heartbeatScript = Join-Path $PSScriptRoot 'heartbeat.ps1'
$hbTaskName = 'ReaLink-Starlink-Heartbeat'
$hbAction = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$heartbeatScript`""
# -RepetitionDuration ([TimeSpan]::MaxValue) is a known Register-ScheduledTask
# trap: New-ScheduledTaskTrigger serializes it to an ISO8601 duration that
# exceeds what Task Scheduler's XML schema accepts, failing with "The task
# XML contains a value which is incorrectly formatted or out of range."
# Fix: build the trigger without -RepetitionDuration, then set the
# underlying Repetition.Duration to '' -- that empty string is the actual
# "repeat indefinitely" sentinel Task Scheduler's COM/CIM model expects.
# 60s, not less: Task Scheduler's minimum RepetitionInterval is one minute --
# 33s serialized to PT33S and was rejected as out of range on the Surface
# (2026-07-17). The server's OFFLINE window (STARLINK_HEARTBEAT_FRESH_SECS)
# is sized to tolerate this cadence; change them together.
$hbTrigger = New-ScheduledTaskTrigger -Once -At (Get-Date) -RepetitionInterval (New-TimeSpan -Seconds 60)
$hbTrigger.Repetition.Duration = ''
$hbBootTrigger = New-ScheduledTaskTrigger -AtStartup
$hbSettings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1)
$hbPrincipal = New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest
Register-ScheduledTask -TaskName $hbTaskName -Action $hbAction -Trigger @($hbTrigger, $hbBootTrigger) -Settings $hbSettings -Principal $hbPrincipal -Force | Out-Null
Write-Ok "Task '$hbTaskName' registered."

Write-Step "Registering watchdog.ps1 as a Scheduled Task (every 60s, runs at startup)"
$watchdogScript = Join-Path $PSScriptRoot 'watchdog.ps1'
$wdTaskName = 'ReaLink-Starlink-Watchdog'
# NatMethod/NatName must reach the watchdog, or its duty-1 assert heals the
# wrong NAT engine (asserting ICS on a WinNAT box would re-enable the exact
# COM path WinNAT exists to avoid -- handoff sections 20/21/23).
$wdAction = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$watchdogScript`" -ServiceName `"$serviceName`" -StarlinkAdapterName `"$StarlinkAdapterName`" -NatMethod `"$NatMethod`" -NatName `"$($state.NatObjectName)`""
$wdTrigger = New-ScheduledTaskTrigger -Once -At (Get-Date) -RepetitionInterval (New-TimeSpan -Seconds 60)
$wdTrigger.Repetition.Duration = ''
$wdBootTrigger = New-ScheduledTaskTrigger -AtStartup
Register-ScheduledTask -TaskName $wdTaskName -Action $wdAction -Trigger @($wdTrigger, $wdBootTrigger) -Settings $hbSettings -Principal $hbPrincipal -Force | Out-Null
Write-Ok "Task '$wdTaskName' registered."

# ---------------------------------------------------------------------------
$state | ConvertTo-Json -Depth 6 | Out-File -FilePath $stateFile -Encoding utf8
Write-Step "Done. State written to $stateFile (remove-gateway.ps1 reads this to know what to undo)."
if ($forwardingJustEnabled) {
    Write-Warn2 "REBOOT REQUIRED before IP forwarding is actually active -- everything else here (NAT, service, tasks) will start fine without one, but forwarded traffic won't flow until after a reboot."
}
Write-Host "`nNext: confirm the VPS side (setup-starlink-wg.sh peer key, Xray routing rule) is applied, then follow the test plan in docs/STARLINK_WINDOWS_GATEWAY.md section 11 starting at step 4." -ForegroundColor Cyan
