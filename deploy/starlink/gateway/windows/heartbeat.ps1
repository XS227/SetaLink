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
    # Empty = resolved next to this script file (see $scriptDir below --
    # deliberately NOT a $PSScriptRoot param default: $PSScriptRoot has been
    # observed EMPTY on the Surface gateway, and Join-Path throws on an empty
    # path, killing the script before gateway.env is even read).
    [string]$ConfigPath = '',
    # fi-hel's tunnel-internal address (test0, handoff section 17) -- the
    # live config, NOT the original 10.90.x design.
    [string]$TunnelPeerAddress = '192.168.137.2',
    # WireGuard adapter alias. Empty = derived from the (single) installed
    # WireGuardTunnel$<name> service, same naming rule watchdog.ps1 relies on.
    [string]$TunnelAdapterName = '',
    # Handshake older than this = tunnel considered dead (see watchdog.ps1).
    [int]$HandshakeStaleSeconds = 180,
    [string]$LogDir = ''
)

# Resolve the script's own directory without trusting $PSScriptRoot.
$scriptDir = $PSScriptRoot
if (-not $scriptDir -and $MyInvocation.MyCommand.Path) {
    $scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
}
if (-not $scriptDir) { $scriptDir = (Get-Location).Path }
if (-not $ConfigPath) { $ConfigPath = Join-Path $scriptDir 'gateway.env' }
if (-not $LogDir) { $LogDir = Join-Path $scriptDir 'logs' }

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

# Node Console (Phase 1, 2026-07-17) -- allowlist executor. Keys MUST match
# lib/node_console.php's NC_COMMAND_REGISTRY exactly; this switch is the
# node-side half of the two-independent-enforcement-points rule from that
# file's header (server registry + this allowlist -- never a raw string
# executed from the server). Add a new command here AND to the server
# registry together; a key present only here is simply never sent, a key
# present only server-side hits the default branch below and reports failure.
function Invoke-NodeCommand([string]$CommandKey) {
    $out = ''
    $ok = $true
    try {
        switch ($CommandKey) {
            'wg_status' {
                $wgExe = Join-Path $env:ProgramFiles 'WireGuard\wg.exe'
                $out = if (Test-Path $wgExe) { (& $wgExe show) -join "`n" } else { 'wg.exe not found' }
            }
            'network_status' {
                $out = (Get-NetIPConfiguration | Format-List | Out-String)
            }
            'last_100_logs' {
                $out = if (Test-Path $logFile) { (Get-Content $logFile -Tail 100) -join "`n" } else { '(no watchdog.log yet)' }
            }
            'refresh_telemetry' {
                # No-op signal command: the NEXT heartbeat this script already
                # sends is the refresh. Nothing extra to do beyond ack it.
                $out = 'telemetry refresh acknowledged -- next heartbeat cycle carries current state'
            }
            'restart_wireguard' {
                $wgSvc = @(Get-Service -Name 'WireGuardTunnel$*' -ErrorAction SilentlyContinue)
                if ($wgSvc.Count -eq 0) { throw 'no WireGuardTunnel$* service found' }
                Restart-Service -Name $wgSvc[0].Name -Force
                $out = "restarted service $($wgSvc[0].Name)"
            }
            default {
                $ok = $false
                $out = "unknown command_key on this gateway: $CommandKey"
            }
        }
    } catch {
        $ok = $false
        $out = "error: $($_.Exception.Message)"
    }
    return @{ success = $ok; output = $out }
}

# Node Console: report an admin-enqueued command's result back. Never
# reports for a command_id this script wasn't handed by the server, and
# never runs anything the server didn't send a signed token for --
# server-side nc_report_command_result() re-verifies the signature anyway.
function Send-CommandResult($cfg, [string]$CommandId, [string]$Token, [bool]$Success, [string]$Output, [int]$DurationMs) {
    $resultUrl = $cfg['VPS_API_URL'] -replace 'starlink-heartbeat\.php$', 'starlink-command-result.php'
    if ($resultUrl -eq $cfg['VPS_API_URL']) {
        Log "WARN: cannot derive command-result URL from VPS_API_URL -- not reporting result for $CommandId."
        return
    }
    $payload = [ordered]@{
        command_id  = $CommandId
        token       = $Token
        success     = $Success
        output      = $Output
        duration_ms = $DurationMs
    } | ConvertTo-Json -Compress
    try {
        Invoke-RestMethod -Uri $resultUrl -Method Post `
            -Headers @{ Authorization = "Bearer starlink-node-$($cfg['NODE_ID']):$($cfg['HEARTBEAT_TOKEN'])" } `
            -ContentType 'application/json' -Body $payload -TimeoutSec 6 | Out-Null
    } catch {
        Log "WARN: could not report command result for $CommandId -- $($_.Exception.Message)"
    }
}

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

    # Node Console: dispatch any pending commands the server attached to
    # this heartbeat response, then report each result. At most 5 per
    # nc_pending_commands_for_node() -- runs inline, heartbeat cadence
    # (~33s) is frequent enough that this never meaningfully delays it.
    if ($resp.commands) {
        foreach ($cmd in @($resp.commands)) {
            Log "Node Console: running command '$($cmd.command_key)' (id=$($cmd.command_id))."
            $cmdStart = Get-Date
            $result = Invoke-NodeCommand -CommandKey $cmd.command_key
            $durMs = [int]((Get-Date) - $cmdStart).TotalMilliseconds
            Log "Node Console: '$($cmd.command_key)' finished success=$($result.success) in ${durMs}ms."
            Send-CommandResult -cfg $cfg -CommandId $cmd.command_id -Token $cmd.token `
                -Success $result.success -Output $result.output -DurationMs $durMs
        }
    }
} catch {
    Log "Failed to send heartbeat: $($_.Exception.Message)"
}
