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

    // Xray file log path (set by injectXrayFileLog; read by xrayLogTimer)
    private var xrayLogPath: String = ""

    // MARK: - HEV engine (TUN mode only)
    #if HEV_AVAILABLE
    private var hevEngineThread:   Thread?
    private var cp1Timer:          DispatchSourceTimer?   // CP1: tunFd readable?
    private var xrayLogTimer:      DispatchSourceTimer?   // CP4: Xray receiving connections?
    private var cp4TotalConns:     Int    = 0
    private var cp4FirstDest:      String = ""
    private var cp1PeekEverSaw:    Bool   = false
    #endif

    /// Network type derived from the first path interface captured by NWPathMonitor.
    private var networkTypeString: String {
        switch initialPathInterfaceType {
        case .some(.wifi):     return "wifi"
        case .some(.cellular): return "mobile"
        default:               return "unknown"
        }
    }

    /// iOS version string, e.g. "17.5.1".
    private var iosVersion: String {
        let v = ProcessInfo.processInfo.operatingSystemVersion
        return "\(v.majorVersion).\(v.minorVersion).\(v.patchVersion)"
    }

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

        // Inject file logging into Xray config so CP3/CP4 can be verified from the log.
        let xrayConfigForLaunch = injectXrayFileLog(into: configJSON)

        // LibXrayRunXrayFromJSON expects base64({"datDir":"","configJSON":"<raw-xray-config>"})
        guard let wrapperData = try? JSONSerialization.data(
            withJSONObject: ["datDir": "", "configJSON": xrayConfigForLaunch]
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
            self.startHevEngine(cfgPath: cfgPath, tunFd: tunFd)
            self.startCP1Monitor(tunFd: tunFd, shared: shared)
            self.startXrayLogMonitor(shared: shared)
            self.startLivenessTimer(shared: shared)
            self.startNetworkMonitor()
            let latencyMs = self.connectStartTime.map { Int(Date().timeIntervalSince($0) * 1000) }
            self.submitTelemetry(event: "connect_ok", latencyMs: latencyMs, tunnelMode: "HEV")
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
        #if HEV_AVAILABLE
        appendLog("DIAG_SUMMARY: CP1_ever_saw_packets=\(cp1PeekEverSaw) CP4_total_conns=\(cp4TotalConns) CP4_first_dest=\(cp4FirstDest.isEmpty ? "none" : cp4FirstDest)")
        submitTelemetry(event: "disconnect", disconnectReason: reasonStr,
                        tunnelMode: "HEV",
                        cp1Readable: cp1PeekEverSaw ? "YES" : "NO",
                        cp4Connections: cp4TotalConns,
                        cp4FirstDest: cp4FirstDest.isEmpty ? nil : cp4FirstDest)
        cp1Timer?.cancel();     cp1Timer     = nil
        xrayLogTimer?.cancel(); xrayLogTimer = nil
        hev_socks5_tunnel_quit()
        hevEngineThread = nil
        #else
        submitTelemetry(event: "disconnect", disconnectReason: reasonStr, tunnelMode: "proxy")
        #endif
        livenessTimer?.cancel(); livenessTimer = nil
        pathMonitor?.cancel();   pathMonitor   = nil
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
        // Build 73 fix (Iran): DO NOT exclude 1.1.1.1/8.8.8.8 from the TUN.
        //   Pre-72 HEV dropped all UDP, so DNS was kept direct to avoid dead UDP/53.
        //   That leaked DNS outside the tunnel: in Iran 1.1.1.1/8.8.8.8 are blocked
        //   and poisoned, so every hostname lookup failed → tunnel connected but no
        //   internet (Norway worked because direct DNS to those resolvers is fine).
        //   Build 72 added `udp: 'udp'` to HEV, so UDP/53 now forwards through to
        //   Xray, whose routing sends port 53 → dns-out (resolved at the exit node).
        //   Routing DNS through the tunnel matches Android (addRoute 0.0.0.0/0, DNS
        //   via tun2socks → Xray) which connects fine from Iran on the same nodes.
        ipv4.excludedRoutes = excluded4
        s.ipv4Settings = ipv4
        // IPv6 intentionally omitted — HEV is IPv4/TCP only. Including IPv6 default
        // route causes browsers to attempt IPv6 connections that HEV can't forward,
        // blocking Happy Eyeballs and making all browser traffic fail. IPv6 goes direct.
        // DNS queries to these resolvers now route INTO the TUN (not excluded above)
        // → HEV → SOCKS5 → Xray dns-out, so resolution happens at the exit node and
        // survives Iran's block/poisoning of public resolvers.
        let dns = NEDNSSettings(servers: ["1.1.1.1", "8.8.8.8"])
        dns.matchDomains = [""]
        s.dnsSettings = dns
        // No NEProxySettings — HEV captures all TCP at TUN level and forwards via SOCKS5.
        appendLog("HEV_SETTINGS: TUN-only no-ipv6, server=\(serverAddr ?? "?") dns=1.1.1.1/8.8.8.8 through-tunnel")
        return s
    }

    // MARK: - HEV TUN engine helpers

    // MARK: - Xray file log injection (both modes)

    /// Rewrites the Xray config to add file-based access + error logging under
    /// the App Group container so CP3/CP4 evidence survives the session.
    /// Falls back to original JSON on any parse failure.
    private func injectXrayFileLog(into json: String) -> String {
        guard var config = try? JSONSerialization.jsonObject(with: Data(json.utf8)) as? [String: Any],
              let agURL  = FileManager.default.containerURL(
                  forSecurityApplicationGroupIdentifier: kAppGroup)
        else {
            appendLog("DIAG: xray file log inject failed (no app group or parse error)")
            return json
        }
        let logDir  = agURL.appendingPathComponent("Library/Caches/xray-diag", isDirectory: true)
        try? FileManager.default.createDirectory(at: logDir, withIntermediateDirectories: true)
        let accURL  = logDir.appendingPathComponent("access.log")
        let errURL  = logDir.appendingPathComponent("error.log")
        // Truncate so the log reader only sees entries from this session.
        try? "".write(to: accURL, atomically: true, encoding: .utf8)
        xrayLogPath = accURL.path
        config["log"] = [
            "loglevel": "info",
            "access":   accURL.path,
            "error":    errURL.path,
        ]
        guard let data   = try? JSONSerialization.data(withJSONObject: config),
              let result = String(data: data, encoding: .utf8) else {
            appendLog("DIAG: xray file log inject failed (re-encode error)")
            return json
        }
        appendLog("DIAG: xray logs → \(accURL.path)")
        return result
    }

    #if HEV_AVAILABLE

    // MARK: - CP1: tunFd readability monitor

    /// Polls the utun fd with MSG_PEEK every 5 s (non-destructive).
    /// CP1=readable → iOS IS delivering packets to the TUN.
    /// CP1=EMPTY    → no packets yet (could be normal; wait for app to send traffic).
    /// CP1=ERR      → wrong fd or permission denied → HEV may have wrong fd.
    private func startCP1Monitor(tunFd: Int32, shared: UserDefaults) {
        var poll = 0
        let srv  = serverLabel()
        let t = DispatchSource.makeTimerSource(queue: .global(qos: .background))
        t.schedule(deadline: .now() + 3, repeating: 5)
        t.setEventHandler { [weak self] in
            guard let self = self else { return }
            poll += 1
            var buf = [UInt8](repeating: 0, count: 4)
            // MSG_PEEK=0x2 | MSG_DONTWAIT=0x80 — check without consuming
            let n = recv(tunFd, &buf, 4, Int32(0x02 | 0x80))
            let result: String
            if n > 0 {
                result = "readable (\(n)B peeked)"
                self.cp1PeekEverSaw = true
            } else {
                let e = errno
                result = (e == EAGAIN || e == EWOULDBLOCK) ? "EMPTY" : "ERR(errno=\(e))"
            }
            // Log every poll for first 12 (60s), then only when data seen
            if poll <= 12 || n > 0 {
                self.appendLog("CP1[\(srv)] poll#\(poll): tunFd=\(tunFd) \(result)")
                self.flushLog(to: shared)
                shared.synchronize()
            }
        }
        t.resume()
        cp1Timer = t
    }

    // MARK: - CP4: Xray access-log monitor

    /// Reads new lines from Xray's access.log every 10 s.
    /// Each line = one SOCKS5 connection HEV made → confirms CP2, CP3, CP4.
    /// Xray format: "<date> from 127.0.0.1:PORT accepted tcp:HOST:PORT [tag -> outbound]"
    private func startXrayLogMonitor(shared: UserDefaults) {
        guard !xrayLogPath.isEmpty else {
            appendLog("CP4: no xray log path — injectXrayFileLog may have failed")
            return
        }
        let path    = xrayLogPath
        let srv     = serverLabel()
        var offset: UInt64 = 0
        var polls   = 0
        let t = DispatchSource.makeTimerSource(queue: .global(qos: .background))
        t.schedule(deadline: .now() + 8, repeating: 10)
        t.setEventHandler { [weak self] in
            guard let self = self else { return }
            polls += 1
            guard let fh = FileHandle(forReadingAtPath: path) else {
                if polls <= 3 {
                    self.appendLog("CP4[\(srv)] poll#\(polls): access.log not found — Xray not writing?")
                    self.flushLog(to: shared); shared.synchronize()
                }
                return
            }
            fh.seek(toFileOffset: offset)
            let data = fh.readDataToEndOfFile()
            offset   = fh.offsetInFile
            fh.closeFile()
            guard let text = String(data: data, encoding: .utf8), !text.isEmpty else { return }
            let lines = text.components(separatedBy: "\n").filter { !$0.isEmpty }
            self.cp4TotalConns += lines.count
            for line in lines where self.cp4FirstDest.isEmpty {
                if let r = line.range(of: "accepted tcp:") ?? line.range(of: "accepted udp:") {
                    let after = line[r.upperBound...]
                    self.cp4FirstDest = String(after.components(separatedBy: " ").first ?? "?")
                }
            }
            self.appendLog("CP4[\(srv)] poll#\(polls): +\(lines.count) entries total=\(self.cp4TotalConns) firstDest=\(self.cp4FirstDest.isEmpty ? "none" : self.cp4FirstDest)")
            self.flushLog(to: shared)
            shared.synchronize()
        }
        t.resume()
        xrayLogTimer = t
    }

    /// Human-readable label for the current server — used in CP log lines.
    private func serverLabel() -> String {
        guard let addr = serverAddr else { return "?" }
        if addr.hasPrefix("65.109.183") { return "Finland/\(addr)" }
        if addr.hasPrefix("178.104.77") { return "Germany/\(addr)" }
        return addr
    }

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
        // dns-upstream intentionally absent:
        //   1.1.1.1/8.8.8.8 are excluded from TUN routes so DNS never enters HEV.
        //   Adding dns-upstream to misc caused HEV v2.15.0 to abort silently (build 66 regression).
        //
        // udp: 'udp'  (build 72 fix):
        //   Without it HEV forwarded ONLY TCP and silently DROPPED every UDP packet.
        //   Browsers/YouTube/Instagram open QUIC (HTTP/3, UDP:443) first; those packets
        //   died in HEV, the apps never got a rejection, and they stalled — so only
        //   TCP-only apps (Telegram) worked. Forwarding UDP to the SOCKS5 inbound lets
        //   Xray's routing act on it: UDP/53 → dns-out, UDP/443 → blackhole (instant
        //   reject → the app falls back to TCP/TLS immediately), other UDP → freedom.
        //   The Xray socks-in already has "udp": true, so this needs no server change.
        let yaml = """
tunnel:
  fd: \(tunFd)
  mtu: 1500

socks5:
  port: \(kSocksPort)
  address: '127.0.0.1'
  udp: 'udp'

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
    /// iOS xcframework signature: (configPath: UnsafePointer<CChar>, tunFd: Int32)
    /// The call is blocking and runs until hev_socks5_tunnel_quit() is called.
    private func startHevEngine(cfgPath: String, tunFd: Int32) {
        let fd = tunFd
        let path = cfgPath
        let thr = Thread {
            path.withCString { cPath in
                let rc = hev_socks5_tunnel_main(cPath, fd)
                // rc != 0 means HEV exited early (bad config, fd error, etc.)
                if rc != 0 {
                    if let shared = UserDefaults(suiteName: kAppGroup) {
                        shared.set("HEV engine exited early rc=\(rc) — check YAML config", forKey: kErrorKey)
                        shared.synchronize()
                    }
                }
            }
        }
        thr.name = "HevSocks5TunnelThread"
        thr.qualityOfService = QualityOfService.userInitiated
        thr.start()
        hevEngineThread = thr
        appendLog("HEV: engine thread started fd=\(tunFd)")
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
        errorCategory:    String? = nil,
        tunnelMode:       String? = nil,
        cp1Readable:      String? = nil,
        cp4Connections:   Int?    = nil,
        cp4FirstDest:     String? = nil
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
        if let mode = tunnelMode     { items.append(URLQueryItem(name: "tunnel_mode",    value: mode)) }
        if let cp1  = cp1Readable    { items.append(URLQueryItem(name: "cp1_readable",   value: cp1))  }
        if let cp4c = cp4Connections { items.append(URLQueryItem(name: "cp4_connections",value: String(cp4c))) }
        if let cp4d = cp4FirstDest   { items.append(URLQueryItem(name: "cp4_first_dest", value: cp4d)) }
        items.append(URLQueryItem(name: "ip_version",    value: ipVersion))
        items.append(URLQueryItem(name: "network_type",  value: networkTypeString))
        items.append(URLQueryItem(name: "ios_version",   value: iosVersion))
        let ag = UserDefaults(suiteName: kAppGroup)
        if let model   = ag?.string(forKey: "session_device_model"), !model.isEmpty   { items.append(URLQueryItem(name: "device_model", value: model)) }
        if let carrier = ag?.string(forKey: "session_carrier"),      !carrier.isEmpty { items.append(URLQueryItem(name: "carrier_name", value: carrier)) }
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
