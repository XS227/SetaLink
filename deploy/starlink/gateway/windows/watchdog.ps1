#Requires -RunAsAdministrator
<#
.SYNOPSIS
    Restarts the WireGuard tunnel service when the tunnel stops actually
    passing traffic. Run every ~60s via the Scheduled Task registered by
    1-provision-gateway.ps1.

.DESCRIPTION
    Important: WireGuard for Windows does NOT ship the Linux `wg` CLI tool
    (no `wg show latest-handshakes` on Windows) — only `wireguard.exe` with
    /installtunnelservice, /uninstalltunnelservice, /dumplog. So liveness
    here is checked the same way docs/CLAUDE_REALINK_RULES.md Rule 2 already
    requires project-wide: ping the VPS's tunnel-internal address THROUGH
    the tunnel and require an actual reply, not just "service is Running."
    This mirrors deploy/starlink/gateway/heartbeat.sh's own approach on the
    Linux gateway path (ping the tunnel peer, not a public target).

    Also maintains disconnects.log — each detected-and-fixed staleness event
    is appended here so heartbeat.ps1 can report a real
    "recent disconnects in the last 15 minutes" count, wiring directly into
    the existing DEGRADED threshold in lib/starlink.php
    (STARLINK_DEGRADED_DISCONNECTS = 3 within 15 minutes).

    Backs off (does nothing, logs, exits) if Starlink itself is unreachable —
    restarting WireGuard repeatedly while the underlying internet is down
    would just thrash the service for no benefit, and would falsely inflate
    the disconnect count for what is actually a Starlink outage, not a
    tunnel problem.
#>

[CmdletBinding()]
param(
    [Parameter(Mandatory)]
    [string]$ServiceName,

    [Parameter(Mandatory)]
    [string]$StarlinkAdapterName,

    [string]$TunnelPeerAddress = '10.90.0.1',

    [string]$LogDir = (Join-Path $PSScriptRoot 'logs')
)

New-Item -ItemType Directory -Path $LogDir -Force | Out-Null
$logFile = Join-Path $LogDir 'watchdog.log'
$disconnectsLog = Join-Path $LogDir 'disconnects.log'

function Log($msg) {
    $line = "$((Get-Date).ToUniversalTime().ToString('o')) $msg"
    Add-Content -Path $logFile -Value $line
}

# --- Is Starlink itself up? Check via the specific adapter, not just "any internet". ---
$starlinkAdapter = Get-NetAdapter -Name $StarlinkAdapterName -ErrorAction SilentlyContinue
if (-not $starlinkAdapter -or $starlinkAdapter.Status -ne 'Up') {
    Log "Starlink adapter '$StarlinkAdapterName' is not Up — backing off, not touching the tunnel service. This is a Starlink/Wi-Fi problem, not a tunnel problem."
    exit 0
}

$starlinkUp = Test-Connection -ComputerName '8.8.8.8' -Count 2 -Quiet -ErrorAction SilentlyContinue
if (-not $starlinkUp) {
    Log "Starlink adapter is Up but no internet reachable through it — backing off, not restarting the tunnel service (would just thrash it while the real cause is upstream)."
    exit 0
}

# --- Is the WireGuard service even running? ---
$svc = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
if (-not $svc) {
    Log "Service '$ServiceName' not found. Nothing to watch — has 1-provision-gateway.ps1 been run?"
    exit 1
}
if ($svc.Status -ne 'Running') {
    Log "Service '$ServiceName' is $($svc.Status), not Running — starting it."
    Start-Service -Name $ServiceName
    Add-Content -Path $disconnectsLog -Value (Get-Date).ToUniversalTime().ToString('o')
    exit 0
}

# --- Is the tunnel actually passing traffic? Ping the VPS's tunnel-internal
#     address. A real reply is the only thing Rule 2 accepts as "working". ---
$tunnelPing = Test-Connection -ComputerName $TunnelPeerAddress -Count 3 -Quiet -ErrorAction SilentlyContinue

if ($tunnelPing) {
    Log "Tunnel healthy — $TunnelPeerAddress reachable."
    exit 0
}

Log "Tunnel peer $TunnelPeerAddress unreachable through a Running service — treating as stale, restarting $ServiceName."
Restart-Service -Name $ServiceName -Force
Add-Content -Path $disconnectsLog -Value (Get-Date).ToUniversalTime().ToString('o')

Start-Sleep -Seconds 5
$retryPing = Test-Connection -ComputerName $TunnelPeerAddress -Count 3 -Quiet -ErrorAction SilentlyContinue
if ($retryPing) {
    Log "Restart fixed it — $TunnelPeerAddress reachable again."
} else {
    Log "Still unreachable after restart. Will retry again on next scheduled run. If this repeats across many runs, check the WireGuard config, VPS-side wg-starlink0 status, and NAT/firewall state before assuming it's a Starlink issue."
}
