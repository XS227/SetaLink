# Windows 11 Surface as the Phase 1 Starlink gateway — analysis & plan

**Date:** 2026-07-14 · **Status:** Analysis complete, scripts prepared, **nothing installed, nothing
deployed, no production VPS/routing changes made.**
**Branch:** `feat/starlink-node-phase1` (same isolated worktree as
`docs/STARLINK_NODE_ARCHITECTURE.md` — read that document first, this one only
covers what changes when the gateway device is a Windows 11 Surface instead of
a GL.iNet router or Raspberry Pi).

> Per `docs/CLAUDE_REALINK_RULES.md` Rule 7: no production rollout without
> Khabat's explicit approval. Per Rule 8: this document was written in
> response to an explicit, in-conversation request — not started speculatively.

---

## 1. Verdict

**Yes, technically viable for a Phase 1 proof-of-concept — with one open
question that must be resolved empirically on the actual Surface before the
provisioning script is trusted, not assumed from documentation.**

Windows 11 can do everything the architecture needs (IP forwarding, a
WireGuard peer, NAT/masquerade, a persistent service, firewall scoping,
reconnect recovery). None of it requires WSL2, Docker, or a running VM. But
**which built-in NAT mechanism is actually usable on this specific Surface**
is genuinely ambiguous from documentation alone (see §3) — Microsoft's own
support forums have open, unresolved threads asking the same question for
Windows 11 Home/Pro. So instead of picking one and hoping, §6 ships a
**read-only probe script** that must run on the real hardware first; the
provisioning script then branches on what the probe finds, rather than on an
assumption made from this VPS.

---

## 2. What doesn't change from the existing Phase 1 design

Everything in `docs/STARLINK_NODE_ARCHITECTURE.md` §4 (traffic path), §5
(backend data model, health policy, heartbeat endpoint) is gateway-agnostic —
the VPS-side Xray routing rule and `public/starlink-heartbeat.php` do not
know or care whether the WireGuard peer on the other end is OpenWrt, a
Raspberry Pi, or Windows. **No backend code changes are required for a
Windows gateway.** The only thing that changes is what runs on the gateway
device itself. See §8 for the two small, non-functional VPS-side adjustments
made for this PoC's tighter test limits (still a code-only change, not
deployed).

---

## 3. The core Windows question: how does NAT actually happen?

