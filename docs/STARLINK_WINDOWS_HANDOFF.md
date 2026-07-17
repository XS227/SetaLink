# Starlink Windows-gateway WireGuard handshake — agent handoff

**Date:** 2026-07-15 · **Status:** ~~Blocked on an unresolved network-path problem~~
**RESOLVED 2026-07-16 — root cause proven, see §13.** The §0 production audit
is complete and clean.
**2026-07-17 — see §21/§22: the remaining Windows ICS `0x80040201` issue is
classified as an isolated OS-specific blocker, not a project blocker. Windows
Surface = controlled internal testing only. Linux gateway (Raspberry Pi) is
now the primary path — see docs/NODE_CONSOLE_ARCHITECTURE.md.**

---

## 13. 2026-07-16 — Investigation resolved (Agent A, from the production box)

Everything below was verified by controlled experiment, not inference.

1. **§0 production audit: DONE, clean.** On `5.249.252.221`: no
   `vps@shahnameh` key in `/root/.ssh/authorized_keys`, no `LogLevel DEBUG3`
   (only the stock commented line), no backup file. The `test0` interface DID
   exist (active since 2026-07-14, never received a handshake, and its peer
   key was a stale one — not the Surface's current `GLXuEbDh…`). Removed per
   §9: service disabled, `/etc/wireguard/test0.*` deleted, iptables rule
   removed, nothing persisted in `/etc/iptables/rules.v4|v6`, no listener
   left on 51820. `wireguard-tools` package left installed (harmless).
   Side-discovery: **Agent A's Claude Code environment runs ON this
   production box** (`vps-5348441` = the panel/web box) — that's why the §2
   terminal mix-up was so easy to make.

2. **§2.1 SSH mystery to `fi-hel`: solved.** Nothing provider-side — the
   `vps@shahnameh` key simply was never authorized there. Agent A's
   `id_ed25519` (the established ReaLink-Hetzner-node key) IS authorized:
   `root@65.109.183.7` works, hostname `ubuntu-4gb-hel1-4`, host key matches
   the known-good `SHA256:WDm4ALsbx9MDONKy1PKIKSz8pG5XQdmFlkjm1XjnRIE`.
   Note: fi-hel is a LIVE ReaLink xray node, not a disposable box — treat
   accordingly.

3. **Hypothesis #1 CONFIRMED — One.com drops external inbound UDP wholesale,
   at the hypervisor layer, on BOTH One.com boxes.** Method: `tcpdump` on the
   dev VPS (`5.249.255.116`) while sending UDP probes to 51820 AND an
   arbitrary port (33533) from two independent sources (the production box =
   One.com Copenhagen, and fi-hel = Hetzner Helsinki). **Zero packets
   arrived from either source on either port.** Control: self-sent packets
   (public IP + loopback) captured fine, so tcpdump/filter provably worked.
   Repeated against the production box: same result (self-test captured,
   external Hetzner probe never arrived). So: not Starlink, not Windows, not
   keys, not port-specific — One.com filters inbound UDP before the NIC.
   Hypotheses #2/#3 are dead as *causes* (though #2 remains formally untested
   as a *second* problem until the Surface completes a handshake).

4. **§12a executed on fi-hel — listener live and PROVEN reachable.**
   `test0` on `65.109.183.7`: `10.99.0.1/30`, port `51820/udp` (ufw opened),
   peer = the Surface's `GLXuEbDh…`. **Server public key is NEW:**
   `mpm3vXTI+B+pFp+es7GDICWI4eHNIlhQRqa4dcPTwBI=` — §12a's "only the
   Endpoint changes on the Surface" was wrong, since §12a generates a fresh
   server keypair. Verified end-to-end with a throwaway second peer from the
   production box: handshake completed in seconds, bytes both ways
   (temporary peer removed afterwards; only the Surface peer remains).
   Remaining user step, on the Surface's `wg-starlink0.conf`:
   - `[Peer] Endpoint = 65.109.183.7:51820`
   - `[Peer] PublicKey = mpm3vXTI+B+pFp+es7GDICWI4eHNIlhQRqa4dcPTwBI=`
   - restart `WireGuardTunnel$wg-starlink0`, then check
     `wg show test0` on fi-hel for the handshake (§7 bar). Note: ping over
     the tunnel will NOT work (fi-hel ufw default-deny on INPUT) — handshake
     + received-bytes is the success criterion, don't chase the ping.

5. **Design consequence for Phase 1:** the dev VPS (One.com) cannot be the
   WireGuard rendezvous — any Starlink gateway must terminate on a Hetzner
   box (or another provider that passes inbound UDP), unless One.com support
   opens the security group (§12.7 — user's call whether that conversation
   is worth it; the Hetzner path already works). `STARLINK_NODE_ARCHITECTURE.md`
   should be revisited with this constraint before any further build-out.

**Read this whole document before touching anything.** It was written so a
fresh agent can continue without asking the user to repeat any of the
investigation below. If you find yourself about to ask "what have we already
tried" or "which server is which," the answer is in here.

