#Requires -RunAsAdministrator
<#
.SYNOPSIS
    Fully reverses 1-provision-gateway.ps1. Returns this Surface to its
    network state from before the Starlink gateway PoC.

.DESCRIPTION
    Reads gateway-state.json (written by 1-provision-gateway.ps1) to know
    exactly what to undo, rather than guessing. Removes NAT, firewall rules,
    the WireGuard tunnel service, both Scheduled Tasks, and restores
    IPEnableRouter to its prior value. Does not touch the VPS.
#>

[CmdletBinding()]
param(
    [string]$StateFile = (Join-Path $PSScriptRoot 'gateway-state.json')
)

function Write-Step($msg) { Write-Host "`n==> $msg" -ForegroundColor Cyan }
function Write-Ok($msg)   { Write-Host "    OK: $msg" -ForegroundColor Green }

if (-not (Test-Path $StateFile)) {
    throw "State file not found at $StateFile — nothing recorded to undo. If you provisioned manually or the file was deleted, undo each step from docs/STARLINK_WINDOWS_GATEWAY.md section 9 by hand."
}
$state = Get-Content $StateFile -Raw | ConvertFrom-Json

Write-Step "Stopping and removing Scheduled Tasks"
foreach ($task in @('ReaLink-Starlink-Heartbeat', 'ReaLink-Starlink-Watchdog')) {
    if (Get-ScheduledTask -TaskName $task -ErrorAction SilentlyContinue) {
        Unregister-ScheduledTask -TaskName $task -Confirm:$false
        Write-Ok "Removed task '$task'."
    } else {
        Write-Ok "Task '$task' not present — nothing to do."
    }
}

Write-Step "Uninstalling the WireGuard tunnel service"
if ($state.WireGuardServiceName) {
    $wg = Get-Command 'wireguard.exe' -ErrorAction SilentlyContinue
    $wgExe = if ($wg) { $wg.Source } else { $null }
    if (-not $wgExe) {
        $fallback = "$env:ProgramFiles\WireGuard\wireguard.exe"
        if (Test-Path $fallback) { $wgExe = $fallback }
    }
    if ($wgExe -and $state.TunnelConfigPath) {
        $tunnelName = [System.IO.Path]::GetFileNameWithoutExtension($state.TunnelConfigPath)
        & $wgExe /uninstalltunnelservice $tunnelName
        Write-Ok "Uninstalled tunnel service for '$tunnelName'."
    } else {
        Write-Host "    Could not locate wireguard.exe or tunnel name — remove the service manually: Services.msc -> $($state.WireGuardServiceName)" -ForegroundColor Yellow
    }
}

Write-Step "Removing NAT"
if ($state.NatMethod -eq 'WinNAT' -and $state.NatObjectName) {
    if (Get-NetNat -Name $state.NatObjectName -ErrorAction SilentlyContinue) {
        Remove-NetNat -Name $state.NatObjectName -Confirm:$false
        Write-Ok "Removed WinNAT object '$($state.NatObjectName)'."
    }
} elseif ($state.NatMethod -eq 'ICS') {
    try {
        $hnet = New-Object -ComObject HNetCfg.HNetShare
        foreach ($conn in $hnet.EnumEveryConnection) {
            $props = $hnet.NetConnectionProps.Invoke($conn)
            if ($props.Name -eq $state.StarlinkAdapterName -or $props.Name -eq $state.TunnelAdapterName) {
                $hnet.INetSharingConfigurationForINetConnection.Invoke($conn).DisableSharing()
            }
        }
        Write-Ok "Disabled ICS sharing on both adapters."
    } catch {
        Write-Host "    Could not disable ICS via COM automation: $($_.Exception.Message). Disable manually: Network Connections -> $($state.StarlinkAdapterName) -> Properties -> Sharing tab." -ForegroundColor Yellow
    }
}

Write-Step "Removing firewall rules"
foreach ($ruleName in $state.FirewallRuleNames) {
    if (Get-NetFirewallRule -DisplayName $ruleName -ErrorAction SilentlyContinue) {
        Remove-NetFirewallRule -DisplayName $ruleName
        Write-Ok "Removed rule '$ruleName'."
    }
}

Write-Step "Restoring IPEnableRouter"
$fwdKey = 'HKLM:\SYSTEM\CurrentControlSet\Services\Tcpip\Parameters'
Set-ItemProperty -Path $fwdKey -Name IPEnableRouter -Value $state.PriorIPEnableRouter -Type DWord
Write-Ok "IPEnableRouter restored to $($state.PriorIPEnableRouter) (was 1 during the PoC). A reboot fully clears forwarding state."

Write-Step "Done"
Write-Host "Recommend a reboot to fully clear IP forwarding and any lingering adapter state." -ForegroundColor Cyan
Write-Host "State file kept at $StateFile for reference — delete manually once you've confirmed the rollback." -ForegroundColor Cyan
