# iOS TestFlight — Build 42 Bug Checklist & Regression Test Plan

Every item must be marked **COVERED** (automated or logged) or **MANUAL** (test step required)
before releasing build 42. Items marked **N/A** are explicitly not applicable with justification.

---

## Known iOS PacketTunnel Bug Coverage

### #1 — App says connected but no traffic flows

**Risk**: tunnel reports "Connected" while HEV relay is dead — all app traffic silently drops.

**Coverage**:
- `startHevMode()` returns `Bool`; if socketpair fails → `fail()` → iOS shows "VPN failed" (**automated guard**)
- Probe 3 (SOCKS5) is **gating** — if xray SOCKS5 unreachable, tunnel fails (**automated guard**)
- Post-connect **8s watchdog**: fires if FIRST-PKT-OUT seen but FIRST-PKT-IN never arrives → `cancelTunnelWithError()` (**automated guard**)
- Admin timeline shows `connected_verified` vs `FAILED` / `Post-connect watchdog fired` (**admin timeline**)
- CI guard: `completionHandler(nil)` appears exactly once (**CI guard**)

**Status**: ✅ COVERED — multiple independent gates

---

### #2 — DNS works outside tunnel but fails inside tunnel

**Risk**: system DNS resolves (direct path), but tunnel DNS via xray `dns-out` rule fails — hostnames time out inside VPN.

**Coverage**:
- Probe 2 (DNS+proxy) fetches `cp.cloudflare.com` by hostname through xray's HTTP proxy — exercises xray's dns-out rule; if DNS fails inside tunnel, probe 2 fails and tunnel fails (**diagnostic log**)
- Log line: `Probe RX[2]: DNS+proxy OK — status=204` confirms DNS resolution worked
- Admin timeline: `DNS+proxy probe OK/FAIL` (**admin timeline event**)
- DNS servers logged: `NetSettings: DNS=[1.1.1.1,8.8.8.8] matchDomains=[all]`
- Self-test "DNS Resolution" check in app runs DNS via active tunnel (**in-app test**)

**Manual test**: after connecting, open Safari → `google.com` (DNS + HTTPS); open `http://neverssl.com` (plain HTTP, DNS only).

**Status**: ✅ COVERED

---

### #3 — IPv6 route breaks traffic if server/relay is IPv4-only

**Risk**: iOS device on dual-stack LTE; Happy Eyeballs prefers IPv6; tunnel has no IPv6 handler → Safari hangs.

**Coverage**:
- IPv6 claim+drop: `NEIPv6Route.default()` with no packet handler → iOS fast-fails IPv6 CONNECT → Happy Eyeballs falls back to IPv4 within ~25ms (**diagnostic log**)
- Log: `NetSettings: IPv6=fd00::2/64 includedRoutes=[default] (claim+drop → force IPv4 fallback)`
- Admin timeline: `IPv6 claim+drop applied` (build 42+) (**admin timeline event**)
- xray routing: `ip=["::/0"] → blackhole` fast-rejects any IPv6 that enters via SOCKS5

**Status**: ✅ COVERED

---

### #4 — Server IP excluded route fails when hostname resolves to changing IP

**Risk**: if `configMeta.addr` is a hostname (not an IPv4 literal), we cannot add an excluded route → routing loop risk when xray connects to the server.

**Coverage**:
- Code logs `⚠️ server addr "..." is not an IPv4 literal — cannot exclude; risk of routing loop` (**diagnostic log**)
- Admin timeline: if this warning appears, admin sees it in raw log

**Manual test**: verify `Server:` line in tunnel log shows an IPv4 literal (e.g. `178.104.77.231:443`), not a hostname. If it's a hostname, escalate — dynamic IPs need a hard-coded exclusion mechanism.

**Status**: ⚠️ PARTIAL — logged, no automated gate. Only affects hostname-based server addresses.

---

### #5 — Network changes from WiFi to 4G/5G kill tunnel silently

**Risk**: iOS switches network path mid-session; PacketTunnelProvider keeps running but packets go nowhere; UI still shows "Connected".

