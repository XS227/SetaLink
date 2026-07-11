# RealGram — Technical Spike Report

**Author:** Agent A (dev box), 2026-07-11. **Status:** first spike pass —
the core transport interlock is PROVEN off-device; the two questions that
genuinely require a real Android build + real Iranian DPI are marked as
such and are the only remaining unknowns before a Path B go/no-go.

This answers the eight questions in `IMPLEMENTATION_PLAN.md` §Spike. It does
**not** authorize the full client build — per `DECISIONS.md`, Phase 4 still
needs Khabat's explicit sign-off on these findings.

---

## Headline finding

**TDLib speaks MTProto to Telegram's data centre through the existing
ReaLink/Xray local SOCKS5 endpoint — proven, with a control.** This is the
single biggest technical unknown in the whole RealGram plan, and it holds.
The architecture in `ARCHITECTURE.md` §2 (TDLib → local SOCKS5 → Xray →
Telegram, no second VPN stack, no TUN, no system VPN permission) is
technically sound.

### How it was proven (reproducible)

- Ran the app's **actual** Xray transport locally: `~/xray-udp-test/xray`
  with `client.json` — VLESS + REALITY + `flow=xtls-rprx-vision` to the
  production Finland node (`65.109.183.7`, SNI `www.cloudflare.com`), SOCKS5
  inbound on `127.0.0.1:11080`. Confirmed exit IP through the proxy =
  `65.109.183.7`.
- Drove **real TDLib** (`libtdjson.so`, TDLib 1.8.x from the `python-telegram`
  wheel) via its JSON interface with `ctypes`, calling `testProxy` —
  TDLib's built-in function that performs a full MTProto handshake against a
  named DC *through a given proxy*, requiring no `api_id` and no login.
  Request: `{"@type":"testProxy","server":"127.0.0.1","port":11080,
  "type":{"@type":"proxyTypeSocks5"},"dc_id":2,"timeout":15}`.
- **Result: `{"@type":"ok"}` on both samples** — TDLib completed the DC2
  handshake over the Xray tunnel.
- **Control (proves the OK is real):** the same `testProxy` against a dead
  local port (`127.0.0.1:19999`) returns
  `{"@type":"error","code":400,"message":"Connection refused"}`. So the OK
  is a genuine end-to-end handshake, not a library no-op.

Repro scripts left in `/tmp/spike_tdlib.py` (proxy path) and
`/tmp/spike_control.py` (dead-port control); Xray config in
`~/xray-udp-test/client.json`. Note: the prebuilt `libtdjson.so` links
OpenSSL 1.1, so on a 24.04 box it needs `libssl.so.1.1`/`libcrypto.so.1.1`
on `LD_LIBRARY_PATH` (extracted from the `libssl1.1` .deb) — a packaging
detail, not a RealGram constraint (the Android/iOS TDLib builds link their
own crypto).

---

## The eight questions

### Q1 — Can the existing ReaLink app open official Telegram for blocked users today? (Path B0)
**Answered YES from production telemetry — no new work needed to validate.**
The Android app is a full-device VpnService (`route 0.0.0.0/0`), so official
Telegram already tunnels through it. Iran telemetry proves it: Telegram
traffic flows over both the Finland Reality node and the Stealth/CDN node in
real tester sessions (see `realink-build78-backlog` history — `149.154.x`
Telegram flows, `sl-node3-ws` tunnel). **Path B0 is not a hypothesis to test;
it already works in the field.** The only case it can't cover: a market where
Telegram's *install/CDN* is blocked, not just its traffic (Q-distribution,
below).

### Q2 — Can TDLib connect through the ReaLink/Xray local SOCKS5 endpoint?
**PROVEN (headline finding).** Full MTProto DC handshake via `127.0.0.1:11080`
→ Xray → Telegram DC2, with a passing control. Caveat: proven on an
unrestricted network path to the node. It does **not** yet prove behaviour
under live Iranian DPI *to the node* — but that's the Xray transport's job,
not TDLib's, and that leg is already proven separately in production (the
same node carries real tester traffic from Iran daily). The new thing this
spike had to prove — that TDLib is happy behind our SOCKS5 — is proven.

### Q3 — Reuse an existing mobile shell, or a separate native project? (`ARCHITECTURE.md` §3 Option 1 vs 2)
**Evidence favours Option 1 (reuse), decision still Khabat's.** The transport
proof means RealGram needs only: TDLib + a thin SOCKS5 wiring to the Xray
process the app already bundles. That's an additive module in the existing RN
app, not a from-scratch client. A separate app would duplicate `libxray.so`
(36 MB arm64, see §Q5) for no transport benefit. Recommendation: reuse.

