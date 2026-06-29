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

// Formal connection lifecycle. completionHandler(nil) is called ONLY from the
// connectedVerified transition — never add a shortcut that bypasses probe 3.
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
    private var livenessTimer:       DispatchSourceTimer?  = nil   // #6 #8 30s heartbeat

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
        var loggedFirstTx: Bool = false   // first outbound packet through S3
        var loggedFirstRx: Bool = false   // first inbound packet through S7

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

            // ── Phase 5 (HEV only): start tun2socks relay ────────────────────
            // HEV is REQUIRED in HEV_AVAILABLE builds — all app traffic routes through
            // TUN → socketpair → hev → xray. If socketpair fails the relay is dead and
            // every packet silently drops. Hard-fail here instead of reaching probe 2
            // (which bypasses the TUN entirely via HTTP proxy) and reporting "connected"
            // with a broken tunnel. This was the root cause of the build 38 bug.
            #if HEV_AVAILABLE
            guard self.startHevMode() else {
                self.fail("HEV bridge failed (socketpair errno=\(errno)) — cannot route app traffic in HEV_AVAILABLE mode",
                          shared: shared, completionHandler)
                return
            }
            #endif

            // ── Phase 6: dual probe ───────────────────────────────────────────
            // Capture a baseline pipeline snapshot before probe traffic starts.
            // The extension is suspended immediately after completionHandler(nil),
            // so the periodic stats timer never fires post-connect. These two
            // explicit snapshots (pre- and post-probe) are the only pipeline records
            // available in every tunnel log.
            #if HEV_AVAILABLE
            self.logHevStats(final: false)
            #endif
            self.step("probing")
            self.runDualProbe { ok, summary in
                shared.set(ok, forKey: kProbeOkKey)
                if ok {
                    // Capture final pipeline counters before the log is saved.
                    // After completionHandler(nil) the process is suspended and the
                    // stats timer never gets another tick.
                    #if HEV_AVAILABLE
                    self.logHevStats(final: true)
                    #endif
                    self.step("connected_verified")
                    self.appendLog("STATE: connected_verified (\(self.elapsed(since: self.startTime)) total)")
                    shared.set(TunnelState.connectedVerified.rawValue, forKey: kTunnelStateKey)
                    self.flushLog(to: shared)
                    // Force UserDefaults to disk so the main-app process reads the
                    // current log immediately on the VPN-state-change notification,
                    // avoiding a cross-process race that produces "DNS: Unknown".
                    shared.synchronize()
                    // Upload async — do not block tunnel establishment for diagnostics.
                    let (deviceId, appVersion, country) = self.readDiagContext(from: shared)
                    DispatchQueue.global(qos: .background).async {
                        self.uploadDiagnostics(deviceId: deviceId, appVersion: appVersion,
                                               country: country, success: true, errorMsg: "",
                                               waitForCompletion: false)
                    }
                    completionHandler(nil)
                } else {
                    self.step("failed")
                    self.appendLog("STATE: failed — \(summary)")
                    self.fail(summary, shared: shared, completionHandler)
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
                            self.appendLog("STATE: internet_reachable — all 3 probes passed")
                            completion(true, "ok")
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
          udp: 'udp'
        tunnel:
          mtu: 1500
          ipv4: '10.255.0.2'
          ipv6: 'fd00::2'
        """
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
    @discardableResult
    private func startHevMode() -> Bool {
        appendLog("HEV-START: build=\(Bundle.main.infoDictionary?["CFBundleVersion"] as? String ?? "?") mode=HEV_AVAILABLE socket=AF_UNIX/SOCK_DGRAM")
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
            var buffer = [UInt8](repeating: 0, count: 65536)
            let n = recv(bridgeFd, &buffer, buffer.count, 0)
            guard n > 0 else { return }
            let packet  = Data(buffer[..<n])
            self.hevStats.s7Packets += 1          // S7: received from HEV (from internet)
            self.hevStats.s7Bytes   += n
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

        // ── S5 liveness: confirm xray is listening on SOCKS5 port ────────────
        // Fires 1s after HEV thread starts (give hev time to open its SOCKS client).
        DispatchQueue.global(qos: .background).asyncAfter(deadline: .now() + 1.0) { [weak self] in
            self?.probeXraySocksPort()
        }

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
                        // Arm 8s watchdog: outbound traffic is flowing but if no
                        // inbound response arrives, the HEV→internet path is broken.
                        // Fires only when traffic reaches the TUN; idle tunnels are safe.
                        let watchdog = DispatchWorkItem { [weak self] in
                            guard let self = self, !self.hevStats.loggedFirstRx else { return }
                            self.appendLog("WATCHDOG: 8s since FIRST-PKT-OUT with no FIRST-PKT-IN — internet unreachable through tunnel")
                            self.cancelTunnel(reason: "No internet response in 8s after first outbound packet — HEV relay or Reality server unreachable")
                        }
                        self.postConnectWatchdog = watchdog
                        DispatchQueue.global(qos: .background).asyncAfter(deadline: .now() + 8.0, execute: watchdog)
                    }
                } else {
                    self.hevStats.s3Drop += 1      // S3 drop: send() short/error
                    if !self.hevStats.loggedFirstTx && self.hevStats.s3Drop == 1 {
                        self.appendLog("FIRST-PKT-DROP: S3 send() returned \(sent) (expected \(packet.count)) errno=\(errno) — HEV socket may be closed")
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