**Coverage**:
- `NWPathMonitor` started in `startHevMode()` — logs every path change (**diagnostic log**, build 42+)
- Log: `NETCHANGE: path=unsatisfied interfaces=[wifi] proto=[ipv4+ipv6]`
- Admin timeline: `Network path lost` / `Network switched to Cellular` (**admin timeline event**)
- Post-connect watchdog detects the consequence: if outbound packets stop getting responses after 8s from FIRST-PKT-OUT, watchdog fires (**automated guard**)

**Manual test**: connect on WiFi → turn off WiFi → watch admin timeline for `NETCHANGE` event → confirm iOS reconnects or shows disconnected (not stuck "Connected").

**Status**: ✅ COVERED — logged + watchdog catches dead-tunnel consequence

---

### #6 — Sleep/background mode stops packet processing

**Risk**: iOS suspends the extension process in Low Power Mode or when app is backgrounded for long; `readNextPackets` chain stops; HEV relay stalls; UI shows "Connected".

**Coverage**:
- Extension liveness heartbeat: writes unix timestamp to `extension_heartbeat` key every 30s (**diagnostic log**, build 42+)
- Log: `HEARTBEAT: liveness timer started (30s interval)`
- Low Power Mode logged: `Device: lowPower=true` at start (**diagnostic log**)
- Main app can read `extension_heartbeat` and compare with current time: if delta > 60s, extension is frozen (exposed via `getExtensionHeartbeat()` in future XrayModule method)

**Manual test**: connect → lock device → wait 5 minutes → unlock → check if Safari still works. If extension froze, `extension_heartbeat` timestamp will be stale by > 60s.

**Status**: ✅ COVERED — heartbeat provides observable signal; watchdog catches dead-tunnel consequence

---

### #7 — Reconnect after disconnect leaves old tunnel state

**Risk**: stale `tunnel_state = connected_verified` or error from previous session persists in UserDefaults; new session reads wrong state.

**Coverage**:
- At start of every `startTunnel()`, before config load: `shared.removeObject(forKey: kTunnelStateKey)` (**automated guard**, build 42+)
- Log line: `AppGroup: ... IPC=OK` proves the clean write succeeded
- Extension is a separate process relaunched fresh for each session; all in-memory state (`tunnelState`, `hevStats`, etc.) is always `.idle` at process start

**Manual test**: connect → disconnect → connect again → confirm second timeline shows `connected_verified` with new timestamps (not copy of first session).

**Status**: ✅ COVERED

---

### #8 — PacketTunnelProvider crashes but app UI still shows connected

**Risk**: extension process crashes (OOM, assertion, uncaught exception); iOS may not immediately report the tunnel as failed; UI shows "Connected" with no relay.