### Q4 — Smallest legally/technically maintainable Telegram-compatible baseline?
TDLib mandates its own minimum (auth, DC migration, updates loop, secret
storage) regardless of UI surface. On top of that, the app-store-safe
minimum (`APP_STORE_COMPLIANCE.md`: no Telegram branding, own "Sponsored"
label, no "bypass a blockade" marketing) is a chat-list + thread + media
send/receive. Groups/channels/calls/stickers are scope on top. **This is a
product-scoping decision, not a technical blocker** — the transport doesn't
constrain it.

### Q5 — How much release size does TDLib + wiring add? (feeds `BUILD_SIZE_BUDGET.md` §3)
Measured, with one figure still needing an Android NDK build:

| Binary | Size | Source |
|---|---:|---|
| App's current `libxray.so` (arm64) | 36.5 MB | measured, `android/.../jniLibs/arm64-v8a` |
| App's current `libtun2socks.so` (arm64) | 16.3 MB | measured, same |
| TDLib `libtdjson.so` (linux x86_64, OpenSSL-linked) | 38.5 MB | measured, python-telegram wheel |
| TDLib `libtdjson.so` (**Android arm64, stripped**) | **~15–25 MB (estimate)** | needs an NDK build to confirm — the desktop 38.5 MB includes x86_64 + debug-ish symbols; stripped arm64 TDLib is typically materially smaller |

**Key size win, confirmed by Q2/Q3:** the SOCKS5 approach means **no second
Xray/tun2socks copy** — RealGram-as-a-module adds only TDLib, not the whole
VPN stack again. If RealGram ships as a *separate* app instead, it would
carry its own `libxray.so` (+36 MB), which is the strongest size argument for
Option 1 (reuse). The Android arm64 `libtdjson.so` measurement is the one
remaining `BUILD_SIZE_BUDGET.md` §3 blocker.

### Q6 — Can Shahnameh/reward features stay remote/on-demand?
**Yes, unaffected by TDLib.** TDLib governs only the Telegram transport;
Shahnameh stays a WebView/Mini App and AdsGram reuses the Shahnameh reward
engine (`lib/adsgram.js`) exactly as the ecosystem wallet work already does.
Nothing in the transport model forces game/media assets into the bundle
(`BUILD_SIZE_BUDGET.md` §4 rule holds).

### Q7 — What store permissions are truly required?
**Strong evidence: NO VPN / network-extension permission for the Telegram
path.** The entire Q2 proof was a plain SOCKS5 dial to a loopback port — no
TUN interface, no `VpnService`, no `NEPacketTunnelProvider` was involved.
TDLib's own SOCKS5 setting carries its traffic. This is the cleanest possible
store-risk posture: RealGram's messaging can work as an ordinary app that
happens to point TDLib at a local proxy. (If RealGram *also* wants to tunnel
the whole device like the current ReaLink app, that's a separate, optional
VPN-permission feature — not required for the core promise.) Confirm on a
real device build, but the architecture supports it.

### Q8 — Which features need no full-device VPN service?
Per Q7: the core Telegram messaging path needs none. Everything TDLib does
(chats, media, calls' signalling) rides the SOCKS5 proxy. A full-device VPN
would only be needed to tunnel *other* apps — which is explicitly out of
RealGram's Path A/module scope (`ARCHITECTURE.md` §7). No feature in the
minimum baseline (Q4) requires TUN.

---

## What still needs a real device / real DPI (the only open items)

1. **Android arm64 `libtdjson.so` size** — one NDK build to close
   `BUILD_SIZE_BUDGET.md` §3. Everything else in the size budget is measured.
2. **TDLib-over-SOCKS5 under live Iranian DPI, on-device** — the transport
   leg to the node is already production-proven, and TDLib-behind-SOCKS5 is
   now proven; the only thing not yet done in one combined shot is *both at
   once on a real phone in Iran*. Low residual risk given both halves are
   proven, but it's the honest last gate before shipping.

Neither is a blocker to *deciding* Option 1 (reuse) or to Agent B's Path A
Mini App work, which shares no code with this transport path.

## Recommendation to Khabat

- The transport premise is sound: **build RealGram as a module in the
  existing app (Option 1), TDLib over the bundled Xray's local SOCKS5, no new
  VPN permission.**
- Close the two open items above with a single throwaway Android build before
  committing to the full chat UI.
- Path A (Mini App, Agent B) and Phases 1–2 (ecosystem wallet, already built)
  proceed independently and don't wait on any of this.

_No production services were touched by this spike. The only process started
was a local Xray on loopback, now stopped; the system Xray service was not
touched._
