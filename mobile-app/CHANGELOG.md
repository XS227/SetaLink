# Changelog

All notable changes to SetaLink are documented here.

## [0.9.33] — 2026-06-14

### Added
- **User-to-user messaging (MVP)** — the Inbox is now a two-way chat surface. Users message each other by SetaLink ID only (`SL-227-…` user_id / device_id / referral code); no phone, email, or IP is involved.
  - Inbox gains **Messages / Announcements** tabs and a **＋ New message** compose modal (recipient ID + body, 2000-char cap).
  - New backend endpoints (`public/api.php`): `send-message`, `list-messages`, `mark-message-read`; shared logic in `lib/messaging.php`.
  - Messages stored server-side in `data/analytics.db` (`user_messages`), **bodies encrypted at rest** (libsodium secretbox, AES-256-GCM fallback).
  - **Anti-spam**: recipient existence validated, self-send blocked, rate limit 10/min + 300/day per device.
  - `user_blocks` / `user_reports` tables created (structure-only) for a later block/report feature.
- **Admin dashboard "Messaging (DM)" card** — total / unread / read / sent-24h / distinct senders & recipients. Metadata only — message content is never shown (the stats endpoint never reads the encrypted body).

## [Unreleased]

### Fixed
- **Real Android VPN tunnel** — `@ReactMethod` annotations added to all XrayModule bridge methods; without these, Old Architecture (newArchEnabled=false) never exported methods to JS, causing the app to silently fall back to MockAdapter and show fake "CONNECTED" state with no real VPN tunnel
- **VPN icon now appears in status bar** — `startForeground()` now passes `FOREGROUND_SERVICE_TYPE_SPECIAL_USE` on API 34 (Android 14); omitting the type caused `MissingForegroundServiceTypeException` which crashed the service before `establish()` could run
- **Routing loop eliminated** — replaced CIDR split-routing with `addDisallowedApplication(packageName)`: the app's entire UID (including Xray and tun2socks subprocesses) now bypasses the TUN at the kernel level, so Xray can reach the VPN server without looping through the tunnel it's filling
- **NativeModules fallback** — vpnBridge.ts now falls back to `NativeModules.XrayModule` when `TurboModuleRegistry.getEnforcing` fails, ensuring the native adapter loads on Old Architecture regardless of module registry path
- **IPv6 leak prevention** — TUN now includes IPv6 address (`fdfe:dcba:9876::2/64`) and full `::/0` route, preventing device IPv6 traffic from bypassing the tunnel
- **Error detection speed** — polling loop now checks `getLastError()` on every cycle and breaks early on failure instead of waiting the full timeout
- **Timeout extended** — connection wait increased from 15 s to 30 s to accommodate slower Xray startup on low-end devices
- **tun2socks fd passing** — switched from `fd://N` (requires O_CLOEXEC clearing via hidden API) to `/proc/PID/fd/N` filesystem path, which tun2socks opens directly without needing the fd to be inherited across exec()
- **`setMetered(false)`** on API 29+ so Android does not throttle the VPN interface
- **Kill switch default** — changed from `true` to `false` (was disconnecting VPN on every background event)
- **Config persistence** — imported VLESS configs and selected server now survive app restarts via MMKV-backed Zustand persist
- **Settings persistence** — bumped settings store key to `setalink-settings-v2` to clear stale persisted kill-switch state
- **Demo servers removed** — `SERVER_CATALOG` is now empty; only real imported or backend-provided nodes appear
- **Settings button** — Home screen settings icon was not forwarding tap events; `onPress` handler added
- **State restoration** — `useAppBoot` now calls native `isRunning()` on mount to sync state if app was restarted while VPN was active

## [0.1.0] — 2026-04-01

### Added
- Initial React Native app shell with navigation (Home, Servers, Settings, Profile tabs)
- VLESS Reality connection via Xray-core bundled binary
- tun2socks for TUN ↔ SOCKS5 bridging
- VLESS URI import and validation
- Subscription URL import (base64-encoded server lists)
- MMKV-backed persistent storage
- ConnectionMachine state machine (idle/connecting/connected/disconnecting/error/reconnecting)
- AI-assist server ranking by mode (gaming, streaming, stealth, auto)
- Session history
- Persian (Farsi) + English bilingual UI
- Kill switch (disconnect on background)
- Auto-connect on app open
- Foreground service with persistent notification
- Android VPN permission flow
- Admin panel backend integration stub