The path is: VPS Xray → WireGuard tunnel → Windows Surface → **must NAT** →
Starlink Wi-Fi adapter → internet. This is not optional — plain IP forwarding
without NAT would send packets out with a private source address
(`10.90.0.1`, the VPS's tunnel-internal address) that the public internet
cannot route a reply back to. Something on the Surface must translate that
source address to the Starlink Wi-Fi adapter's own address, the same job
`iptables -j MASQUERADE` does on Linux.

Three native (no VM) candidates exist. None can be declared safe purely from
documentation — this is exactly the kind of claim the brief said not to
blindly assume, and the search results below confirm it's a genuinely
contested point, not settled trivia.

| Method | How it works | Real risk |
|---|---|---|
| **ICS** (Internet Connection Sharing) | Decades-old, always present on every Windows edition including Home. You mark the Starlink Wi-Fi adapter "shared" and the WireGuard adapter as the receiving side. | **Likely disqualifying for this design:** ICS does not just NAT — when enabled on the "private" adapter it *takes over that adapter's IP configuration*, forcibly assigning it `192.168.137.1/24` (or a custom scope, via an undocumented, version-dependent registry override) and acting as a DHCP server on it. WireGuard's Windows client sets the tunnel adapter's address itself, statically, from the `.conf` file's `Address=` line, to match what the VPS's `AllowedIPs`/routing table expects (`10.90.0.2`). Two things fighting to own the same adapter's IP is not a config detail to paper over in a proof-of-concept whose whole point is verifying safety. |
| **`New-NetNat`** (WinNAT) | A PowerShell cmdlet that NATs between two subnets without touching either adapter's IP configuration at all — closer in spirit to `iptables MASQUERADE` than ICS is. | The underlying `winnat.sys`/virtual-switch driver is part of the same platform layer Hyper-V and WSL2's NAT networking sit on. Microsoft's own Windows 11 support forum has an open, unresolved thread from a Home-edition user asking how to get this working *without* Hyper-V — meaning on at least some Windows 11 builds/editions, `New-NetNat` is not simply "there." **Important distinction to be explicit about:** if this Surface needs the `VirtualMachinePlatform` optional feature enabled for `New-NetNat` to exist, that enables a NAT *driver component* only — it does not create, start, or require a VM, WSL2 distro, or container to ever run. That is different in kind from what the brief says to avoid, but it is still a real change to flag and get explicit sign-off on, not slip in silently. |
| **RRAS / `netsh routing ip nat`** | The "full" Windows NAT/routing engine ICS itself is built on. | Officially a Windows *Server* role. On client Windows the `RemoteAccess` service exists but the full NAT configuration surface has historically been gated off by SKU checks; enabling it on Windows 11 Pro client relies on unsupported community workarounds. Excluded from Phase 1 for this PoC — too much surface area and uncertainty for a 1-user test. |

**Decision:** try `New-NetNat` first (§6's probe script checks whether it's
already available with zero extra features enabled — this is common on
Windows 11 Pro in practice). If the probe shows it needs
`VirtualMachinePlatform`, that specific, narrow ask goes back to you before
`1-provision-gateway.ps1 -NatMethod WinNAT` touches anything. ICS is kept as
a documented `-NatMethod ICS` fallback path in the same script *only* if
WinNAT proves unavailable and you accept the static-IP conflict risk in §3's
table — the script warns loudly and requires `-AcknowledgeIcsIpConflictRisk`
before proceeding down that path, it will not do it silently.

**Sources consulted (this is a live, evolving area of Windows networking —
verify against current Microsoft documentation before trusting older
threads):**
- [Set up a NAT network — Microsoft Learn](https://learn.microsoft.com/en-us/windows-server/virtualization/hyper-v/setup-nat-network)
- [How to Enable/work with NAT in Windows 11 Home without Hyper-V? — Microsoft Q&A](https://learn.microsoft.com/en-us/answers/questions/2243007/how-to-enable-work-with-network-address-translatio)
- [Windows NAT (WinNAT) — Capabilities and limitations — Microsoft Tech Community](https://techcommunity.microsoft.com/blog/virtualization/windows-nat-winnat----capabilities-and-limitations/382303)

---

## 4. IP forwarding — this part is solid

Unlike NAT, this is well-established and does **not** need RRAS or Hyper-V:

```
HKLM\SYSTEM\CurrentControlSet\Services\Tcpip\Parameters\IPEnableRouter = 1
```

This enables the TCP/IP stack's own packet-forwarding logic across all
interfaces, system-wide — it's been part of Windows since NT/2000, is
independent of RRAS, and only needs a restart of the `Tcpip` binding (or a
reboot) to take effect. `1-provision-gateway.ps1` sets this and records the
prior value so `remove-gateway.ps1` can restore it exactly.

**Sources:**
- [Enable IP Forwarding — Zenlayer Docs](https://docs.console.zenlayer.com/welcome/elastic-compute/get-started/manage-networking/enable-ip-forwarding)
- [How to enable ip routing Windows 11 — GeekChamp](https://geekchamp.com/how-to-enable-ip-routing-windows-11/)

## 5. WireGuard persistence — also solid

`wireguard.exe /installtunnelservice <path-to-conf>` registers the tunnel as
a proper Windows service (`WireGuardTunnel$<name>`), startup type Automatic,
so it survives reboot without any extra scheduled-task wrapper. Verified
against the official WireGuard-for-Windows documentation and independent
write-ups; this is the one component of this whole design with no open
question attached.

**Sources:**
- [wireguard-windows enterprise docs — git.zx2c4.com](https://git.zx2c4.com/wireguard-windows/about/docs/enterprise.md)
- [Autostart WireGuard after Windows reboot](https://vpn.how/en/pages/autostart-wireguard-after-windows-reboot.html)

## 6. Reconnect / watchdog

WireGuard for Windows does not itself retry a stalled handshake indefinitely
under flaky connectivity the way `PersistentKeepalive` handles NAT timeout,
but doesn't recover from — e.g. — the Wi-Fi adapter dropping and
re-associating with a new local IP. A small watchdog is the accepted
community pattern (independently converged on by multiple unrelated
projects, e.g. the `WindowsWireguardWatchdog` PowerShell project found during
research).

**One correction to that reference project's assumption, worth stating
explicitly:** WireGuard for Windows ships only `wireguard.exe`
(`/installtunnelservice`, `/uninstalltunnelservice`, `/dumplog`) — it does
**not** bundle the Linux `wg` CLI, so there is no `wg show
latest-handshakes` to poll on Windows the way the Linux gateway path or
generic watchdog write-ups assume. `watchdog.ps1` (§9) instead pings the
VPS's tunnel-internal address through the tunnel and requires an actual
reply — the same "connected ≠ working" standard
`docs/CLAUDE_REALINK_RULES.md` Rule 2 already applies project-wide, and
arguably a stronger liveness signal than a handshake timestamp anyway. It
runs via a native **Windows Task Scheduler** repeating trigger — deliberately
not via NSSM or any third-party service wrapper, one less binary to trust or
have to remove during rollback.

**Source:** [WindowsWireguardWatchdog — GitHub](https://github.com/irmo-de/WindowsWireguardWatchdog)

## 7. DNS, IPv4/IPv6, firewall — design decisions, not open questions

- **DNS:** the Windows gateway does **no** DNS resolution of its own for
  tunneled traffic — the existing architecture resolves DNS Iran-client-side
  / VPS-side already (this hasn't changed). The provisioning script does not
  touch the Surface's own DNS settings at all.
- **IPv6:** Starlink commonly hands out a real, working, routable IPv6
  prefix — easy to overlook and a real leak risk here: if IPv6 forwarding
  isn't explicitly scoped, tunneled traffic could exit over IPv6 via a path
  that bypasses the allowlisted-UUID containment the whole Phase 1 design
  relies on. `1-provision-gateway.ps1` explicitly disables IPv6 forwarding
  for this PoC (IPv4-only egress) — revisit only as a deliberate future
  decision, not a default.
- **Firewall / no exposed service:** because the Surface *dials out* to the
  VPS (matching the brief's explicit requirement and the existing VPS-side
  design in `deploy/starlink/vps/setup-starlink-wg.sh`, which is
  client-role-agnostic), **no inbound port needs to open on the Surface at
  all** — Starlink's CGNAT is fine, `PersistentKeepalive` keeps the outbound
  NAT mapping alive. `1-provision-gateway.ps1` adds only least-privilege
  outbound-scoped rules plus an explicit inbound-block rule preventing the
  tunnel's internal subnet from reaching the Surface's own local
  services (file sharing, RDP, etc.) — satisfying "block access to internal
  ReaLink infrastructure" and "avoid turning the Surface into a general LAN
  bridge" from the brief.

## 8. VPS-side changes for this PoC (still code-only, not deployed)

Two small adjustments in this same worktree, not yet committed:

1. `lib/starlink.php` seed defaults tightened from the original Phase 1
   defaults (`max_sessions=3`, `allocated_kbps=20000`) to the conservative
   PoC limits requested: **`max_sessions=1`, `allocated_kbps=10000` (10
   Mbps)**. Bump to 3/20000 later via the existing `starlink-update-node`
   admin action once stability is confirmed — no code change needed for that
   step, it's already an admin-panel field.
2. Everything else — the Xray routing rule, the heartbeat endpoint, the
   health-state policy, the admin enable/disable/maintenance controls — is
   unchanged and already gateway-agnostic (§2).

---

## 9. Deliverables (all in `deploy/starlink/gateway/windows/`)

| File | Purpose |
|---|---|
| `0-probe-capabilities.ps1` | **Run first.** Read-only. Reports Windows build, whether WireGuard/`New-NetNat`/ICS/RRAS are present, current `IPEnableRouter` state, adapters, active Wi-Fi. Makes zero changes. |
| `1-provision-gateway.ps1` | Idempotent. Detects the Starlink Wi-Fi adapter (or prompts once), enables IPv4 forwarding, sets up NAT via `-NatMethod WinNAT` (default) or `-NatMethod ICS` (needs explicit risk acknowledgment), least-privilege firewall rules, installs the WireGuard tunnel as a service, registers heartbeat + watchdog as Scheduled Tasks. |
| `heartbeat.ps1` | Posts the same JSON schema the Linux gateway posts to `public/starlink-heartbeat.php` — no backend change needed. Every ~30s via Scheduled Task. Backs off (skips, doesn't crash-loop) when there's no internet at all. |
| `watchdog.ps1` | Checks tunnel liveness by pinging the VPS's tunnel-internal address (WireGuard for Windows has no `wg show`/handshake-age CLI — see §6) + confirms Starlink itself is reachable before acting; restarts the tunnel service only if the tunnel is stale and Starlink is fine. Every ~60s via Scheduled Task. |
| `remove-gateway.ps1` | Full rollback: removes NAT, firewall rules, the WireGuard service, both Scheduled Tasks, restores `IPEnableRouter` to its prior value. |
| `config.template.env` | `node_id=starlink-no-01`, `display_name=Norway Starlink #01`, `node_type=STARLINK`, `role=EXIT_ONLY`, VPS endpoint placeholder, heartbeat-token placeholder. No secrets committed. |
| `wg-starlink-windows.conf.example` | WireGuard peer config template for the Windows side; private key placeholder only. |

---

## 10. Manual steps required from Khabat, in order

1. **Run `0-probe-capabilities.ps1` on the actual Surface** (as
   Administrator) and share the output — this determines whether §3 resolves
   to WinNAT cleanly or needs the `VirtualMachinePlatform` conversation.
2. Confirm the Surface has stable ordinary internet over the Starlink Mini's
   Wi-Fi *before* any of this runs (test plan step 1–2 below).
3. Install WireGuard for Windows from the official source
   (`wireguard.com/install`) if the probe shows it's missing.
4. Review `1-provision-gateway.ps1` and `deploy/starlink/vps/setup-starlink-wg.sh`
   together — same review gate as the OpenWrt/Pi path already had.
5. Tell me which VPS hosts the WireGuard listener (same question as the
   existing Phase 1 doc's step 3 — unchanged by using Windows).
6. I generate the Windows-side WireGuard keypair *on the Surface, via the
   script* (never on this VPS, never committed) and you paste the resulting
   public key into the VPS's `wg-starlink0.conf` peer block, same as the
   OpenWrt/Pi flow.
7. Run `1-provision-gateway.ps1`, then confirm heartbeat + handshake per the
   test plan below.
8. I will not run anything on the Surface myself, obviously — every one of
   these scripts is designed for you to review and execute by hand, exactly
   like the Linux gateway scripts.

## 11. Test plan (mirrors the brief's 19 steps, mapped to concrete commands)

1. Confirm Surface has stable Starlink internet — `ping starlink.com`,
   `Test-NetConnection 8.8.8.8`, ordinary browsing.
2. (same check, explicitly *before* touching anything) — baseline, so any
   later breakage is attributable to this setup, not pre-existing flakiness.
3. Run `0-probe-capabilities.ps1`, then `1-provision-gateway.ps1`.
4. `wg show` on the VPS and on the Surface — confirm a recent handshake
   timestamp on both ends.
5. Admin panel → Starlink tab → confirm `starlink-no-01` shows a fresh
   `last_heartbeat_at` and `tunnel_status=up` within ~90s.
6. Re-run step 1's checks on the Surface — ordinary browsing must still work
   unaffected (confirms `AllowedIPs` on the Windows peer is scoped to the
   tunnel subnet only, not `0.0.0.0/0`, per §7).
7. Admin panel → allowlist exactly one test device's UUID to
   `starlink-no-01` (existing `node-allowlist-add` action, unchanged).
8. On the allowlisted test device, connect and check exit IP (e.g.
   `curl https://api.ipify.org` inside the tunnel) — must resolve to the
   Starlink Mini's public IP, not the VPS's normal egress.
9. On a *different*, non-allowlisted device, confirm it still gets
   `fi-hel`/primary (Finland/Germany) as before — proves containment.
10. Measure throughput/latency/loss (`iperf3` or a speed-test endpoint) and
    Surface CPU (`Get-Counter '\Processor(_Total)\% Processor Time'`) under
    load.
11. Turn off Starlink (or disable its Wi-Fi) for 1–2 minutes.
12. Confirm the admin panel shows `starlink-no-01` transition to
    `DEGRADED` then `OFFLINE` per the existing `st_health_state()` thresholds
    (no code change here — same policy as the Linux path).
13. Confirm the allowlisted test device's traffic falls back to
    primary/Finland automatically (existing `v1_starlink_down()` fail-closed
    logic in `public/v1.php` — already built, gateway-agnostic).
14. Restore Starlink.
15. Confirm `watchdog.ps1` restores the tunnel and heartbeats resume without
    manual intervention.
16. Reboot the Surface.
17. Confirm the WireGuard service and both Scheduled Tasks auto-start and
    the node returns `ONLINE` without you touching the keyboard.
18. Toggle Wi-Fi off/on a few times over a short window — confirms the
    watchdog handles repeated short drops, not just one clean outage.
19. Run `remove-gateway.ps1`, then repeat step 1 — the Surface must return
    to its exact prior network state (no leftover NAT/firewall/forwarding).

**If any of steps 3–9 fail because the chosen NAT method turns out not to
work as documented, stop, report the exact failure, and fall back to the
smallest dedicated hardware option already recommended in
`docs/STARLINK_NODE_ARCHITECTURE.md` §3 (GL.iNet travel router) — do not
paper over a broken forwarding/NAT path with a partial workaround.**
