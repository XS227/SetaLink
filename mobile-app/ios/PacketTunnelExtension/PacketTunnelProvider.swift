import NetworkExtension
import Network
import Foundation
import CryptoKit

// PacketTunnelProvider — routes device traffic through xray-core (VLESS/Reality).
//
// Two compile-time modes (selected by SWIFT_ACTIVE_COMPILATION_CONDITIONS):
//
//   HEV_AVAILABLE (CI build — full-TUN):
//     packetFlow ↔ socketpair ↔ hev-socks5-tunnel → xray SOCKS 127.0.0.1:10808
//     All TCP+UDP tunneled; Telegram/QUIC work; no NEProxySettings needed.
//
//   default (local dev — proxy mode):
//     iOS apps → NEProxySettings HTTP proxy 127.0.0.1:10809
//              → xray http-in → xray proxy outbound → VPN server
//     HTTP/HTTPS only; simpler, no native library required.
//
// IPC contract with XrayModule.swift (main app):
//   App Group: group.no.setalink.realink
//   Keys written BEFORE start:  xray_config_json, diag_device_id, diag_country, diag_app_version
//   Keys written AFTER attempt: last_tunnel_error, last_probe_ok, connection_log

private let kAppGroup      = "group.no.setalink.realink"
private let kConfigKey     = "xray_config_json"
private let kErrorKey      = "last_tunnel_error"
private let kProbeOkKey    = "last_probe_ok"
private let kLogKey        = "connection_log"
private let kDiagDeviceId  = "diag_device_id"
private let kDiagCountry   = "diag_country"
private let kDiagAppVer    = "diag_app_version"

private let kSocksPort: Int = 10808
private let kHttpPort:  Int = 10809

private let kUploadURL      = "https://setalink.no/api.php?mobile=1&action=submit-tunnel-log"
private let kTunnelStateKey = "tunnel_state"
private let kHeartbeatKey   = "extension_heartbeat"  // unix ts written every 30s; main app can detect frozen extension

// Formal connection lifecycle. completionHandler(nil) fires immediately after
// setTunnelNetworkSettings succeeds — iOS activates the TUN only after this.
// HEV and packetFlow relay start post-completionHandler; probes run in background.
private enum TunnelState: String {
    case idle                   = "idle"
    case starting               = "starting"
    case networkSettingsApplied = "network_settings_applied"
    case hevStarted             = "hev_started"
    case firstPacketOut         = "first_packet_out"
    case firstPacketIn          = "first_packet_in"
    case internetReachable      = "internet_reachable"
    case connectedVerified      = "connected_verified"
    case failed                 = "failed"
}

// ── Parsed fields from the proxy outbound ──────────────────────────────────────
private struct ConfigMeta {
    var proto:      String = "(nil)"
    var network:    String = "(nil)"
    var security:   String = "(nil)"
    var serverName: String = "(nil)"
    var flow:       String = "(absent)"
    var addr:       String = "(nil)"
    var port:       Any    = "(nil)"
    var outbound0:  String = "{}"
    var inbound0:   String = "{}"
}

class PacketTunnelProvider: NEPacketTunnelProvider {

    private var log: [String]  = []
    private let startTime      = Date()
    private var postConnectTime: Date? = nil

    // Captured during the attempt — assembled into the upload payload on finish.
    private var xrayVersion    = "(not reached)"
    private var lastStep       = "init"
    private var configMeta     = ConfigMeta()
    private var libxraySuccess = false
    private var libxrayError   = ""
    private var configSha256   = ""
    private var configLength   = 0
    private var configValid    = false
    private var sanitizedCfg   = ""

    private var tunnelState: TunnelState = .idle

    // HEV tun2socks relay state (only used when HEV_AVAILABLE)
    #if HEV_AVAILABLE
    private var hevBridgeFd:         Int32                = -1
    private var hevRelaySource:      DispatchSourceRead?   = nil
    private var hevStatsTimer:       DispatchSourceTimer?  = nil
    private var postConnectWatchdog: DispatchWorkItem?     = nil
    private var pathMonitor:         NWPathMonitor?        = nil   // #5 #18 network-change detection
    private var livenessTimer:         DispatchSourceTimer?  = nil   // #6 #8 30s heartbeat
    private var propagationProbeTimer: DispatchSourceTimer?  = nil   // build-44 experiment

    // Per-stage pipeline counters.
    // S1 = packetFlow.readPackets delivered
    // S3 = successfully written to HEV socket (send() returned > 0)
    // S3drop = send() returned -1 (socket full / closed)
    // S7 = recv() from HEV socket returned > 0 (response from internet)
    // S8 = writePackets called back into packetFlow
    // S4/S7 authoritative totals come from hev_socks5_tunnel_stats() (C counters).
    // Rate tracking: snapshots taken each timer tick to compute pkts/s.
    private struct HevStats {
        var s1Packets: Int = 0   // S1 packetFlow.readPackets delivered
        var txBytes:   Int = 0
        var txTCP:     Int = 0
        var txUDP:     Int = 0
        var txQUIC:    Int = 0   // UDP dst-port 443 (QUIC/Meta/Instagram)
        var txOther:   Int = 0
        var s3Written: Int = 0   // S3 send() to HEV socket succeeded
        var s3Drop:    Int = 0   // S3 send() returned -1 or wrong size
        var s7Packets: Int = 0   // S7 recv() from HEV socket (from internet)
        var s7Bytes:   Int = 0
        var s8Packets: Int = 0   // S8 writePackets back into packetFlow

        // One-shot flags for immediate per-event logging (fire exactly once).
        var loggedFirstTx:       Bool = false   // first outbound packet through S3
        var loggedFirstRx:       Bool = false   // first inbound packet through S7
        var rxRelayEventsFired:  Int  = 0       // DispatchSource fires on bridgeFd

        // Snapshots at last timer tick — used to compute per-second rates.
        var snapS1: Int = 0
        var snapS3: Int = 0
        var snapS7: Int = 0
        var snapTime: Date = Date()
    }
    private var hevStats = HevStats()
    #endif

    // MARK: - Start

    override func startTunnel(options: [String: NSObject]? = nil,
                              completionHandler: @escaping (Error?) -> Void) {

        let pi = ProcessInfo.processInfo
        step("start")
        appendLog("Extension: \(Bundle.main.bundleIdentifier ?? "unknown") pid=\(pi.processIdentifier)")
        appendLog("iOS: \(pi.operatingSystemVersionString)")
        appendLog("App Group: \(kAppGroup)")
        // #17 Low Power Mode throttles background processing; log so admin can correlate with degraded tunnels.
        appendLog("Device: lowPower=\(pi.isLowPowerModeEnabled) thermalState=\(pi.thermalState.rawValue)")

        // xray-core version — logged before RunXrayFromJSON so it appears even on config failures.
        captureXrayVersion()

        // Confirm which symbols the embedded LibXray.xcframework actually exports.
        // Runs before any libxray call so the result appears even on config failures.
        logLibxraySymbols()

        // ── Phase 1: load config ──────────────────────────────────────────────
        guard let shared = UserDefaults(suiteName: kAppGroup) else {
            fail("App Group \(kAppGroup) inaccessible — check entitlements", shared: nil,
                 completionHandler)
            return
        }
        // #16 Verify App Group is bidirectionally readable by the extension process.
        // If this write+read roundtrip fails, all IPC with the main app is broken.
        let ipcKey = "_ipc_\(pi.processIdentifier)"
        shared.set("ok", forKey: ipcKey)
        let ipcOk = shared.string(forKey: ipcKey) == "ok"
        shared.removeObject(forKey: ipcKey)
        appendLog("AppGroup: \(kAppGroup) IPC=\(ipcOk ? "OK" : "FAIL — extension cannot write to shared container")")

        // #7 Clear stale tunnel_state from the previous session so a crashed/interrupted
        // prior attempt never makes this attempt appear to be in a wrong state.
        shared.removeObject(forKey: kTunnelStateKey)

        guard let configJson = shared.string(forKey: kConfigKey), !configJson.isEmpty else {
            fail("No xray config in App Group — XrayModule.start() must be called first",
                 shared: shared, completionHandler)
            return
        }
        step("config loaded")
        configLength = configJson.count
        configSha256 = sha256(configJson)
        sanitizedCfg = sanitizeConfig(configJson)
        appendLog("Config: \(configLength) bytes sha256=\(configSha256)")

        // ── Phase 2: validate ─────────────────────────────────────────────────
        step("config validating")
        if let validationError = validateAndLogConfig(configJson) {
            appendLog("Config validation FAILED: \(validationError)")
            appendLog("Config head: \(configJson.prefix(400))")
            fail("Config validation: \(validationError)", shared: shared, completionHandler)
            return
        }
        configValid = true
        step("config valid")

        // ── Phase 3: start xray-core ──────────────────────────────────────────
        step("xray starting")
        let xrayT0 = Date()
        if let xrayError = startXrayCore(configJson: configJson) {
            fail(xrayError, shared: shared, completionHandler)
            return
        }
        step("xray started")
        appendLog("xray-core started in \(elapsed(since: xrayT0))")

        // ── Phase 4: apply NEPacketTunnelNetworkSettings ──────────────────────
        step("route install")
        applyNetworkSettings { [weak self] error in
            guard let self = self else { return }
            if let error = error {
                self.appendLog("NetSettings FAILED — \(error.localizedDescription)")
                self.fail("NEPacketTunnelNetworkSettings: \(error.localizedDescription)",
                          shared: shared, completionHandler)
                return
            }
            self.step("route installed")
            self.appendLog("Route installed (\(self.elapsed(since: self.startTime)) total)")

            // ── Phase 5: signal iOS the tunnel is active ─────────────────────
            // completionHandler(nil) must fire BEFORE HEV or readPackets start.
            // iOS only activates the TUN fd and routes app traffic after this call —
            // starting HEV beforehand is why S1=0 persisted in builds 44–49.
            self.step("connected_verified")
            self.appendLog("STATE: connected_verified (\(self.elapsed(since: self.startTime)) total)")
            shared.set(TunnelState.connectedVerified.rawValue, forKey: kTunnelStateKey)
            self.postConnectTime = Date()
            shared.set(true, forKey: kProbeOkKey)
            self.flushLog(to: shared)
            shared.synchronize()
            completionHandler(nil)

            // ── Phase 6 (HEV only): start tun2socks relay AFTER completionHandler ─
            // iOS now routes app traffic to the TUN, so readPackets will deliver
            // packets. S1 should be > 0 almost immediately after this starts.
            #if HEV_AVAILABLE
            guard self.startHevMode() else {
                self.cancelTunnel(reason: "HEV bridge failed post-connect (socketpair errno=\(errno))")
                return
            }
            self.startPostConnectMonitor(shared: shared)
            #endif

            // ── Phase 7: background probes (non-gating) ──────────────────────
            // Diagnostic only — results are logged and uploaded but do NOT
            // disconnect or gate the tunnel.
            DispatchQueue.global(qos: .background).async {
                self.runDualProbe { ok, summary in
                    shared.set(ok, forKey: kProbeOkKey)
                    shared.synchronize()
                    self.appendLog("BG-PROBE: \(ok ? "PASS" : "FAIL") — \(summary)")
                    let (deviceId, appVersion, country) = self.readDiagContext(from: shared)
                    DispatchQueue.global(qos: .background).async {
                        self.uploadDiagnostics(deviceId: deviceId, appVersion: appVersion,
                                               country: country, success: ok, errorMsg: ok ? "" : summary,
                                               waitForCompletion: false)
                    }
                }
            }
        }
    }

