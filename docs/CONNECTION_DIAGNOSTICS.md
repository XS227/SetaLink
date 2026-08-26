# Connection Diagnostics — real measured VPN performance

**Date:** 2026-07-20 · **Status:** implemented (server + client code), **not deployed, not built**.
Written by a Claude Code session (dev-box, `5.249.255.116`) after a real iOS
tester reported the Starlink node felt slow while other iOS/Android testers
called it great. See `STARLINK_WINDOWS_HANDOFF.md` §32-35 for the investigation
that led here — the short version: every performance column in
`connect_telemetry` (`latency_ms`, `jitter_ms`, `throughput_kbps`, `rtt_ms`)
already existed and was schema-ready, but the client never actually measured
or sent real values for most of them, and `rtt_ms` was outright **fabricated**
(30% of total connect latency, a guess dressed as a measurement). There was no
way to tell "Starlink is genuinely worse right now" from "this one tester's
household link had a bad five minutes" from "we're imagining the whole thing."

This doc is the map of what changed, what's real, and what's still a known
gap — read this before extending the Connection Diagnostics feature, so you
don't duplicate work or re-fabricate a number this doc already flags as fake.

---

## 1. What's actually measured now vs. before

| Metric | Before | Now |
|---|---|---|
| `latency_ms` / `time_to_connect_ms` | Real (connect-to-first-byte) | Unchanged — already real |
| `rtt_ms` | **Fabricated**: `latency_ms * 0.3` | Removed. Not sent from the sync connect report (nothing better to put there yet — see §4 gap) |
| `jitter_ms` | Column existed, never sent | **Real**: stddev of 5 sequential probe RTTs, `connectionDiagnostics.ts::runJitterPacketLossProbe()` |
| `packet_loss_pct` | Didn't exist | **Real** (approximated): % of those 5 probes that failed/timed out — see §5 for why this isn't true ICMP loss |
| `throughput_down_kbps` / `throughput_up_kbps` | Column existed (`throughput_kbps`, singular, unused) | **Real**: timed 1 MB download / 256 KB upload against `/v1/speedtest/*`, `runThroughputTest()` |
| `network_type` (wifi/mobile) | Type existed, never sent from `_reportTelemetry` | **Real**: native `XrayModule.getNetworkInfo()`, both platforms |
| `network_generation` (5g/4g/3g/2g) | Didn't exist | **Best-effort real** — see §4, permission-dependent on Android |
| `mtu` | Didn't exist | Real, but not measured — it's a known constant (1400/1280) already baked into the client, just wasn't being reported |
| `device_model` | Column existed, sent to the OLD `reportToAdmin()` path only | Now also reaches `connect_telemetry` via `_reportTelemetry()` |
| `tcp_connect_ms` / `handshake_ms` | Didn't exist | **Schema + backend ready, NOT populated** — see §4, this is the one metric from Khabat's list that isn't real yet |

---

## 2. Architecture

```
Mobile app (connect_ok)
  └─ _reportTelemetry()                     [autoConnector.ts]
       ├─ POST /v1/telemetry/connect          (existing, extended: device_model, mtu,
       │                                        network_type, network_generation)
       └─ scheduleConnectionDiagnostics()      fires ~4s later, non-blocking
            ├─ runJitterPacketLossProbe()       5x GET /v1/speedtest/download?bytes=256
            ├─ runThroughputTest()              1x GET .../download?bytes=1048576
            │    (only on Wi-Fi, see §3)        1x POST .../upload (256 KB body)
            └─ POST /v1/telemetry/connect        trigger='diagnostics'
                                                  -> stored as event='diagnostics_probe'
                                                     (server-side override, see v1.php)

connect_telemetry (SQLite, data/analytics.db)
  └─ ni_perf_breakdown($pdo, $dimension, $days)   [lib/node_intel.php]
       dimension ∈ {node_id, platform, network_type, network_generation}
       AVG()s every perf column, COUNT()s real samples per column (n_*),
       counts total/ok from actual connect events only (diagnostics_probe
       rows contribute their metrics but don't inflate attempt counts)

admin/api.php?action=connection-diagnostics
  └─ admin/index.php, page=diagnostics ("Connection Diagnostics" nav tab)
       By Node (Starlink vs fi-hel vs primary) / By Platform / By Network Type
       / By Cellular Generation — four independent ni_perf_breakdown() calls
```

**Why a second telemetry row (`trigger='diagnostics'`) instead of adding the
probe results to the connect report directly?** The probes take real
wall-clock time — up to ~15s for the throughput leg on a slow link — and must
never delay the connect flow the user is staring at. `_reportTelemetry()`
still fires immediately and cheaply on connect; the heavier probe is a
separate, delayed, best-effort follow-up that can fail silently without the
user ever noticing.

**Why `event='diagnostics_probe'` instead of `event='connect_ok'`?** A
diagnostics row happens once per successful connect (a few seconds later) —
if it were also counted as `connect_ok`, every node/platform/network's
success-rate and attempt-count in the EXISTING Network Intel page
(`ni_node_scores`, `ni_platform_breakdown`, etc.) would double-count. See the
`ni_valid_event()` comment and the `event NOT IN (...)` exclusions added
alongside `quic_probe`/`quic_probe_direct` in `ni_node_scores()` and
`ni_learned_routing()`. `ni_perf_breakdown()` deliberately does NOT exclude
`diagnostics_probe` — that's the whole row this feature exists to read.

