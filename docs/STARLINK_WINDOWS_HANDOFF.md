# Starlink Windows-gateway WireGuard handshake — agent handoff

**Date:** 2026-07-15 · **Status:** Blocked on an unresolved network-path problem;
production-server audit is INCOMPLETE and is the single most urgent item in
this document. Read section 0 first, then act on it before anything else.

**Read this whole document before touching anything.** It was written so a
fresh agent can continue without asking the user to repeat any of the
investigation below. If you find yourself about to ask "what have we already
tried" or "which server is which," the answer is in here.

---

## 0. URGENT — do this first, before any other work

During this investigation the user was working in a terminal they *believed*
was the Hetzner test box (`fi-hel`, `65.109.183.7`) but was actually connected
to **the production server** (`5.249.252.221`, hostname `vps-5348441`) — see
§2 for how this was discovered. Several diagnostic/debug actions intended for
the disposable test box were very likely executed on production instead:

- An SSH public key (`ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAII6AMoNMFT1zrC9KQcKRxg2Lf4fnetBkNhETP6o/0uO5 vps@shahnameh`, fingerprint `SHA256:J4cdhNQatrk4JIJ9l/G2FaN7z3Gb8GR744FQ7j014zQ`) may have been added to `/root/.ssh/authorized_keys` on production.
- `LogLevel DEBUG3` may have been appended to production's `/etc/ssh/sshd_config` (a backup was requested at `/etc/ssh/sshd_config.bak-debug` if this happened — check whether that backup exists).
- `wireguard-tools` / a `test0` WireGuard interface may have been partially installed on production.

**The user was asked to run the following audit and report back, but no
result was ever received before this handoff was requested. This is
unfinished — do it before anything else:**

```bash
# Run on 5.249.252.221 (production, hostname vps-5348441) — confirm the
# hostname in your prompt matches before running anything.
grep "vps@shahnameh" /root/.ssh/authorized_keys
grep "LogLevel" /etc/ssh/sshd_config
ls -la /etc/ssh/sshd_config.bak-debug 2>/dev/null
which wg; ls /etc/wireguard/ 2>/dev/null
```

Revert whatever is found:
- Key present → `sed -i '/vps@shahnameh/d' /root/.ssh/authorized_keys`
- `LogLevel DEBUG3` present, backup exists → `cp /etc/ssh/sshd_config.bak-debug /etc/ssh/sshd_config && systemctl reload ssh`
- `LogLevel DEBUG3` present, no backup → `sed -i '/LogLevel DEBUG3/d' /etc/ssh/sshd_config && systemctl reload ssh`
- Any `test0` WireGuard artifacts → `systemctl disable --now wg-quick@test0 2>/dev/null; rm -f /etc/wireguard/test0.*`

**Do not consider this investigation "clean" until this audit has actually
been run and confirmed. Nothing else in this document matters as much as
this.**

---

## 1. What this repo/investigation is about

Phase 1 proof-of-concept: adding an optional Starlink-satellite exit node to
ReaLink's VPN, using a Microsoft Surface (Windows) as the temporary gateway
between an isolated WireGuard tunnel and the Starlink Mini's Wi-Fi. Full
design in `docs/STARLINK_NODE_ARCHITECTURE.md` and
`docs/STARLINK_WINDOWS_GATEWAY.md` — read those for the *design*; this
document is about the *current blocked state* of getting a WireGuard
handshake to complete at all.

**Current single blocking problem:** the Windows Surface's WireGuard client
is confirmed actively transmitting handshake/keepalive packets, but the dev
VPS never receives a single one — not even at raw `tcpdump` level on the
network interface. Root cause is not yet proven; leading hypothesis is a
cloud-provider Security Group, but this is NOT confirmed (see §11).

## 2. The three servers involved — do not confuse them again