    // MARK: - Stop

    override func stopTunnel(with reason: NEProviderStopReason,
                             completionHandler: @escaping () -> Void) {
        appendLog("STATE: stop reason=\(reason.rawValue) (\(stopReasonDescription(reason)))")
        #if HEV_AVAILABLE
        postConnectWatchdog?.cancel()
        postConnectWatchdog = nil
        stopHevMode()
        #endif
        stopXrayCore()
        if let shared = UserDefaults(suiteName: kAppGroup) { flushLog(to: shared) }
        completionHandler()
    }

    // MARK: - Network settings (proxy mode)

    private func applyNetworkSettings(completion: @escaping (Error?) -> Void) {
        let settings = NEPacketTunnelNetworkSettings(tunnelRemoteAddress: "10.255.0.1")
        settings.mtu = 1280
        appendLog("NetSettings: tunnelRemoteAddress=10.255.0.1 mtu=1280")

        // ── IPv4: claim the DEFAULT route so iOS applies NEProxySettings to ALL app
        // traffic (Safari, etc.). With includedRoutes=[] the proxy was installed but
        // NOT applied to apps — the connect probe passed only because it set the proxy
        // explicitly, while real browsing went direct and stalled (CONNECTED-but-hangs).
        // The VPN server IP is excluded so xray's own outbound to the node does not loop
        // back into the tunnel (iOS has no Android-style socket protect()).
        let ipv4 = NEIPv4Settings(addresses: ["10.255.0.2"], subnetMasks: ["255.255.255.0"])
        ipv4.includedRoutes = [NEIPv4Route.default()]
        var excluded4: [NEIPv4Route] = []
        if isIPv4Literal(configMeta.addr) {
            excluded4.append(NEIPv4Route(destinationAddress: configMeta.addr,
                                         subnetMask: "255.255.255.255"))
            appendLog("NetSettings: excludedRoute(server)=\(configMeta.addr)/32 (loop prevention)")
        } else {
            appendLog("NetSettings: ⚠️ server addr \"\(configMeta.addr)\" is not an IPv4 literal — cannot exclude (edge transport?); risk of routing loop")
        }
        ipv4.excludedRoutes = excluded4
        settings.ipv4Settings = ipv4
        appendLog("NetSettings: IPv4=10.255.0.2/24 includedRoutes=[default] excluded=\(excluded4.count) (full-tunnel proxy)")

        // ── IPv6: claim + drop. Iranian LTE carries IPv6; if the tunnel ignores it,
        // Safari (Happy Eyeballs) prefers IPv6, connects DIRECTLY (bypassing the IPv4
        // proxy), hits blocked/poisoned routes and hangs. Claiming ::/0 with no IPv6
        // packet handler fast-fails IPv6 so the OS immediately falls back to IPv4
        // (which is proxied). This also kills direct QUIC/UDP-443 over IPv6.
        let ipv6 = NEIPv6Settings(addresses: ["fd00::2"], networkPrefixLengths: [64])
        ipv6.includedRoutes = [NEIPv6Route.default()]
        ipv6.excludedRoutes = []
        settings.ipv6Settings = ipv6
        appendLog("NetSettings: IPv6=fd00::2/64 includedRoutes=[default] (claim+drop → force IPv4 fallback)")

        let dns = NEDNSSettings(servers: ["1.1.1.1", "8.8.8.8"])
        dns.matchDomains = [""]
        settings.dnsSettings = dns
        appendLog("NetSettings: DNS=[1.1.1.1,8.8.8.8] matchDomains=[all]")

        #if HEV_AVAILABLE
        // HEV mode: hev-socks5-tunnel reads raw IP packets from the TUN and forwards
        // ALL traffic (TCP+UDP) to xray SOCKS 10808 — no HTTP proxy needed.
        appendLog("NetSettings: HEV mode — no NEProxySettings (all traffic via TUN→hev→xray SOCKS)")
        #else
        let proxy = NEProxySettings()
        proxy.httpEnabled  = true
        proxy.httpServer   = NEProxyServer(address: "127.0.0.1", port: kHttpPort)
        proxy.httpsEnabled = true
        proxy.httpsServer  = NEProxyServer(address: "127.0.0.1", port: kHttpPort)
        proxy.excludeSimpleHostnames = true
        settings.proxySettings = proxy
        appendLog("NetSettings: HTTP/HTTPS proxy=127.0.0.1:\(kHttpPort) excludeSimpleHostnames=true")
        #endif

        appendLog("NetSettings: calling setTunnelNetworkSettings…")
        setTunnelNetworkSettings(settings) { error in
            if let error = error {
                self.appendLog("NetSettings: setTunnelNetworkSettings ERROR — \(error.localizedDescription) (code=\((error as NSError).code))")
            } else {
                self.appendLog("NetSettings: setTunnelNetworkSettings OK — route installed")
            }
            completion(error)
        }
    }

    // MARK: - Dual probe

    private func runDualProbe(completion: @escaping (Bool, String) -> Void) {
        let proxyDict: [AnyHashable: Any] = [
            kCFNetworkProxiesHTTPEnable as String: 1,
            kCFNetworkProxiesHTTPProxy  as String: "127.0.0.1",
            kCFNetworkProxiesHTTPPort   as String: kHttpPort,
        ]

        // IP-direct probe MUST be HTTPS: iOS App Transport Security blocks plain
        // http:// ("requires the use of a secure connection"), so an http:// probe
        // fails inside URLSession before it ever reaches xray — a false negative
        // that made a working tunnel look like "xray is NOT forwarding traffic".
        // 1.1.1.1 presents a valid certificate for the IP literal, so this stays a
        // genuine DNS-free reachability test while satisfying ATS.
        let ipURL = URL(string: "https://1.1.1.1/cdn-cgi/trace")!
        appendLog("Probe TX[1]: HTTPS → 1.1.1.1/cdn-cgi/trace (IP-direct, DNS bypass) via 127.0.0.1:\(kHttpPort)")
        fetchURL(ipURL, via: proxyDict, timeout: 10) { [weak self] status, bytes, err, t in
            guard let self = self else { return }
            let ipOk = err == nil && status != nil
            if ipOk {
                self.appendLog("Probe RX[1]: IP-direct OK — status=\(status!) bytes=\(bytes) elapsed=\(t)")
                self.appendLog("Outbound: established — xray is forwarding TCP to internet")
            } else {
                let reason = err?.localizedDescription ?? "status=\(status.map{"\($0)"} ?? "nil")"
                self.appendLog("Probe RX[1]: IP-direct FAIL — \(reason) elapsed=\(t)")
                self.appendLog("Outbound: xray is NOT forwarding traffic")
            }

            self.step("dns probe")
            let cpURL = URL(string: "https://cp.cloudflare.com/")!
            self.appendLog("Probe TX[2]: HTTPS → cp.cloudflare.com (DNS+proxy) via 127.0.0.1:\(kHttpPort)")
            self.fetchURL(cpURL, via: proxyDict, timeout: 12) { status2, bytes2, err2, t2 in
                // cp.cloudflare.com is a captive-portal / connectivity-check endpoint:
                // it returns 204 No Content BY DESIGN (the same contract as Google's
                // generate_204). Requiring exactly 200 here made a fully working tunnel
                // report failure — the request reached cp.cloudflare.com through xray
                // and got its genuine 204 reply. Accept 200 or 204; both prove the
                // first packet went out and a real response came back.
                let dnsOk = err2 == nil && (status2 == 200 || status2 == 204)
                if dnsOk {
                    self.appendLog("Probe RX[2]: DNS+proxy OK — status=\(status2!) bytes=\(bytes2) elapsed=\(t2)")
                    self.appendLog("DNS: resolution OK (cp.cloudflare.com resolved through xray dns-out)")
                    // ── Probe 3 (diagnostic, NON-gating) ──────────────────────
                    #if HEV_AVAILABLE
                    // HEV mode: extension process bypasses the TUN, so a bare URLSession
                    // request is NOT routed through hev. Instead probe via SOCKS5 directly —
                    // this verifies hev is actually forwarding packets through xray SOCKS.
                    self.step("hev socks probe")
                    let socksDict: [AnyHashable: Any] = [
                        "SOCKSEnable": 1,
                        "SOCKSProxy":  "127.0.0.1",
                        "SOCKSPort":   kSocksPort,
                    ]
                    self.appendLog("Probe TX[3]: HTTPS → cp.cloudflare.com via SOCKS5 127.0.0.1:\(kSocksPort) (HEV path)")
                    // Probe 3 is GATING in HEV mode: the SOCKS5 port (10808) is
                    // the interface between hev-socks5-tunnel and xray. If it's
                    // unreachable, HEV cannot forward any app traffic regardless
                    // of what probe 2 (HTTP proxy 10809) reported.
                    self.fetchURL(URL(string: "https://cp.cloudflare.com/")!, via: socksDict, timeout: 10) { s3, _, e3, t3 in
                        let socks5Ok = e3 == nil && (s3 == 200 || s3 == 204)
                        if socks5Ok {
                            self.appendLog("Probe RX[3]: SOCKS5 OK — status=\(s3!) elapsed=\(t3) — xray SOCKS5 relay confirmed ✓")
                            // Probe 3 goes extension→URLSession→SOCKS5→xray directly.
                            // It does NOT flow through packetFlow/HEV. S7 > 0 is the
                            // only proof that the TUN→HEV→xray return path is alive.
                            // Without it, app traffic goes in but nothing comes back.
                            var hTxP: size_t = 0, hTxB: size_t = 0
                            var hRxP: size_t = 0, hRxB: size_t = 0
                            hev_socks5_tunnel_stats(&hTxP, &hTxB, &hRxP, &hRxB)
                            let s7C = Int(hRxP)   // authoritative C counter
                            let s7S = self.hevStats.s7Packets  // swift recv() counter
                            if s7C == 0 && s7S == 0 {
                                let s4C = Int(hTxP)
                                let s1  = self.hevStats.s1Packets
                                let why: String
                                if s4C > 0 {
                                    why = "S4=\(s4C) packets sent by HEV to xray but S7=0 returned — " +
                                          "xray response path through HEV broken (UDP TCP-path failed?)"
                                } else if s1 > 0 {
                                    why = "S1=\(s1) packets entered TUN but S4=0 — HEV socket send() failing"
                                } else {
                                    why = "S1=0 — iOS did not route any app traffic through TUN"
                                }
                                self.appendLog("TUN-CHECK FAIL: \(why)")
                                self.appendLog("FAIL: probe 3 passed via direct extension path but TUN→HEV path delivers no return traffic — user apps have no internet")
                                completion(false, "TUN path broken: \(why)")
                            } else {
                                self.appendLog("TUN-CHECK OK: S7=\(max(s7C, s7S)) packets returned through HEV ✓ — full TUN→HEV→xray path confirmed")
                                self.appendLog("STATE: internet_reachable — all 3 probes passed, TUN path verified")
                                completion(true, "ok")
                            }
                        } else {
                            let r3 = e3?.localizedDescription ?? "status=\(s3.map { "\($0)" } ?? "nil")"
                            self.appendLog("Probe RX[3]: SOCKS5 FAIL — \(r3) elapsed=\(t3) — xray SOCKS5 port \(kSocksPort) unreachable ✗")
                            self.appendLog("FAIL: HEV mode requires working SOCKS5 relay — cannot verify end-to-end path")
                            completion(false, "SOCKS5 relay probe failed: \(r3)")
                        }
                    }
                    #else
                    // Proxy mode: system-routed, NO explicit proxy dict.
                    // Tests whether iOS actually applies NEProxySettings to app traffic.
                    // May under-report inside the extension's own process — warns, doesn't fail.
                    self.step("system probe")
                    self.appendLog("Probe TX[3]: HTTPS → cp.cloudflare.com (SYSTEM-routed, no explicit proxy)")
                    self.fetchURL(URL(string: "https://cp.cloudflare.com/")!, via: [:], timeout: 10) { s3, _, e3, t3 in
                        let sysOk = e3 == nil && (s3 == 200 || s3 == 204)
                        if sysOk {
                            self.appendLog("Probe RX[3]: SYSTEM-routed OK — status=\(s3!) elapsed=\(t3) — app traffic IS using the tunnel")
                        } else {
                            let r3 = e3?.localizedDescription ?? "status=\(s3.map { "\($0)" } ?? "nil")"
                            self.appendLog("Probe RX[3]: SYSTEM-routed FAIL — \(r3) elapsed=\(t3)")
                            self.appendLog("⚠️ Proxy may NOT be applied to app traffic — browsers (Safari) could hang despite CONNECTED")
                        }
                        self.appendLog("First packet sent+received — end-to-end connectivity confirmed")
                        completion(true, "ok")
                    }
                    #endif
                } else {
                    let reason2 = err2?.localizedDescription ?? "status=\(status2.map{"\($0)"} ?? "nil")"
                    self.appendLog("Probe RX[2]: DNS+proxy FAIL — \(reason2) elapsed=\(t2)")
                    let errCode = (err2 as NSError?)?.code
                    let dnsHint: String
                    if errCode == NSURLErrorCannotFindHost || errCode == NSURLErrorDNSLookupFailed {
                        dnsHint = "DNS: FAILED — NSURLError \(errCode!) (cannot resolve hostname)"
                    } else if ipOk {
                        dnsHint = "DNS: likely FAILED (IP probe passed, hostname probe failed)"
                    } else {
                        dnsHint = "DNS: unknown (IP probe also failed — xray itself may be down)"
                    }
                    self.appendLog(dnsHint)
                    let summary = ipOk
                        ? "DNS probe failed: \(reason2)"
                        : "Proxy probe failed: \(reason2)"
                    completion(false, summary)
                }
            }
        }
    }

