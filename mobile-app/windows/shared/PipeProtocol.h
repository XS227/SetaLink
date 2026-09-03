#pragma once
//
// Wire protocol between the RealGram Windows app's native `XrayModule` (an
// unelevated, unpackaged win32 process running as the interactive user) and
// RealGramVpnService.exe (a SYSTEM-level Windows service, installed by
// RealGram-Setup.exe, that owns the WinTun adapter + xray-core/tun2socks
// child processes and the elevated routing changes neither the app process
// nor a per-connect UAC prompt should be doing — see the "background
// service" architecture decision for the Windows VPN client).
//
// This mirrors, over IPC, the same start/stop/status surface Android's
// XrayModule.kt exposes directly (in-process, via VpnService + broadcasts)
// and iOS's NEPacketTunnelProvider exposes via App Group state — same shape,
// different transport, so vpnBridge.ts's NativeAdapter needs no changes.
//
// Framing (both directions): 1-byte code, 4-byte little-endian payload
// length, then that many UTF-8 payload bytes. One request -> one response
// per pipe connection (connect, write request, read response, disconnect) —
// control-plane traffic only (a few calls/second at most from JS-side
// polling), not the data path, so this is deliberately not optimized beyond
// "correct and simple".
//

#include <cstdint>

namespace RealGramVpn {

// Same name the service registers with the SCM (RealGram.iss's `sc create`)
// and the name both sides connect through.
inline constexpr wchar_t kPipeName[] = L"\\\\.\\pipe\\RealGramVpnService";

enum class Command : unsigned char {
  Start              = 1,  // payload: full xray-core JSON config (UTF-8) — same shape xrayConfigBuilder.ts already produces for Android/iOS
  StartEmergency     = 2,  // payload: same as Start, emergency-profile config
  Stop               = 3,  // no payload
  Status             = 4,  // no payload -> "running=0|1\nprobeOk=0|1\nuptime=<sec>\nerror=<text>\n"
  GetXrayLog         = 5,  // no payload -> tail of xray.log
  GetTun2socksLog    = 6,  // no payload -> tail of tun2socks.log
  GetGeneratedConfig = 7,  // no payload -> the xray.json currently on disk
};

enum class ResponseStatus : unsigned char {
  Ok    = 0,
  Error = 1,  // payload: human-readable error message (UTF-8)
};

// Local SOCKS5 inbound Xray listens on — same port Android/iOS use
// (docs/realgram/ARCHITECTURE.md: "TUN -> tun2socks -> 127.0.0.1:10808
// (Xray SOCKS5 inbound) -> Xray-core"). Keeping this one constant shared
// means the generated config, the tun2socks launch args, and the readiness
// probe can never drift out of sync with each other.
inline constexpr int kSocksPort = 10808;

}  // namespace RealGramVpn
