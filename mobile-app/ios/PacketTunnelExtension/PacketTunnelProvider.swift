// PacketTunnelProvider.swift — Realink tunnel (build 65 dual-mode)
//
// #if HEV_AVAILABLE  → hev-socks5-tunnel full-device TUN engine (TCP all apps)
//                      CI sets SWIFT_ACTIVE_COMPILATION_CONDITIONS="LIBXRAY_AVAILABLE HEV_AVAILABLE"
// #else              → proxy-only / NEProxySettings (build 64 fallback, proxy mode only)
//
// CI guard rules enforced in ios-testflight.yml:
//   • completionHandler(nil) — exactly 1 occurrence in non-comment code
//   • connected_verified     — must be present before completionHandler
//   • NEProxySettings         — only inside the #else block (8-space indent)
//   • SOCK_SEQPACKET         — banned (use SOCK_DGRAM; SEQPACKET → errno 43 in NE sandbox)

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

    // Extended diagnostics
    private var initialPathInterfaceType: NWInterface.InterfaceType? = nil
    private var networkSwitchedDuringSession = false
    private var xrayReadyTime: Date? = nil

    // MARK: - HEV engine (TUN mode only)
    #if HEV_AVAILABLE
    private var hevEngineThread: Thread?
    #endif

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
        guard let wrapperData = try? JSONSerialization.data(
            withJSONObject: ["datDir": "", "configJSON": configJSON]
        ) else {
            return fail("Config wrapper serialization failed", shared: shared, completionHandler)
        }
        let b64 = wrapperData.base64EncodedString()
        appendLog("CONFIG_B64: \(b64.count) chars")

        // LibXrayRunXrayFromJSON always returns base64({"success":bool,"error":"..."}).
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

        let parsedAddr = parseServerAddress(from: configJSON)
        self.serverAddr = parsedAddr

        #if HEV_AVAILABLE
        // ── Build 65: full-device TUN via hev-socks5-tunnel ──────────────────
        // All TCP (Telegram, WhatsApp, Instagram, Safari) routes through the TUN
        // interface → HEV engine → Xray SOCKS5 :10808 → VPS → internet.
        // NEProxySettings not used; native socket apps are captured at layer 3.
        setTunnelNetworkSettings(buildHevNetworkSettings(serverAddr: parsedAddr)) { [weak self] error in
            guard let self = self else { return }
            if let e = error {
                self.submitTelemetry(event: "connect_fail", errorCategory: "routing_failed")
                return self.fail("HEV TUN settings: \(e.localizedDescription)", shared: shared, completionHandler)
            }
            let tunFd = self.findUtunFd()
            guard tunFd >= 0 else {
                self.submitTelemetry(event: "connect_fail", errorCategory: "tun_fd_unavailable")
                return self.fail("HEV: TUN fd unavailable after settings applied", shared: shared, completionHandler)
            }
            guard let cfgPath = self.writeHevConfig(tunFd: tunFd) else {
                return self.fail("HEV: config write failed", shared: shared, completionHandler)
            }
            self.startHevEngine(cfgPath: cfgPath)
            self.startLivenessTimer(shared: shared)
            self.startNetworkMonitor()
            let latencyMs = self.connectStartTime.map { Int(Date().timeIntervalSince($0) * 1000) }
            self.submitTelemetry(event: "connect_ok", latencyMs: latencyMs)
            self.finishConnected(shared: shared, completionHandler)
        }

        #else
        // ── Build 64 fallback: proxy-only (NEProxySettings / PAC SOCKS5) ─────
        // Routes URLSession-based apps through Xray SOCKS5 :10808 via PAC.
        // Native socket apps (Telegram, WhatsApp, Instagram) bypass this proxy.
        let proxyNetSettings: NEPacketTunnelNetworkSettings = {
            let s = NEPacketTunnelNetworkSettings(tunnelRemoteAddress: "10.255.0.1")
            let ipv4 = NEIPv4Settings(addresses: ["10.255.0.2"], subnetMasks: ["255.255.255.0"])
            ipv4.includedRoutes = [NEIPv4Route.default()]
            var excluded4: [NEIPv4Route] = []
            if let addr = parsedAddr, self.isIPv4(addr) {
                let r = NEIPv4Route(destinationAddress: addr, subnetMask: "255.255.255.255")
                excluded4.append(r)
                self.appendLog("SETTINGS: excludedRoute=\(addr)/32 (prevent xray→server loop)")
            }
            let dnsExclusions = ["1.1.1.1", "1.0.0.1", "8.8.8.8", "8.8.4.4"]
            for ip in dnsExclusions {
                excluded4.append(NEIPv4Route(destinationAddress: ip, subnetMask: "255.255.255.255"))
            }
            self.appendLog("SETTINGS: dnsExcluded=\(dnsExclusions.joined(separator: ",")) (prevent UDP/53 drain)")
            ipv4.excludedRoutes = excluded4
            s.ipv4Settings = ipv4
            let ipv6 = NEIPv6Settings(addresses: ["fd00::2"], networkPrefixLengths: [64])
            ipv6.includedRoutes = [NEIPv6Route.default()]
            ipv6.excludedRoutes = []
            s.ipv6Settings = ipv6
            let dns = NEDNSSettings(servers: ["1.1.1.1", "8.8.8.8"])
            dns.matchDomains = [""]
            s.dnsSettings = dns
            let proxy = NEProxySettings()
            proxy.autoProxyConfigurationEnabled    = true
            proxy.proxyAutoConfigurationJavaScript =
                "function FindProxyForURL(url,host){" +
                "if(host==='localhost'||host==='127.0.0.1'||host==='::1')return 'DIRECT';" +
                "return 'SOCKS 127.0.0.1:\(kSocksPort)';" +
                "}"
            proxy.matchDomains = [""]
            s.proxySettings = proxy
            self.appendLog("SETTINGS: server=\(parsedAddr ?? "?") proxy=SOCKS5:\(kSocksPort) PAC matchDomains=[\"\"] routes=default+serverExcluded+dnsExcluded ipv6=claim+drop")
            return s
        }()
        setTunnelNetworkSettings(proxyNetSettings) { [weak self] error in
            guard let self = self else { return }
            if let e = error {
                self.submitTelemetry(event: "connect_fail", errorCategory: "routing_failed")
                return self.fail("Network settings: \(e.localizedDescription)", shared: shared, completionHandler)
            }
            self.startLivenessTimer(shared: shared)
            self.startNetworkMonitor()
            let latencyMs = self.connectStartTime.map { Int(Date().timeIntervalSince($0) * 1000) }
            self.submitTelemetry(event: "connect_ok", latencyMs: latencyMs)
            self.finishConnected(shared: shared, completionHandler)
            self.performConnectivityProbe(shared: shared)
            self.performDNSCheck(shared: shared)
            self.drainTunPackets()
        }
        #endif
    }

    /// Mark the tunnel as fully connected. Exactly one call per tunnel lifetime —
    /// this is the only location where completionHandler(nil) is invoked (CI guard).
    private func finishConnected(shared: UserDefaults,
                                 _ completionHandler: @escaping (Error?) -> Void) {
        shared.set(TunnelState.connectedVerified.rawValue, forKey: kTunnelStateKey)
        shared.set(true, forKey: kProbeOkKey)
        shared.set("",   forKey: kErrorKey)
        flushLog(to: shared)
        shared.synchronize()
        appendLog("CONNECTED: tunnel active")
        completionHandler(nil)
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
        #if HEV_AVAILABLE
        hev_socks5_tunnel_quit()
        hevEngineThread = nil
        #endif
        if let shared = UserDefaults(suiteName: kAppGroup) {
            flushLog(to: shared)
        }
        completionHandler()
        DispatchQueue.global(qos: .utility).async { LibXrayStopXray() }
    }

    // MARK: - HEV network settings (TUN mode, no proxy)

    private func buildHevNetworkSettings(serverAddr: String?) -> NEPacketTunnelNetworkSettings {
        let s = NEPacketTunnelNetworkSettings(tunnelRemoteAddress: "10.255.0.1")
        let ipv4 = NEIPv4Settings(addresses: ["10.255.0.2"], subnetMasks: ["255.255.255.0"])
        ipv4.includedRoutes = [NEIPv4Route.default()]
        var excluded4: [NEIPv4Route] = []
        // Exclude the VPS so Xray's outbound TCP to the server doesn't loop into the TUN.
        if let addr = serverAddr, isIPv4(addr) {
            excluded4.append(NEIPv4Route(destinationAddress: addr, subnetMask: "255.255.255.255"))
            appendLog("HEV_SETTINGS: excludedRoute=\(addr)/32 (prevent xray→server loop)")
        }
        // Keep DNS resolvers direct; HEV forwards TCP but DNS exclusion keeps UDP/53 stable.
        for ip in ["1.1.1.1", "1.0.0.1", "8.8.8.8", "8.8.4.4"] {
            excluded4.append(NEIPv4Route(destinationAddress: ip, subnetMask: "255.255.255.255"))
        }
        ipv4.excludedRoutes = excluded4
        s.ipv4Settings = ipv4
        let ipv6 = NEIPv6Settings(addresses: ["fd00::2"], networkPrefixLengths: [64])
        ipv6.includedRoutes = [NEIPv6Route.default()]
        ipv6.excludedRoutes = []
        s.ipv6Settings = ipv6
        let dns = NEDNSSettings(servers: ["1.1.1.1", "8.8.8.8"])
        dns.matchDomains = [""]
        s.dnsSettings = dns
        // No NEProxySettings — HEV captures all TCP at TUN level and forwards via SOCKS5.
        appendLog("HEV_SETTINGS: TUN-only, server=\(serverAddr ?? "?") dns=1.1.1.1/8.8.8.8 direct")
        return s
    }

    // MARK: - HEV TUN engine helpers

    #if HEV_AVAILABLE

    /// Scan open file descriptors for the utun control socket created by
    /// setTunnelNetworkSettings. Returns the fd on success, -1 on failure.
    ///
    /// Technique: getsockopt(fd, SYSPROTO_CONTROL=2, UTUN_OPT_IFNAME=2) succeeds
    /// only on the utun socket — same approach used by WireGuard-iOS.
    private func findUtunFd() -> Int32 {
        var buf = [UInt8](repeating: 0, count: 64)
        var len = socklen_t(buf.count)
        for fd: Int32 in 0 ..< 256 {
            if getsockopt(fd, 2 /* SYSPROTO_CONTROL */, 2 /* UTUN_OPT_IFNAME */, &buf, &len) == 0 {
                return fd
            }
        }
        return -1
    }

    /// Write a hev-socks5-tunnel YAML config to the temp directory and return
    /// the file path, or nil if the write fails.
    private func writeHevConfig(tunFd: Int32) -> String? {
        let yaml = """
tunnel:
  fd: \(tunFd)
  mtu: 1500

socks5:
  port: \(kSocksPort)
  address: '127.0.0.1'

misc:
  task-stack-size: 81920
  connect-timeout: 5000
  read-write-timeout: 60000
  log-level: warn
"""
        let path = NSTemporaryDirectory() + "hev-socks5.yml"
        do {
            try yaml.write(toFile: path, atomically: true, encoding: .utf8)
            appendLog("HEV: config written to \(path) fd=\(tunFd)")
            return path
        } catch {
            appendLog("HEV: config write error: \(error)")
            return nil
        }
    }

    /// Start hev_socks5_tunnel_main in a dedicated background thread.
    /// The call is blocking and runs until hev_socks5_tunnel_quit() is called.
    private func startHevEngine(cfgPath: String) {
        let thr = Thread {
            let arg0 = strdup("hev-socks5-tunnel")!
            let arg1 = strdup(cfgPath)!
            var argv: [UnsafeMutablePointer<CChar>?] = [arg0, arg1, nil]
            _ = hev_socks5_tunnel_main(2, &argv)
            free(arg0); free(arg1)
        }
        thr.name = "HevSocks5TunnelThread"
        thr.qualityOfService = .userInitiated
        thr.start()
        hevEngineThread = thr
        appendLog("HEV: engine thread started")
    }

    #endif // HEV_AVAILABLE

    // MARK: - Helpers

    private func isIPv4(_ s: String) -> Bool {
        var sin = sockaddr_in()
        return s.withCString { inet_pton(AF_INET, $0, &sin.sin_addr) == 1 }
    }

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

    private func performDNSCheck(shared: UserDefaults) {
        DispatchQueue.global(qos: .background).async { [weak self] in
            guard let self = self else { return }
            guard let url = URL(string: "https://one.one.one.one/") else { return }
            let cfg = URLSessionConfiguration.ephemeral
            cfg.connectionProxyDictionary = [:]
            cfg.timeoutIntervalForRequest = 6.0
            let session = URLSession(configuration: cfg)
            let sem = DispatchSemaphore(value: 0)
            var resolved = false
            session.dataTask(with: URLRequest(url: url)) { _, resp, _ in
                resolved = (resp as? HTTPURLResponse) != nil
                sem.signal()
            }.resume()
            _ = sem.wait(timeout: .now() + 6)
            if resolved {
                self.appendLog("DNS: resolution OK — one.one.one.one reachable via system DNS")
            } else {
                self.appendLog("DNS: FAILED — check that 1.1.1.1/8.8.8.8 exclusion routes are applied")
            }
            self.flushLog(to: shared)
            shared.synchronize()
        }
    }

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

    private func submitTelemetry(
        event:            String,
        latencyMs:        Int?    = nil,
        disconnectReason: String? = nil,
        errorCategory:    String? = nil
    ) {
        guard let url = URL(string: "https://setalink.no/v1/telemetry/connect") else { return }
        let diagDeviceId = UserDefaults(suiteName: kAppGroup)?.string(forKey: "diag_device_id") ?? ""
        let diagCountry  = UserDefaults(suiteName: kAppGroup)?.string(forKey: "diag_country")    ?? ""
        var items: [URLQueryItem] = [
            URLQueryItem(name: "event",        value: event),
            URLQueryItem(name: "node_id",      value: serverAddr ?? "primary"),
            URLQueryItem(name: "platform",     value: "ios"),
            URLQueryItem(name: "app_version",  value: Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? ""),
            URLQueryItem(name: "build_number", value: Bundle.main.object(forInfoDictionaryKey: "CFBundleVersion") as? String ?? "0"),
            URLQueryItem(name: "protocol",     value: "VLESS + Reality"),
        ]
        if !diagDeviceId.isEmpty { items.append(URLQueryItem(name: "device_id", value: diagDeviceId)) }
        if !diagCountry.isEmpty  { items.append(URLQueryItem(name: "country",   value: diagCountry))  }
        if let ms = latencyMs {
            items.append(URLQueryItem(name: "time_to_connect_ms", value: String(ms)))
        }
        if let reason = disconnectReason {
            items.append(URLQueryItem(name: "disconnect_reason", value: reason))
        }
        if let cat = errorCategory {
            items.append(URLQueryItem(name: "error_category", value: cat))
        }
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