    private func fetchURL(_ url: URL,
                          via proxyDict: [AnyHashable: Any],
                          timeout: TimeInterval,
                          completion: @escaping (Int?, Int, Error?, String) -> Void) {
        let t0  = Date()
        let cfg = URLSessionConfiguration.ephemeral
        cfg.timeoutIntervalForRequest  = timeout
        cfg.timeoutIntervalForResource = timeout
        cfg.connectionProxyDictionary  = proxyDict
        let task = URLSession(configuration: cfg).dataTask(with: URLRequest(url: url)) { data, resp, err in
            completion((resp as? HTTPURLResponse)?.statusCode, data?.count ?? 0, err, self.elapsed(since: t0))
        }
        task.resume()
    }

    // MARK: - libXray integration

    private func startXrayCore(configJson: String) -> String? {
        #if LIBXRAY_AVAILABLE
        // Validate JSON structure and log key outbound fields before calling libxray.
        // validateAndLogConfig captures configMeta and logs Outbound: / Server: / Config OK lines.
        // It is called earlier (Phase 2) so this path is only reached after configValid=true.

        // Build base64-wrapped request for libxray v25+ RunXrayFromJSON.
        // Payload: { datDir: "", configJSON: "<raw xray json string>" }
        // datDir is empty — routing rules use IP/port only, no geo dat files needed.
        guard let requestData = try? JSONSerialization.data(withJSONObject: [
            "datDir":     "",
            "configJSON": configJson,
        ]) else {
            return "Failed to serialize libxray request"
        }
        let base64Request = requestData.base64EncodedString()
        step("libxray call")
        appendLog("LibXrayRunXrayFromJSON: request \(base64Request.count) base64 chars")
        appendLog("libxray input struct: datDir=\"\" configJSON=<\(configJson.count) chars, sha256=\(configSha256)>")

        // ── Pre-flight: round-trip decode the exact bytes libxray will receive ──
        // Decode base64Request → outer JSON → extract configJSON → parse inner JSON.
        // If Swift can parse the payload and find outbounds[0].protocol but libxray
        // rejects it, the problem is the API contract (wrong field name / encoding),
        // not our config generation.
        verifyLibxrayPayload(base64Request)

        let base64Response = LibXrayRunXrayFromJSON(base64Request)
        step("libxray response")

        appendLog("libxray raw response: \(base64Response.prefix(200))")

        guard !base64Response.isEmpty,
              let responseData = Data(base64Encoded: base64Response),
              let json = try? JSONSerialization.jsonObject(with: responseData) as? [String: Any]
        else {
            appendLog("libxray response: undecodable (xcframework version mismatch?)")
            libxrayError = "libxray returned unreadable response"
            return libxrayError
        }

        libxraySuccess = json["success"] as? Bool ?? false
        libxrayError   = json["error"]   as? String ?? ""

        appendLog("libxray CallResponse: success=\(libxraySuccess)\(libxrayError.isEmpty ? "" : " error=\"\(libxrayError)\"")")

        // If protocol error: log outbound[0], inbound[0], and config head for cross-check.
        if !libxraySuccess &&
           libxrayError.lowercased().contains("protocol") {
            appendLog("⚠️ Protocol error — dumping outbound[0] and inbound[0] for cross-check")
            appendLog("outbound[0]: \(configMeta.outbound0)")
            appendLog("inbound[0]:  \(configMeta.inbound0)")
            appendLog("config head (first 800 chars, sanitized):")
            let head = sanitizedCfg.prefix(800)
            appendLog(String(head))
        }

        if libxraySuccess { return nil }
        return libxrayError.isEmpty ? "xray-core failed (no error detail)" : libxrayError
        #else
        return "libXray not embedded — CI build required for real VPN."
        #endif
    }

    // Open LibXray.framework via dlopen and check which entry points are actually
    // exported. Runs once per tunnel attempt, before any libxray call.
    //
    // Why: gomobile bind output varies by libxray version and build flags.
    // A symbol that appears in the header might be absent or renamed in the dylib.
    // dlsym is the only runtime check that proves the symbol resolves.
    private func logLibxraySymbols() {
        appendLog("LibXray symbol audit — scanning Bundle.allFrameworks…")

        // Locate LibXray.framework among the loaded bundles.
        // In the extension process this is typically at:
        //   <app>.appex/Frameworks/LibXray.framework
        var libxrayBundle: Bundle?
        for b in Bundle.allFrameworks {
            if b.bundlePath.contains("LibXray.framework") {
                libxrayBundle = b
                break
            }
        }

        guard let bundle = libxrayBundle else {
            appendLog("LibXray.framework: NOT FOUND in Bundle.allFrameworks")
            let names = Bundle.allFrameworks
                .map { URL(fileURLWithPath: $0.bundlePath).lastPathComponent }
                .joined(separator: ", ")
            appendLog("Loaded frameworks: \(names)")
            return
        }

        appendLog("LibXray.framework path: \(bundle.bundlePath)")

        guard let execURL = bundle.executableURL else {
            appendLog("LibXray executable: nil — bundle has no executable")
            return
        }
        appendLog("LibXray executable: \(execURL.lastPathComponent) @ \(execURL.path)")

        // dlopen the dylib directly so we can probe its symbol table.
        guard let handle = dlopen(execURL.path, RTLD_NOW | RTLD_LOCAL) else {
            let reason = String(cString: dlerror())
            appendLog("dlopen FAILED: \(reason)")
            return
        }
        defer { dlclose(handle) }

        // All known entry-point names across libxray versions.
        // The one we call is marked with ← CURRENT.
        let candidates: [(name: String, note: String)] = [
            ("LibXrayRunXrayFromJSON", "← CURRENT call site (v25+ base64 API)"),
            ("LibXrayXrayVersion",     "version query — must be present if framework loaded"),
            ("LibXrayStopXray",        "stop call"),
            ("LibXrayRunXray",         "old raw-JSON API (pre-v25)"),
            ("LibXrayInitEnv",         "init required by some versions"),
            ("RunXrayFromJSON",        "without LibXray prefix"),
            ("runXrayFromJSON",        "lowercase variant"),
            ("LibXrayTestXray",        "test/validate variant"),
        ]

        var found: [String] = []
        var missing: [String] = []
        for c in candidates {
            let ptr = dlsym(handle, c.name)
            let status = ptr != nil ? "EXPORTED ✓" : "not found ✗"
            appendLog("  \(c.name): \(status)  \(c.note)")
            if ptr != nil { found.append(c.name) } else { missing.append(c.name) }
        }

        appendLog("LibXray audit: \(found.count) found [\(found.joined(separator: ", "))]")
        if missing.contains("LibXrayRunXrayFromJSON") {
            appendLog("⚠️  LibXrayRunXrayFromJSON is NOT exported — every call to it invokes an undefined stub")
        }
        if missing.contains("LibXrayXrayVersion") {
            appendLog("⚠️  LibXrayXrayVersion missing — framework may not be LibXray at all")
        }
    }

