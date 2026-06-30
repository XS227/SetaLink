// PacketTunnelProvider.swift — Realink tunnel (proxy architecture)
//
// xray exposes HTTP CONNECT (:10809) and SOCKS5 (:10808) inbounds locally.
// NEProxySettings routes all app traffic through those proxies.
// No TUN-level packet relay, no HEV bridge, no socketpair.
// Same model as Shadowrocket/Quantumult X.

import NetworkExtension
import Network

// ── App Group IPC — shared with main app / XrayModule.swift ──────────────────
private let kAppGroup       = "group.no.setalink.realink"
private let kConfigKey      = "xray_config_json"
private let kErrorKey       = "last_tunnel_error"
private let kProbeOkKey     = "last_probe_ok"
private let kLogKey         = "connection_log"
private let kTunnelStateKey = "tunnel_state"
private let kHeartbeatKey   = "tunnel_heartbeat"

private let kSocksPort: Int  = 10808
private let kHttpPort:  Int  = 10809

private enum TunnelState: String {
    case connecting         = "connecting"
    case connectedVerified  = "connected_verified"
    case failed             = "failed"
}

class PacketTunnelProvider: NEPacketTunnelProvider {

    private var log:            [String]             = []
    private var livenessTimer:  DispatchSourceTimer?
    private var pathMonitor:    NWPathMonitor?
    private var connectStartTime: Date?
    private var serverAddr:     String?

    // Extended diagnostics (Phase 7)
    private var initialPathInterfaceType: NWInterface.InterfaceType? = nil
    private var networkSwitchedDuringSession = false
    private var xrayReadyTime: Date? = nil

    /// IP version derived from the server address stored in serverAddr.
    private var ipVersion: String {
        guard let addr = serverAddr else { return "unknown" }
        if addr.contains(":") { return "ipv6" }
        let parts = addr.split(separator: ".").map { String($0) }
        if parts.count == 4 && parts.allSatisfy({ Int($0) != nil }) { return "ipv4" }
        return "unknown"
    }

    /// URLSession that bypasses the VPN proxy — used for telemetry POSTs so
    /// the tunnel extension can reach the server even before the proxy is up.
    private lazy var telemetrySession: URLSession = {
        let cfg = URLSessionConfiguration.ephemeral
        cfg.connectionProxyDictionary = [:]   // no proxy — direct connection
        cfg.timeoutIntervalForRequest  = 10
        return URLSession(configuration: cfg)
    }()

    // MARK: - startTunnel