| Role | IP | Hostname | Provider (verified via `whois`) | My SSH access |
|---|---|---|---|---|
| **Dev/secondary VPS** (this whole worktree lives here) | `5.249.255.116` | `1431514` | One.com (`ONECOM-INFRA`), OpenStack, Copenhagen | Yes, this is the working directory |
| **Production** (real users, DO NOT TOUCH beyond §0/§9) | `5.249.252.221` | `vps-5348441` | One.com (`ONECOM-INFRA`), OpenStack, Copenhagen — **same provider as the dev VPS** | Yes (user has console/SSH access; agent should NOT request persistent access here) |
| **`fi-hel` test box** (Hetzner — the actual A/B test target) | `65.109.183.7` | unknown (never confirmed — SSH never succeeded) | **Hetzner Online GmbH**, Cloud Helsinki (`CLOUD-HEL1`) — genuinely different provider than the other two | **Never established** — every attempt got `Permission denied (publickey,password)`, cause never resolved (see §2.1) |

**Verification trick for next time, so this mix-up can't happen again:** the
host key fingerprint is unique per machine and cannot be spoofed by network
routing. Known-good fingerprints, confirmed this session:
- `fi-hel` (`65.109.183.7`): `SHA256:WDm4ALsbx9MDONKy1PKIKSz8pG5XQdmFlkjm1XjnRIE`
- production (`5.249.252.221`): `SHA256:bXEaqnHLLo8ePtf9r5LZB//1gTAl5Mya23dGf+tOdjA`