    // Round-trip decode the exact base64 payload that is about to be handed to
    // LibXrayRunXrayFromJSON and verify the inner xray config is intact.
    //
    // Logged unconditionally so every build captures the result.
    // Does NOT abort — libxray is still called regardless of what Swift finds.
    //
    // Expected decode chain:
    //   base64Request
    //     → base64-decode → outer JSON: { datDir, configJSON }
    //       → configJSON string → parse inner JSON: xray config
    //         → outbounds[0].protocol   must == "vless"
    //         → outbounds[0].streamSettings.security  must == "reality"
    private func verifyLibxrayPayload(_ base64Request: String) {
        appendLog("PreFlight: verifying exact payload libxray will receive…")

        // Step 1 — base64 decode
        guard let outerData = Data(base64Encoded: base64Request) else {
            appendLog("PreFlight FAIL [1]: base64 decode failed (length=\(base64Request.count))")
            return
        }
        appendLog("PreFlight [1]: base64 decoded OK → \(outerData.count) bytes")

        // Step 2 — parse outer JSON { datDir, configJSON }
        guard let outerObj = try? JSONSerialization.jsonObject(with: outerData) as? [String: Any] else {
            appendLog("PreFlight FAIL [2]: outer JSON parse failed")
            appendLog("PreFlight outer raw (first 200): \(String(data: outerData, encoding: .utf8)?.prefix(200) ?? "(not utf8)")")
            return
        }
        let datDir    = outerObj["datDir"]    as? String ?? "(missing)"
        let hasConfig = outerObj["configJSON"] is String
        appendLog("PreFlight [2]: outer JSON OK — keys=[\(outerObj.keys.sorted().joined(separator: ","))] datDir=\"\(datDir)\" configJSON=\(hasConfig ? "present" : "MISSING")")

        // Step 3 — extract configJSON string
        guard let innerJson = outerObj["configJSON"] as? String else {
            appendLog("PreFlight FAIL [3]: configJSON field is missing or not a String (type=\(type(of: outerObj["configJSON"])))")
            return
        }
        appendLog("PreFlight [3]: configJSON string extracted — \(innerJson.count) chars")

        // Step 4 — parse inner JSON (the actual xray config)
        guard let innerData = innerJson.data(using: .utf8),
              let xrayCfg  = try? JSONSerialization.jsonObject(with: innerData) as? [String: Any]
        else {
            appendLog("PreFlight FAIL [4]: inner JSON parse failed")
            appendLog("PreFlight inner head (200 chars): \(innerJson.prefix(200))")
            return
        }
        let topKeys = xrayCfg.keys.sorted().joined(separator: ",")
        appendLog("PreFlight [4]: inner JSON parsed OK — top-level keys=[\(topKeys)]")

        // Step 5 — check outbounds array
        guard let outbounds = xrayCfg["outbounds"] as? [[String: Any]], !outbounds.isEmpty else {
            appendLog("PreFlight FAIL [5]: outbounds missing or empty (keys=[\(topKeys)])")
            return
        }
        appendLog("PreFlight [5]: outbounds count=\(outbounds.count)")

        // Step 6 — check outbounds[0].protocol
        let ob0      = outbounds[0]
        let proto    = ob0["protocol"] as? String
        let protoOk  = proto == "vless"
        appendLog("PreFlight [6]: outbounds[0].protocol=\(proto ?? "(nil)") → \(protoOk ? "✓ PASS" : "✗ FAIL — expected \"vless\"")")

        // Step 7 — check outbounds[0].streamSettings.security
        let ss       = ob0["streamSettings"] as? [String: Any]
        let security = ss?["security"] as? String
        let secOk    = security == "reality"
        appendLog("PreFlight [7]: outbounds[0].streamSettings.security=\(security ?? "(nil)") → \(secOk ? "✓ PASS" : "✗ FAIL — expected \"reality\"")")

        // Step 8 — check inbounds
        let inbounds   = xrayCfg["inbounds"] as? [[String: Any]] ?? []
        let ib0proto   = inbounds.first?["protocol"] as? String ?? "(none)"
        appendLog("PreFlight [8]: inbounds count=\(inbounds.count) inbounds[0].protocol=\(ib0proto)")

        // Summary
        let allOk = protoOk && secOk
        appendLog("PreFlight SUMMARY: \(allOk ? "ALL CHECKS PASSED — payload is valid; if libxray rejects it the problem is in the API contract, not our config" : "CHECKS FAILED — see individual step results above")")
    }

    // Reads and logs xray-core version; stores in xrayVersion for the meta payload.
    private func captureXrayVersion() {
        #if LIBXRAY_AVAILABLE
        let raw = LibXrayXrayVersion()
        if let data = Data(base64Encoded: raw),
           let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
           let ver  = json["data"] as? String, !ver.isEmpty {
            xrayVersion = ver
            appendLog("xray-core version: \(ver)")
        } else {
            xrayVersion = "(unreadable)"
            appendLog("xray-core version: unreadable — base64=\(raw.prefix(60))")
        }
        #else
        xrayVersion = "(stub — LIBXRAY_AVAILABLE not set)"
        appendLog("xray-core version: \(xrayVersion)")
        #endif
    }

    // Validates JSON config, captures configMeta, and logs key outbound fields.
    // Returns nil on success or a short error string.
    private func validateAndLogConfig(_ configJson: String) -> String? {
        guard let data = configJson.data(using: .utf8),
              let obj  = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
        else {
            return "Config is not valid JSON"
        }

        // ── Capture proxy outbound fields ──────────────────────────────────────
        let outbounds = obj["outbounds"] as? [[String: Any]] ?? []
        let inbounds  = obj["inbounds"]  as? [[String: Any]] ?? []

        if let proxy = outbounds.first(where: { ($0["tag"] as? String) == "proxy" })
                    ?? outbounds.first {
            configMeta.proto      = proxy["protocol"] as? String ?? "(nil)"
            let ss                = proxy["streamSettings"] as? [String: Any]
            configMeta.network    = ss?["network"]  as? String ?? "(nil)"
            configMeta.security   = ss?["security"] as? String ?? "(nil)"
            let rs                = ss?["realitySettings"] as? [String: Any]
            configMeta.serverName = rs?["serverName"] as? String
                                 ?? (ss?["tlsSettings"] as? [String: Any])?["serverName"] as? String
                                 ?? "(nil)"
            let vnext             = (proxy["settings"] as? [String: Any])?["vnext"] as? [[String: Any]]
            configMeta.addr       = vnext?.first?["address"] as? String ?? "(nil)"
            configMeta.port       = vnext?.first?["port"] ?? "(nil)"
            let users             = vnext?.first?["users"] as? [[String: Any]]
            configMeta.flow       = users?.first?["flow"] as? String ?? "(absent)"

            // Sanitized outbound[0] for error dumps
            if let sanitized = sanitizeJsonObject(proxy) {
                configMeta.outbound0 = sanitized
            }
        }
        if let ib0 = inbounds.first, let sanitized = sanitizeJsonObject(ib0) {
            configMeta.inbound0 = sanitized
        }

        appendLog("Outbound: protocol=\(configMeta.proto) network=\(configMeta.network) security=\(configMeta.security)")
        appendLog("Server: \(configMeta.addr):\(configMeta.port) sni=\(configMeta.serverName) flow=\(configMeta.flow)")

        // ── Validate all outbounds and inbounds have protocol ──────────────────
        guard !outbounds.isEmpty else { return "outbounds array is missing or empty" }
        for (i, ob) in outbounds.enumerated() {
            guard let p = ob["protocol"] as? String, !p.isEmpty else {
                return "outbounds[\(i)] missing or empty 'protocol' field"
            }
        }
        guard !inbounds.isEmpty else { return "inbounds array is missing or empty" }
        for (i, ib) in inbounds.enumerated() {
            guard let p = ib["protocol"] as? String, !p.isEmpty else {
                return "inbounds[\(i)] missing or empty 'protocol' field"
            }
        }

        let outProtos = outbounds.compactMap { $0["protocol"] as? String }
        let inProtos  = inbounds.compactMap  { $0["protocol"] as? String }
        appendLog("Config OK \(configJson.count)B: out=[\(outProtos.joined(separator: ","))] in=[\(inProtos.joined(separator: ","))]")
        return nil
    }

    private func stopXrayCore() {
        #if LIBXRAY_AVAILABLE
        _ = LibXrayStopXray()
        #endif
    }

    // MARK: - Upload diagnostics

    private func readDiagContext(from shared: UserDefaults) -> (deviceId: String, appVersion: String, country: String) {
        let deviceId   = shared.string(forKey: kDiagDeviceId)  ?? "unknown"
        let appVersion = shared.string(forKey: kDiagAppVer)    ?? "unknown"
        let country    = shared.string(forKey: kDiagCountry)   ?? ""
        return (deviceId, appVersion, country)
    }

    private func uploadDiagnostics(deviceId: String, appVersion: String, country: String,
                                   success: Bool, errorMsg: String,
                                   waitForCompletion: Bool) {
        guard let url = URL(string: kUploadURL) else { return }

        // ── Build structured meta ──────────────────────────────────────────────
        var meta: [String: Any] = [
            "device_id":      deviceId,
            "app_version":    appVersion,
            "server":         "\(configMeta.addr):\(configMeta.port)",
            "country":        country,
            "timestamp":      ISO8601DateFormatter().string(from: Date()),
            "libxray_version": xrayVersion,
            "config_sha256":  configSha256,
            "config_length":  configLength,
            "config_valid":   configValid,
            "protocol":       configMeta.proto,
            "network":        configMeta.network,
            "security":       configMeta.security,
            "server_name":    configMeta.serverName,
            "flow":           configMeta.flow,
            "success":        success,
            "error":          errorMsg,
            "step":           lastStep,
        ]
        // Include protocol-error diagnostics when applicable
        if !success && errorMsg.lowercased().contains("protocol") {
            meta["outbound_0"]  = configMeta.outbound0
            meta["inbound_0"]   = configMeta.inbound0
            meta["config_head"] = String(sanitizedCfg.prefix(800))
            meta["config_sha256_verify"] = configSha256
        }

        guard let metaData = try? JSONSerialization.data(withJSONObject: meta),
              let metaJson = String(data: metaData, encoding: .utf8),
              let logData  = try? JSONSerialization.data(withJSONObject: log),
              let logJson  = String(data: logData, encoding: .utf8)
        else { return }

        // ── Encode body ────────────────────────────────────────────────────────
        var allowed = CharacterSet.alphanumerics
        allowed.insert(charactersIn: "-._~")
        func pct(_ s: String) -> String {
            s.addingPercentEncoding(withAllowedCharacters: allowed) ?? s
        }

        var bodyParts = [
            "device_id=\(pct(deviceId))",
            "log=\(pct(logJson))",
            "meta=\(pct(metaJson))",
        ]
        if !sanitizedCfg.isEmpty {
            bodyParts.append("config=\(pct(sanitizedCfg))")
        }
        let bodyString = bodyParts.joined(separator: "&")

        guard let bodyData = bodyString.data(using: .utf8) else { return }

        var req = URLRequest(url: url)
        req.httpMethod = "POST"
        req.setValue("application/x-www-form-urlencoded", forHTTPHeaderField: "Content-Type")
        req.httpBody   = bodyData
        req.timeoutInterval = 10

        // Bypass the extension's own proxy settings so upload goes direct.
        let cfg = URLSessionConfiguration.ephemeral
        cfg.connectionProxyDictionary = [:] as [AnyHashable: Any]

        appendLog("Uploading diagnostics to server (waitForCompletion=\(waitForCompletion))…")

        if waitForCompletion {
            let sema = DispatchSemaphore(value: 0)
            URLSession(configuration: cfg).dataTask(with: req) { [weak self] _, resp, err in
                let code = (resp as? HTTPURLResponse)?.statusCode ?? -1
                self?.appendLog("Upload result: http=\(code)\(err.map { " err=\($0.localizedDescription)" } ?? "")")
                sema.signal()
            }.resume()
            _ = sema.wait(timeout: .now() + 12)
        } else {
            URLSession(configuration: cfg).dataTask(with: req) { _, _, _ in }.resume()
        }
    }

