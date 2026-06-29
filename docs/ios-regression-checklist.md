# iOS TestFlight Regression Checklist

Run before every TestFlight release. All steps must pass. Mark each ✓ / ✗.

---

## Pre-build (CI)

| # | Check | Result |
|---|-------|--------|
| 1 | CI guard: `SOCK_SEQPACKET` not found in PacketTunnelProvider.swift | |
| 2 | CI guard: `completionHandler(nil)` appears exactly once | |
| 3 | CI guard: `STATE: connected_verified` present in source | |
| 4 | Build exits 0, no Swift compile errors | |
| 5 | TestFlight upload succeeds, build visible in App Store Connect | |

---

## Fresh install

| # | Check | Result |
|---|-------|--------|
| 6 | Delete app, install fresh from TestFlight | |
| 7 | App launches without crash | |
| 8 | Welcome screen appears on first launch | |
| 9 | Device auto-registers (admin → Devices shows new device) | |

---

## Connect

| # | Check | Result |
|---|-------|--------|
| 10 | Tap Connect — tunnel starts | |
| 11 | Admin → Tunnel Logs — new log appears within 60s | |
| 12 | Admin → Tunnel Logs → open log — Connection Timeline shows `connected_verified` ✅ (green) | |
| 13 | Timeline shows HEV bridge started (not FAILED) | |
| 14 | Timeline shows FIRST-PKT-OUT and FIRST-PKT-IN | |
| 15 | `tunnel_state = connected_verified` in App Group (Self Test → Tunnel Route Verified ✓) | |

---

## Safari works

| # | Check | Result |
|---|-------|--------|
| 16 | Open Safari → google.com loads | |
| 17 | Open Safari → youtube.com loads | |
| 18 | Open Safari → https://1.1.1.1/cdn-cgi/trace — `ip=` shows VPN server exit IP (not device IP) | |

---

## Telegram works

| # | Check | Result |
|---|-------|--------|
| 19 | Open Telegram — messages load | |
| 20 | Send a message — delivered | |
| 21 | Voice call (optional) — audio flows | |

---

## Self Test (Diagnostics screen)

| # | Check | Result |
|---|-------|--------|
| 22 | Open Diagnostics → Run Self Test | |
| 23 | DNS Resolution ✓ | |
| 24 | HTTPS (IP-direct) ✓ | |
| 25 | Tunnel Route Verified ✓ | |
| 26 | Exit IP ✓ — shows VPN server IP, not device IP | |

---

## Disconnect & reconnect

| # | Check | Result |
|---|-------|--------|
| 27 | Tap Disconnect — tunnel stops | |
| 28 | Safari fails (no tunnel) | |
| 29 | Tap Connect again — reconnects within 30s | |
| 30 | Safari works again after reconnect | |

---

## Diagnostic upload

| # | Check | Result |
|---|-------|--------|
| 31 | Admin → Tunnel Logs — at least 2 logs appear (connect + reconnect) | |
| 32 | Connection Timeline on both logs shows `connected_verified` | |
| 33 | No "unknown" device_id on new device logs | |
| 34 | Probe result column shows ✓ for both sessions | |

---

## Watchdog validation (optional — requires forced failure)

| # | Check | Result |
|---|-------|--------|
| 35 | Kill xray process mid-session — watchdog fires within 8s of next outbound packet | |
| 36 | Admin → Tunnel Logs — `WATCHDOG-FAIL` line appears in log | |
| 37 | iOS VPN disconnects automatically (not "Connected" with no internet) | |

---

## Pass criteria

All of items 1–34 must pass. The build is safe to release when every row shows ✓.

If any of 1–3 fails: **stop, do not release, fix the CI guard first.**  
If 12–15 fail (Timeline shows failed or no `connected_verified`): **blocked — HEV path is broken.**  
If 16–21 fail but 12–15 pass: xray/Reality server issue, not an iOS bug. Check server logs.

---

## iOS vs Android Config Differences

The xray JSON config (`buildXrayConfig()` in `xrayConfigBuilder.ts`) is **identical** for iOS
and Android. Both platforms receive:

```
inbounds:  socks-in :10808, http-in :10809
outbounds: proxy (vless/reality), direct, dns-out, blackhole
routing:   LAN→direct, port53→dns-out, UDP443→blackhole, IPv6→blackhole
```

The differences are entirely in **how each platform uses the config**:

| Aspect | iOS (PacketTunnelProvider) | Android (VpnService) |
|--------|---------------------------|----------------------|
| TUN creation | `NEPacketTunnelProvider` (OS managed) | `VpnService.establish()` (fd 10) |
| Packet relay | hev-socks5-tunnel via `socketpair(AF_UNIX, SOCK_DGRAM)` | tun2socks reads fd 10 directly |
| Socket protection | Server IP excluded via `NEIPv4Route` excluded routes | `VpnService.protect(socket)` on xray outbound socket |
| IPv6 | Claim + drop (`NEIPv6Route.default()`, no handler) | Excluded from TUN routes |
| DNS | `NEDNSSettings(servers:["1.1.1.1","8.8.8.8"])` | xray `dns-out` rule handles port 53 |
| HTTP proxy | Not set in HEV mode (NEProxySettings in `#else` only) | Not used (TUN handles all traffic) |
| Probe method | URLSession via explicit `proxyDict` (bypasses TUN) | SOCKS5 probe via tun2socks |
| Connectivity gate | All 3 probes must pass (IP-direct, DNS+proxy, SOCKS5) | SOCKS5 probe must pass |
| Post-connect watchdog | 8s from FIRST-PKT-OUT, fires if FIRST-PKT-IN absent | Not implemented |
| State reporting | `tunnel_state` written to App Group UserDefaults | Intent broadcast to JS |

**Key insight**: iOS probe 2 (via HTTP proxy 10809) and probe 3 (via SOCKS5 10808) both
bypass the TUN — they go directly to xray's inbound ports. Neither proves HEV is working.
Only `FIRST-PKT-IN` in the log confirms the full TUN→HEV→xray→internet round-trip.
The post-connect watchdog (8s timer from FIRST-PKT-OUT) is the safety net that catches
a broken HEV path after `connected_verified` is declared.