Before running *anything* on a box reached via a web console (not `ssh` from
this repo's environment), run `hostname` and cross-check against the table
above. The mix-up happened because a Hetzner Console tab and a
production-server console tab were open at the same time and it wasn't
obvious which was which from the prompt alone until `hostname` was checked.

### 2.1 The unresolved SSH mystery to `fi-hel`

Every SSH attempt to `65.109.183.7` (both `ubuntu` and later `root` user)
failed with `Permission denied (publickey,password)`, **even after**:
- Fingerprint of the offered key independently verified to match exactly
  what was (reportedly) added to `authorized_keys` there
- Permissions/ownership on `~/.ssh` and `authorized_keys` confirmed correct
- `AuthorizedKeysFile`, `AuthorizedKeysCommand` (none), `PermitRootLogin`
  (`without-password`), `AllowUsers`/`DenyUsers` (none) all checked clean
- No `Match` blocks found
- `journalctl`/`auth.log` showed **zero entries** even for a precisely
  timestamped connection attempt that completed a full SSH protocol
  handshake (version exchange, KEX, NEWKEYS, a real `USERAUTH_REQUEST`
  packet) with a consistent host key every single time

**This was never actually resolved** — it's possible (even likely, given §0)
that some or all of the later "fi-hel" troubleshooting in this session was
actually happening on the production box instead, in a different terminal,
which would fully explain why nothing ever seemed to take effect. **Treat
SSH access to the real `65.109.183.7` as still unverified/unestablished.**
Next agent: before spending more time on this exact mystery, first just try
a completely fresh SSH key addition via the Hetzner Console, on a
freshly-opened console tab, immediately verifying `hostname` shows something
consistent with Hetzner/`fi-hel` (not `vps-5348441`) before doing anything
else. If it still fails identically, this is a real, deeper mystery worth
escalating (possibly to Hetzner support, since a completed protocol
handshake with zero server-side log trace is unusual enough that it may be
provider-side).

## 3. Current state — dev VPS (`5.249.255.116`)

- `/etc/wireguard/wg-starlink0.conf`: `Address = 10.90.0.1/30`, `ListenPort = 51820` (switched from `51900` mid-investigation for a port-specific test — both ports are open in `ufw`, see below), `PrivateKey` unique to this box, `[Peer] PublicKey = GLXuEbDhoMUCmhIybFlNKIG+xxY7pRVLDJchDoJqcFo=` (current Windows Surface key), `AllowedIPs = 10.90.0.2/32`.
- Interface is up (`wg-quick@wg-starlink0.service` enabled+active), listening correctly on `0.0.0.0:51820` and `[::]:51820` (verified via `ss -ulnp`).
- `ufw`: both `51900/udp` and `51820/udp` explicitly allowed (both IPv4/IPv6). No conflicting `iptables` rules found (`iptables -S` reviewed in full).
- `sudo wg show wg-starlink0`: **`latest-handshakes` has never been anything but `0` (never), `transfer` has never been anything but `0`/`0`, for the entire session, across every key/port combination tried.**
- `sudo tcpdump -i any udp port 51820` (and separately `-i ens3`), run for 30-35s windows while the Windows Surface was actively sending: **0 packets captured, every time.** This is the single most important piece of evidence — it means packets never arrive at this VM's network interface at all, ruling out anything at the OS/`ufw`/`wg` level on this box.
- This VM's own public IP is confirmed genuinely `5.249.255.116` on all fronts: `ip addr` (bound directly to `ens3` via DHCP), `curl -4 ifconfig.me` (externally-visible IP), and `ip route get 65.109.183.7` (confirms this is the source IP the kernel actually uses for outbound traffic — ruled out the box's separate OpenVPN `tun0` interface as a factor).
- **OpenStack Security Groups are confirmed structurally attached** to this VM via the metadata service itself (`curl http://169.254.169.254/openstack/latest/meta_data.json`, also visible in `cloud-init`'s cached `instance-data.json`): groups named `default` and `1431514.vps.tornado.no`. This is first-party proof the mechanism exists and applies to this instance — not an inference. See §11 for why this is the leading (not yet confirmed) hypothesis.
- The Starlink Phase 1 backend/mobile-app code (unrelated to this specific network problem) is committed on branch `feat/starlink-node-phase1` in this worktree, NOT pushed to GitHub, NOT merged to `main`, NOT deployed to `/var/www/setalink`'s production checkout. Commits: `9fe8c17`, `c3e2515`, `e9c7eff`, `48e7796`, `04b5b5b` (see `git log` in this worktree).

## 4. Current state — production (`5.249.252.221`)

**See §0 — audit not yet confirmed complete.** Beyond that: this box was
never intentionally used for Starlink work until the user explicitly
authorized a narrowly-scoped exception (§9) partway through this session,
specifically:

> "We can use this production server only as an isolated WireGuard handshake
> test. Keep everything separate: interface `test0`, subnet `10.99.0.0/30`,
> UDP port `51820`, no changes to existing ReaLink/Xray routing, NAT,
> Docker, firewall defaults, or production interfaces, no full-tunnel
> routing and no forwarding of user traffic."

As of this handoff, it is **unknown** whether the `test0` interface was ever
actually created here (the mix-up discovery interrupted that work before
confirmation). Check as part of the §0 audit.

**This authorization is scoped narrowly and should not be read as blanket
permission for further production changes.** If you need to do anything on
this box beyond exactly what §9 specifies, stop and get fresh explicit
confirmation from the user first — this is Rule 7 in
`docs/CLAUDE_REALINK_RULES.md`, and it isn't superseded by anything in this
document.

## 5. Current state — `fi-hel` (`65.109.183.7`, Hetzner)

**Unknown / likely never actually reached**, per §2.1. This is the box the
A/B test was supposed to run on (different provider than One.com, to isolate
whether the problem is One.com-specific). No verified diagnostic data exists
from this box — treat anything attributed to "fi-hel" earlier in this
session's history with suspicion unless it's independently re-verified,
since it may actually describe the production box instead.

## 6. Windows Surface (Starlink gateway client) — state is good, not the blocker

- **Windows 10 Pro** (build 19045/22H2) — not Windows 11 as originally
  briefed; doesn't matter functionally, all tooling used is version-agnostic.
- WireGuard for Windows installed at `C:\Program Files\WireGuard\wireguard.exe`.
- Working directory on the Surface: `C:\ReaLink-Starlink-PoC\`.
- Tunnel service is running (`WireGuardTunnel$wg-starlink0` after the
  dynamic-tunnel-name-discovery fix in `1-provision-gateway.ps1` — see §8;
  WireGuard for Windows does not reliably name the installed tunnel after
  the `.conf` filename, this was a real bug that's now fixed).
- NAT confirmed working via `New-NetNat` (WinNAT) — **no Hyper-V/
  `VirtualMachinePlatform` feature needed**, confirmed available out of the
  box on this specific Windows 10 Pro install via the probe script.
- Starlink-facing adapter: `"Wi-Fi"` (Marvell AVASTAR), connected to SSID
  `"Setalink"` (the Starlink Mini's Wi-Fi, custom-named).
- `wg-starlink0.conf` on the Surface: `Address = 10.90.0.2/32`, current
  `PrivateKey` paired with public key `GLXuEbDhoMUCmhIybFlNKIG+xxY7pRVLDJchDoJqcFo=`
  (independently verified this is the genuine derived public key, not a
  stale/wrong one), `[Peer] PublicKey` = the dev VPS's key
  (`bJomDaU1hnz8wsSCXN4FplaP2TclpPQagSzZKnX6RTA=`), `Endpoint` currently
  pointing at whichever server was last being tested (**check and update
  this before resuming** — it was last set to test against the dev VPS on
  port `51820`), `AllowedIPs = 10.90.0.1/32`, `PersistentKeepalive = 25`.
- **Windows's own `wg show` output, last reported by the user:** `transfer:
  sent > 0 (11.27 KiB), received: 0 B`, keepalive firing every 25s. This
  **proves the Surface is actively transmitting** — the failure is not "the
  client never tries," it's "packets never arrive at the far end." Do not
  re-litigate this; it's settled.

## 7. Success criteria

A completed WireGuard handshake between the Windows Surface and *any* test
server: `wg show` on the server side reporting a non-zero `latest
handshake` timestamp and non-zero `received` bytes in `transfer`. That's the
whole bar for this phase — it does **not** include routing real traffic,
Xray integration, or any production rollout, all of which remain separately
gated behind explicit user approval per `docs/CLAUDE_REALINK_RULES.md` Rule 7.

## 8. Exact files in this repo relevant to this work

All under `/root/work/setalink-starlink` (isolated worktree, branch
`feat/starlink-node-phase1`):

- `docs/STARLINK_NODE_ARCHITECTURE.md` — original Phase 1 design (VPS-side, gateway-agnostic)
- `docs/STARLINK_WINDOWS_GATEWAY.md` — Windows-gateway-specific design/analysis, NAT method decision record
- `docs/STARLINK_WINDOWS_HANDOFF.md` — this document
- `deploy/starlink/vps/setup-starlink-wg.sh` — generates the VPS-side WireGuard keypair/config (already run once on the dev VPS; would need adapting or manual mirroring for a fresh `fi-hel` deployment)
- `deploy/starlink/gateway/windows/0-probe-capabilities.ps1` — read-only Windows capability probe, ASCII-clean, already proven working
- `deploy/starlink/gateway/windows/1-provision-gateway.ps1` — main Windows provisioning script, includes the dynamic-tunnel-name-discovery fix (§6), ASCII-clean, proven working through the "service running" stage
- `deploy/starlink/gateway/windows/{heartbeat,watchdog,remove-gateway}.ps1` — not yet exercised in anger (heartbeat endpoint was never deployed, see `docs/STARLINK_WINDOWS_GATEWAY.md` — deferred pending tunnel verification, still deferred)
- `deploy/starlink/gateway/windows/wg-starlink-windows.conf.example` — template, ASCII-clean
- `lib/starlink.php`, `public/starlink-heartbeat.php`, `admin/api.php`/`admin/index.php` diffs — backend, untouched by this network investigation, not deployed anywhere live

**Important lesson learned this session, applies to any new files you write
for this work:** every `.ps1`/`.conf` file handed to the Windows Surface
MUST be pure ASCII (no em-dashes, no smart quotes, no `§`). Non-ASCII bytes
get corrupted when Windows PowerShell 5.1 misreads UTF-8-without-BOM as the
system codepage, producing exactly the kind of "unexpected token" parser
errors that cost significant time earlier in this session. Verify with
`grep -cP '[^\x00-\x7F]' <file>` before handing anything to the Windows side
— it should always print `0`.

## 9. Rollback instructions

**Dev VPS (`5.249.255.116`):** this is the intended long-term home for
Phase 1, not something to roll back — but if needed: `systemctl disable
--now wg-quick@wg-starlink0`, `ufw delete allow 51900/udp`, `ufw delete
allow 51820/udp` (both v4 and v6 variants), remove
`/etc/wireguard/wg-starlink0.conf`.

**Production (`5.249.252.221`):** complete §0 first. If a `test0` interface
was set up under the §9-authorized exception and is no longer needed:
```bash
systemctl disable --now wg-quick@test0
iptables -D INPUT -p udp --dport 51820 -j ACCEPT
rm -f /etc/wireguard/test0.conf /etc/wireguard/test0.key /etc/wireguard/test0.pub
```

**Windows Surface:** `deploy/starlink/gateway/windows/remove-gateway.ps1`
reverses everything `1-provision-gateway.ps1` did (NAT, firewall rule,
WireGuard service, both Scheduled Tasks, `IPEnableRouter`), reading
`gateway-state.json` to know exactly what to undo. Not yet exercised this
session but written and reviewed.

## 10. Risks and assumptions

- **The production audit (§0) being incomplete is the top risk right now** —
  worse than the original networking problem, because it involves a live
  box serving real, potentially at-risk users (Iran-focused anti-censorship
  VPN). Resolve this before anything else, regardless of how close you feel
  to solving the handshake mystery.
- Assume nothing about "fi-hel" state from before this handoff is reliable
  — re-verify via host-key fingerprint (§2) before trusting any of it.
- The One.com Security Group hypothesis (§11) is **not confirmed** — don't
  present it to the user as settled fact. It's the best-supported hypothesis
  given the evidence, not a proven conclusion.
- Any further production changes beyond exactly what §9 authorized require
  fresh explicit user sign-off — do not extend scope based on momentum.

## 11. Hypotheses — ranked, with what's already ruled out

| # | Hypothesis | Status | Confidence |
|---|---|---|---|
| 1 | **OpenStack Neutron Security Group** (One.com) silently dropping inbound UDP before it reaches the dev VPS's NIC | **Not confirmed — leading hypothesis.** Security groups structurally proven attached (§3); every guest-OS-level explanation has been individually ruled out (see below); zero packets at raw `tcpdump` is exactly the signature of hypervisor-layer filtering. **Untested: actually adding a security-group rule and re-checking** — this is the single test that would confirm or kill this hypothesis outright, and it hasn't been done because access to a genuinely independent second box (`fi-hel`) to compare against was never established. | ~65% |
| 2 | **Starlink/ISP-side egress filtering** of this specific flow, before it leaves Starlink's network at all | **Not tested.** "Windows sent bytes" only proves local transmission, not internet-wide delivery. The proposed test (`Test-NetConnection -ComputerName 8.8.8.8 -Port 53` from the Surface, checking whether arbitrary outbound UDP works at all) was suggested twice in this session but **results were never reported back** — this is a cheap, fast, non-production-touching test worth running early. | ~20% |
| 3 | Leftover software on the Windows Surface (old OpenVPN Connect install, TAP/DCO adapters present but disconnected) interfering post-transfer-counter | Not investigated further at the user's request (focus stayed server-side) | ~5% |
| 4 | Neutron port-security / anti-spoofing rule | Structurally present in OpenStack generally but this mechanism is about anti-spoofing the VM's own *outbound* source address, weak fit for *inbound* filtering; not independently checkable from inside the guest | ~5% |
| 5 | Something local to the dev VPS's own network stack (Docker, stray routes) | **Largely ruled out** — `iptables -S`, `ip route`, `ip rule` all reviewed, nothing found | ~5% |

**Definitively ruled out this session** (don't re-investigate these):
- Wrong WireGuard keys — verified byte-for-byte, both directions, multiple times, including deriving public keys directly from private key files (`ssh-keygen`-equivalent via `wg pubkey`) rather than trusting `.pub` files
- Wrong endpoint IP/port — verified via `ip addr`, `curl -4 ifconfig.me`, and `ip route get`
- Windows not actually transmitting — disproven by Windows's own `wg show` sent-byte counter
- `ufw`/`iptables` misconfiguration on the dev VPS — reviewed in full, correct
- `fail2ban` interference — only watches `sshd`, nothing banned
- Docker interference on the dev VPS — reviewed, unrelated
- DNS issues — endpoint is a literal IP throughout, no DNS involved
- Local policy routing on the dev VPS — `ip rule`/`ip route` clean

## 12. Step-by-step plan from here

1. **Complete §0 (production audit/revert). Do not skip this.**
2. Run Test A from hypothesis #2 (§11) — cheap, fast, rules in/out the
   Starlink/ISP path independent of anything provider-specific:
   ```powershell
   Test-NetConnection -ComputerName 8.8.8.8 -Port 53
   ```
   on the Windows Surface. Report the result before proceeding.
3. Get **genuinely verified** access to `fi-hel` (`65.109.183.7`):
   - Open a fresh Hetzner Cloud Console tab for that specific server
   - Run `hostname` immediately, confirm it's NOT `vps-5348441`
   - Add the SSH key (`ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAII6AMoNMFT1zrC9KQcKRxg2Lf4fnetBkNhETP6o/0uO5 vps@shahnameh`) to `/root/.ssh/authorized_keys`
   - Verify from this repo's environment: `ssh root@65.109.183.7 hostname`, and cross-check the host key fingerprint matches `SHA256:WDm4ALsbx9MDONKy1PKIKSz8pG5XQdmFlkjm1XjnRIE`
4. Deploy a clean WireGuard listener on `fi-hel` (script in §12a below).
5. On the Windows Surface, change only `Endpoint` in `wg-starlink0.conf` to
   `65.109.183.7:<port>`, restart `WireGuardTunnel$wg-starlink0`.
6. Check `wg show test0` on `fi-hel`, plus a `tcpdump` capture there for
   good measure (same method as §3).
7. **If handshake succeeds on `fi-hel`:** One.com is isolated as the cause.
   Next step is contacting One.com (support, or their VPS control panel's
   Security Group section if one exists) to open the relevant UDP port for
   the dev VPS — this is a conversation with the user, not something to do
   unilaterally. Then re-point the Surface back at the dev VPS and confirm
   the handshake works there too before considering this phase done.
8. **If handshake fails on `fi-hel` too:** this rules out One.com entirely
   and points at the Starlink/Windows path (hypothesis #2/#3). Escalate
   investigation there — packet capture at the point closest to the Surface
   possible, checking Starlink's own router admin interface if accessible,
   or trying yet another destination port in case of narrow ISP-side
   filtering.
9. **Regardless of outcome, do not proceed to Xray routing rule changes or
   any production rollout** without stopping and getting explicit, fresh
   confirmation from the user — that's a distinctly separate, higher-stakes
   step gated by Rule 7, not an automatic continuation of "the tunnel works
   now."

### 12a. Clean `fi-hel` WireGuard listener setup script

```bash
systemctl stop wg-quick@test0 2>/dev/null
rm -f /etc/wireguard/test0.conf /etc/wireguard/test0.key /etc/wireguard/test0.pub
which wg >/dev/null 2>&1 || (apt-get update && apt-get install -y wireguard-tools)
wg genkey | tee /etc/wireguard/test0.key | wg pubkey > /etc/wireguard/test0.pub
PRIVKEY=$(cat /etc/wireguard/test0.key)
cat > /etc/wireguard/test0.conf <<EOF
[Interface]
Address = 10.99.0.1/30
ListenPort = 51820
PrivateKey = ${PRIVKEY}

[Peer]
PublicKey = GLXuEbDhoMUCmhIybFlNKIG+xxY7pRVLDJchDoJqcFo=
AllowedIPs = 10.99.0.2/32
EOF
grep "^PrivateKey" /etc/wireguard/test0.conf
systemctl enable --now wg-quick@test0
ufw allow 51820/udp 2>/dev/null || iptables -I INPUT -p udp --dport 51820 -j ACCEPT
wg show test0
```
Reuses the Surface's current public key (`GLXuEbDhoMUCmhIybFlNKIG+xxY7pRVLDJchDoJqcFo=`) — no Windows-side key regeneration needed, only the `Endpoint` changes there. If the Surface's key has changed since this document was written, check §6 for the current value or ask the user.
