#Requires -RunAsAdministrator
<#
.SYNOPSIS
    Posts gateway health telemetry to public/starlink-heartbeat.php. Run
    every ~33s via the Scheduled Task registered by 1-provision-gateway.ps1.

.DESCRIPTION
    Sends the SAME JSON schema deploy/starlink/gateway/heartbeat.sh (the
    Linux gateway) already sends -- no backend change needed for a Windows
    gateway, per docs/STARLINK_WINDOWS_GATEWAY.md section 2.

    Config is read from gateway.env (NOT committed -- see config.template.env
    for the format). Never hardcode the heartbeat token in this script.

    Backs off safely: if there is no internet at all, this exits quietly
    instead of erroring or crash-looping -- matching the Linux gateway's
    `|| true` on its curl call.
#>

[CmdletBinding()]
param(
    [string]$ConfigPath = (Join-Path $PSScriptRoot 'gateway.env'),
    # fi-hel's tunnel-internal address (test0, handoff section 17) -- the
    # live config, NOT the original 10.90.x design.
    [string]$TunnelPeerAddress = '192.168.137.2',
    # WireGuard adapter alias. Empty = derived from the (single) installed
    # WireGuardTunnel$<name> service, same naming rule watchdog.ps1 relies on.
    [string]$TunnelAdapterName = '',
    # Handshake older than this = tunnel considered dead (see watchdog.ps1).
    [int]$HandshakeStaleSeconds = 180,
    [string]$LogDir = (Join-Path $PSScriptRoot 'logs')
)

New-Item -ItemType Directory -Path $LogDir -Force | Out-Null
$logFile = Join-Path $LogDir 'heartbeat.log'
function Log($msg) { Add-Content -Path $logFile -Value "$((Get-Date).ToUniversalTime().ToString('o')) $msg" }

if (-not (Test-Path $ConfigPath)) {
    Log "Config not found at $ConfigPath -- copy config.template.env there and fill it in. Exiting."
    exit 1
}

# --- Load simple KEY=VALUE env file ---
$cfg = @{}
Get-Content $ConfigPath | Where-Object { $_ -match '^\s*[^#].*=' } | ForEach-Object {
    $k, $v = $_ -split '=', 2
    $cfg[$k.Trim()] = $v.Trim()
}
foreach ($required in @('VPS_API_URL', 'NODE_ID', 'HEARTBEAT_TOKEN')) {
    if (-not $cfg.ContainsKey($required) -or [string]::IsNullOrWhiteSpace($cfg[$required])) {
        Log "Missing required config value: $required. Exiting."
        exit 1
    }
}

# --- Quick internet check first -- back off quietly if none, per brief requirement. ---
if (-not (Test-Connection -ComputerName '1.1.1.1' -Count 1 -Quiet -ErrorAction SilentlyContinue)) {
    Log "No internet reachable at all -- backing off, not sending heartbeat this cycle."
    exit 0
}

# --- Tunnel status: fi-hel's ufw drops ICMP over the tunnel BY DESIGN
#     (default-deny, only 51820/udp open), so ping replies are the exception,
#     not the rule -- a ping-based tunnel_status would permanently report
#     'down' and the server would hold the node OFFLINE/unroutable forever
#     (st_health_state in lib/starlink.php fails closed on tunnel_status).
#     Same approach as watchdog.ps1: the pings STIMULATE a WireGuard
#     handshake even when the inner ICMP is dropped, and liveness is judged
#     by handshake age via wg.exe. If replies DO come back (e.g. the fi-hel
#     firewall is opened later), they are used for real latency/loss. ---
if (-not $TunnelAdapterName) {
    $wgSvc = @(Get-Service -Name 'WireGuardTunnel$*' -ErrorAction SilentlyContinue)
    if ($wgSvc.Count -gt 0) { $TunnelAdapterName = $wgSvc[0].Name -replace '^WireGuardTunnel\$', '' }
}

function Get-HandshakeAgeSeconds {
    # Duplicated from watchdog.ps1 -- these scripts are deliberately
    # standalone (each is fetched/run independently on the gateway).
    $wgExe = Join-Path $env:ProgramFiles 'WireGuard\wg.exe'
    if (-not $TunnelAdapterName -or -not (Test-Path $wgExe)) { return $null }
    $out = & $wgExe show $TunnelAdapterName latest-handshakes 2>$null
    if (-not $out) { return $null }
    $epochs = @($out | ForEach-Object { ($_ -split '\s+')[-1] } |
        Where-Object { $_ -match '^\d+$' } | ForEach-Object { [int64]$_ })
    if ($epochs.Count -eq 0) { return $null }
    $latest = ($epochs | Measure-Object -Maximum).Maximum
    if ($latest -eq 0) { return [int64]::MaxValue }  # never handshaken
    return [DateTimeOffset]::UtcNow.ToUnixTimeSeconds() - $latest
}

