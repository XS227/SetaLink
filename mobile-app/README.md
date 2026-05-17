# SetaLink VPN

![Android](https://img.shields.io/badge/Android-6.0%2B-3DDC84?logo=android&logoColor=white)
![React Native](https://img.shields.io/badge/React%20Native-0.73-61DAFB?logo=react&logoColor=white)
![Xray-core](https://img.shields.io/badge/Xray--core-VLESS%20Reality-FF6B35)
![License](https://img.shields.io/badge/License-GPL--3.0-blue)

Free, open-source Android VPN using the **VLESS Reality** protocol — ultra-low detection fingerprint, designed for networks that actively block standard VPN traffic.

---

## Features

- **VLESS Reality tunneling** — traffic fingerprint mimics normal HTTPS; bypasses DPI and deep packet inspection
- **Import any VLESS URI** — paste a `vless://` link from any provider, persisted across restarts
- **Real Android VPN tunnel** — full `VpnService` integration, appears in Android VPN settings, shows system VPN key icon
- **Background protection** — foreground service keeps tunnel alive when app is minimized
- **Kill switch** — optionally disconnects when app is backgrounded
- **Auto-reconnect** — exponential-backoff retry on dropped connections
- **Persian + English** — full bilingual UI
- **Diagnostics log** — per-step tunnel setup log for debugging connection failures

---

## Screenshots

> _Screenshots coming in the next release._

---

## Architecture

```
┌─────────────────────────────────────────────────────┐
│  React Native UI  (HomeScreen, ServersScreen, ...)   │
│          ↕ Zustand stores (vpnStore, serverStore)    │
├─────────────────────────────────────────────────────┤
│  ConnectionMachine  (pure TS state machine)          │
│          ↓ VpnAdapter interface                      │
│  NativeAdapter  ──────────────────────────────────── │
│  (vpnBridge.ts)       ↓ @ReactMethod bridge          │
├─────────────────────────────────────────────────────┤
│  XrayModule.kt  (Android TurboModule / Bridge)       │
│          ↓ startForegroundService()                  │
│  XrayVpnService.kt                                   │
│    1. VpnService.prepare() permission check          │
│    2. Extract Xray + tun2socks binaries from assets  │
│    3. Write Xray JSON config to disk                 │
│    4. Start Xray process (SOCKS5 on :10808)          │
│    5. VpnService.Builder.establish() → TUN fd        │
│    6. tun2socks: TUN fd → SOCKS5 proxy               │
│    7. Broadcast CONNECTED → JS store updates         │
├─────────────────────────────────────────────────────┤
│  Kernel TUN interface  (Android routes all traffic)  │
│          ↕ tun2socks reads/writes packets            │
│  Xray-core  (VLESS Reality outbound to server)       │
└─────────────────────────────────────────────────────┘
```

See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for the full technical breakdown.

---

## Build Instructions

### Prerequisites

| Tool | Version |
|------|---------|
| Node.js | 18+ |
| Yarn | 1.22+ |
| JDK | 17 |
| Android SDK | API 34 (compileSdk) |
| Android NDK | As specified in `build.gradle` |

### Steps

```bash
# 1. Install JS dependencies
cd mobile-app
yarn install

# 2. Build release APK
cd android
./gradlew assembleRelease

# 3. Output
# app/build/outputs/apk/release/app-arm64-v8a-release.apk
```

The release APK targets `arm64-v8a` only (all modern Android phones since ~2015). For debugging, use `./gradlew assembleDebug` and install via `adb install`.

### Signing

Copy `android/keystore.properties.example` to `android/keystore.properties` and fill in your keystore details. Without signing, the release build uses the debug keystore.

---

## Importing a Server Config

1. Open the app → **Servers** tab → tap the import (link) button
2. Paste a `vless://` URI — example:
   ```
   vless://UUID@server.example.com:443?security=reality&sni=...&pbk=...&sid=...&fp=chrome&flow=xtls-rprx-vision#My Server
   ```
3. The server is saved locally (MMKV) and survives app restarts
4. Tap the server to select it, then connect from the Home screen

---

## Changelog

See [`CHANGELOG.md`](CHANGELOG.md).

---

## Roadmap

- [ ] Backend node sync (auto-fetch servers from admin panel)
- [ ] Connection diagnostics screen (full step log in UI)
- [ ] iOS support (NEPacketTunnelProvider)
- [ ] Subscription URL import (base64 encoded server lists)
- [ ] Split tunneling (per-app bypass)
- [ ] Traffic statistics (real byte counters from Xray stats API)
- [ ] Widgets and quick-connect tile

---

## Security & Privacy

- **No logs collected** — the app does not send usage data, connection logs, or analytics to any server
- **No telemetry** — all connection state is local
- **Open source** — the full tunnel stack (Xray, tun2socks) is open source and auditable
- **Config stored locally** — VLESS credentials are stored only on-device in MMKV (not synced to any cloud)

---

## Contributing

Pull requests welcome. Please open an issue first for significant changes.

The app borrows architectural patterns from [v2rayNG](https://github.com/2dust/v2rayNG) (GPL-3.0) and [Psiphon](https://github.com/Psiphon-Inc/psiphon-android) (GPL-3.0). Any derivative works must also be released under GPL-3.0.

---

## License

GPL-3.0 — see [LICENSE](LICENSE).