---

## 14. 2026-07-16, later — Windows gateway script fixes + ICS provisioning; open question re: §13.4

Session picked up from a fresh chat compaction, working with the user
directly against the actual Surface via relayed PowerShell output (no direct
access to that machine). Scope was `deploy/starlink/gateway/windows/
1-provision-gateway.ps1` and the live provisioning run, not the VPS side.

1. **Two script bugs fixed and pushed** (commit `79a8094`, on top of the
   five commits above): `Register-ScheduledTask` was failing with "The task
   XML contains a value which is incorrectly formatted or out of range" —
   caused by `-RepetitionDuration ([TimeSpan]::MaxValue)`, which
   `New-ScheduledTaskTrigger` serializes to an out-of-range ISO8601
   duration. Fixed by building the trigger without `-RepetitionDuration`
   and setting `$trigger.Repetition.Duration = ''` directly (the real
   "repeat indefinitely" sentinel). Second bug: `New-NetNat` failed with
   "Invalid class" — added a pre-flight existing-NAT check plus
   try/catch with `-ErrorAction Stop` and automatic `Get-NetNat`/
   `Get-Service WinNat` diagnostics on failure (this class of cmdlet
   doesn't reliably honor the script's `$ErrorActionPreference = 'Stop'`,
   which is why the script previously completed and wrote
   `gateway-state.json` despite both calls failing silently).

2. **Root cause of the NetNat failure, confirmed by diagnostic, not
   guessed:** `Get-CimClass -Namespace root\StandardCimv2 -ClassName
   MSFT_NetNat` returns nothing on this Surface — the class plain doesn't
   exist. Control test (`MSFT_NetAdapter`) works, `winmgmt
   /verifyrepository` reports the WMI repository consistent, and `WinNat`
   the *service* starts fine. So this isn't WMI corruption and isn't
   fixable by restarting anything — the NetNat **management provider**
   simply isn't registered on this install, consistent with both
   `Hyper-V-All` and `VirtualMachinePlatform` being `Disabled` (the
   pre-existing `0-probe-capabilities.ps1` comment already anticipated
   exactly this). Enabling `VirtualMachinePlatform` would fix it but needs
   a reboot and is exactly the kind of systemic change
   `STARLINK_WINDOWS_GATEWAY.md` §3 says needs the user's explicit sign-off
   first — not done. Went with the already-built ICS fallback instead:
   `.\1-provision-gateway.ps1 -NatMethod ICS -AcknowledgeIcsIpConflictRisk`.

3. **ICS is now active.** Verified the specific risk the script warns about
   (ICS overwriting the tunnel adapter's IP with its own `192.168.137.1/24`
   default) did NOT happen to the tunnel adapter's `10.90.0.2` address —
   both coexist. Also separately confirmed, by reading the actual source
   (not assumed): the `-TunnelInternalAddress`/`-TunnelSubnet` script
   parameters never write to `wg-starlink0.conf` — they only feed the
   WinNAT prefix and the ICS post-check comparison message. The tunnel's
   real `[Interface] Address` comes solely from the `.conf` file, and
   `10.90.0.2` there is correct — it matches `deploy/starlink/vps/
   setup-starlink-wg.sh` (`WG_VPS_ADDR=10.90.0.1/30`,
   `WG_PEER_ADDR=10.90.0.2/32`), which none of the five commits above
   touched.

4. **Current blocker:** `Test-Connection -ComputerName 10.90.0.1` returns
   "Error due to lack of resources" (a send-side/no-route failure, not a
   timeout or an ICMP-unreachable reply). Leading hypothesis: ICS's
   reconfiguration of the tunnel adapter disrupted the route WireGuard
   installs for `AllowedIPs = 10.90.0.1/32` when the tunnel service
   started. Requested `Get-NetRoute -InterfaceAlias
   $state.TunnelAdapterName` from the user to confirm — **not yet
   returned when this note was written.** Whoever picks this up next:
   check for that reply first before re-deriving the same diagnostic.

5. **Open question that needs reconciling before either thread continues
   blindly:** all of the above (§14.1–14.4) was debugged against
   `wg-starlink0.conf` pointed at whatever `Endpoint`/`PublicKey` it
   currently has — which was never re-confirmed against **§13.4 above**,
   which already documents a different, proven-working destination:
   `Endpoint = 65.109.183.7:51820` (fi-hel) with a **new** server key
   `mpm3vXTI+B+pFp+es7GDICWI4eHNIlhQRqa4dcPTwBI=`. If the Surface's
   `wg-starlink0.conf` still has the old `Endpoint`/`PublicKey`, the
   `10.90.0.1` unreachability in §14.4 could be entirely explained by
   *pointing at the wrong/dead server*, independent of ICS or routing —
   in which case §13.4's change should be applied and verified **first**,
   and the routing investigation revisited only if the handshake still
   doesn't complete afterward. This was not resolved in this session —
   flagging it rather than guessing which track is the real blocker.