    override func startTunnel(options: [String: NSObject]?,
                              completionHandler: @escaping (Error?) -> Void) {
        connectStartTime = Date()
        networkSwitchedDuringSession = false
        initialPathInterfaceType     = nil
        xrayReadyTime                = nil
        guard let shared = UserDefaults(suiteName: kAppGroup) else {
            submitTelemetry(event: "connect_fail", errorCategory: "config_error")
            return completionHandler(NSError(domain: "no.setalink.tunnel", code: -1,
                userInfo: [NSLocalizedDescriptionKey: "App Group unavailable"]))
        }
        shared.set(TunnelState.connecting.rawValue, forKey: kTunnelStateKey)
        appendLog("START")

        // 1. Read config written by XrayModule.swift
        guard let configJSON = shared.string(forKey: kConfigKey), !configJSON.isEmpty else {
            submitTelemetry(event: "connect_fail", errorCategory: "config_error")
            return fail("No xray config in App Group", shared: shared, completionHandler)
        }

        // 2. Instrument config handoff
        appendLog("CONFIG: \(configJSON.count) bytes")
        let preview = String(configJSON.prefix(200))
            .replacingOccurrences(of: "\"id\":\"[^\"]+\"",        with: "\"id\":\"[REDACTED]\"",        options: .regularExpression)
            .replacingOccurrences(of: "\"publicKey\":\"[^\"]+\"", with: "\"publicKey\":\"[REDACTED]\"", options: .regularExpression)
            .replacingOccurrences(of: "\"shortId\":\"[^\"]+\"",   with: "\"shortId\":\"[REDACTED]\"",   options: .regularExpression)
        appendLog("CONFIG_PREVIEW: \(preview)")

        // LibXrayRunXrayFromJSON expects base64({"datDir":"","configJSON":"<raw-xray-config>"})
        // NOT base64(<raw-xray-config>) — build 56 passed raw JSON, causing xray to hit EOF.
        guard let wrapperData = try? JSONSerialization.data(
            withJSONObject: ["datDir": "", "configJSON": configJSON]
        ) else {
            return fail("Config wrapper serialization failed", shared: shared, completionHandler)
        }
        let b64 = wrapperData.base64EncodedString()
        appendLog("CONFIG_B64: \(b64.count) chars")

        // LibXrayRunXrayFromJSON always returns base64({"success":bool,"error":"..."}).
        // Checking !isEmpty is wrong — the response is never empty. Must decode and check success.
        let xrayResponse = LibXrayRunXrayFromJSON(b64)
        appendLog("XRAY_RESP: \(String(xrayResponse.prefix(120)))")
        guard !xrayResponse.isEmpty,
              let respData = Data(base64Encoded: xrayResponse),
              let respJSON = try? JSONSerialization.jsonObject(with: respData) as? [String: Any]
        else {
            submitTelemetry(event: "connect_fail", errorCategory: "xray_failed")
            return fail("Xray: undecodable response from libxray", shared: shared, completionHandler)
        }
        let xrayOk  = respJSON["success"] as? Bool   ?? false
        let xrayErr = respJSON["error"]   as? String ?? ""
        guard xrayOk else {
            submitTelemetry(event: "connect_fail", errorCategory: "xray_failed")
            return fail("Xray: \(xrayErr.isEmpty ? "unknown error" : xrayErr)", shared: shared, completionHandler)
        }
        appendLog("XRAY: started")

        // 3. Log config details for diagnostics
        if let info = parseConfigInfo(from: configJSON) {
            appendLog("Outbound: protocol=\(info.protocol) network=\(info.network) security=\(info.security)")
            appendLog("Server: \(info.address):\(info.port) sni=\(info.sni) flow=\(info.flow.isEmpty ? "(absent)" : info.flow)")
        }

        // 4. Poll SOCKS5 port (up to 5 s)
        var portReady = false
        for _ in 0 ..< 25 {
            if isPortOpen(kSocksPort) { portReady = true; break }
            Thread.sleep(forTimeInterval: 0.2)
        }
        guard portReady else {
            submitTelemetry(event: "connect_fail", errorCategory: "proxy_not_ready")
            return fail("SOCKS5 port \(kSocksPort) not ready after 5 s", shared: shared, completionHandler)
        }
        xrayReadyTime = Date()
        appendLog("XRAY: SOCKS5 :\(kSocksPort) ready")

        // 6. Apply network settings (proxy → xray)
        let parsedAddr = parseServerAddress(from: configJSON)
        self.serverAddr = parsedAddr
        setTunnelNetworkSettings(buildNetworkSettings(serverAddr: parsedAddr)) { [weak self] error in
            guard let self = self else { return }
            if let e = error {
                self.submitTelemetry(event: "connect_fail", errorCategory: "routing_failed")
                return self.fail("Network settings: \(e.localizedDescription)",
                                 shared: shared, completionHandler)
            }
            self.startLivenessTimer(shared: shared)
            self.startNetworkMonitor()
            shared.set(TunnelState.connectedVerified.rawValue, forKey: kTunnelStateKey)
            shared.set(true,  forKey: kProbeOkKey)
            shared.set("",    forKey: kErrorKey)
            self.flushLog(to: shared)
            shared.synchronize()
            self.appendLog("CONNECTED: SOCKS5 127.0.0.1:\(kSocksPort)")
            // Report successful connect with time-to-connect
            let latencyMs = self.connectStartTime.map { Int(Date().timeIntervalSince($0) * 1000) }
            self.submitTelemetry(event: "connect_ok", latencyMs: latencyMs)
            completionHandler(nil)

            // Background probe: verify xray SOCKS5 actually forwards traffic.
            // Extension traffic bypasses the system VPN, so we configure URLSession
            // explicitly with SOCKS5 proxy dictionary. Updates kProbeOkKey.
            self.performConnectivityProbe(shared: shared)

            // Drain the TUN queue so iOS does not kill the extension for an
            // unresponsive tunnel. QUIC/UDP-443 hits TUN and is dropped here —
            // Safari falls back to TCP in ~1 s. All other TCP goes through the
            // SOCKS5 PAC proxy before reaching TUN.
            self.drainTunPackets()
        }
    }