**Coverage**:
- Extension liveness heartbeat (see #6): `extension_heartbeat` stops updating when extension crashes — main app can detect within 30–60s (**diagnostic log**, build 42+)
- iOS `.connection.status` becomes `.invalid` or `.disconnected` within seconds of extension crash; `isRunning()` in XrayModule returns false — but the UI must poll this and react

**Manual test**: force-kill the extension process (not possible from UI; use Xcode Instruments or wait for OOM). Verify app UI eventually shows "Disconnected" rather than stuck "Connected".

**Status**: ⚠️ PARTIAL — heartbeat detects it; UI reaction depends on JS polling frequency (every 500ms in `vpnBridge.ts` during connect, but not continuously post-connect).

---

### #9 — MTU too high causes some websites/apps to hang

**Risk**: MTU higher than path MTU causes IP fragmentation; some firewalls drop fragments; large payloads (images, video) silently fail.

**Coverage**:
- MTU is hardcoded to `1280` — well below the 1500 Ethernet MTU and the 1400 LTE typical effective MTU (**verified in source**)
- Log: `NetSettings: tunnelRemoteAddress=10.255.0.1 mtu=1280`
- hev-socks5-tunnel config also sets `tunnel.mtu: 1500` — this is the TUN buffer size, not the path MTU; the 1280 from NEIPv4Settings governs what iOS sends into the TUN

**Status**: ✅ N/A — 1280 is conservative and correct for both IPv4 and IPv6 (RFC 8200 minimum). No action needed.

---

### #10 — UDP/QUIC traffic leaks or fails

**Risk**: QUIC (UDP port 443) reaches hev-socks5-tunnel which attempts SOCKS5 UDP ASSOCIATE; our VLESS/Reality outbound is TCP-only and cannot forward UDP → silent drop or QUIC error.

**Coverage**:
- xray routing rule: `{ network: "udp", port: "443", outboundTag: "blackhole" }` — QUIC fast-rejected (**automated guard in config**)
- Chrome/Safari falls back to HTTP/2 over TLS (TCP) immediately after QUIC rejection
- HEV stats log: `QUIC=N` counter in `[PIPE]` lines shows how many UDP/443 packets were intercepted (**diagnostic log**)
- For other UDP: hev-socks5-tunnel config has `udp: 'udp'` — UDP ASSOCIATE is attempted but VLESS drops it; only DNS (port 53) and QUIC (port 443) matter in practice
- DNS uses `dns-out` rule (Xray internal resolver, not SOCKS5 UDP) (**automated guard in config**)

**Manual test**: open Instagram (QUIC-heavy) → confirm it loads (after 1-2s QUIC fallback). Run `[PIPE]` log and verify QUIC counter > 0 for Instagram session.

**Status**: ✅ COVERED

---

### #11 — Telegram/WhatsApp work differently than Safari

**Risk**: Telegram uses MTProto (custom TCP framing); WhatsApp uses XMPP + calls (TCP + UDP); may behave differently through HEV vs proxy mode.

**Coverage**:
- HEV mode (build 40+) forwards ALL TCP via TUN → hev-socks5-tunnel → xray SOCKS5 → Reality → internet
- MTProto is TCP — goes through HEV without special handling
- WhatsApp calls use STUN/TURN (UDP); STUN over UDP → hev forwards via SOCKS5 UDP ASSOCIATE; if xray doesn't support it → falls back to TURN relay (TCP)
- Self-test DNS + HTTPS checks pass → baseline connectivity confirmed (**in-app test**)

**Manual test**: connect → open Telegram → send message → receive message → make voice call (optional) → check `[PIPE]` log for `UDP=N` counter showing UDP traffic. WhatsApp: send message + check.

**Status**: ⚠️ MANUAL TEST REQUIRED — Telegram text (TCP) verified by FIRST-PKT-IN; calls (UDP) need on-device confirmation.

---

### #12 — Captive portal / restricted network causes false failure

**Risk**: device on hotel WiFi with captive portal; probe fails with redirect or HTML response; tunnel incorrectly marked failed; user thinks VPN is broken.

**Coverage**:
- Probe 2 accepts **only** HTTP 200 or 204 from `cp.cloudflare.com` — captive portals typically return 302 redirect or HTML with 200 (**automated guard**: redirect → `status != 200 || 204` → fail; HTML 200 is a risk)
- HTML 200 false positive risk: `cp.cloudflare.com` returns exactly `"success\n"` (< 10B) — a captive portal returning an HTML page at 200 would be > 1KB but we don't check body content
- `cp.cloudflare.com` is specifically the Cloudflare captive-portal detection endpoint — it's the correct target for this check

**Manual test**: connect on hotel/coffee-shop WiFi (before accepting captive portal) → confirm tunnel fails with `DNS+proxy FAIL` (not falsely succeeds). Then accept captive portal and connect again → confirm tunnel succeeds.

**Mitigation if needed**: add `bytes < 50` check on probe 2 — if status=200 but < 50 bytes, it could be captive portal `success` response (legitimate) or a portal redirect (check body).

**Status**: ⚠️ PARTIAL — 302 captive portals handled; HTML-200 portals are a theoretical gap. No known reports.

---

### #13 — DNS matchDomains = [""] behaves differently across iOS versions

**Risk**: on some iOS versions, `matchDomains = [""]` might not intercept ALL DNS (could be interpreted as "no domains" rather than "all domains").

**Coverage**:
- iOS version logged at start: `iOS: 18.x.y` (**diagnostic log**)
- Admin can correlate DNS failures with specific iOS versions via Tunnel Logs platform filter
- Apple documentation confirms `[""]` means "intercept all DNS" on iOS 14+ — our minimum deployment target is iOS 16

**Manual test**: verify on iOS 16, 17, 18 — open `neverssl.com` (requires DNS resolution) while connected. All should load.

**Status**: ✅ COVERED for iOS 16+ — `[""]` semantics are stable since iOS 14. Logged for correlation.

---

### #14 — iOS caches old VPN profile/settings after app update

**Risk**: after app update, iOS uses old NETunnelProviderProtocol or extension bundle ID; new code never runs; tunnel appears to work but uses old binary.

**Coverage**:
- Build number logged: `HEV-START: build=42 mode=HEV_AVAILABLE` (**diagnostic log**)
- Admin timeline shows build number in log file name and `build` field in tunnel log listing
- XrayModule.start() calls `saveToPreferences` + `loadFromPreferences` on every connect — this forces iOS to refresh the profile with the current extension bundle ID (**automated guard**)

**Manual test**: install build 41 → connect (note build=41 in log) → update to build 42 → connect → verify log shows build=42. If still build=41, profile cache is stale.

**Status**: ✅ COVERED — forced profile reload on every connect.

---

### #15 — TestFlight build uses different entitlements/profile than local archive

**Risk**: local dev archive has debug entitlements; CI archive has App Store entitlements; mismatch causes tunnel or App Group failures in TestFlight.

**Coverage**:
- CI guard verifies both entitlements files have `group.no.setalink.realink` App Group (**CI guard**, build 42 workflow)
- CI uses `fastlane sigh` with explicit App IDs for both main app and tunnel extension (**CI guard**)
- `SWIFT_ACTIVE_COMPILATION_CONDITIONS="LIBXRAY_AVAILABLE HEV_AVAILABLE"` is set explicitly in CI archive step — different from local dev (**CI guard**)

**Status**: ✅ COVERED — CI explicitly validates entitlements.

---

### #16 — App Group state not readable between PacketTunnel and main app

**Risk**: misconfigured entitlement or sandboxing issue; extension writes to App Group but main app reads stale/nil values; device_id = "unknown", errors not surfaced.

**Coverage**:
- At tunnel start: `shared.set("ok", forKey: ipcKey)` + readback + `removeObject` — logs `AppGroup: ... IPC=OK` or `IPC=FAIL` (**diagnostic log**, build 42+)
- Admin timeline: `App Group IPC verified` / `App Group IPC BROKEN` (**admin timeline event**)
- Existing guard: `guard let shared = UserDefaults(suiteName: kAppGroup) else { fail(...) }` — fails tunnel if App Group unreachable (**automated guard**)

**Status**: ✅ COVERED

---

### #17 — Battery saver / Low Data Mode affects tunnel reliability

**Risk**: iOS Low Power Mode throttles background tasks, timers, and extension CPU; `readNextPackets` callback may be delayed; `hevStatsTimer` fires less frequently.

**Coverage**:
- Low Power Mode state logged at every tunnel start: `Device: lowPower=true thermalState=N` (**diagnostic log**, build 42+)
- Admin can correlate poor performance with `lowPower=true` in log
- Admin timeline: `Low Power Mode active` (shown as warning when `lowPower=true`) (**admin timeline event**)
- Low Data Mode: affects cellular data but not VPN tunnel operation (VPN is exempt from Low Data Mode restrictions on iOS)

**Status**: ✅ COVERED — logged; no code mitigation possible (Low Power Mode is an OS policy).

---

### #18 — IPv6-only networks fail if tunnel assumes IPv4

**Risk**: 5G or campus IPv6-only LTE; xray connects to Reality server via IPv4 only; xray CONNECT to `178.104.77.231` fails; entire tunnel fails.

**Coverage**:
- `NWPathMonitor` logs when device is on IPv6-only path: `NETCHANGE: ⚠️ IPv6-only path` (**diagnostic log**, build 42+)
- Admin timeline: `IPv6-only network detected` (**admin timeline event**)
- IPv6 claim+drop (#3) ensures app traffic falls back to IPv4 within the tunnel — but if xray itself can't reach the server over IPv4, the probe will fail and the tunnel won't connect

**Manual test**: test on an IPv6-only hotspot (rare in Norway; more common in some mobile networks) → confirm probe fails gracefully with `NETCHANGE: IPv6-only` in log.

**Mitigation for IPv6-only**: add IPv6 address for VPN server, or add Helsinki node (65.109.183.7) as fallback.

**Status**: ✅ COVERED — logged; server-side IPv6 support is the long-term fix.

---

### #19 — Proxy fallback accidentally masks full-tunnel failure

**Risk**: `NEProxySettings` set in HEV mode; extension's own URLSession probe goes through HTTP proxy (not TUN); probe passes but real app traffic (via TUN→HEV) silently drops.

**Coverage**:
- `NEProxySettings` is ONLY set inside `#else` (proxy mode) — `#if HEV_AVAILABLE` block has no proxy settings (**source guard**)
- CI guard: verifies all `NEProxySettings` occurrences are inside `#else` block via awk (**CI guard**, build 42 workflow)
- Probe 3 (SOCKS5) goes through xray SOCKS5 directly (not HTTP proxy) — tests the xray path more directly (**diagnostic log**)
- Log: `NetSettings: HEV mode — no NEProxySettings (all traffic via TUN→hev→xray SOCKS)` (**diagnostic log**)

**Status**: ✅ COVERED

---

### #20 — Exit IP check succeeds direct, not through tunnel

**Risk**: exit IP test fetches `cloudflare.com/cdn-cgi/trace` directly (bypassing tunnel); shows device's real IP; false positive "tunnel working" report.

**Coverage**:
- `runSelfTest()` exit IP test uses `URLSessionConfiguration.ephemeral` with **no explicit proxy dictionary** — on iOS, system URLSession traffic from an app with an active VPN is automatically routed through the TUN (**source verified**)
- The fetched IP should be the VPN server exit IP (e.g. `178.104.77.231` → Norwegian exit); if it shows the device's carrier IP, the tunnel is not routing app traffic (**in-app test**)
- Test result shows exact IP so tester can verify vs known VPN server exit IPs

**Manual test**: connect → Diagnostics → Run Self Test → Exit IP shows `exit IP: 178.104.77.xxx` (or Helsinki IP). Does NOT show device's carrier IP.

**Status**: ✅ COVERED

---

## Pre-Build 42 Release Checklist

### Automated (CI must pass before tagging)

| # | Check | Guard |
|---|-------|-------|
| A | `SOCK_SEQPACKET` not in source | CI step "Guard tunnel extension source" |
| B | `completionHandler(nil)` appears exactly once | CI step |
| C | `STATE: connected_verified` present in source | CI step |
| D | `NEProxySettings` only inside `#else` | CI step |
| E | Both entitlements have `group.no.setalink.realink` | CI step |
| F | Build archives and IPA exports without error | xcodebuild exit 0 |
| G | TestFlight upload succeeds | xcrun altool exit 0 |

### Manual (tester must mark ✓ before promoting to public)

| # | Step | Confirms |
|---|------|----------|
| 1 | Install fresh from TestFlight | No crash on launch |
| 2 | Connect → admin Tunnel Logs → Timeline shows `Connected ✓ (all probes verified)` | #1 state machine |
| 3 | Timeline shows `HEV bridge started (SOCK_DGRAM)` not `HEV bridge FAILED` | #1 HEV fix |
| 4 | Timeline shows `FIRST-PKT-OUT` and `FIRST-PKT-IN` | #1 end-to-end |
| 5 | Safari → google.com loads | #2 DNS + #11 |
| 6 | Safari → youtube.com loads | #9 MTU |
| 7 | Telegram → send/receive message | #11 |
| 8 | Diagnostics → Run Self Test → all 4 green | #2 #10 #20 |
| 9 | Self Test "Exit IP" shows VPN server IP, not device IP | #20 |
| 10 | Disconnect → reconnect → admin Timeline has 2 separate sessions | #7 |
| 11 | Both sessions show `connected_verified` | #7 |
| 12 | Turn off WiFi mid-session → admin Timeline shows `NETCHANGE` event | #5 |
| 13 | Admin → log from step 12 → build=42 confirmed | #14 |
| 14 | `Device: lowPower=false` in log (or `lowPower=true` if device was in Low Power Mode) | #17 |
| 15 | `AppGroup: ... IPC=OK` in log | #16 |

### Pass criteria

All CI guards (A–G) must be green AND manual steps 1–15 must be ✓.

If any manual step fails, **do not promote to public group**. File issue with the tunnel log stem from admin.