---

## 15. 2026-07-16, same evening — §14.5 ANSWERED (Agent A, from the production box): §14 debugged the WRONG tunnel; the fi-hel tunnel is alive right now

Verified live against `fi-hel` over SSH at ~22:47 UTC tonight, minutes
after §14 was written — not inferred from docs:

```
wg show test0 latest-handshakes → Y+9l3IPN…  (38 seconds old)
wg show test0 transfer          → 55 KB received / 27 KB sent
```

**The Surface has a WORKING, currently-handshaking WireGuard tunnel to
fi-hel (`test0`, `10.99.0.0/30`, Surface = `10.99.0.2`, fi-hel =
`10.99.0.1`).** That is the §13 tunnel, set up earlier today in a separate
session (`test0.conf` on the Surface — a different config/tunnel from
`wg-starlink0`). So §14.5's suspicion is confirmed, with a twist:

- `wg-starlink0.conf` (`10.90.0.x` → One.com dev VPS) is the **dead** path
  (§13 proved One.com drops inbound UDP — a handshake there can NEVER
  complete). Everything in §14.3–14.4 — the ICS binding, the `10.90.0.2`
  address check, the `10.90.0.1` "lack of resources" unreachability — was
  debugged against this dead tunnel. `10.90.0.1` will stay unreachable
  forever; do not resume that route investigation.
- The §13.4 fix was in practice applied as a NEW tunnel (`test0.conf`)
  rather than an edit to `wg-starlink0.conf` — which is why §14's session,
  looking only at `wg-starlink0`, never saw it.

**What is still missing (verified failing tonight, from fi-hel):**

```
curl -4 --interface 10.99.0.1 https://ifconfig.me   → hangs / no reply
```

Traffic enters the tunnel (policy routing on fi-hel is correct: `from
10.99.0.1 lookup starlink` → `default dev test0`) but nothing returns —
the Surface is not yet forwarding/NAT-ing tunnel traffic out via Starlink.
Exactly the §13 conclusion, unchanged: **the only remaining blocker is
Windows-side NAT/forwarding, and it must be attached to the `test0`
tunnel adapter (`10.99.0.2`), not `wg-starlink0`.**

Concrete next steps on the Surface, in order:

1. To avoid §14 happening again: stop/remove the `wg-starlink0` tunnel
   service (dead path, pure confusion once ICS is also in play). Keep
   `test0`.
2. Re-run the (now-fixed, `79a8094`) provisioning against the RIGHT
   subnet/adapter: `.\1-provision-gateway.ps1 -NatMethod ICS
   -AcknowledgeIcsIpConflictRisk -TunnelSubnet 10.99.0.0/30` with ICS's
   private side pointed at the `test0` adapter (the one holding
   `10.99.0.2`), public side = the Starlink Wi-Fi adapter.