    // MARK: - HEV tun2socks relay (HEV_AVAILABLE only)

    #if HEV_AVAILABLE

    // Build the YAML config for hev-socks5-tunnel.
    // tunnel.ipv4/ipv6 must match the virtual addresses in NEIPv4Settings / NEIPv6Settings.
    private func buildHevConfig() -> Data {
        let yaml = """
        misc:
          task-stack-size: 81920
          connect-timeout: 4000
          read-write-timeout: 8000
          log-level: warning
        socks5:
          port: \(kSocksPort)
          address: '127.0.0.1'
          udp: 'tcp'
        tunnel:
          mtu: 1500
          ipv4: '10.255.0.2'
          ipv6: 'fd00::2'
        """
        // udp: 'tcp' — routes UDP (DNS) through SOCKS5 TCP CONNECT instead of UDP
        // ASSOCIATE. iOS NE sandbox blocks UDP ASSOCIATE's response path (S7=0).
        // TCP CONNECT to the same SOCKS5 port is proven working (probe 3 uses it).
        return yaml.data(using: .utf8)!
    }

    // Start the bidirectional relay: packetFlow ↔ socketpair ↔ hev-socks5-tunnel.
    //
    // Architecture:
    //   [iOS apps] → kernel → [TUN / packetFlow]
    //                               ↕  (this relay, Swift side)
    //                         [socketpair swift end]
    //                               ↕  (SOCK_DGRAM — one datagram = one IP packet)
    //                         [socketpair hev end]
    //                               ↕  (read/write, inside hev-socks5-tunnel)
    //                         [SOCKS5 client → 127.0.0.1:10808 xray SOCKS inbound]
    //                               ↕
    //                         [xray outbound → VPN server → internet]
    // Returns false if the bridge cannot start; caller must fail the tunnel.
    // SOCK_SEQPACKET is permanently banned — it triggers errno=43 (EPROTOTYPE)
    // in the iOS NE sandbox. SOCK_DGRAM has identical message boundaries.
    // Poll 127.0.0.1:kSocksPort with a blocking TCP connect until xray is ready.
    // Callers must NOT hold any lock — this blocks the calling thread for up to maxWait.
    @discardableResult
    private func waitForXraySocks5Ready(maxWait: TimeInterval = 3.0) -> Bool {
        let deadline = Date().addingTimeInterval(maxWait)
        var tries = 0
        while true {
            tries += 1
            let sock = socket(AF_INET, SOCK_STREAM, 0)
            if sock != -1 {
                var addr = sockaddr_in()
                addr.sin_family      = sa_family_t(AF_INET)
                addr.sin_port        = UInt16(kSocksPort).bigEndian
                addr.sin_addr.s_addr = inet_addr("127.0.0.1")
                let connected = withUnsafePointer(to: &addr) { ptr in
                    ptr.withMemoryRebound(to: sockaddr.self, capacity: 1) {
                        connect(sock, $0, socklen_t(MemoryLayout<sockaddr_in>.size))
                    }
                } == 0
                close(sock)
                if connected {
                    appendLog("XRAY-READY: SOCKS5 port \(kSocksPort) open after \(tries) poll(s) (≤\(Int(Double(tries) * 50))ms)")
                    return true
                }
            }
            if Date() >= deadline { break }
            Thread.sleep(forTimeInterval: 0.05)
        }
        appendLog("XRAY-READY: port \(kSocksPort) not ready after \(tries) tries (\(Int(maxWait))s) — S3→S4 race likely")
        return false
    }

    @discardableResult
    private func startHevMode() -> Bool {
        appendLog("HEV-START: build=\(Bundle.main.infoDictionary?["CFBundleVersion"] as? String ?? "?") mode=HEV_AVAILABLE socket=AF_UNIX/SOCK_DGRAM")

        // Block until xray's SOCKS5 inbound is listening (max 3s).
        // HEV attempts to connect to 127.0.0.1:10808 on its very first packet.
        // If xray isn't ready, that connect() fails and HEV never retries — S4 stays 0.
        let xrayUp = waitForXraySocks5Ready()
        appendLog("HEV-START: xray SOCKS5 \(xrayUp ? "ready ✓" : "not ready — proceeding (watchdog will catch this)")")

        var fds = [Int32](repeating: -1, count: 2)
        guard socketpair(AF_UNIX, SOCK_DGRAM, 0, &fds) == 0 else {
            appendLog("HEV-START: socketpair(AF_UNIX,SOCK_DGRAM) FAILED errno=\(errno) — caller must fail tunnel")
            return false
        }
        let hevFd   = fds[0]
        hevBridgeFd = fds[1]
        appendLog("HEV-START: socketpair(AF_UNIX,SOCK_DGRAM) OK — hevFd=\(hevFd) bridgeFd=\(hevBridgeFd) ✓")

        let configData = buildHevConfig()
        appendLog("HEV: config \(configData.count)B — socks5=127.0.0.1:\(kSocksPort) mtu=1500")

        // hev_socks5_tunnel_main_from_str blocks until hev_socks5_tunnel_quit() is called.
        let configCopy = configData
        Thread.detachNewThread {
            configCopy.withUnsafeBytes { ptr in
                let base = ptr.baseAddress!.assumingMemoryBound(to: UInt8.self)
                _ = hev_socks5_tunnel_main_from_str(base, UInt32(configCopy.count), hevFd)
            }
            close(hevFd)
        }
        appendLog("HEV: tunnel thread started")

        // ── socket → packetFlow (inbound from internet) ──────────────────────
        let bridgeFd = hevBridgeFd
        let queue    = DispatchQueue(label: "no.setalink.hev.rx", qos: .userInitiated)
        let source   = DispatchSource.makeReadSource(fileDescriptor: bridgeFd, queue: queue)
        source.setEventHandler { [weak self] in
            guard let self = self else { return }
            // Count and log DispatchSource fires — proves bridgeFd has data vs. event never arrives.
            self.hevStats.rxRelayEventsFired += 1
            let evN = self.hevStats.rxRelayEventsFired
            if evN <= 5 {
                self.appendLog("RX-RELAY-EVENT[\(evN)]: DispatchSource fired — about to recv() bridgeFd=\(bridgeFd)")
            }
            var buffer = [UInt8](repeating: 0, count: 65536)
            let n = recv(bridgeFd, &buffer, buffer.count, 0)
            guard n > 0 else {
                // n==0 → EOF (socket closed); n<0 → error. Both indicate broken bridge.
                if n == 0 {
                    self.appendLog("RX-RELAY: recv()=0 EOF — bridgeFd=\(bridgeFd) closed (HEV quit?)")
                } else {
                    self.appendLog("RX-RELAY: recv()=-1 errno=\(errno) — bridgeFd=\(bridgeFd) broken")
                }
                return
            }
            let packet  = Data(buffer[..<n])
            self.hevStats.s7Packets += 1          // S7: received from HEV (from internet)
            self.hevStats.s7Bytes   += n
            let s7 = self.hevStats.s7Packets
            // Log first 5 post-connect inbound packets — proves full S7→S8 path is alive.
            if self.postConnectTime != nil && s7 <= 5 {
                let tPc = self.postConnectTime.map { Int((-$0.timeIntervalSinceNow).rounded()) } ?? -1
                self.appendLog("RX-RELAY[S7=\(s7)] +\(tPc)s recv \(n)B ← HEV (internet)")
            }
            if !self.hevStats.loggedFirstRx {
                self.hevStats.loggedFirstRx = true
                self.appendLog("FIRST-PKT-IN: S7 recv \(n)B from HEV ← internet — end-to-end relay confirmed ✓")
                self.postConnectWatchdog?.cancel()
                self.postConnectWatchdog = nil
            }
            let version = (packet[0] >> 4) & 0xF
            let proto: NSNumber = version == 6
                ? NSNumber(value: AF_INET6)
                : NSNumber(value: AF_INET)
            self.packetFlow.writePackets([packet], withProtocols: [proto])
            self.hevStats.s8Packets += 1          // S8: written back into packetFlow
        }
        source.resume()
        hevRelaySource = source
        appendLog("HEV: rx relay started (socket→packetFlow)")

        // ── packetFlow → socket (outbound from device) ───────────────────────
        readNextPackets(to: bridgeFd)
        appendLog("HEV: tx relay started (packetFlow→socket)")

        // ── startup relay watcher: every 500ms for 10s, log S1/S3/S4 ─────────
        // Catches the S3→S4 race where xray isn't ready when first packets arrive.
        // Uses Thread.sleep (not DispatchSource timer) to survive busy GCD queues.
        Thread.detachNewThread { [weak self] in
            for tick in 1...20 {
                Thread.sleep(forTimeInterval: 0.5)
                guard let self = self else { return }
                let s1 = self.hevStats.s1Packets
                let s3 = self.hevStats.s3Written
                var hTxP: size_t = 0, hTxB: size_t = 0, hRxP: size_t = 0, hRxB: size_t = 0
                hev_socks5_tunnel_stats(&hTxP, &hTxB, &hRxP, &hRxB)
                self.appendLog("STARTUP[\(String(format:"%.1f",Double(tick)*0.5))s] S1=\(s1) S3=\(s3) S4=\(hTxP) S7=\(hRxP)")
            }
        }

        // ── S5 liveness: confirm xray is listening on SOCKS5 port ────────────
        DispatchQueue.global(qos: .background).asyncAfter(deadline: .now() + 1.0) { [weak self] in
            self?.probeXraySocksPort()
        }

        // ── Raw SOCKS5 probes: test xray routing at the protocol level ─────────
        // Port 53 (DNS) hits the port-53→dns-out routing rule; port 443 (HTTPS)
        // falls through to the proxy outbound. Comparing the two shows exactly
        // where the pipeline breaks inside xray, independent of HEV.
        let bridgeFdCopy = bridgeFd
        DispatchQueue.global(qos: .background).asyncAfter(deadline: .now() + 5.0) { [weak self] in
            self?.rawSocks5Probe(toIP: "1.1.1.1", port: 53,  label: "DNS-p53")
            self?.rawSocks5Probe(toIP: "1.1.1.1", port: 443, label: "HTTPS-p443")
        }
        startBridgeFdPoller(bridgeFd: bridgeFdCopy)

        // ── periodic pipeline stats (5s interval, always on for diagnosis) ───
        startHevStatsTimer()

        // ── #5 #18 Network path monitor: logs WiFi↔cellular switches and IPv6-only paths ──
        startNetworkMonitor()

        // ── #6 #8 Liveness heartbeat: extension writes ts every 30s so main app can ──
        // detect a frozen extension (no heartbeat update = extension may have crashed).
        startLivenessTimer()

        return true
    }