    private func drainTunPackets() {
        packetFlow.readPackets { [weak self] _, _ in
            // Discard: all real traffic goes through the proxy (:10809).
            // Calling readPackets again keeps the loop alive.
            self?.drainTunPackets()
        }
    }

    // MARK: - stopTunnel

    override func stopTunnel(with reason: NEProviderStopReason,
                             completionHandler: @escaping () -> Void) {
        let reasonStr = stopReasonDescription(reason)
        appendLog("STOP: \(reasonStr)")
        submitTelemetry(event: "disconnect", disconnectReason: reasonStr)
        livenessTimer?.cancel(); livenessTimer = nil
        pathMonitor?.cancel();   pathMonitor   = nil
        if let shared = UserDefaults(suiteName: kAppGroup) {
            flushLog(to: shared)
        }
        // Call completionHandler immediately so iOS tears down the tunnel at once.
        // LibXrayStopXray() is synchronous and can block for several seconds;
        // delaying completionHandler causes the UI to hang on "Disconnecting…"
        // and forces the user to use the kill switch.
        completionHandler()
        DispatchQueue.global(qos: .utility).async { LibXrayStopXray() }
    }

    // MARK: - Network settings

    private func buildNetworkSettings(serverAddr: String?) -> NEPacketTunnelNetworkSettings {
        // tunnelRemoteAddress must be a non-loopback virtual address.
        // "127.0.0.1" causes iOS to add a host route for loopback via the physical
        // interface — a nonsensical instruction that produces undefined TUN behaviour.
        // Build 51 used "10.255.0.1" (same /24 as the TUN address), which gives iOS
        // a clean virtual endpoint with no ambiguity, and is the documented pattern
        // for proxy-only PacketTunnelProviders that do not have a real remote server.
        let s = NEPacketTunnelNetworkSettings(tunnelRemoteAddress: "10.255.0.1")

        // IPv4: claim the default route so iOS actually applies NEProxySettings to all
        // app traffic. With includedRoutes=[] iOS installs the proxy config object but
        // does NOT apply it to system apps (Safari, etc.) — traffic goes direct.
        // Build 51 documented this: "connect probe passed only because it set the proxy
        // explicitly, while real browsing went direct and stalled."
        let ipv4 = NEIPv4Settings(addresses: ["10.255.0.2"], subnetMasks: ["255.255.255.0"])
        ipv4.includedRoutes = [NEIPv4Route.default()]
        // Exclude the VLESS server so xray's own outbound doesn't loop back into the TUN.
        // iOS has no Android-style socket protect(), so without this exclusion xray's
        // TCP connection to the server is captured by the default route and deadlocks.
        var excluded4: [NEIPv4Route] = []
        if let addr = serverAddr, isIPv4(addr) {
            let r = NEIPv4Route(destinationAddress: addr, subnetMask: "255.255.255.255")
            excluded4.append(r)
            appendLog("SETTINGS: excludedRoute=\(addr)/32 (prevent xray→server loop)")
        }
        ipv4.excludedRoutes = excluded4
        s.ipv4Settings = ipv4

        // IPv6: claim default + drop. If IPv6 is not claimed, Safari (Happy Eyeballs)
        // uses IPv6 directly, bypassing the IPv4 proxy entirely and hitting ISP blocks.
        // Claiming ::/0 with no IPv6 packet handler causes immediate IPv6 failure so
        // the OS falls back to IPv4 where the proxy is active.
        let ipv6 = NEIPv6Settings(addresses: ["fd00::2"], networkPrefixLengths: [64])
        ipv6.includedRoutes = [NEIPv6Route.default()]
        ipv6.excludedRoutes = []
        s.ipv6Settings = ipv6

        // DNS
        let dns = NEDNSSettings(servers: ["1.1.1.1", "8.8.8.8"])
        dns.matchDomains = [""]
        s.dnsSettings = dns

        // PAC-based SOCKS5 → xray SOCKS5 inbound on :10808 (udp:true in xray config).
        // SOCKS5 covers ALL TCP (HTTP, HTTPS, raw MTProto) unlike HTTP CONNECT which
        // only intercepts URLSession-based HTTPS. PAC returns DIRECT for loopback.
        let proxy = NEProxySettings()
        proxy.autoProxyConfigurationEnabled    = true
        proxy.proxyAutoConfigurationJavaScript =
            "function FindProxyForURL(url,host){" +
            "if(host==='localhost'||host==='127.0.0.1'||host==='::1')return 'DIRECT';" +
            "return 'SOCKS 127.0.0.1:\(kSocksPort)';" +
            "}"
        proxy.matchDomains = [""]
        s.proxySettings = proxy

        appendLog("SETTINGS: server=\(serverAddr ?? "?") proxy=SOCKS5:\(kSocksPort) PAC matchDomains=[\"\"] routes=default+serverExcluded ipv6=claim+drop")
        return s
    }