3. Known ICS caveat if step 2 still doesn't pass traffic: ICS's NAT may
   only translate its own `192.168.137.0/24` subnet, in which case the
   clean fixes are (a) enable `VirtualMachinePlatform` (+ reboot) so the
   NetNat provider exists and use `-NatMethod WinNAT` (needs Khabat's
   explicit sign-off per §14.2 / GATEWAY.md §3), or (b) renumber the
   tunnel to `192.168.137.0/24` on BOTH ends (Surface `test0.conf` +
   fi-hel's `test0` + the xray `sendThrough` value) — option (a) is less
   invasive to the already-proven tunnel.
4. E2E pass criterion, run from fi-hel (or ask Agent A, who has SSH):
   `curl -4 --interface 10.99.0.1 https://ifconfig.me` returns the
   Starlink WAN IP. The moment that returns, the whole chain is proven
   (xray integration on fi-hel is already deployed and `-test` clean per
   §13) and the management plane (`lib/starlink.php` + heartbeat +
   catalog + admin) can be deployed to production.

Side note for the same next session: `starlink_wg_endpoint` /
`starlink_wg_public_key` are now set in the production `settings` table
(values verified against `wg show` on fi-hel tonight), so
`starlink-enroll.php` responses will carry the peer info as soon as the
backend deploys.

---

## 16. 2026-07-17 — → Agent A: Tap-to-Learn mobile contract is ready

Not this document's investigation — flagging here because this is the
thread Agent A reads for anything backend/routing-adjacent on this branch.

`docs/NODE_INTELLIGENCE_ARCHITECTURE.md` (Genome/Trust/Adaptive
Routing/Evolution Layer, commit `7c71b5a`) is implemented server-side,
`php -l` clean, smoke-tested, Adaptive Routing feature-flagged OFF (Rule
7 — nobody has turned it on). The mobile-app side of the next milestone
("Tap-to-Learn telemetry from the apps, users earn Zar") is specced —
**not implemented** — in `docs/realgram/DECISIONS.md`, entry **"2026-07-17
— Tap-to-Learn mobile contract: `app_category` dimension + ZAR reward
framing (needs Agent A spec/decision)"**. Two things need your input
before anything gets built against it:

1. **`app_category` enum** — a proposal is there
   (`streaming|messaging|social|gaming|browsing|other`), not a spec.
   Counter-propose if the app's actual telemetry surface suggests
   something different, or confirm it works.
2. **"Users earn Zar"** — currently unresolved whether that means (a) UI
   copy over the existing quota-bonus reward (already live, no backend
   work needed) or (b) a real Shahnameh Zar-ledger integration (needs
   Agent B, bigger scope). Khabat hasn't picked one yet — don't build UI
   copy that assumes (b) is happening until it's confirmed.

Everything else on the contract (the already-working `event=tap` +
`consent=1` reward path, the optional `carrier`/`network_type` params on
`GET /v1/servers`, the response-shape change ONLY when
`adaptive_routing_enabled` flips) is in `docs/MULTINODE_API_v1.md` §8 —
read that alongside the DECISIONS.md entry, not instead of it.

---

## 17. 2026-07-17 ~00:30 — ✅✅ E2E VERIFIED (Agent A + Khabat live): Starlink exit works end to end, firewall ON

```
curl -4 --interface 192.168.137.2 https://ifconfig.me  (from fi-hel)
→ 209.198.157.28        ← Starlink WAN (CGNAT), stable across repeated runs
   (fi-hel's own exit is 65.109.183.7 — source proven different)
~620 KB/s download through the full chain, ~54 ms RTT over the tunnel
```

Survived Windows Firewall being re-enabled (firewall never filtered the
*forwarded* traffic — it only blocked replies to the Surface's own
addresses, which is why ping/DNS against 192.168.137.1 stayed dead even
while NAT worked).

### The FINAL working configuration (differs from §13/§15 — read this, not those)

**fi-hel `/etc/wireguard/test0.conf`** (backups: `.bak-1099`, `.bak-1090`):
- `Address = 192.168.137.2/24` — fi-hel is a *client inside ICS's own
  hardwired subnet*. This is the trick that made ICS NAT the traffic:
  ICS only translates 192.168.137.0/24, so instead of fighting that
  (VirtualMachinePlatform/WinNAT/reboot), the tunnel was renumbered INTO it.
- `Table = off` + `PostUp` policy routing (`from 192.168.137.2 table 99`,
  `default dev test0 table 99`) — AllowedIPs 0.0.0.0/0 must not touch the
  main routing table.
- `[Peer] AllowedIPs = 0.0.0.0/0` — **required**: after ICS de-NAT, replies
  arrive sourced from arbitrary internet IPs; any /32 here silently drops
  every reply. (This was a latent bug in the ORIGINAL 10.99/10.90 design —
  it would have blackholed even with working NAT.)
- xray `starlink-exit` outbound: `sendThrough: 192.168.137.2`
  (config.json backups alongside).

**Surface (Windows)**: tunnel `wg-starlink0`, `[Interface] Address` still
10.90.0.2 (harmless, coexists), ICS-assigned 192.168.137.1 on the same
adapter, `[Peer] AllowedIPs = 192.168.137.2/32`, ICS: Wi-Fi(Starlink) =
public → wg-starlink0 = private, forwarding enabled on both adapters.

### Root causes, in the order they were peeled off tonight

1. **Subnet mismatch** (§15): fi-hel spoke 10.99.0.x, Surface 10.90.0.x —
   cryptokey routing dropped all data silently while handshake stayed green.
2. **Surface AllowedIPs stale** (10.90.0.1/32): user's GUI edit didn't
   apply the first time — verify with `wg.exe show`, never trust the edit.
3. **fi-hel AllowedIPs /32**: return traffic from internet IPs needs 0/0
   (see above).
4. **ICS subnet limitation**: ICS only NATs 192.168.137.0/24 → renumber
   the tunnel into it.
5. **Toggle amnesia — THE remaining operational fragility**: WireGuard for
   Windows destroys/recreates the adapter on every Deactivate/Activate.
   The ICS 192.168.137.1 address AND per-interface forwarding die with it
   (symptom: `ICMP net unreachable` from 10.90.0.2 for everything). Fix:
   re-bind ICS (Wi-Fi properties → Sharing → off → on) +
   `Set-NetIPInterface -InterfaceAlias wg-starlink0 -AddressFamily IPv4
   -Forwarding Enabled`. **✅ BUILT 2026-07-17 (§18): `watchdog.ps1` now
   asserts both on every run** — a toggle/reboot self-heals within ~60s.

### What this unblocks

The management plane (lib/starlink.php + heartbeat + enroll + v1 catalog +
admin tab) can now be deployed to production per the §13 plan — the
`starlink_wg_endpoint`/`starlink_wg_public_key` settings rows are already
in the prod DB. The mobile-app data path (VLESS test-UUID `e5e6b692…` on
fi-hel:8443 → starlink-exit outbound) is configured and `xray -test`-clean;
first real-device test can happen whenever a client with that UUID dials in.

---

## 18. 2026-07-17 — watchdog.ps1 + heartbeat.ps1 rewritten: toggle-amnesia self-heal + handshake-based liveness (Agent A)

**heartbeat.ps1 got the same liveness fix** (second commit): its ping-based
`tunnel_status` would have permanently reported `down` (fi-hel filters tunnel
ICMP), and `st_health_state()` fails closed on that — the node would sit
OFFLINE/unroutable forever even with `enabled=1`, and loss would read 100%
(≥ the 2% DEGRADED threshold) besides. Now: ≥3/5 ping replies = real
latency/loss; otherwise handshake age ≤180s = `up` with latency/loss sent as
null ("not measured" — the server stores NULL and treats it as healthy);
stale = `down`. Peer default corrected to 192.168.137.2, adapter derived from
the installed `WireGuardTunnel$*` service.

Closes §17 root cause 5's TODO. Two changes, both live in
`deploy/starlink/gateway/windows/watchdog.ps1` (ASCII-clean, parse-validated):

1. **Exit-path assert every run**: if ICS's 192.168.137.1 is missing from
   the tunnel adapter, re-bind ICS programmatically (HNetCfg.HNetShare COM:
   clear all stale bindings, then Wi-Fi=public / tunnel=private, wait for the
   address) and re-enable IPv4 forwarding on BOTH adapters if disabled.
   Re-asserted after every service start/restart the watchdog itself performs
   (those recreate the adapter too). Each ICS heal is appended to
   disconnects.log — the exit WAS down for users until the heal.

2. **Liveness no longer trusts ping replies**: fi-hel's ufw drops ICMP over
   the tunnel BY DESIGN (only 51820/udp open — verified 17/7), so the old
   ping-or-restart logic would have restart-looped every 60s against the live
   peer, re-triggering the exact amnesia duty 1 fixes. Now: ping serves to
   *stimulate* a handshake, health is judged by handshake age via `wg.exe
   show <tunnel> latest-handshakes` (>180s stale → restart). The old header
   comment claiming Windows has no wg CLI was wrong — wg.exe ships in
   `%ProgramFiles%\WireGuard` (§17 root cause 2 used it).

Defaults updated to the LIVE §17 config (peer 192.168.137.2, ICS
192.168.137.1) since the Scheduled Task only passes -ServiceName and
-StarlinkAdapterName. NOTE: `1-provision-gateway.ps1` defaults are still
10.90.x — unchanged, out of scope here.

Surface action needed (one-time): re-pull watchdog.ps1 (raw.githubusercontent,
repo is public) over the installed copy — the Scheduled Task
(`ReaLink-Starlink-Watchdog`, every 60s) picks it up on the next run, no
re-registration needed.

---

## 19. 2026-07-17 ~02:40 — Server-side verification after task re-registration: heartbeat GREEN, but the EXIT PATH IS DOWN after the reboot (Agent A)

Context: the Surface user re-registered both Scheduled Tasks with a **1-minute**
repetition interval — Task Scheduler rejected the original 33s as `PT33S`
(its documented minimum is one minute; the 33s default was a bug on every
Windows box, now fixed in `1-provision-gateway.ps1`). The Surface was
rebooted ~01:41 UTC; tasks were started ~02:22 UTC.

**Verification results, all from the server side:**

1. **Heartbeat arriving: ✅** `POST /starlink-heartbeat.php` → 200 every ~60s
   since 02:22:37 (nginx access.log + `starlink_nodes.last_heartbeat_at`).
   Because of the new 60s cadence, `STARLINK_HEARTBEAT_FRESH_SECS` was raised
   90 → **150** (repo + prod, backup `lib/starlink.php.bak-hbwindow-20260717`)
   — at 90s a single late POST would have flapped the node OFFLINE/unroutable.
2. **Node status: ✅** `st_health_state()` = ONLINE, `st_routable()` = YES
   (evaluated live via the server's own code).
3. **tunnel_status: ✅** DB says `up`; `wg show test0` on fi-hel shows a
   handshake 6s old, endpoint `209.198.157.144:13221`.
4. **Exit IP: ❌ THE ACTUAL EXIT IS DEAD.** The heartbeat reports exit_ip
   `209.198.157.144` — still Starlink CGNAT (changed from `.28` at reboot,
   normal), **but that value is measured from the Surface's own WAN curl, not
   through the tunnel.** From fi-hel the real data path fails:
   `curl --interface 192.168.137.2 https://ifconfig.me` → timeout (retested
   3× over ~10 min), and `192.168.137.1` (the ICS gateway) answers nothing
   (100% loss). fi-hel policy routing verified intact (ip rule → table
   starlink → default dev test0; packets DO enter the tunnel — counters grow).
   Surface→fi-hel direction works (heartbeat pings: ~54ms/0%). Diagnosis:
   **§17's toggle-amnesia, triggered by the reboot** — ICS lost
   192.168.137.1/forwarding, and the watchdog is NOT healing it despite ~40
   one-minute cycles since boot. `recent_disconnects` = 0 in every heartbeat,
   i.e. the watchdog has never logged a heal — strongest hypothesis: **the
   Surface still runs the pre-§18 watchdog.ps1** (the §18 re-pull was never
   done; the re-registered task points at the old file). Alternative: new
   watchdog runs but `Rebind-Ics` fails — that would leave `ERROR:` lines in
   `logs\watchdog.log` next to the script.
5. **Reboot survival: ⏳ UNPROVEN.** The heartbeat gap 01:28→02:22 spans the
   reboot, and beats only resumed when the tasks were manually started — so
   this boot proves nothing. The provision script does register `-AtStartup`
   triggers for both tasks; whether the manual re-registration kept them is
   unknown from here.

**Phase 1 is NOT re-confirmed complete** — the node currently advertises
ONLINE+routable while the exit blackholes (the exact monitoring blind spot
§18 warned about: handshake liveness stays green when NAT dies).

**Surface steps, in order:**

1. Re-pull BOTH gateway scripts from the branch (raw.githubusercontent,
   `feat/starlink-node-phase1`, `deploy/starlink/gateway/windows/`) over the
   installed copies — watchdog.ps1 (§18 rewrite) is the critical one.
2. Run watchdog.ps1 once by hand in an admin PowerShell (same -ServiceName /
   -StarlinkAdapterName arguments as the task) and read `logs\watchdog.log`:
   expect `Toggle amnesia detected … re-binding ICS` then `HEALED`. If
   `ERROR: EnableSharing failed` instead, fall back to the manual §17 fix
   (Wi-Fi properties → Sharing → off → on, select the tunnel adapter) and
   report the error text.
3. Confirm both tasks kept a boot trigger:
   `schtasks /query /tn ReaLink-Starlink-Watchdog /xml | findstr BootTrigger`
   (same for `ReaLink-Starlink-Heartbeat`). If missing, re-run
   `1-provision-gateway.ps1` (now registers 60s + AtStartup correctly).
4. Say when done — the server side re-checks
   `curl --interface 192.168.137.2 https://ifconfig.me` from fi-hel (must
   return the Starlink IP). Only then reboot once more for check 5; after
   the reboot the exit must come back **without any manual action**, healed
   by the watchdog's boot trigger + 60s cycles (watch `disconnects.log`
   gain exactly one entry for the post-boot ICS heal).

---

## 20. 2026-07-17 — §19 result: watchdog detects correctly but `EnableSharing` throws 0x80040201; ROOT CAUSE FOUND (ghost entries in the HomeNet WMI store, KB828807) + programmatic fix shipped (Agent A)

§19 steps 1–2 were done: the Surface now runs the current watchdog, and its
log proves the DETECTION chain works end to end:

1. `ICS binding check: address present but sharing bindings are gone … treating as amnesia.` ✅ (the de8fd4b COM-level check caught exactly the §19 false-healthy state)
2. `Toggle amnesia detected … re-binding ICS.` ✅
3. `WARN: EnableSharing threw … 0x80040201` ❌
4. `ERROR: ICS bind still failing after service restart.` ❌ — the b16e466 service-kick retry didn't help either.

**Question this raised: is programmatic ICS re-bind after reboot simply
impossible on Windows (UI required), or is there a supported sequence?**

**Answer: it is NOT a hard Windows limitation — root cause identified.**
`0x80040201` = `EVENT_E_ALL_SUBSCRIBERS_FAILED`: `EnableSharing` publishes a
COM event to the ICS subscriber chain, and the whole event fails. An archived
MSDN thread with our EXACT scenario ("COMException 0x80040201 when setting
Internet Connection Sharing **after restarting the PC**") was resolved via
**Microsoft KB828807**: the ICS configuration store — WMI namespace
`root\Microsoft\HomeNet`, class `HNet_ConnectionProperties` — retains
`IsIcsPublic`/`IsIcsPrivate` flags for connections **whose adapter no longer
exists**. The event subscribers choke on those ghost entries and the whole
enable fails. This maps 1:1 onto our box:

- WireGuard for Windows destroys/recreates its adapter on every toggle,
  service restart and reboot (§17 root cause 5), and this Surface has been
  through several tunnel incarnations (`wg-starlink0`, `test0`, the 10.90.x
  era) — the ghost entries are practically guaranteed.
- The watchdog's COM clearing loop can't reach them: `EnumEveryConnection`
  only enumerates LIVE connections. Ghosts are invisible to the entire
  `HNetCfg.HNetShare` API surface — they only exist in the WMI store.
- It explains why one manual UI toggle "fixes" it (reported in every
  independent hit on this error): the Sharing tab rewrites the store.
  The UI isn't doing anything privileged — it's doing cleanup.

**Fix shipped in watchdog.ps1 (this commit):** new
`Clear-GhostHomeNetEntries` clears `IsIcsPublic`/`IsIcsPrivate` on every
still-flagged `HNet_ConnectionProperties` entry (ghost or not — we re-enable
the two bindings we want immediately after) via `Get-CimInstance`/
`Set-CimInstance`, called inside `Invoke-IcsBind` after the COM disable loop
and before `EnableSharing`. Logs each cleared entry as
`ICS store cleanup: cleared GHOST (adapter no longer exists) -- …`.
Also added `EventSystem` (COM+ Event System) and `SENS` to the service-kick
list — they dispatch the very event that is failing.

**Surface steps:**

1. Re-pull `watchdog.ps1` from the branch (raw.githubusercontent,
   `feat/starlink-node-phase1`) over the installed copy.
2. Run it once by hand (same arguments as the task) and read
   `logs\watchdog.log`. Expected sequence:
   `Toggle amnesia detected` → one or more `ICS store cleanup: cleared …`
   lines → `HEALED: ICS re-bound, 192.168.137.1 back on …`.
3. If it STILL fails after ghost cleanup: do the manual UI toggle ONCE
   (Wi-Fi properties → Sharing → off → on, tunnel adapter selected). With
   `EnableRebootPersistConnection=1` (already asserted by the watchdog,
   b16e466) the binding now persists across reboots, so the watchdog only
   needs the programmatic path for toggle-amnesia during uptime — and
   report the log lines so we see whether the store cleanup ran at all.
4. Then the §19 finale, still pending: server-side exit check from fi-hel
   (`curl --interface 192.168.137.2 https://ifconfig.me` = Starlink IP),
   followed by ONE more reboot — the exit must come back with no manual
   action (§19 check 5, still unproven).

**Plan B if KB828807 cleanup does not cure it** (decreasing preference):
(a) rely on `EnableRebootPersistConnection=1` + one last manual toggle —
reboot persistence makes the 0x80040201 path a rare event; (b) drop ICS for
WinNAT: install the `VirtualMachinePlatform` feature + reboot to materialize
`MSFT_NetNat` (absent today, §14.2), then `New-NetNat` + a static
192.168.137.1 on the tunnel adapter — no COM events anywhere in that path,
fully scriptable; (c) the architecture note's real answer: a Linux gateway
(GL.iNet/RPi) — Windows ICS is the fragile part, and it is the stopgap.

---

## 21. 2026-07-17, later — §20 follow-up investigation CLOSED for now: `0x80040201` reclassified as an isolated Windows-ICS blocker, not fixed; Linux gateway promoted to the primary path

Live back-and-forth diagnosis (Khabat at the Surface + this agent) after §20 shipped
`Clear-GhostHomeNetEntries`. Summary of what was actually learned, then the
decision.

**What we found, in order:**

1. The new watchdog **is** running correctly and detecting toggle amnesia
   every cycle (proves §18/§20's detection logic is sound). But the loop
   never resolves: `Toggle amnesia detected` → `Re-binding ICS` →
   `EnableSharing threw HRESULT 0x80040201` → `Could not clear HomeNet
   entry` → `ICS bind still failing` → next cycle, same thing.
2. Checked whether `HNet_ConnectionProperties.IsIcsPublic`/`IsIcsPrivate`
   are provider-marked read-only (would explain `Set-CimInstance` always
   failing regardless of technique). **Ruled out**: `Get-CimClass` shows
   `read=True, write=True` on both properties — this is not a permissions
   or read-only-provider problem.
3. Checked whether the specific ghost GUID
   (`4F630E25-A5A3-86BE-C8E2-F73083B316D6`) still resolves to anything at
   all. A fresh, independent `Get-WmiObject` lookup for it returned
   nothing — the instance the watchdog's own `Get-CimInstance` enumerated
   moments earlier can no longer be found by a subsequent query, by
   `Set-CimInstance`, or by anything else. It is not a stable, independently
   addressable record; it appears to be a transient/short-lived artifact
   that stops resolving between one query and the next.
4. Checked Plug-and-Play (`Get-PnpDevice` + Device Manager, hidden devices
   shown) for a ghosted WireGuard adapter that this GUID might still trace
   back to at the device-tree level. **Ruled out**: no ghost WireGuard
   adapter exists in PnP at all — only the unrelated stock `RAS Async
   Adapter`. Whatever HomeNet is tracking, it is not backed by a live or
   hidden PnP device record we can remove.

**Where this leaves it:** the stale GUID is very likely a residual
`IsIcsPublic`/`IsIcsPrivate` flag from an earlier WireGuard adapter
incarnation (WireGuard mints a new adapter GUID on every
toggle/service-restart — §17 root cause 5 — and this Surface has cycled
through several: `wg-starlink0`, `test0`, the original `10.90.x` design).
It is writable by schema, not tied to any PnP device, and not reliably
re-resolvable a moment after it's first seen. Two explanations remain
open and were **not** resolved before calling time on this for tonight:
(a) HomeNet's store on this Windows 11 build is a short-lived/dynamic
cache rather than a persisted list the old KB828807-era remedy assumed,
so the "ghost" is closer to noise than a real object to clear; or (b) the
watchdog's own tunnel-restart duty is repeatedly minting fresh short-lived
ghosts faster than any of them can be cleanly resolved, making the retry
loop partly self-sustaining. Deciding between these would need a live
raw-log GUID-across-cycles comparison and a full-hive registry search for
the literal GUID string — real further work, just not tonight's.

**Decision (Khabat, 2026-07-17): stop chasing this tonight.** Classified
as an **isolated Windows-ICS blocker**, not a design flaw in the Node
Console/heartbeat/watchdog architecture around it (§18/§20's detection and
self-heal *reporting* additions are sound and stay shipped as-is — see
§22 below for the further hardening done in parallel). Consequences:

- The Windows Surface gateway is **not blocking the project**. It's kept
  running for **controlled internal testing only** (Khabat + Agent A/this
  agent's own verification), not for real Iran test users, until either
  this is fixed or it's fully superseded.
- **The Linux gateway (`deploy/starlink/gateway/`, Raspberry Pi path) is
  promoted from "long-term/Plan B" to the primary path forward** — see
  §22. This was already flagged as the architecturally sounder option in
  §20's own "Plan B" list (no COM event chain exists on Linux at all —
  `wg-quick`'s `PostUp`/`PostDown` manage NAT declaratively), so this
  isn't a new direction, just an accelerated one.
- If a supported Windows fix is found later (the registry-search /
  GUID-across-cycles evidence above, or a WinNAT-via-VirtualMachinePlatform
  path per §20 Plan B option (b)), it merges in as an improvement to the
  Windows path — it is explicitly **not a gate** on any other work.

---

## 22. 2026-07-17, later — Linux gateway (Raspberry Pi) brought to parity with the hardened Windows path; Node Console wired end-to-end on both platforms

Done while the Windows ICS investigation above was paused, per Khabat's
"continue Linux in parallel" instruction. Scope: bring
`deploy/starlink/gateway/` (Linux/Raspberry Pi) up to the same
self-healing + remote-command level as the Windows scripts, and finish
wiring Node Console (docs/NODE_CONSOLE_ARCHITECTURE.md, new) end-to-end on
both platforms. Full detail in that architecture doc and in the commit
history on `feat/starlink-node-phase1`; not duplicated here.

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

## 23. 2026-07-17 ~06:15 — → Agent B: Khabat-directive + APK v0.9.68 published to prod beta + Starlink node gated (Agent A)

1. **Khabat directive (this morning, supersedes §21's scope call):** the
   Windows Surface node SHOULD go to **live Iran testing** as soon as the
   exit works — "do not start another architecture redesign yet". Your
   Linux/RPi Node Console work (§22) continues in parallel as the robust
   production path — both tracks are wanted, neither gates the other.
2. **APK v0.9.68 (versionCode 95): published to prod by Agent A.** Artifact
   from run 29557206601 downloaded, all three sha256 verified against your
   38b2c97 message, live at `download/build95/` + pre-staged in
   `releases/stable/`. Prod `version.json`: **beta + experimental → 0.9.68/95;
   top-level/stable still 0.9.67/94** (owner-test-channel flow). Your repo
   version.json stages a stable flip = mass-OTA — do NOT sync it to prod
   until Khabat gives the go after the owner build checks out.
3. **starlink-no-01 set `maintenance_mode=1`** (Agent A, prod DB) so the three
   auto-qualified devices (`sl-85ff1772…` owner, `sl-f877790f…` Iran tester,
   `sl-ec58c486…` premium) don't select a node whose exit blackholes. Will be
   flipped back the moment the fi-hel exit check passes.
4. **Windows exit plan now:** one-time manual Sharing toggle restores NAT and
   `EnableRebootPersistConnection=1` (already asserted) makes it survive
   reboots; toggle-amnesia during uptime stays the watchdog's job. Durable
   Windows path = `VirtualMachinePlatform` + reboot + re-provision with
   `-NatMethod WinNAT` (§20 Plan B (b)) — needs a watchdog variant that
   asserts the static 192.168.137.1 + NetNat instead of ICS; coordinate so we
   don't both write it.
5. **⚠️ Prod disk hit 100% today** while git pulled your LFS APK objects on
   the prod clone (this box hosts setalink.no — everything write-dependent
   was at risk). Cleaned to ~1.3 GB free (journald vacuum, LFS objects
   dropped, `lfs.fetchexclude=public/releases,public/download` set locally).
   Please stop committing APKs into the repo via LFS — CI artifacts +
   `releases/` on the web root are enough, and every LFS APK costs the prod
   clone its size in `.git/lfs` on every pull. Your storage/cleanup Fase 1
   work is very relevant here.