    // Chain continuous reads from packetFlow, writing each IP packet to the socket.
    // Classifies every packet by protocol/port for traffic verification logging.
    private func readNextPackets(to fd: Int32) {
        packetFlow.readPackets { [weak self] packets, _ in
            guard let self = self, self.hevBridgeFd != -1 else { return }
            // Log when callback fires with 0 packets — may indicate stall or fd closure.
            if packets.isEmpty {
                self.appendLog("RX-CB: readPackets delivered 0 pkts — stall? S1=\(self.hevStats.s1Packets) fd=\(fd) postConnect=\(self.postConnectTime != nil)")
            }
            for packet in packets {
                let (proto, dstPort) = self.classifyPacket(packet)
                self.hevStats.s1Packets += 1      // S1: packetFlow delivered this packet
                self.hevStats.txBytes   += packet.count
                switch proto {
                case 6:
                    self.hevStats.txTCP += 1
                case 17:
                    self.hevStats.txUDP += 1
                    if dstPort == 443 { self.hevStats.txQUIC += 1 }
                default:
                    self.hevStats.txOther += 1
                }
                let s1 = self.hevStats.s1Packets
                // Post-connect: log first 5 packets + every 50th. Proves readPackets is alive.
                if self.postConnectTime != nil && (s1 <= 5 || s1 % 50 == 0) {
                    let tPc = self.postConnectTime.map { Int((-$0.timeIntervalSinceNow).rounded()) } ?? -1
                    let pn = proto == 6 ? "TCP" : proto == 17 ? "UDP" : "IP(\(proto))"
                    self.appendLog("TX-PKT[S1=\(s1)] +\(tPc)s \(pn)\(dstPort.map{" dst=\($0)"} ?? "") \(packet.count)B")
                }
                // S3: write to HEV bridge socket — capture return value to detect drops.
                let sent = packet.withUnsafeBytes { ptr -> Int in
                    Int(send(fd, ptr.baseAddress!, ptr.count, 0))
                }
                if sent == packet.count {
                    self.hevStats.s3Written += 1   // S3: socket accepted the packet
                    if !self.hevStats.loggedFirstTx {
                        self.hevStats.loggedFirstTx = true
                        let protoName = proto == 6 ? "TCP" : proto == 17 ? "UDP" : "IP(\(proto))"
                        self.appendLog("FIRST-PKT-OUT: S3 sent \(packet.count)B \(protoName)\(dstPort.map { " dstPort=\($0)" } ?? "") → HEV socket")
                        let hexDump = packet.prefix(24).map { String(format: "%02x", $0) }.joined(separator: " ")
                        self.appendLog("FIRST-PKT-HEX: [\(hexDump)] (first \(min(packet.count,24)) of \(packet.count)B)")
                        // Arm 30s watchdog (extended from 8s in build-45 for deeper observation).
                        // Fires only when outbound traffic hits TUN with no inbound response.
                        let watchdog = DispatchWorkItem { [weak self] in
                            guard let self = self, !self.hevStats.loggedFirstRx else { return }
                            self.appendLog("WATCHDOG: 30s since FIRST-PKT-OUT with no FIRST-PKT-IN — internet unreachable through tunnel")
                            self.cancelTunnel(reason: "No internet response in 30s after first outbound packet — HEV relay or Reality server unreachable")
                        }
                        self.postConnectWatchdog = watchdog
                        DispatchQueue.global(qos: .background).asyncAfter(deadline: .now() + 30.0, execute: watchdog)
                    }
                } else {
                    self.hevStats.s3Drop += 1      // S3 drop: send() short/error
                    let drop = self.hevStats.s3Drop
                    if drop <= 5 || drop % 100 == 0 {
                        self.appendLog("TX-DROP[S3drop=\(drop)]: send()=\(sent) expected=\(packet.count) errno=\(errno) fd=\(fd)")
                    }
                }
            }
            self.readNextPackets(to: fd)
        }
    }

    // Extract IP protocol number and destination port from a raw IP packet.
    // Supports both IPv4 and IPv6 headers.
    private func classifyPacket(_ data: Data) -> (proto: UInt8, dstPort: UInt16?) {
        guard data.count >= 1 else { return (0, nil) }
        let version = (data[0] >> 4) & 0xF
        var proto: UInt8 = 0
        var toff = 0
        if version == 4 {
            guard data.count >= 10 else { return (0, nil) }
            proto = data[9]
            toff  = Int(data[0] & 0xF) * 4
        } else if version == 6 {
            guard data.count >= 7 else { return (0, nil) }
            proto = data[6]
            toff  = 40
        } else { return (0, nil) }
        // Only TCP(6) and UDP(17) carry a 4-byte port header immediately after IP.
        guard proto == 6 || proto == 17, data.count >= toff + 4 else { return (proto, nil) }
        let dstPort = UInt16(data[toff + 2]) << 8 | UInt16(data[toff + 3])
        return (proto, dstPort)
    }

    // ── Raw SOCKS5 protocol probe ──────────────────────────────────────────────
    // Makes a complete SOCKS5 handshake using BSD sockets (not URLSession) to
    // 127.0.0.1:kSocksPort and then issues CONNECT to toIP:port.
    // Tests xray SOCKS5 routing at the protocol level, independent of HEV.
    //
    // Expected results with the current routing config:
    //   port=53  → hits "port:53 → dns-out" rule → dns-out cannot handle transparent
    //              TCP proxy → CONNECT response hangs or returns failure rep code
    //   port=443 → falls through to "proxy" (vless/Reality) → CONNECT succeeds
    //              meaning the Reality server path works
    private func rawSocks5Probe(toIP: String, port: Int, label: String) {
        appendLog("RAW-SOCKS5[\(label)]: probe start — CONNECT to \(toIP):\(port) via 127.0.0.1:\(kSocksPort)")
        let sock = socket(AF_INET, SOCK_STREAM, 0)
        guard sock != -1 else {
            appendLog("RAW-SOCKS5[\(label)]: socket() failed errno=\(errno)")
            return
        }
        defer { close(sock) }

        var tv = timeval(tv_sec: 8, tv_usec: 0)
        setsockopt(sock, SOL_SOCKET, SO_RCVTIMEO, &tv, socklen_t(MemoryLayout<timeval>.size))
        setsockopt(sock, SOL_SOCKET, SO_SNDTIMEO, &tv, socklen_t(MemoryLayout<timeval>.size))

        var addr = sockaddr_in()
        addr.sin_family = sa_family_t(AF_INET)
        addr.sin_port   = UInt16(kSocksPort).bigEndian
        addr.sin_addr.s_addr = inet_addr("127.0.0.1")
        let connected = withUnsafePointer(to: &addr) {
            $0.withMemoryRebound(to: sockaddr.self, capacity: 1) {
                connect(sock, $0, socklen_t(MemoryLayout<sockaddr_in>.size))
            }
        } == 0
        guard connected else {
            appendLog("RAW-SOCKS5[\(label)]: TCP connect FAILED errno=\(errno) — xray SOCKS5 port not reachable")
            return
        }
        appendLog("RAW-SOCKS5[\(label)]: TCP connect OK")

        // Step 1 — SOCKS5 greeting (no auth)
        var greeting: [UInt8] = [0x05, 0x01, 0x00]
        guard send(sock, &greeting, 3, 0) == 3 else {
            appendLog("RAW-SOCKS5[\(label)]: send(greeting) failed errno=\(errno)")
            return
        }
        var gresp = [UInt8](repeating: 0, count: 2)
        let gn = recv(sock, &gresp, 2, MSG_WAITALL)
        guard gn == 2 else {
            appendLog("RAW-SOCKS5[\(label)]: recv(greeting_resp) n=\(gn) errno=\(errno) — xray closed or timed out on greeting")
            return
        }
        let gHex = gresp.map { String(format: "%02x", $0) }.joined(separator: " ")
        appendLog("RAW-SOCKS5[\(label)]: greeting resp=[\(gHex)]")
        guard gresp[0] == 0x05 && gresp[1] == 0x00 else {
            appendLog("RAW-SOCKS5[\(label)]: auth method=0x\(String(format:"%02x",gresp[1])) — no-auth rejected")
            return
        }

        // Step 2 — SOCKS5 CONNECT to toIP:port
        var ipBytes = [UInt8](repeating: 0, count: 4)
        inet_pton(AF_INET, toIP, &ipBytes)
        var req: [UInt8] = [
            0x05, 0x01, 0x00, 0x01,          // VER CMD(CONNECT) RSV ATYP(IPv4)
            ipBytes[0], ipBytes[1], ipBytes[2], ipBytes[3],
            UInt8((port >> 8) & 0xFF), UInt8(port & 0xFF),
        ]
        guard send(sock, &req, req.count, 0) == req.count else {
            appendLog("RAW-SOCKS5[\(label)]: send(CONNECT) failed errno=\(errno)")
            return
        }
        appendLog("RAW-SOCKS5[\(label)]: CONNECT request sent → waiting for xray response (8s timeout)…")

        var cresp = [UInt8](repeating: 0, count: 10)
        let cn = recv(sock, &cresp, 10, MSG_WAITALL)
        guard cn >= 4 else {
            appendLog("RAW-SOCKS5[\(label)]: recv(CONNECT_resp) n=\(cn) errno=\(errno) — xray did NOT respond to CONNECT (timeout or closed) ✗")
            return
        }
        let rep    = cresp[1]
        let cHex   = cresp[..<min(cn, 10)].map { String(format: "%02x", $0) }.joined(separator: " ")
        let repMsg = rep == 0x00 ? "SUCCESS" :
                     rep == 0x01 ? "FAIL(general)" :
                     rep == 0x02 ? "FAIL(not-allowed)" :
                     rep == 0x03 ? "FAIL(net-unreachable)" :
                     rep == 0x04 ? "FAIL(host-unreachable)" :
                     rep == 0x05 ? "FAIL(conn-refused)" : "FAIL(0x\(String(format:"%02x",rep)))"
        appendLog("RAW-SOCKS5[\(label)]: CONNECT resp=[\(cHex)] rep=\(repMsg)")

        // Step 3 — if CONNECT succeeded on port 443, confirm data flows
        if rep == 0x00 && port == 443 {
            // Send a minimal TLS ClientHello to confirm the channel is open.
            // Not a real handshake — we just want to see if xray echos something back.
            var tlsHello: [UInt8] = [
                0x16, 0x03, 0x01, 0x00, 0x05,        // ContentType=Handshake TLS1.0 len=5
                0x01, 0x00, 0x00, 0x01, 0x00,         // ClientHello (minimal, invalid but sends bytes)
            ]
            send(sock, &tlsHello, tlsHello.count, 0)
            var tlsResp = [UInt8](repeating: 0, count: 16)
            let tn = recv(sock, &tlsResp, 16, 0)
            // Any response (even a TLS Alert) proves the channel is alive.
            appendLog("RAW-SOCKS5[\(label)]: data channel test — recv=\(tn) bytes\(tn > 0 ? " → channel is LIVE ✓" : " (0 or error errno=\(errno))")")
        }
    }