    private func isIPv4(_ s: String) -> Bool {
        var sin = sockaddr_in()
        return s.withCString { inet_pton(AF_INET, $0, &sin.sin_addr) == 1 }
    }

    // MARK: - Helpers

    private func isPortOpen(_ port: Int) -> Bool {
        let fd = socket(AF_INET, SOCK_STREAM, 0)
        guard fd != -1 else { return false }
        defer { close(fd) }
        var addr        = sockaddr_in()
        addr.sin_family = sa_family_t(AF_INET)
        addr.sin_port   = UInt16(port).bigEndian
        addr.sin_addr.s_addr = inet_addr("127.0.0.1")
        let rc = withUnsafePointer(to: &addr) { p in
            p.withMemoryRebound(to: sockaddr.self, capacity: 1) {
                connect(fd, $0, socklen_t(MemoryLayout<sockaddr_in>.size))
            }
        }
        return rc == 0
    }

    private struct ConfigInfo {
        var `protocol`: String
        var network:    String
        var security:   String
        var address:    String
        var port:       Int
        var sni:        String
        var flow:       String
    }

    private func parseConfigInfo(from json: String) -> ConfigInfo? {
        guard let data  = json.data(using: .utf8),
              let root  = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let outs  = root["outbounds"] as? [[String: Any]],
              let first = outs.first
        else { return nil }

        let proto    = first["protocol"]  as? String ?? "?"
        let stream   = first["streamSettings"] as? [String: Any] ?? [:]
        let network  = stream["network"]  as? String ?? "?"
        let security = stream["security"] as? String ?? "?"

        let reality  = stream["realitySettings"] as? [String: Any] ?? [:]
        let sni      = reality["serverName"] as? String ?? "?"

        let sett  = first["settings"]   as? [String: Any] ?? [:]
        let vnext = sett["vnext"]       as? [[String: Any]] ?? []
        let srv   = vnext.first ?? [:]
        let addr  = srv["address"]      as? String ?? "?"
        let port  = srv["port"]         as? Int    ?? 0
        let user  = (srv["users"] as? [[String: Any]])?.first ?? [:]
        let flow  = user["flow"]        as? String ?? ""

        return ConfigInfo(protocol: proto, network: network, security: security,
                          address: addr, port: port, sni: sni, flow: flow)
    }

