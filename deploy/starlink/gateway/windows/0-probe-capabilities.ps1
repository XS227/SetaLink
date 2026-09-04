#Requires -RunAsAdministrator
<#
.SYNOPSIS
    Read-only capability probe for the Windows Starlink gateway PoC.

.DESCRIPTION
    Makes NO changes to this machine. Run this FIRST, on the actual Surface,
    before trusting any assumption in docs/STARLINK_WINDOWS_GATEWAY.md.
    Paste the printed report (and probe-result.json) back before anyone runs
    1-provision-gateway.ps1 -- the NAT method that script uses depends on
    what this probe finds, not on documentation written on a different box.

    See docs/STARLINK_WINDOWS_GATEWAY.md section 3 for why this matters:
    whether New-NetNat is usable without enabling any Hyper-V-adjacent
    feature is genuinely ambiguous from documentation alone and varies by
    Windows edition/build.
#>

[CmdletBinding()]
param()

$ErrorActionPreference = 'Continue'
$report = [ordered]@{}

# --- OS ---
$os = Get-CimInstance Win32_OperatingSystem
$report.WindowsCaption   = $os.Caption
$report.WindowsBuild     = $os.BuildNumber
$report.WindowsVersion   = $os.Version
$report.Architecture     = $os.OSArchitecture
$report.ProbeRunAtUtc    = (Get-Date).ToUniversalTime().ToString('o')

# --- WireGuard ---
$wg = Get-Command 'wireguard.exe' -ErrorAction SilentlyContinue
if (-not $wg) {
    # Not always on PATH -- check the default install location too.
    $defaultPath = "$env:ProgramFiles\WireGuard\wireguard.exe"
    if (Test-Path $defaultPath) { $wg = Get-Item $defaultPath }
}
$report.WireGuardInstalled = [bool]$wg
$report.WireGuardPath      = if ($wg) { if ($wg.Source) { $wg.Source } else { $wg.FullName } } else { $null }

# --- NAT candidates ---
$report.NetNatCmdletAvailable = [bool](Get-Command New-NetNat -ErrorAction SilentlyContinue)
try {
    $existingNat = @(Get-NetNat -ErrorAction Stop | Select-Object Name, InternalIPInterfaceAddressPrefix)
    $report.ExistingNetNat = $existingNat
} catch {
    $report.ExistingNetNat = @()
}

# Informational only -- this probe does NOT enable anything.
try {
    $vmp = Get-WindowsOptionalFeature -Online -FeatureName VirtualMachinePlatform -ErrorAction Stop
    $report.VirtualMachinePlatformState = $vmp.State
} catch {
    $report.VirtualMachinePlatformState = 'unknown (Get-WindowsOptionalFeature failed -- may be Home edition or restricted)'
}
try {
    $hv = Get-WindowsOptionalFeature -Online -FeatureName Microsoft-Hyper-V-All -ErrorAction Stop
    $report.HyperVAllState = $hv.State
} catch {
    $report.HyperVAllState = 'unknown (Get-WindowsOptionalFeature failed -- may be Home edition or restricted)'
}

# ICS / Shared Access
$sharedAccess = Get-Service SharedAccess -ErrorAction SilentlyContinue
$report.SharedAccessServiceStatus    = $sharedAccess.Status
$report.SharedAccessServiceStartType = $sharedAccess.StartType

# RRAS (checked for completeness -- Phase 1 excludes this path, see doc section 3)
$remoteAccess = Get-Service RemoteAccess -ErrorAction SilentlyContinue
$report.RemoteAccessServiceStatus = $remoteAccess.Status

# --- IP forwarding current state (so provisioning can restore it exactly) ---
$fwd = Get-ItemProperty -Path 'HKLM:\SYSTEM\CurrentControlSet\Services\Tcpip\Parameters' -Name IPEnableRouter -ErrorAction SilentlyContinue
$report.IPEnableRouterCurrent = if ($null -ne $fwd) { $fwd.IPEnableRouter } else { 'not set (defaults to 0/disabled)' }

# --- Adapters (to help pick the Starlink Wi-Fi adapter by name) ---
$adapters = Get-NetAdapter | Select-Object Name, InterfaceDescription, Status, MediaType, ifIndex
$report.Adapters = $adapters

# --- Active Wi-Fi (best-effort identification of the Starlink SSID) ---
try {
    $report.WlanInterfaces = (netsh wlan show interfaces) -join "`n"
} catch {
    $report.WlanInterfaces = 'netsh wlan not available'
}

# --- Windows Firewall profile state (informational) ---
$report.FirewallProfiles = Get-NetFirewallProfile | Select-Object Name, Enabled, DefaultOutboundAction, DefaultInboundAction

Write-Host "`n===== Starlink Windows Gateway -- Capability Probe =====`n" -ForegroundColor Cyan
$report.GetEnumerator() | ForEach-Object {
    Write-Host "$($_.Key):" -ForegroundColor Yellow
    $_.Value | Format-List | Out-String | Write-Host
}

$jsonPath = Join-Path $PSScriptRoot 'probe-result.json'
$report | ConvertTo-Json -Depth 6 | Out-File -FilePath $jsonPath -Encoding utf8
Write-Host "`nFull report written to $jsonPath" -ForegroundColor Green
Write-Host "Paste this file's contents back before running 1-provision-gateway.ps1." -ForegroundColor Green

if (-not $report.WireGuardInstalled) {
    Write-Warning "WireGuard for Windows is not installed. Install it from https://www.wireguard.com/install/ before continuing."
}
if (-not $report.NetNatCmdletAvailable) {
    Write-Warning "New-NetNat is not available on this system as-is. See docs/STARLINK_WINDOWS_GATEWAY.md section 3 -- this determines whether -NatMethod WinNAT can be used, or whether the VirtualMachinePlatform / ICS conversation is needed."
}