    // ── bridgeFd availability poller ───────────────────────────────────────────
    // Uses poll(2) to check if bridgeFd has data every 10s for 60s.
    // If poll() never returns POLLIN, HEV is not writing any packets to the socket.
    private func startBridgeFdPoller(bridgeFd: Int32) {
        Thread.detachNewThread { [weak self] in
            guard let self = self else { return }
            for i in 1...6 {
                Thread.sleep(forTimeInterval: 10.0)
                var pfd = pollfd(fd: bridgeFd, events: Int16(POLLIN), revents: 0)
                let result = poll(&pfd, 1, 200)   // 200ms
                let dataReady = result > 0 && (pfd.revents & Int16(POLLIN)) != 0
                let errFlag   = result > 0 && (pfd.revents & Int16(POLLERR | POLLHUP | POLLNVAL)) != 0
                self.appendLog(
                    "RX-POLL[\(i*10)s]: poll(bridgeFd=\(bridgeFd)) result=\(result)" +
                    (dataReady ? " DATA_PENDING ← HEV wrote something" :
                     errFlag   ? " ERR/HUP/NVAL (bridgeFd closed?)" :
                     result == 0 ? " TIMEOUT (no data from HEV in 200ms)" :
                                   " errno=\(errno)")
                )
            }
            self.appendLog("RX-POLL: 60s done — if all TIMEOUT, HEV wrote nothing to bridgeFd")
        }
    }

    private func stopHevMode() {
        pathMonitor?.cancel();   pathMonitor   = nil
        livenessTimer?.cancel(); livenessTimer = nil
        hevStatsTimer?.cancel()
        hevStatsTimer = nil
        hevRelaySource?.cancel()
        hevRelaySource = nil
        logHevStats(final: true)   // final stats before hev quits
        hev_socks5_tunnel_quit()
        if hevBridgeFd != -1 {
            close(hevBridgeFd)
            hevBridgeFd = -1
        }
        appendLog("HEV: stopped")
    }

    // ── #5 #18 Network path monitor ───────────────────────────────────────────
    // Logs every path change so admin can correlate "tunnel silently failed" reports
    // with WiFi→cellular switches or IPv6-only paths (e.g. some 5G carriers).
    private func startNetworkMonitor() {
        let monitor = NWPathMonitor()
        monitor.pathUpdateHandler = { [weak self] path in
            guard let self = self else { return }
            let status = path.status == .satisfied ? "satisfied" : "unsatisfied"
            let ifaces = path.availableInterfaces.map { iface -> String in
                switch iface.type {
                case .wifi:          return "wifi"
                case .cellular:      return "cellular"
                case .wiredEthernet: return "ethernet"
                case .loopback:      return "loopback"
                default:             return "other"
                }
            }.joined(separator: ",")
            let proto = [path.supportsIPv4 ? "ipv4" : "", path.supportsIPv6 ? "ipv6" : ""]
                .filter { !$0.isEmpty }.joined(separator: "+")
            self.appendLog("NETCHANGE: path=\(status) interfaces=[\(ifaces.isEmpty ? "none" : ifaces)] proto=[\(proto)]")
            if path.status != .satisfied {
                self.appendLog("NETCHANGE: ⚠️ network path lost — tunnel may silently drop packets until path restores (#5)")
            }
            if !path.supportsIPv4 && path.supportsIPv6 {
                self.appendLog("NETCHANGE: ⚠️ IPv6-only path — if VPN server at \(self.configMeta.addr) is IPv4-only, connection will fail (#18)")
            }
        }
        monitor.start(queue: DispatchQueue(label: "no.setalink.pathmonitor", qos: .background))
        pathMonitor = monitor
        appendLog("NETMONITOR: NWPathMonitor started")
    }

    // ── #6 #8 Extension liveness heartbeat ────────────────────────────────────
    // Writes a unix timestamp every 30s to shared UserDefaults. The main app can
    // read kHeartbeatKey and compare with current time: delta > 60s means the
    // extension process has likely frozen or been killed by iOS (#6 sleep, #8 crash).
    private func startLivenessTimer() {
        guard let shared = UserDefaults(suiteName: kAppGroup) else { return }
        let timer = DispatchSource.makeTimerSource(queue: .global(qos: .background))
        timer.schedule(deadline: .now() + 30, repeating: 30)
        timer.setEventHandler { [weak self] in
            guard self != nil else { return }
            shared.set(Int(Date().timeIntervalSince1970), forKey: kHeartbeatKey)
        }
        timer.resume()
        livenessTimer = timer
        // Write immediately so the first read from the main app has a baseline value.
        shared.set(Int(Date().timeIntervalSince1970), forKey: kHeartbeatKey)
        appendLog("HEARTBEAT: liveness timer started (30s interval) key=\(kHeartbeatKey)")
    }

    // ── Diagnostic logging gate ───────────────────────────────────────────────

    // True in DEBUG and TestFlight builds; false in App Store (production) releases.
    private var verboseHevLogging: Bool {
        #if DEBUG
        return true
        #else
        let appBundle = Bundle.main.bundleURL
            .deletingLastPathComponent()
            .deletingLastPathComponent()
        let sandboxReceipt = appBundle
            .appendingPathComponent("StoreKit/sandboxReceipt").path
        return FileManager.default.fileExists(atPath: sandboxReceipt)
        #endif
    }

    // ── Stage 5 probe: confirm xray is listening on the SOCKS5 port ──────────
    // A TCP connect to 127.0.0.1:10808 tells us whether xray's inbound is up.
    // This does NOT send data — it only verifies the port is open.
    private func probeXraySocksPort() {
        let sock = socket(AF_INET, SOCK_STREAM, 0)
        guard sock != -1 else {
            appendLog("S5-PROBE: socket() failed errno=\(errno)")
            return
        }
        defer { close(sock) }
        var addr = sockaddr_in()
        addr.sin_family      = sa_family_t(AF_INET)
        addr.sin_port        = UInt16(kSocksPort).bigEndian
        addr.sin_addr.s_addr = inet_addr("127.0.0.1")
        let connectResult = withUnsafePointer(to: &addr) { ptr in
            ptr.withMemoryRebound(to: sockaddr.self, capacity: 1) { saddr in
                connect(sock, saddr, socklen_t(MemoryLayout<sockaddr_in>.size))
            }
        }
        if connectResult == 0 {
            appendLog("S5-PROBE: xray SOCKS5 port \(kSocksPort) OPEN — xray inbound is listening ✓")
        } else {
            appendLog("S5-PROBE: xray SOCKS5 port \(kSocksPort) CLOSED/REFUSED errno=\(errno) — xray may not be running ✗")
        }
    }

    // ── Stats logging ─────────────────────────────────────────────────────────

    // Fires every 5 seconds during diagnosis — no verboseHevLogging gate here.
    // In production (App Store), reduce to 60s after the pipeline is confirmed working.
    private func startHevStatsTimer() {
        let interval: Double = verboseHevLogging ? 5.0 : 60.0
        let timer = DispatchSource.makeTimerSource(queue: .global(qos: .background))
        timer.schedule(deadline: .now() + interval, repeating: interval)
        timer.setEventHandler { [weak self] in self?.logHevStats(final: false) }
        timer.resume()
        hevStatsTimer = timer
    }