---

## 3. Data-usage guardrail (this product's primary market is Iran)

The throughput test moves ~1.25 MB. Cellular data has a real per-MB cost for
many testers, so `shouldRunThroughputTest()` only runs it automatically on
Wi-Fi. The jitter/packet-loss probe (5 × 256 bytes ≈ 1.3 KB total) always
runs — cheap enough to not matter on any connection.

The `/v1/speedtest/*` endpoints are server-side capped at 4 MB per request
(`V1_SPEEDTEST_MAX_BYTES`) and rate-limited to 6 requests/minute/IP
(`ni_speedtest_gate()`, separate bucket from the telemetry rate limit) —
protects the smaller VPN nodes (1 GB RAM class, see `CLAUDE_REALINK_RULES.md`)
from becoming an accidental bandwidth sink.

---

## 4. Known gaps — read before extending this

1. **`tcp_connect_ms` / `handshake_ms` are NOT populated.** These need a
   timing boundary INSIDE the native connect probe (the moment the raw TCP
   socket opens vs. the moment the Reality/TLS handshake completes) — that
   boundary lives inside the native Xray/HEV connect path
   (`XrayVpnService.kt` / `PacketTunnelProvider.swift` + the Go tun2socks/HEV
   core), not in JS. This session deliberately did NOT touch that native
   timing internals — it's real surgery on the actual connect path, on code
   this session couldn't compile or test, versus this feature's other pieces
   (new bridge methods, new backend columns, new probe requests) which are
   additive and fail safe. The DB column, `ni_record()` plumbing, and the
   admin page's columns are all ready — they'll just read "—" (0 samples)
   until a future session wires up the native split. Don't re-derive this
   from `time_to_connect_ms` by guessing a percentage — that's exactly the
   `rtt_ms` mistake this doc exists to warn against repeating.

2. **`network_generation` is real but likely reads "unknown" on Android.**
   `TelephonyManager.dataNetworkType` has historically required
   `READ_PHONE_STATE`, which this app does NOT declare in
   `AndroidManifest.xml` (deliberately not added this session — a new
   dangerous permission has Play Store review + user-facing prompt
   implications, out of scope for a backend/telemetry change). The read is
   wrapped in `runCatching { }.getOrDefault("unknown")` so it never crashes —
   it just won't have real data until/unless that permission is added. iOS
   doesn't need special permission for `CTTelephonyNetworkInfo`, so iOS
   generation data should be real from day one.

3. **No manual "run diagnostics now" trigger exists**, in-app or in admin.
   Everything here is automatic (every connect). If a specific tester needs
   to be diagnosed RIGHT NOW rather than waiting for their next connect, the
   fastest path today is still what §33 already suggested: ask them to
   connect via Starlink, wait ~5s, then check this admin page filtered to
   that time window — or add a manual trigger later if this becomes a
   recurring need.

4. **Not built, not deployed.** Per this VPS's CLAUDE.md rules, this session
   made code changes only — no `npm install`/build/pm2/nginx changes. A real
   device won't send any of this until a new build ships. See the mobile-app
   release checklist docs for the build/TestFlight/Play process.

---

## 5. Why jitter/packet-loss are HTTPS-probe-based, not real ICMP

Mobile apps have no raw socket / ICMP access without root (iOS: sandboxed,
no raw sockets at all outside NetworkExtension's own tunnel context; Android:
possible but requires root or a suid ping binary, neither acceptable here).
The achievable signal at this layer is N sequential small HTTPS requests
against `/v1/speedtest/download?bytes=256`, timing each and computing:

- **jitter** = standard deviation of the N round-trip times
- **packet loss%** = fraction of the N requests that failed or timed out

This is the same category of approximation most consumer network-diagnostic
apps use for the same reason. It's a real, honest, useful signal — just not
literally the same number `ping -c 10` would report (TCP+TLS setup overhead
inflates each sample vs. a bare ICMP echo). Documented here so nobody "fixes"
this later by fabricating a conversion factor.

---

## 6. Files touched

Backend: `lib/node_intel.php` (schema + `ni_record()` + `ni_valid_generation()`
+ `ni_perf_breakdown()` + `ni_speedtest_gate()`), `public/v1.php`
(`/telemetry/connect` extended, new `/speedtest/download` + `/speedtest/upload`),
`admin/api.php` (`connection-diagnostics` action), `admin/index.php` (new
"Connection Diagnostics" nav tab + page + JS view; also fixed a pre-existing
page-whitelist bug for `starlink`/`tunnellogs`, same class as the one
`feat/admin-noc-consolidated` already fixed independently).

Mobile: `mobile-app/src/services/api/telemetry.api.ts` (payload fields),
`mobile-app/src/services/connectionDiagnostics.ts` (new — the probe logic),
`mobile-app/src/services/networkInfoService.ts` (`getConnectionType()`),
`mobile-app/src/services/autoConnector.ts` (`_reportTelemetry()` extended,
`scheduleConnectionDiagnostics()` new), `mobile-app/android/app/src/main/java/
com/setalink/modules/XrayModule.kt` (`getNetworkInfo()` native method),
`mobile-app/ios/SetaLink/XrayModule.swift` (`getNetworkInfo()` native method,
`import Network`).