    private func performConnectivityProbe(shared: UserDefaults) {
        DispatchQueue.global(qos: .background).async { [weak self] in
            guard let self = self else { return }
            guard let url = URL(string: "https://cp.cloudflare.com/") else { return }

            let cfg = URLSessionConfiguration.ephemeral
            // kCFNetworkProxies* constants are unavailable on iOS — use raw string keys.
            // Use SOCKS5 to match the system proxy (PAC→SOCKS5); probe validates
            // xray SOCKS5 inbound reachability, not the old HTTP inbound.
            cfg.connectionProxyDictionary = [
                "SOCKSEnable": 1,
                "SOCKSProxy":  "127.0.0.1",
                "SOCKSPort":   kSocksPort,
            ]
            cfg.timeoutIntervalForRequest = 10.0
            let session = URLSession(configuration: cfg)

            let sem   = DispatchSemaphore(value: 0)
            let start = Date()
            var probeOk     = false
            var probeStatus = 0

            let task = session.dataTask(with: URLRequest(url: url)) { _, resp, _ in
                if let h = resp as? HTTPURLResponse {
                    probeOk     = true
                    probeStatus = h.statusCode
                }
                sem.signal()
            }
            task.resume()
            _ = sem.wait(timeout: .now() + 10)

            let ms = Int(Date().timeIntervalSince(start) * 1000)
            if probeOk {
                self.appendLog("PROBE: cp.cloudflare.com → HTTP \(probeStatus) in \(ms)ms ✓")
            } else {
                self.appendLog("PROBE: cp.cloudflare.com → FAIL in \(ms)ms — xray not forwarding traffic")
                shared.set(false, forKey: kProbeOkKey)
            }
            self.flushLog(to: shared)
            shared.synchronize()
        }
    }

    // Parse outbound server address from xray JSON (VLESS vnext format)
    private func parseServerAddress(from json: String) -> String? {
        guard let data  = json.data(using: .utf8),
              let root  = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let outs  = root["outbounds"] as? [[String: Any]],
              let first = outs.first,
              let sett  = first["settings"] as? [String: Any],
              let vnext = sett["vnext"]     as? [[String: Any]],
              let srv   = vnext.first,
              let addr  = srv["address"]    as? String
        else { return nil }
        return addr
    }

    private func startLivenessTimer(shared: UserDefaults) {
        shared.set(Int(Date().timeIntervalSince1970), forKey: kHeartbeatKey)
        let t = DispatchSource.makeTimerSource(queue: .global(qos: .background))
        t.schedule(deadline: .now() + 30, repeating: 30)
        t.setEventHandler { [weak self] in
            guard self != nil else { return }
            shared.set(Int(Date().timeIntervalSince1970), forKey: kHeartbeatKey)
        }
        t.resume()
        livenessTimer = t
    }

    private func startNetworkMonitor() {
        let m = NWPathMonitor()
        m.pathUpdateHandler = { [weak self] path in
            guard let self = self else { return }
            let current = path.availableInterfaces.first?.type
            if self.initialPathInterfaceType == nil {
                self.initialPathInterfaceType = current
            } else if current != self.initialPathInterfaceType {
                self.networkSwitchedDuringSession = true
                self.appendLog("PATH: network type changed — switched=true")
            }
            self.appendLog("NET: \(path.status == .satisfied ? "up" : "down")")
        }
        m.start(queue: DispatchQueue(label: "no.setalink.pathmon", qos: .background))
        pathMonitor = m
    }

