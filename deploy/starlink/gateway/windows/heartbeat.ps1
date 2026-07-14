#Requires -RunAsAdministrator
<#
.SYNOPSIS
    Posts gateway health telemetry to public/starlink-heartbeat.php. Run
    every ~33s via the Scheduled Task registered by 1-provision-gateway.ps1.

.DESCRIPTION
    Sends the SAME JSON schema deploy/starlink/gateway/heartbeat.sh (the
    Linux gateway) already sends — no backend change needed for a Windows
    gateway, per docs/STARLINK_WINDOWS_GATEWAY.md section 2.

    Config is read from gateway.env (NOT committed — see config.template.env
    for the format). Never hardcode the heartbeat token in this script.

    Backs off safely: if there is no internet at all, this exits quietly
    instead of erroring or crash-looping — matching the Linux gateway's
    `|| true` on its curl call.
#>

[CmdletBinding()]
param(
    [string]$ConfigPath = (Join-Path $PSScriptRoot 'gateway.env'),
    [string]$TunnelPeerAddress = '10.90.0.1',
    [string]$LogDir = (Join-Path $PSScriptRoot 'logs')
)

New-Item -ItemType Directory -Path $LogDir -Force | Out-Null
$logFile = Join-Path $LogDir 'heartbeat.log'
function Log($msg) { Add-Content -Path $logFile -Value "$((Get-Date).ToUniversalTime().ToString('o')) $msg" }

if (-not (Test-Path $ConfigPath)) {
    Log "Config not found at $ConfigPath — copy config.template.env there and fill it in. Exiting."
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

# --- Quick internet check first — back off quietly if none, per brief requirement. ---
if (-not (Test-Connection -ComputerName '1.1.1.1' -Count 1 -Quiet -ErrorAction SilentlyContinue)) {
    Log "No internet reachable at all — backing off, not sending heartbeat this cycle."
    exit 0
}

# --- Tunnel status + latency/loss: ping the VPS's tunnel-internal address,
#     same rationale as watchdog.ps1 and the Linux gateway's own heartbeat.sh
#     (measure the tunnel's own health, not the general internet). ---
$pingResults = 1..5 | ForEach-Object {
    Test-Connection -ComputerName $TunnelPeerAddress -Count 1 -ErrorAction SilentlyContinue
}
$received = @($pingResults | Where-Object { $_ })
$lossPct = [math]::Round((5 - $received.Count) / 5 * 100, 1)
$latencyMs = if ($received.Count -gt 0) {
    [math]::Round(($received | Measure-Object -Property ResponseTime -Average).Average)
} else { $null }
$tunnelStatus = if ($received.Count -ge 3) { 'up' } else { 'down' }

# --- Public exit IP (must reflect the Starlink-side egress, not the tunnel —
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

# --- Local Wi-Fi state (informational — not a backend column today, sent as
#     an extra field for future use; unknown fields are safely ignored by
#     st_apply_heartbeat's whitelist, see lib/starlink.php). ---
$wifiState = try { (netsh wlan show interfaces) -join ' | ' } catch { 'unavailable' }

$lastError = if ($tunnelStatus -eq 'down') { "tunnel unreachable at $TunnelPeerAddress ($($received.Count)/5 pings answered)" } else { '' }

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
} catch {
    Log "Failed to send heartbeat: $($_.Exception.Message)"
}