$pingResults = 1..5 | ForEach-Object {
    Test-Connection -ComputerName $TunnelPeerAddress -Count 1 -ErrorAction SilentlyContinue
}
$received = @($pingResults | Where-Object { $_ })

if ($received.Count -ge 3) {
    # ICMP actually works -- use the real measurements.
    $tunnelStatus = 'up'
    $lossPct = [math]::Round((5 - $received.Count) / 5 * 100, 1)
    $latencyMs = [math]::Round(($received | Measure-Object -Property ResponseTime -Average).Average)
} else {
    $hsAge = Get-HandshakeAgeSeconds
    if ($null -ne $hsAge -and $hsAge -le $HandshakeStaleSeconds) {
        # Tunnel is alive; ICMP is just filtered at the peer. Report no
        # latency/loss rather than fake 100% loss -- null means "not
        # measured" server-side (st_health_state treats null as 0).
        $tunnelStatus = 'up'
        $lossPct = $null
        $latencyMs = $null
    } else {
        $tunnelStatus = 'down'
        $lossPct = [math]::Round((5 - $received.Count) / 5 * 100, 1)
        $latencyMs = $null
    }
}

# --- Public exit IP (must reflect the Starlink-side egress, not the tunnel --
#     run these direct, not through the tunnel adapter). ---
$exitIpv4 = $null
$exitIpv6 = $null
try { $exitIpv4 = (Invoke-RestMethod -Uri 'https://api.ipify.org' -TimeoutSec 4) } catch { }
try { $exitIpv6 = (Invoke-RestMethod -Uri 'https://api6.ipify.org' -TimeoutSec 4) } catch { }

# --- Uptime ---
$uptimeSecs = [int]((Get-Date) - (Get-CimInstance Win32_OperatingSystem).LastBootUpTime).TotalSeconds

# --- Recent disconnects: count watchdog-logged events in the last 15 minutes,
#     matching STARLINK_DEGRADED_DISCONNECTS's window in lib/starlink.php. ---
$disconnectsLog = Join-Path $LogDir 'disconnects.log'
$recentDisconnects = 0
if (Test-Path $disconnectsLog) {
    $cutoff = (Get-Date).ToUniversalTime().AddMinutes(-15)
    $recentDisconnects = @(Get-Content $disconnectsLog | Where-Object {
        try { [datetime]$_ -gt $cutoff } catch { $false }
    }).Count
}

# --- Local Wi-Fi state (informational -- not a backend column today, sent as
#     an extra field for future use; unknown fields are safely ignored by
#     st_apply_heartbeat's whitelist, see lib/starlink.php). ---
$wifiState = try { (netsh wlan show interfaces) -join ' | ' } catch { 'unavailable' }

$lastError = if ($tunnelStatus -eq 'down') { "tunnel dead: no WireGuard handshake within ${HandshakeStaleSeconds}s and $($received.Count)/5 pings answered at $TunnelPeerAddress" } else { '' }

$payload = [ordered]@{
    tunnel_status      = $tunnelStatus
    public_ipv4        = $exitIpv4
    public_ipv6        = $exitIpv6
    exit_ip            = $exitIpv4
    latency_ms         = $latencyMs
    packet_loss_pct    = $lossPct
    recent_disconnects = $recentDisconnects
    uptime_secs        = $uptimeSecs
    software_version   = "phase1-win-$(Get-Date -Format yyyyMMdd)"
    last_error         = $lastError
    wifi_state         = $wifiState
} | ConvertTo-Json -Compress

try {
    $resp = Invoke-RestMethod -Uri $cfg['VPS_API_URL'] -Method Post `
        -Headers @{ Authorization = "Bearer starlink-node-$($cfg['NODE_ID']):$($cfg['HEARTBEAT_TOKEN'])" } `
        -ContentType 'application/json' -Body $payload -TimeoutSec 6
    Log "Sent. Server reports health_state=$($resp.health_state)"

    # Persist the admin-controlled config the server just returned
    # (enabled/maintenance_mode/max_sessions/allocated_kbps -- see
    # lib/starlink.php:st_gateway_config()) so an admin change on the VPS is
    # visible here without a redeploy. Same state-file convention as the
    # Linux gateway's heartbeat.sh.
    if ($resp.config) {
        $configFile = Join-Path $LogDir 'node-config.json'
        $resp.config | ConvertTo-Json -Compress | Set-Content -Path $configFile -ErrorAction SilentlyContinue
    }
} catch {
    Log "Failed to send heartbeat: $($_.Exception.Message)"
}
