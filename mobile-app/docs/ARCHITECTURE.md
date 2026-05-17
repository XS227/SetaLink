# SetaLink — Technical Architecture

## Connection Flow

```
User taps "Connect"
      │
      ▼
vpnStore.connect()
  └─ machine.send('CONNECT')
        │
        ▼
ConnectionMachine: idle → connecting
  └─ _doConnect() → adapter.connect(configJson)
        │
        ▼
NativeAdapter.connect()        (src/services/vpnBridge.ts)
  1. fetchPublicIp()            ← pre-connect IP snapshot
  2. module.start(configJson)   ← @ReactMethod bridge call
  3. Poll isRunning() + getLastError() every 500 ms (up to 30 s)
  4. fetchPublicIp()            ← post-connect IP verification
  5. throw if IP unchanged      ← routing sanity check
        │
        ▼
XrayModule.kt                  (Android TurboModule / bridge)
  • VpnService.prepare()       ← request system VPN dialog if needed
  • startForegroundService()   ← start XrayVpnService
  • promise.resolve()          ← returns to JS immediately
        │
        ▼ (async, in XrayVpnService coroutine)
XrayVpnService.establishTunnel()
  1. VpnService.prepare(this) == null?   ← safety check
  2. extractBinary("xray-arm64")
  3. extractBinary("tun2socks-arm64")
  4. configFile.writeText(configJson)
  5. ProcessBuilder(xray, "run", "-c", configFile)
  6. waitForPort(10808, 8s)             ← wait for Xray SOCKS5
  7. VpnService.Builder
       .addAddress("10.0.0.2", 24)
       .addRoute("0.0.0.0", 0)          ← full tunnel
       .addDisallowedApplication(pkg)   ← Xray/tun2socks bypass VPN
       .establish()                     ← creates TUN, shows VPN icon
  8. ProcessBuilder(tun2socks,
       "--device", "/proc/PID/fd/N",    ← TUN fd via proc symlink
       "--proxy",  "socks5://127.0.0.1:10808")
  9. sendBroadcast(BROADCAST_CONNECTED)
        │
        ▼
XrayModule BroadcastReceiver
  • running = true
        │
        ▼
NativeAdapter poll: isRunning() → true
  └─ machine.send('CONNECTED')
        │
        ▼
ConnectionMachine: connected
  └─ onConnected() → vpnStore update → UI shows CONNECTED
```

## Key Files

| File | Responsibility |
|------|---------------|
| `src/screens/HomeScreen.tsx` | Main connect/disconnect UI |
| `src/screens/ServersScreen.tsx` | Server list, VLESS import |
| `src/stores/vpnStore.ts` | VPN state machine, connection lifecycle |
| `src/stores/serverStore.ts` | Server records, imported credentials (MMKV-persisted) |
| `src/stores/settingsStore.ts` | App settings (kill switch, autoConnect, DNS mode) |
| `src/services/connectionMachine.ts` | Pure TS state machine: idle/connecting/connected/error/reconnecting |
| `src/services/vpnBridge.ts` | NativeAdapter (real tunnel) + MockAdapter (dev/test) |
| `src/services/xrayConfigBuilder.ts` | Builds Xray JSON config from VLESS credentials |
| `src/services/subscriptionService.ts` | VLESS URI parser + subscription URL fetcher |
| `src/specs/NativeXrayModule.ts` | TurboModule spec (typed bridge to Android) |
| `android/.../XrayModule.kt` | Android bridge: VPN permission, service start/stop |
| `android/.../XrayVpnService.kt` | Android VPN service: TUN, Xray, tun2socks |
| `android/.../XrayPackage.kt` | Registers XrayModule with React Native |
| `src/storage/storage.ts` | MMKV-backed Zustand storage adapter |

## State Machine

```
         CONNECT
idle ──────────────► connecting
  ▲                      │ CONNECTED
  │ RESET                ▼
error ◄──────── FAILED  connected
  │                      │ DISCONNECT
  │ CONNECT              ▼
  └──────► reconnecting  disconnecting
               │ CONNECTED  │ DISCONNECTED
               └────────────┘
                            │
                            ▼
                           idle
```

States:
- **idle** — no connection, ready
- **connecting** — `adapter.connect()` in flight (waiting for SOCKS5, TUN, tun2socks)
- **connected** — TUN active, traffic routing through Xray
- **disconnecting** — `adapter.disconnect()` in flight
- **error** — connection failed; error message stored in `vpnStore.error`
- **reconnecting** — auto-retry after error (exponential backoff, max 3 attempts)

## VPN Tunnel Stack

```
Android device apps
      │ (all traffic, all ports)
      ▼
TUN interface (10.0.0.2/24)    ← created by VpnService.Builder.establish()
      │ raw IP packets
      ▼
tun2socks (Go binary)          ← reads TUN, implements userspace TCP/UDP stack
      │ SOCKS5 requests
      ▼
127.0.0.1:10808                ← Xray SOCKS5 inbound
      │ proxied connections
      ▼
Xray-core (Go binary)          ← VLESS Reality outbound
      │ VLESS/TLS stream
      ▼
VPN server (VLESS Reality)
      │
      ▼
Internet
```

**Why `addDisallowedApplication(packageName)` is critical:**
Xray and tun2socks run as subprocesses of our app, sharing the same UID. Android's VPN routing is UID-based. Without excluding our own UID, Xray's outbound socket (to the VPN server) would be routed back into the TUN it's trying to fill — a routing loop. `addDisallowedApplication` excludes all processes with our UID from VPN routing at the kernel level, so Xray connects directly to the server while all other app traffic goes through the tunnel.

## VLESS URI Format

```
vless://UUID@host:port?
  security=reality
  &sni=trusted-domain.com
  &pbk=PUBLIC_KEY_HEX
  &sid=SHORT_ID_HEX
  &fp=chrome
  &flow=xtls-rprx-vision
  #Server Name
```

Fields used by `xrayConfigBuilder.ts`:
- `UUID` → Xray user ID
- `host:port` → server address and port
- `pbk` → Reality public key (X25519)
- `sid` → Reality short ID
- `sni` → TLS SNI (legitimate domain to impersonate)
- `fp` → TLS fingerprint (`chrome`, `firefox`, etc.)
- `flow` → must be `xtls-rprx-vision` for Reality

## Config Persistence

All user data is stored locally using **MMKV** via Zustand's `persist` middleware:

| Store | MMKV Key | What's stored |
|-------|----------|---------------|
| `serverStore` | `setalink-servers-v1` | Server records + VLESS credentials |
| `settingsStore` | `setalink-settings-v2` | Kill switch, DNS mode, language, etc. |

Nothing is sent to any remote server. Settings and configs survive app restarts and updates.