    private func fail(_ msg: String,
                      shared: UserDefaults?,
                      _ completion: @escaping (Error?) -> Void) {
        appendLog("FAIL: \(msg)")
        shared?.set(msg,                         forKey: kErrorKey)
        shared?.set(false,                       forKey: kProbeOkKey)
        shared?.set(TunnelState.failed.rawValue, forKey: kTunnelStateKey)
        flushLog(to: shared ?? .standard)
        (shared ?? .standard).synchronize()
        completion(NSError(domain: "no.setalink.tunnel", code: -1,
                           userInfo: [NSLocalizedDescriptionKey: msg]))
    }

    private func appendLog(_ line: String) {
        let ts = ISO8601DateFormatter().string(from: Date())
        log.append("[\(ts)] \(line)")
    }

    private func flushLog(to shared: UserDefaults) {
        shared.set(log, forKey: kLogKey)
    }

    private func stopReasonDescription(_ r: NEProviderStopReason) -> String {
        switch r {
        case .none:                       return "none"
        case .userInitiated:              return "userInitiated"
        case .providerFailed:             return "providerFailed"
        case .noNetworkAvailable:         return "noNetworkAvailable"
        case .unrecoverableNetworkChange: return "unrecoverableNetworkChange"
        case .providerDisabled:           return "providerDisabled"
        case .authenticationCanceled:     return "authenticationCanceled"
        case .configurationFailed:        return "configurationFailed"
        case .idleTimeout:                return "idleTimeout"
        default:                          return "other(\(r.rawValue))"
        }
    }

    // MARK: - Telemetry

    /// Fire-and-forget anonymous telemetry POST to /v1/telemetry/connect.
    /// Uses a direct (no-proxy) URLSession so it works before and after tunnel teardown.
    private func submitTelemetry(
        event:            String,
        latencyMs:        Int?    = nil,
        disconnectReason: String? = nil,
        errorCategory:    String? = nil
    ) {
        guard let url = URL(string: "https://setalink.no/v1/telemetry/connect") else { return }
        var items: [URLQueryItem] = [
            URLQueryItem(name: "event",        value: event),
            URLQueryItem(name: "node_id",      value: serverAddr ?? "primary"),
            URLQueryItem(name: "platform",     value: "ios"),
            URLQueryItem(name: "app_version",  value: Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? ""),
            URLQueryItem(name: "build_number", value: Bundle.main.object(forInfoDictionaryKey: "CFBundleVersion") as? String ?? "0"),
            URLQueryItem(name: "protocol",     value: "VLESS + Reality"),
        ]
        if let ms = latencyMs {
            items.append(URLQueryItem(name: "time_to_connect_ms", value: String(ms)))
        }
        if let reason = disconnectReason {
            items.append(URLQueryItem(name: "disconnect_reason", value: reason))
        }
        if let cat = errorCategory {
            items.append(URLQueryItem(name: "error_category", value: cat))
        }
        // Extended diagnostics
        items.append(URLQueryItem(name: "ip_version", value: ipVersion))
        if networkSwitchedDuringSession {
            items.append(URLQueryItem(name: "network_switched", value: "1"))
        }
        if let ready = xrayReadyTime, let start = connectStartTime {
            let rttMs = Int(ready.timeIntervalSince(start) * 1000)
            items.append(URLQueryItem(name: "rtt_ms", value: String(rttMs)))
        }
        if let start = connectStartTime, event != "connect_ok" {
            let dur = Int(Date().timeIntervalSince(start))
            items.append(URLQueryItem(name: "session_duration_secs", value: String(dur)))
        }
        var comps        = URLComponents()
        comps.queryItems = items
        guard let body = comps.query?.data(using: .utf8) else { return }
        var req = URLRequest(url: url, timeoutInterval: 10)
        req.httpMethod  = "POST"
        req.httpBody    = body
        req.setValue("application/x-www-form-urlencoded", forHTTPHeaderField: "Content-Type")
        telemetrySession.dataTask(with: req) { _, _, _ in }.resume()
    }

}
