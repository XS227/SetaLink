# Starlink gateway — Windows 11 (Microsoft Surface), Phase 1 PoC only

Temporary gateway option for the proof-of-concept test period, using a
Microsoft Surface running Windows 11 instead of the GL.iNet/Raspberry Pi
options in `deploy/starlink/gateway/`. **Read
`docs/STARLINK_WINDOWS_GATEWAY.md` in full before running anything here** —
it explains why NAT method selection needs to be verified on the real
hardware rather than assumed, and covers DNS/IPv4-IPv6/firewall decisions
these scripts implement.

The long-term gateway may later move to GL.iNet/OpenWrt, a Raspberry Pi, or
a Linux mini-PC — nothing on the VPS side or in the backend changes when
that happens (see `docs/STARLINK_WINDOWS_GATEWAY.md` section 2). This is
intentionally a portable proof-of-concept, not a redesign around Windows.

## Prerequisites

- **Windows 11**, any edition with the built-in Windows PowerShell 5.1
  (every edition has this — no separate install). All scripts here are
  written for 5.1 specifically (no `??`, no `?:` ternary, no `&&`/`||`
  pipeline chains — those are PowerShell 7+-only syntax); nothing here
  requires installing PowerShell 7/pwsh.
- **Administrator** privileges for every script except none — all five
  scripts (`0-probe-capabilities.ps1` through `remove-gateway.ps1`) declare
  `#Requires -RunAsAdministrator` and will refuse to run otherwise (they
  touch the registry, firewall, NAT, services, and Scheduled Tasks).
- **WireGuard for Windows**, official build from
  <https://www.wireguard.com/install/> — not the Store version, the standard
  MSI installer (needed for `wireguard.exe /installtunnelservice`).
- **No Windows optional features need enabling up front.** If
  `0-probe-capabilities.ps1` shows `New-NetNat` unavailable and
  `VirtualMachinePlatformState: Disabled`, that's a decision point to bring
  back to Khabat before enabling anything — see
  `docs/STARLINK_WINDOWS_GATEWAY.md` section 3. Nothing in this folder
  enables a Windows feature automatically.

## Order of operations

1. Install WireGuard for Windows from <https://www.wireguard.com/install/>
   if not already present.
2. **`0-probe-capabilities.ps1`** (as Administrator) — read-only, makes no
   changes. Share the output before proceeding; it determines which NAT
   method (`WinNAT` or `ICS`) is actually usable on this Surface.
3. Copy `wg-starlink-windows.conf.example` to `wg-starlink0.conf`, fill in
   the VPS's public key and endpoint (from
   `deploy/starlink/vps/setup-starlink-wg.sh`'s output) and this machine's
   generated private key. **Never commit `wg-starlink0.conf` once the
   private key is filled in.**
4. Copy `config.template.env` to `gateway.env`, fill in `VPS_API_URL` and
   `HEARTBEAT_TOKEN` (generated once via the admin panel's Starlink tab,
   "Generate heartbeat token" for `starlink-no-01`). **Never commit
   `gateway.env`.**
5. **`1-provision-gateway.ps1`** (as Administrator) — see the script's own
   `Get-Help` comment block for parameters. Default `-NatMethod WinNAT`;
   use `-NatMethod ICS -AcknowledgeIcsIpConflictRisk` only if the probe
   shows WinNAT unavailable and you've read and accept the risk described
   in `docs/STARLINK_WINDOWS_GATEWAY.md` section 3.
6. Paste this machine's generated public key (printed by step 5) into the
   VPS's `wg-starlink0.conf` `[Peer]` block, then on the VPS:
   `systemctl enable --now wg-quick@wg-starlink0`, apply the Xray
   `starlink-exit` outbound snippet, `xray -test -config ...`,
   `systemctl restart xray`.
7. In the admin panel's Starlink tab: paste the same `vless_uuid` used in
   the Xray routing rule into `starlink-no-01`'s config (`starlink-update-node`
   action), and confirm the node shows `ONLINE` within ~90s of the heartbeat
   task's first run.
8. Follow the full test procedure in `docs/STARLINK_WINDOWS_GATEWAY.md`
   section 11 before allowlisting any real test device.

## What runs continuously

Two Scheduled Tasks, both registered by step 5, both starting automatically
at boot:

- **`ReaLink-Starlink-Heartbeat`** (`heartbeat.ps1`, every ~33s) — posts
  status to `public/starlink-heartbeat.php`. Logs to `logs/heartbeat.log`.
- **`ReaLink-Starlink-Watchdog`** (`watchdog.ps1`, every ~60s) — restarts
  the WireGuard service if the tunnel stops actually passing traffic (pings
  the VPS's tunnel-internal address; a Running service alone isn't treated
  as "working" — see `docs/CLAUDE_REALINK_RULES.md` Rule 2). Logs to
  `logs/watchdog.log` and `logs/disconnects.log`.

Plus the WireGuard tunnel itself, installed as a normal Windows service
(`WireGuardTunnel$wg-starlink0`), startup type Automatic.

## Rollback

**`remove-gateway.ps1`** — reads `gateway-state.json` (written by
`1-provision-gateway.ps1`) and reverses every change it made: NAT, firewall
rules, the WireGuard service, both Scheduled Tasks, and `IPEnableRouter`.
Reboot afterward to fully clear forwarding state.

## Files in this folder

| File | Committed? | Purpose |
|---|---|---|
| `0-probe-capabilities.ps1` | yes | Read-only capability check — run first. |
| `1-provision-gateway.ps1` | yes | Main provisioning script. |
| `heartbeat.ps1` | yes | Health telemetry agent. |
| `watchdog.ps1` | yes | Tunnel liveness watchdog. |
| `remove-gateway.ps1` | yes | Full rollback. |
| `config.template.env` | yes | Copy to `gateway.env` and fill in — `gateway.env` itself is never committed. |
| `wg-starlink-windows.conf.example` | yes | Copy to `wg-starlink0.conf` and fill in — never commit once the private key is added. |
| `gateway.env`, `wg-starlink0.conf`, `gateway-state.json`, `probe-result.json`, `logs/` | **no** | Generated on the actual Surface at provisioning time; contain secrets or machine-specific state. |