    // Logs all 8 pipeline stages in order.
    //
    // S1 = packetFlow.readPackets delivered (Swift counter)
    // S2 = per-second rate since last tick (computed from snapshot delta)
    // S3 = written to HEV socket (Swift counter) + drops
    // S4 = HEV forwarded to SOCKS5 (C counter via hev_socks5_tunnel_stats)
    // S5 = xray SOCKS5 liveness (one-shot at startup, see probeXraySocksPort)
    // S6 = xray → Reality server (no direct counter; inferred if S4>0 and S7>0)
    // S7 = received back from HEV socket (Swift counter) + C counter cross-check
    // S8 = written back into packetFlow (Swift counter)
    //
    // The first stage that stays at zero identifies the broken component.
    private func logHevStats(final: Bool) {
        var hTxP: size_t = 0, hTxB: size_t = 0
        var hRxP: size_t = 0, hRxB: size_t = 0
        hev_socks5_tunnel_stats(&hTxP, &hTxB, &hRxP, &hRxB)

        let tag  = final ? "PIPE-FINAL" : "PIPE"
        let now  = Date()
        let dt   = now.timeIntervalSince(hevStats.snapTime)
        let s1ps = dt > 0 ? Double(hevStats.s1Packets - hevStats.snapS1) / dt : 0
        let s3ps = dt > 0 ? Double(hevStats.s3Written  - hevStats.snapS3)  / dt : 0
        let s7ps = dt > 0 ? Double(hevStats.s7Packets  - hevStats.snapS7)  / dt : 0

        appendLog("[\(tag)] ──── pipeline counters ────────────────────────────")
        appendLog("[\(tag)] S1 packetFlow→relay : \(hevStats.s1Packets) pkts total | \(String(format:"%.1f",s1ps)) pkt/s")
        appendLog("[\(tag)] S2 rate (pkt/s)     : \(String(format:"%.1f",s1ps)) [TCP=\(hevStats.txTCP) UDP=\(hevStats.txUDP) QUIC=\(hevStats.txQUIC)]")
        appendLog("[\(tag)] S3 relay→hev socket : \(hevStats.s3Written) written | \(hevStats.s3Drop) dropped | \(String(format:"%.1f",s3ps)) pkt/s")
        appendLog("[\(tag)] S4 hev→SOCKS5 (lib) : \(hTxP) pkts \(hTxB) bytes (C counter — authoritative)")
        appendLog("[\(tag)] S5 xray SOCKS5 up   : see S5-PROBE line at tunnel start")
        appendLog("[\(tag)] S6 xray→Reality     : no direct counter (inferred: S4=\(hTxP)>0 && S7=\(hRxP)>0 → ok)")
        appendLog("[\(tag)] S7 hev←SOCKS5 (lib) : \(hRxP) pkts \(hRxB) bytes (C counter) | swift=\(hevStats.s7Packets) pkts")
        appendLog("[\(tag)] S8 relay→packetFlow  : \(hevStats.s8Packets) pkts | \(String(format:"%.1f",s7ps)) pkt/s")
        appendLog("[\(tag)] ── first zero stage = broken component ───────────")

        // S1=0 → routes not applied (TUN never receives app packets)
        // S3=0 (S1>0) → socketpair bridge broken
        // S4=0 (S3>0) → hev not reading socket or SOCKS5 connection failed
        // S7=0 (S4>0) → xray not forwarding (check xray config, Reality server)
        // S8=0 (S7>0) → writePackets path broken
        if hevStats.s1Packets == 0 {
            appendLog("[\(tag)] DIAGNOSIS: S1=0 → packetFlow delivers NO packets — routes not applied to app traffic. Check includedRoutes/excludedRoutes and NEIPv4Settings.")
        } else if hevStats.s3Written == 0 {
            appendLog("[\(tag)] DIAGNOSIS: S1>0 S3=0 → relay receives packets but socket send() fails — HEV bridge broken. Check socketpair fd validity.")
        } else if hTxP == 0 {
            appendLog("[\(tag)] DIAGNOSIS: S3>0 S4=0 → packets reach socket but hev-lib forwards 0 — hev not reading socket, or SOCKS5 connect to xray failed. See S5-PROBE.")
        } else if hRxP == 0 {
            appendLog("[\(tag)] DIAGNOSIS: S4>0 S7=0 → hev sent to SOCKS5/xray but received 0 back — xray not responding (Reality server down? Xray config error?)")
        } else if hevStats.s8Packets == 0 {
            appendLog("[\(tag)] DIAGNOSIS: S7>0 S8=0 — internal counter bug; responses arrive but writePackets count is 0.")
        } else {
            appendLog("[\(tag)] DIAGNOSIS: all stages > 0 — pipeline appears healthy (S1=\(hevStats.s1Packets) S4=\(hTxP) S7=\(hRxP) S8=\(hevStats.s8Packets))")
        }

        // Update rate snapshot
        hevStats.snapS1   = hevStats.s1Packets
        hevStats.snapS3   = hevStats.s3Written
        hevStats.snapS7   = hevStats.s7Packets
        hevStats.snapTime = now

        guard final else { return }

        // ── Final summary (always written, production + TestFlight) ──────────
        if hTxP > 0 {
            appendLog("HEV VERIFY ✓: \(hTxP)pkts SOCKS5→xray (TCP=\(hevStats.txTCP) UDP=\(hevStats.txUDP) QUIC=\(hevStats.txQUIC))")
        } else if hevStats.s1Packets > 0 {
            appendLog("HEV VERIFY ✗: S1=\(hevStats.s1Packets) packets from packetFlow, S4=0 reached SOCKS5 — pipeline broke between S3 and S4")
        } else {
            appendLog("HEV VERIFY: S1=0 — no app traffic reached TUN during session")
        }
    }

    // BUILD-45: post-connect background thread — logs S1/S3/S4/S7/S8 every second for 120s.
    // Runs AFTER completionHandler(nil). Thread.sleep survives longer than DispatchSourceTimer
    // under iOS extension suspension (timers stop firing; threads continue, just infrequently).
    // Key questions answered:
    //   - Does S1 increase post-connect? (readPackets alive?)
    //   - Does S4 increase? (HEV forwarding to xray?)
    //   - Do POST[T+Xs] lines appear in log? (thread alive despite iOS suspension?)
    //   - Timestamps reveal actual CPU scheduling delay (Thread.sleep(1) ≠ exactly 1s).
    private func startPostConnectMonitor(shared: UserDefaults) {
        var prev = (s1: hevStats.s1Packets, s3: hevStats.s3Written, s4: 0, s7: 0)
        appendLog("POST-MONITOR: started — S1/S3/S4/S7/S8 every 1s for 120s via Thread.sleep")
        Thread.detachNewThread { [weak self] in
            guard let self = self else { return }
            for sec in 1...120 {
                Thread.sleep(forTimeInterval: 1.0)
                let s1 = self.hevStats.s1Packets
                let s3 = self.hevStats.s3Written
                let s8 = self.hevStats.s8Packets
                var hTxP: size_t = 0, hTxB: size_t = 0, hRxP: size_t = 0, hRxB: size_t = 0
                hev_socks5_tunnel_stats(&hTxP, &hTxB, &hRxP, &hRxB)
                let s4 = Int(hTxP), s7 = Int(hRxP)
                let d1 = s1-prev.s1, d3 = s3-prev.s3, d4 = s4-prev.s4, d7 = s7-prev.s7
                self.appendLog("POST[T+\(sec)s] S1=\(s1)(+\(d1)) S3=\(s3)(+\(d3)) S4=\(s4)(+\(d4)) S7=\(s7)(+\(d7)) S8=\(s8)")
                prev = (s1, s3, s4, s7)
                if sec % 15 == 0 {
                    self.flushLog(to: shared)
                    shared.synchronize()
                }
            }
            self.appendLog("POST-MONITOR: 120s done")
            self.flushLog(to: shared)
            shared.synchronize()
        }
    }

    #endif

    // MARK: - fail() helper

    private func fail(_ message: String,
                      shared: UserDefaults?,
                      _ completionHandler: @escaping (Error?) -> Void) {
        appendLog("FAIL: \(message)")
        shared?.set(message,                     forKey: kErrorKey)
        shared?.set(false,                       forKey: kProbeOkKey)
        shared?.set(TunnelState.failed.rawValue, forKey: kTunnelStateKey)
        flushLog(to: shared ?? .standard)
        // Same cross-process synchronize as the success path — ensures the error
        // is visible to the main app before completionHandler fires.
        (shared ?? .standard).synchronize()

        // Upload synchronously — extension process will be killed after completionHandler.
        let (deviceId, appVersion, country) = readDiagContext(from: shared ?? .standard)
        uploadDiagnostics(deviceId: deviceId, appVersion: appVersion, country: country,
                          success: false, errorMsg: message,
                          waitForCompletion: true)

        completionHandler(NSError(domain: "no.setalink.tunnel", code: -1,
                                  userInfo: [NSLocalizedDescriptionKey: message]))
    }

    // Called post-connect when the watchdog detects a dead tunnel (connected but
    // no internet response). Uploads diagnostics then disconnects via cancelTunnelWithError().
    private func cancelTunnel(reason: String) {
        appendLog("WATCHDOG-FAIL: \(reason)")
        if let shared = UserDefaults(suiteName: kAppGroup) {
            shared.set(reason,                       forKey: kErrorKey)
            shared.set(false,                        forKey: kProbeOkKey)
            shared.set(TunnelState.failed.rawValue,  forKey: kTunnelStateKey)
            flushLog(to: shared)
            let (deviceId, appVersion, country) = readDiagContext(from: shared)
            DispatchQueue.global(qos: .background).async {
                self.uploadDiagnostics(deviceId: deviceId, appVersion: appVersion,
                                       country: country, success: false, errorMsg: reason,
                                       waitForCompletion: false)
            }
        }
        cancelTunnelWithError(NSError(domain: "no.setalink.tunnel", code: -2,
                                      userInfo: [NSLocalizedDescriptionKey: reason]))
    }

    // MARK: - Helpers

    private func step(_ name: String) {
        lastStep = name
        appendLog("STATE: \(name)")
    }

    private func appendLog(_ line: String) {
        let ts = ISO8601DateFormatter().string(from: Date())
        log.append("[\(ts)] \(line)")
    }

    private func flushLog(to shared: UserDefaults) {
        shared.set(log, forKey: kLogKey)
    }

    private func elapsed(since t0: Date) -> String {
        String(format: "%.2fs", -t0.timeIntervalSinceNow)
    }

    // SHA256 of a UTF-8 string, hex-encoded.
    private func sha256(_ string: String) -> String {
        let data   = Data(string.utf8)
        let digest = SHA256.hash(data: data)
        return digest.map { String(format: "%02x", $0) }.joined()
    }

    // Mask secret fields (id/UUID, publicKey, shortId) in a raw JSON string.
    private func sanitizeConfig(_ json: String) -> String {
        var result = json
        let patterns: [(String, String)] = [
            (#""id"\s*:\s*"[0-9a-fA-F\-]{8,}""#,  #""id":"***""#),
            (#""publicKey"\s*:\s*"[^"]+""#,         #""publicKey":"***""#),
            (#""shortId"\s*:\s*"[^"]*""#,           #""shortId":"***""#),
        ]
        for (pattern, replacement) in patterns {
            if let re = try? NSRegularExpression(pattern: pattern) {
                let range = NSRange(result.startIndex..., in: result)
                result = re.stringByReplacingMatches(in: result, range: range,
                                                     withTemplate: replacement)
            }
        }
        return result
    }

    // Serialize a JSON-compatible dictionary to a sanitized string (masks secrets).
    private func sanitizeJsonObject(_ obj: [String: Any]) -> String? {
        guard let data   = try? JSONSerialization.data(withJSONObject: obj),
              let raw    = String(data: data, encoding: .utf8)
        else { return nil }
        return sanitizeConfig(raw)
    }

    // True only for dotted-quad IPv4 literals (e.g. "178.104.77.231"). Used to decide
    // whether the server address can be added to excludedRoutes for loop prevention.
    private func isIPv4Literal(_ s: String) -> Bool {
        let parts = s.split(separator: ".", omittingEmptySubsequences: false)
        guard parts.count == 4 else { return false }
        return parts.allSatisfy { p in
            guard let n = Int(p), n >= 0, n <= 255, String(n) == p else { return false }
            return true
        }
    }

    private func stopReasonDescription(_ reason: NEProviderStopReason) -> String {
        switch reason {
        case .none:                       return "none"
        case .userInitiated:              return "userInitiated"
        case .providerFailed:             return "providerFailed"
        case .noNetworkAvailable:         return "noNetworkAvailable"
        case .unrecoverableNetworkChange: return "unrecoverableNetworkChange"
        case .providerDisabled:           return "providerDisabled"
        case .authenticationCanceled:     return "authenticationCanceled"
        case .configurationFailed:        return "configurationFailed"
        case .idleTimeout:                return "idleTimeout"
        case .configurationDisabled:      return "configurationDisabled"
        case .configurationRemoved:       return "configurationRemoved"
        case .superceded:                 return "superceded"
        case .userLogout:                 return "userLogout"
        case .userSwitch:                 return "userSwitch"
        case .connectionFailed:           return "connectionFailed"
        case .sleep:                      return "sleep"
        case .appUpdate:                  return "appUpdate"
        @unknown default:                 return "unknown(\(reason.rawValue))"
        }
    }
}
