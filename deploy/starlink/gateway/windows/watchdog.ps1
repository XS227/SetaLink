#Requires -RunAsAdministrator
<#
.SYNOPSIS
    Keeps the Starlink exit path alive: asserts ICS + forwarding on every run
    (toggle-amnesia self-heal) and restarts the WireGuard tunnel service when
    the tunnel stops actually passing traffic. Run every ~60s via the
    Scheduled Task registered by 1-provision-gateway.ps1.

.DESCRIPTION
    Two duties, in this order:

    1. EXIT-PATH ASSERT (handoff section 17, root cause 5 -- "toggle
       amnesia"): WireGuard for Windows destroys and recreates the tunnel
       adapter on every Deactivate/Activate and on service restart. The
       ICS-assigned internal address (192.168.137.1) and the per-interface
       IPv4 forwarding flag die with the adapter, which kills the exit for
       every user while the handshake stays green. Every run this script
       (a) re-binds ICS (Wi-Fi = public -> tunnel adapter = private) if the
       ICS address is missing from the tunnel adapter, and (b) re-enables
       IPv4 forwarding on both adapters if disabled. It re-asserts after
       every service start/restart it performs itself, because those
       recreate the adapter too.

    2. TUNNEL LIVENESS: fi-hel's ufw drops ICMP arriving over the tunnel by
       design (default-deny; only 51820/udp is open), so "no ping reply" is
       the NORMAL healthy state and must not trigger a restart -- a naive
       ping-or-restart loop would restart the service every 60s and
       re-trigger the exact ICS amnesia duty 1 exists to fix. Instead the
       ping is used to STIMULATE the tunnel (the encrypted packets force a
       WireGuard handshake even when the inner ICMP is dropped), and
       liveness is judged by the handshake age from `wg.exe show` --
       wg.exe ships with WireGuard for Windows in $env:ProgramFiles.
       (An earlier revision of this file claimed the wg CLI does not exist
       on Windows; that was wrong, see handoff section 17 root cause 2
       which used `wg.exe show` to catch a stale AllowedIPs edit.)
       A ping reply, if one ever arrives, is accepted as healthy directly.

    Also maintains disconnects.log -- each detected-and-fixed event
    (service start, stale-handshake restart, ICS re-bind) is appended so
    heartbeat.ps1 can report a real "recent disconnects in the last 15
    minutes" count, wiring into the existing DEGRADED threshold in
    lib/starlink.php (STARLINK_DEGRADED_DISCONNECTS = 3 within 15 minutes).

    Backs off (does nothing, logs, exits) if Starlink itself is unreachable --
    restarting WireGuard repeatedly while the underlying internet is down
    would just thrash the service for no benefit, and would falsely inflate
    the disconnect count for what is actually a Starlink outage, not a
    tunnel problem.

    Defaults below match the LIVE configuration from handoff section 17
    (tunnel renumbered into ICS's hardwired 192.168.137.0/24; fi-hel test0 =
    192.168.137.2), NOT the original 10.90.x design docs. The Scheduled Task
    only passes -ServiceName and -StarlinkAdapterName, so these defaults are
    what actually runs.
#>

[CmdletBinding()]
param(
    [Parameter(Mandatory)]
    [string]$ServiceName,

    [Parameter(Mandatory)]
    [string]$StarlinkAdapterName,

    # WireGuard adapter alias. Empty = derived from the service name
    # (WireGuardTunnel$<name> -> <name>), which is how WireGuard for
    # Windows always names the pair.
    [string]$TunnelAdapterName = '',

    # fi-hel's tunnel-internal address (test0, handoff section 17).
    [string]$TunnelPeerAddress = '192.168.137.2',

    # Address ICS assigns to the private (tunnel) adapter. Hardwired by
    # Windows ICS itself -- if this is missing from the adapter, ICS has
    # lost its binding and NAT is dead.
    [string]$IcsInternalAddress = '192.168.137.1',

    # Handshake older than this = tunnel considered dead. WireGuard
    # rekeys at least every ~2 minutes when traffic flows, and the
    # stimulate-ping below guarantees traffic just flowed.
    [int]$HandshakeStaleSeconds = 180,

    [string]$LogDir = (Join-Path $PSScriptRoot 'logs')
)

New-Item -ItemType Directory -Path $LogDir -Force | Out-Null
$logFile = Join-Path $LogDir 'watchdog.log'
$disconnectsLog = Join-Path $LogDir 'disconnects.log'

# Runs every 60s forever on the Surface -- rotate so the log can't fill the disk.
if ((Test-Path $logFile) -and (Get-Item $logFile).Length -gt 5MB) {
    Move-Item -Path $logFile -Destination "$logFile.1" -Force
}

function Log($msg) {
    $line = "$((Get-Date).ToUniversalTime().ToString('o')) $msg"
    Add-Content -Path $logFile -Value $line
}

function Record-Disconnect {
    Add-Content -Path $disconnectsLog -Value (Get-Date).ToUniversalTime().ToString('o')
}

if (-not $TunnelAdapterName) {
    $TunnelAdapterName = $ServiceName -replace '^WireGuardTunnel\$', ''
}

# --- Exit-path assert helpers (duty 1) ---------------------------------------

function Test-IcsBound {
    $addr = Get-NetIPAddress -InterfaceAlias $TunnelAdapterName -AddressFamily IPv4 `
        -ErrorAction SilentlyContinue | Where-Object { $_.IPAddress -eq $IcsInternalAddress }
    return [bool]$addr
}

function Assert-Forwarding($alias) {
    $ipIf = Get-NetIPInterface -InterfaceAlias $alias -AddressFamily IPv4 -ErrorAction SilentlyContinue
    if (-not $ipIf) {
        Log "WARN: no IPv4 interface '$alias' to assert forwarding on."
        return
    }
    if ($ipIf.Forwarding -ne 'Enabled') {
        Set-NetIPInterface -InterfaceAlias $alias -AddressFamily IPv4 -Forwarding Enabled
        Log "HEALED: IPv4 forwarding was Disabled on '$alias' -- re-enabled."
    }
}

function Rebind-Ics {
    # ICS lives in the SharedAccess service; the COM calls below silently do
    # nothing useful if it's stopped.
    $sharedAccess = Get-Service -Name 'SharedAccess' -ErrorAction SilentlyContinue
    if ($sharedAccess -and $sharedAccess.Status -ne 'Running') {
        Log "SharedAccess (ICS) service is $($sharedAccess.Status) -- starting it."
        Start-Service -Name 'SharedAccess'
    }

    # Programmatic equivalent of Wi-Fi properties -> Sharing -> off -> on:
    # clear every existing sharing binding, then public on Starlink,
    # private on the tunnel adapter.
    $netShare = New-Object -ComObject HNetCfg.HNetShare
    $publicCfg = $null
    $privateCfg = $null
    foreach ($conn in @($netShare.EnumEveryConnection)) {
        try {
            $props = $netShare.NetConnectionProps.Invoke($conn)
            $cfg = $netShare.INetSharingConfigurationForINetConnection.Invoke($conn)
        } catch {
            continue  # some pseudo-connections don't expose a sharing config
        }
        if ($cfg.SharingEnabled) {
            Log "ICS re-bind: clearing stale sharing on '$($props.Name)'."
            try { $cfg.DisableSharing() } catch { Log "WARN: DisableSharing on '$($props.Name)' failed: $_" }
        }
        if ($props.Name -eq $StarlinkAdapterName) { $publicCfg = $cfg }
        elseif ($props.Name -eq $TunnelAdapterName) { $privateCfg = $cfg }
    }
    if (-not $publicCfg -or -not $privateCfg) {
        Log "ERROR: ICS re-bind impossible -- connection not found (public '$StarlinkAdapterName': $([bool]$publicCfg), private '$TunnelAdapterName': $([bool]$privateCfg))."
        return $false
    }
    try {
        $publicCfg.EnableSharing(0)   # 0 = ICSSHARINGTYPE_PUBLIC
        $privateCfg.EnableSharing(1)  # 1 = ICSSHARINGTYPE_PRIVATE
    } catch {
        Log "ERROR: EnableSharing failed: $_"
        return $false
    }
    # ICS assigns $IcsInternalAddress to the private adapter asynchronously.
    for ($i = 0; $i -lt 15; $i++) {
        Start-Sleep -Seconds 1
        if (Test-IcsBound) { return $true }
    }
    Log "ERROR: ICS re-bound but '$TunnelAdapterName' never got $IcsInternalAddress within 15s."
    return $false
}

function Assert-ExitPath {
    $wgAdapter = Get-NetAdapter -Name $TunnelAdapterName -ErrorAction SilentlyContinue
    if (-not $wgAdapter) {
        Log "WARN: tunnel adapter '$TunnelAdapterName' does not exist -- cannot assert exit path (is the tunnel service creating it?)."
        return
    }
    if (-not (Test-IcsBound)) {
        Log "Toggle amnesia detected: $IcsInternalAddress missing from '$TunnelAdapterName' -- re-binding ICS."
        if (Rebind-Ics) {
            Log "HEALED: ICS re-bound, $IcsInternalAddress back on '$TunnelAdapterName'."
            Record-Disconnect  # the exit was down for users until this heal
        }
    }
    # Section 17: forwarding must be enabled on BOTH adapters, and it dies
    # with the adapter just like the ICS address does.
    Assert-Forwarding $TunnelAdapterName
    Assert-Forwarding $StarlinkAdapterName
}

# --- Liveness helper (duty 2) -------------------------------------------------

function Get-HandshakeAgeSeconds {
    $wgExe = Join-Path $env:ProgramFiles 'WireGuard\wg.exe'
    if (-not (Test-Path $wgExe)) { return $null }
    $out = & $wgExe show $TunnelAdapterName latest-handshakes 2>$null
    if (-not $out) { return $null }
    $epochs = @($out | ForEach-Object { ($_ -split '\s+')[-1] } |
        Where-Object { $_ -match '^\d+$' } | ForEach-Object { [int64]$_ })
    if ($epochs.Count -eq 0) { return $null }
    $latest = ($epochs | Measure-Object -Maximum).Maximum
    if ($latest -eq 0) { return [int64]::MaxValue }  # never handshaken
    return [DateTimeOffset]::UtcNow.ToUnixTimeSeconds() - $latest
}

# --- Is Starlink itself up? Check via the specific adapter, not just "any internet". ---
$starlinkAdapter = Get-NetAdapter -Name $StarlinkAdapterName -ErrorAction SilentlyContinue
if (-not $starlinkAdapter -or $starlinkAdapter.Status -ne 'Up') {
    Log "Starlink adapter '$StarlinkAdapterName' is not Up -- backing off, not touching the tunnel service. This is a Starlink/Wi-Fi problem, not a tunnel problem."
    exit 0
}

$starlinkUp = Test-Connection -ComputerName '8.8.8.8' -Count 2 -Quiet -ErrorAction SilentlyContinue
if (-not $starlinkUp) {
    Log "Starlink adapter is Up but no internet reachable through it -- backing off, not restarting the tunnel service (would just thrash it while the real cause is upstream)."
    exit 0
}

# --- Is the WireGuard service even running? ---
$svc = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
if (-not $svc) {
    Log "Service '$ServiceName' not found. Nothing to watch -- has 1-provision-gateway.ps1 been run?"
    exit 1
}
if ($svc.Status -ne 'Running') {
    Log "Service '$ServiceName' is $($svc.Status), not Running -- starting it."
    Start-Service -Name $ServiceName
    Record-Disconnect
    Start-Sleep -Seconds 5
    Assert-ExitPath  # fresh adapter = ICS address and forwarding are gone
    exit 0
}

# --- Duty 1: assert the exit path every run, even when the tunnel is healthy. ---
Assert-ExitPath

# --- Duty 2: is the tunnel actually passing traffic? The ping doubles as
#     traffic stimulation: fi-hel drops the inner ICMP by design, but the
#     encrypted packets force WireGuard to (re)handshake, which is what the
#     age check below measures. ---
$tunnelPing = Test-Connection -ComputerName $TunnelPeerAddress -Count 3 -Quiet -ErrorAction SilentlyContinue
if ($tunnelPing) {
    Log "Tunnel healthy -- $TunnelPeerAddress replied to ping."
    exit 0
}

$age = Get-HandshakeAgeSeconds
if ($null -ne $age -and $age -le $HandshakeStaleSeconds) {
    Log "Tunnel healthy -- handshake ${age}s ago (no ping reply, but fi-hel filters tunnel ICMP by design)."
    exit 0
}
if ($null -eq $age) {
    Log "WARN: wg.exe unavailable or gave no handshake data, and no ping reply -- cannot distinguish idle from dead. NOT restarting (fi-hel drops tunnel ICMP by design; a blind restart loop here would recreate the adapter every 60s and thrash ICS). Check WireGuard install / tunnel name '$TunnelAdapterName'."
    exit 1
}

Log "Tunnel stale -- handshake ${age}s ago (limit ${HandshakeStaleSeconds}s) despite stimulate-ping. Restarting $ServiceName."
Restart-Service -Name $ServiceName -Force
Record-Disconnect
Start-Sleep -Seconds 5
Assert-ExitPath  # restart recreated the adapter -- heal ICS/forwarding again

Test-Connection -ComputerName $TunnelPeerAddress -Count 3 -Quiet -ErrorAction SilentlyContinue | Out-Null
$retryAge = Get-HandshakeAgeSeconds
if ($null -ne $retryAge -and $retryAge -le $HandshakeStaleSeconds) {
    Log "Restart fixed it -- handshake ${retryAge}s ago."
} else {
    Log "Still stale after restart. Will retry on next scheduled run. If this repeats across many runs, check the Surface's WireGuard config (wg.exe show, section 17 root cause 2), fi-hel's test0 status, and only then suspect Starlink."
}
