#Requires -RunAsAdministrator
<#
.SYNOPSIS
    Starlink gateway — Phase 2 self-registration (Windows).

.DESCRIPTION
    Replaces the manual "admin tells you the VPS's WireGuard endpoint +
    public key, you paste it into wg-starlink0.conf" step with one call:
    given a one-time enrollment token (from the admin panel's "Create
    enrollment token" action), this generates a local WireGuard keypair (if
    one doesn't already exist), registers with the backend, and writes BOTH
    wg-starlink0.conf and gateway.env (heartbeat.ps1's config file) — so
    heartbeat.ps1 and 1-provision-gateway.ps1 run completely unchanged
    afterward, exactly as if a human had typed in the values by hand.

    Phase 1's manual path (hand-editing wg-starlink-windows.conf.example)
    still works exactly as before — this is an additional, optional path.

    Requires wg.exe alongside wireguard.exe (ships with recent WireGuard for
    Windows installers, same wireguard-nt driver generation that
    1-provision-gateway.ps1 already assumes). If it's missing, this script
    stops with a clear message rather than silently falling back to the GUI
    key-generation flow that caused the I-vs-l transcription error earlier
    in this project's history (see docs/STARLINK_WINDOWS_HANDOFF.md).

    NOT exercised against real hardware — this VPS has no Windows box to
    test against. Review before running on the actual Surface.

.PARAMETER EnrollmentToken
    The one-time token from the admin panel.

.PARAMETER VpsApiUrl
    e.g. https://api.setalink.no/starlink-enroll.php
#>

[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$EnrollmentToken,

    [Parameter(Mandatory = $true)]
    [string]$VpsApiUrl,

    [string]$TunnelConfigPath = (Join-Path $PSScriptRoot 'wg-starlink0.conf'),
    [string]$GatewayEnvPath   = (Join-Path $PSScriptRoot 'gateway.env')
)

$ErrorActionPreference = 'Stop'

function Write-Step($msg) { Write-Host "`n==> $msg" -ForegroundColor Cyan }
function Write-Ok($msg)   { Write-Host "    OK: $msg" -ForegroundColor Green }

Write-Step "Locating WireGuard"
$wg = Get-Command 'wireguard.exe' -ErrorAction SilentlyContinue
$wgPath = if ($wg) { Split-Path $wg.Source -Parent } else { "$env:ProgramFiles\WireGuard" }
$wgToolExe = Join-Path $wgPath 'wg.exe'
if (-not (Test-Path $wgToolExe)) {
    throw "wg.exe not found at $wgToolExe. This script needs it to generate a keypair the same way the Linux gateway does (wg genkey/wg pubkey) -- generating via the WireGuard GUI instead risks the exact transcription error (I vs l) already hit once in this project (see docs/STARLINK_WINDOWS_HANDOFF.md section 6/13). Update WireGuard for Windows to a version that ships wg.exe, or generate the keypair via the GUI and use the Phase 1 manual path instead."
}
Write-Ok "Found: $wgToolExe"

Write-Step "Generating (or reusing) a local WireGuard keypair"
$keyDir = Join-Path $PSScriptRoot '.wg-keys'
New-Item -ItemType Directory -Path $keyDir -Force | Out-Null
$privKeyFile = Join-Path $keyDir 'privatekey'
$pubKeyFile  = Join-Path $keyDir 'publickey'

if (-not (Test-Path $privKeyFile)) {
    $privateKey = & $wgToolExe genkey
    Set-Content -Path $privKeyFile -Value $privateKey -NoNewline
    $publicKey = $privateKey | & $wgToolExe pubkey
    Set-Content -Path $pubKeyFile -Value $publicKey -NoNewline
    Write-Ok "Generated a new keypair (private key never leaves $keyDir)."
} else {
    Write-Ok "Reusing existing keypair at $privKeyFile."
}
$privateKey = (Get-Content $privKeyFile -Raw).Trim()
$publicKey  = (Get-Content $pubKeyFile  -Raw).Trim()

Write-Step "Calling $VpsApiUrl to self-register"
$body = @{ wg_public_key = $publicKey; platform = 'windows' } | ConvertTo-Json -Compress
try {
    $resp = Invoke-RestMethod -Uri $VpsApiUrl -Method Post `
        -Headers @{ Authorization = "Bearer $EnrollmentToken" } `
        -ContentType 'application/json' -Body $body -TimeoutSec 10
} catch {
    $errBody = $null
    try { $errBody = ($_.ErrorDetails.Message | ConvertFrom-Json).error } catch {}
    throw "Enrollment request failed: $($_.Exception.Message)$(if ($errBody) { " -- server said: $errBody" })"
}
if (-not $resp.ok) {
    throw "Enrollment failed: $($resp.error)"
}
Write-Ok "Registered as $($resp.node_id)"

if (-not $resp.vps_wg_endpoint -or -not $resp.vps_wg_public_key) {
    Write-Warning "Server did not return vps_wg_endpoint/vps_wg_public_key (STARLINK_WG_ENDPOINT / STARLINK_WG_PUBLIC_KEY env vars not set on the VPS yet). Node identity + heartbeat token ARE registered below, but you still need to fill in the [Peer] section of $TunnelConfigPath by hand, same as the Phase 1 manual path."
}

Write-Step "Writing $TunnelConfigPath"
$vpsEndpoint  = if ($resp.vps_wg_endpoint)   { $resp.vps_wg_endpoint }   else { 'REPLACE_ME_VPS_IP:PORT' }
$vpsPublicKey = if ($resp.vps_wg_public_key) { $resp.vps_wg_public_key } else { 'REPLACE_ME_VPS_PUBLIC_KEY' }
@"
[Interface]
Address = 10.99.0.2/30
PrivateKey = $privateKey

[Peer]
PublicKey = $vpsPublicKey
Endpoint = $vpsEndpoint
AllowedIPs = 0.0.0.0/0
PersistentKeepalive = 25
"@ | Set-Content -Path $TunnelConfigPath
Write-Ok "Wrote $TunnelConfigPath -- ready for 1-provision-gateway.ps1 (unchanged) to pick up."

Write-Step "Writing $GatewayEnvPath"
$heartbeatUrl = $VpsApiUrl -replace 'starlink-enroll\.php$', 'starlink-heartbeat.php'
@"
VPS_API_URL=$heartbeatUrl
NODE_ID=$($resp.node_id)
HEARTBEAT_TOKEN=$(($resp.heartbeat_token -split ':', 2)[1])
"@ | Set-Content -Path $GatewayEnvPath
Write-Ok "Wrote $GatewayEnvPath -- heartbeat.ps1 (unchanged) will pick this up automatically."

Write-Host "`n== Next step ==" -ForegroundColor Cyan
Write-Host "Run .\1-provision-gateway.ps1 now -- it will find $TunnelConfigPath already filled in and proceed exactly as the Phase 1 manual path does from here (NAT, firewall rules, service install, scheduled heartbeat task)."
