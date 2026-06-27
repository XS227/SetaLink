import NetworkExtension
import Foundation

// PacketTunnelProvider — routes device traffic through xray-core (VLESS/Reality).
//
// Architecture: NEProxySettings proxy mode (no tun2socks).
//
//   iOS apps → HTTP proxy 127.0.0.1:10809 (set via NEProxySettings)
//           → xray http-in (10809) → xray proxy outbound → VPN server
//
// Why proxy mode instead of TUN + tun2socks:
//   xray on iOS has a SOCKS5/HTTP inbound, not a TUN inbound.
//   Reading raw IP packets from packetFlow and re-routing them through xray
//   requires a full tun2socks implementation (TCP state machine, ~500 lines).
//   NEProxySettings covers all HTTP/HTTPS iOS app traffic without that complexity.
//   DNS is handled separately via NEDNSSettings (routes port-53 through xray dns-out).
//
// IPC contract with XrayModule.swift (main app):
//   App Group: group.no.setalink.realink
//   Keys written before start:       xray_config_json
//   Keys written after start/fail:   last_tunnel_error, last_probe_ok, connection_log

private let kAppGroup   = "group.no.setalink.realink"
private let kConfigKey  = "xray_config_json"
private let kErrorKey   = "last_tunnel_error"
private let kProbeOkKey = "last_probe_ok"
private let kLogKey     = "connection_log"

// Ports must match xrayConfigBuilder.ts inbounds.
private let kSocksPort: Int = 10808
private let kHttpPort:  Int = 10809

class PacketTunnelProvider: NEPacketTunnelProvider {

    private var log: [String] = []
    private let startTime = Date()

    // MARK: - Start

    override func startTunnel(options: [String: NSObject]? = nil,
                              completionHandler: @escaping (Error?) -> Void) {

        // ── Phase 0: extension boot ───────────────────────────────────────────
        let pi = ProcessInfo.processInfo
        appendLog("STATE: start")
        appendLog("Extension: \(Bundle.main.bundleIdentifier ?? "unknown") pid=\(pi.processIdentifier)")
        appendLog("iOS: \(pi.operatingSystemVersionString)")
        appendLog("App Group: \(kAppGroup)")

        // Log the xray-core version embedded in the xcframework so we know
        // exactly which binary we are running, without requiring a connect attempt.
        logXrayVersion()

        // ── Phase 1: load config from App Group ───────────────────────────────
        guard let shared = UserDefaults(suiteName: kAppGroup) else {
            fail("App Group \(kAppGroup) inaccessible — check entitlements", completionHandler)
            return
        }
        guard let configJson = shared.string(forKey: kConfigKey), !configJson.isEmpty else {
            fail("No xray config in App Group — XrayModule.start() must be called first",
                 completionHandler)
            return
        }
        appendLog("STATE: config loaded (\(configJson.count) bytes)")

        // ── Phase 2: validate + start xray-core ──────────────────────────────
        appendLog("STATE: xray starting")
        let xrayT0 = Date()
        if let xrayError = startXrayCore(configJson: configJson) {
            fail(xrayError, completionHandler)
            return
        }
        appendLog("STATE: xray started (\(elapsed(since: xrayT0)))")

        // ── Phase 3: apply NEPacketTunnelNetworkSettings ──────────────────────
        appendLog("STATE: applying network settings")
        applyNetworkSettings { [weak self] error in
            guard let self = self else { return }
            if let error = error {
                self.appendLog("STATE: network settings FAILED — \(error.localizedDescription)")
                self.fail("NEPacketTunnelNetworkSettings: \(error.localizedDescription)",
                          completionHandler)
                return
            }
            self.appendLog("STATE: network settings applied (\(self.elapsed(since: self.startTime)) total)")

            // ── Phase 4: diagnostic probes ───────────────────────────────────
            // Two-leg probe separates proxy failures from DNS failures:
            //   Leg 1 (IP-direct)  — bypasses DNS; tests xray forwarding only.
            //   Leg 2 (DNS+proxy)  — uses hostname; tests DNS resolution end-to-end.
            self.appendLog("STATE: probing")
            self.runDualProbe { ok, summary in
                shared.set(ok, forKey: kProbeOkKey)
                if ok {
                    self.appendLog("STATE: connected (\(self.elapsed(since: self.startTime)) total)")
                    self.flushLog(to: shared)
                    completionHandler(nil)
                } else {
                    self.appendLog("STATE: failed — \(summary)")
                    self.fail(summary, completionHandler)
                }
            }
        }
    }

    // MARK: - Stop

    override func stopTunnel(with reason: NEProviderStopReason,
                             completionHandler: @escaping () -> Void) {
        appendLog("STATE: stop reason=\(reason.rawValue) (\(stopReasonDescription(reason)))")
        stopXrayCore()
        if let shared = UserDefaults(suiteName: kAppGroup) { flushLog(to: shared) }
        completionHandler()
    }

    // MARK: - Network settings (proxy mode)

    private func applyNetworkSettings(completion: @escaping (Error?) -> Void) {
        // Proxy mode: we do not install a default TUN route.
        // iOS routes HTTP/HTTPS app traffic via NEProxySettings to xray (127.0.0.1:10809).
        // A minimal TUN address is required to keep the NEVPNManager connection alive.
        let settings = NEPacketTunnelNetworkSettings(tunnelRemoteAddress: "10.255.0.1")
        settings.mtu = 1280
        appendLog("NetSettings: tunnelRemoteAddress=10.255.0.1 mtu=1280")

        // Minimal IPv4 — loopback-only range, no default route.
        let ipv4 = NEIPv4Settings(addresses: ["10.255.0.2"], subnetMasks: ["255.255.255.0"])
        ipv4.includedRoutes = []          // no TUN routing; proxy handles traffic
        ipv4.excludedRoutes = []
        settings.ipv4Settings = ipv4
        appendLog("NetSettings: IPv4=10.255.0.2/24 includedRoutes=[] (proxy mode — no default route)")

        settings.ipv6Settings = nil       // xray outbounds are IPv4-only
        appendLog("NetSettings: IPv6=disabled")

        // DNS via xray's dns-out rule — resolves via 1.1.1.1 through the VPN server.
        let dns = NEDNSSettings(servers: ["1.1.1.1", "8.8.8.8"])
        dns.matchDomains = [""]           // catch-all: all DNS goes through this
        settings.dnsSettings = dns
        appendLog("NetSettings: DNS=[1.1.1.1,8.8.8.8] matchDomains=[all]")

        // Route all HTTP/HTTPS through xray's local HTTP proxy (port 10809).
        // Covers Safari, App Store, social apps, and anything using URLSession.
        let proxy = NEProxySettings()
        proxy.httpEnabled  = true
        proxy.httpServer   = NEProxyServer(address: "127.0.0.1", port: kHttpPort)
        proxy.httpsEnabled = true
        proxy.httpsServer  = NEProxyServer(address: "127.0.0.1", port: kHttpPort)
        // Exclude plain hostnames (LAN devices) — avoids proxying e.g. "printer.local".
        proxy.excludeSimpleHostnames = true
        settings.proxySettings = proxy
        appendLog("NetSettings: HTTP proxy=127.0.0.1:\(kHttpPort) HTTPS proxy=127.0.0.1:\(kHttpPort) excludeSimpleHostnames=true")

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

    // Leg 1 probes an IP address directly — bypasses DNS, tests xray TCP forwarding.
    // Leg 2 probes a hostname — requires both DNS resolution AND xray TCP forwarding.
    // Comparing results isolates DNS failures from proxy failures.
    private func runDualProbe(completion: @escaping (Bool, String) -> Void) {
        let proxyDict: [AnyHashable: Any] = [
            kCFNetworkProxiesHTTPEnable as String: 1,
            kCFNetworkProxiesHTTPProxy  as String: "127.0.0.1",
            kCFNetworkProxiesHTTPPort   as String: kHttpPort,
        ]

        // Leg 1: plain HTTP to a known IP (no TLS cert issue, no DNS needed).
        // 1.0.0.1 is Cloudflare's anycast DNS IP; port 80 returns a redirect page.
        let ipURL = URL(string: "http://1.0.0.1/")!
        appendLog("Probe TX[1]: HTTP to 1.0.0.1 (IP-direct, DNS bypass) via 127.0.0.1:\(kHttpPort)")
        fetchURL(ipURL, via: proxyDict, timeout: 10) { [weak self] status, bytes, err, t in
            guard let self = self else { return }
            let ipOk = err == nil && status != nil
            if ipOk {
                self.appendLog("Probe RX[1]: IP-direct OK — status=\(status!) bytes=\(bytes) elapsed=\(t)")
                self.appendLog("Outbound: established — xray is forwarding TCP to internet")
            } else {
                let reason = err?.localizedDescription ?? "status=\(status.map{"\($0)"} ?? "nil")"
                self.appendLog("Probe RX[1]: IP-direct FAIL — \(reason) elapsed=\(t)")
                self.appendLog("Outbound: xray is NOT forwarding traffic (proxy or xray itself failed)")
            }

            // Leg 2: HTTPS to hostname — requires DNS + xray forwarding.
            let cpURL = URL(string: "https://cp.cloudflare.com/")!
            self.appendLog("Probe TX[2]: HTTPS to cp.cloudflare.com (DNS+proxy) via 127.0.0.1:\(kHttpPort)")
            self.fetchURL(cpURL, via: proxyDict, timeout: 12) { status2, bytes2, err2, t2 in
                let dnsOk = err2 == nil && status2 == 200
                if dnsOk {
                    self.appendLog("Probe RX[2]: DNS+proxy OK — status=200 bytes=\(bytes2) elapsed=\(t2)")
                    self.appendLog("DNS: resolution OK (cp.cloudflare.com resolved through xray dns-out)")
                    self.appendLog("First packet sent+received — end-to-end connectivity confirmed")
                    completion(true, "ok")
                } else {
                    let reason2 = err2?.localizedDescription ?? "status=\(status2.map{"\($0)"} ?? "nil")"
                    self.appendLog("Probe RX[2]: DNS+proxy FAIL — \(reason2) elapsed=\(t2)")
                    // Interpret combined result
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

    // Generic single URL fetch through an explicit proxy dict with timing.
    // Returns (httpStatus, bodyBytes, error, elapsedString) on the calling queue.
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
            let t = self.elapsed(since: t0)
            completion((resp as? HTTPURLResponse)?.statusCode, data?.count ?? 0, err, t)
        }
        task.resume()
    }

    // MARK: - libXray integration

    // Returns nil on success, or a human-readable error string.
    //
    // libxray v25+ API (unchanged through v26.6.1):
    //   RunXrayFromJSON(base64({ datDir, configJSON })) → base64({ success, data, error })
    //
    // datDir points to geoip/geosite .dat files; our routing rules use IP ranges +
    // port numbers only, so passing "" is safe (no geo dat files needed).
    //
    // LIBXRAY_AVAILABLE is set by CI via SWIFT_ACTIVE_COMPILATION_CONDITIONS.
    // Local dev (no LIBXRAY_AVAILABLE) fails fast with a clear message.
    private func startXrayCore(configJson: String) -> String? {
        #if LIBXRAY_AVAILABLE
        // Validate + log key config fields before calling libxray so every failure
        // is diagnosable without needing a second build.
        if let validationError = validateAndLogConfig(configJson) {
            appendLog("Config validation FAILED: \(validationError)")
            appendLog("Config dump: \(configJson.prefix(600))")
            return "Config validation: \(validationError)"
        }

        // Encode request for libxray v25+ RunXrayFromJSON.
        // Input:  base64({ datDir: "", configJSON: "<raw xray json>" })
        // Output: base64({ success: bool, data: "", error: "..." })
        // datDir is empty — routing rules use IP/port only, no geo dat files needed.
        guard let requestData = try? JSONSerialization.data(withJSONObject: [
            "datDir":     "",
            "configJSON": configJson,
        ]) else {
            return "Failed to serialize libxray request"
        }
        let base64Request = requestData.base64EncodedString()
        appendLog("Calling LibXrayRunXrayFromJSON (base64-wrapped, \(base64Request.count) chars)")

        let base64Response = LibXrayRunXrayFromJSON(base64Request)

        // Decode the base64 CallResponse and log both fields regardless of outcome.
        guard !base64Response.isEmpty,
              let responseData = Data(base64Encoded: base64Response),
              let json = try? JSONSerialization.jsonObject(with: responseData) as? [String: Any]
        else {
            appendLog("libxray raw response (undecodable): \(base64Response.prefix(300))")
            return "libxray returned unreadable response (xcframework version mismatch?)"
        }

        let success = json["success"] as? Bool ?? false
        let errMsg  = json["error"]   as? String ?? ""
        appendLog("libxray CallResponse: success=\(success)\(errMsg.isEmpty ? "" : " error=\"\(errMsg)\"")")

        if success { return nil }
        return errMsg.isEmpty ? "xray-core failed (no error detail)" : errMsg
        #else
        return "libXray not embedded — CI build required for real VPN."
        #endif
    }

    // Reads the xray-core version string from the embedded xcframework.
    // Called before RunXrayFromJSON so the version appears even on config failures.
    private func logXrayVersion() {
        #if LIBXRAY_AVAILABLE
        let raw = LibXrayXrayVersion()
        if let data = Data(base64Encoded: raw),
           let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
           let ver  = json["data"] as? String, !ver.isEmpty {
            appendLog("xray-core version: \(ver)")
        } else {
            appendLog("xray-core version: (unreadable — base64=\(raw.prefix(60)))")
        }
        #else
        appendLog("xray-core version: (stub — LIBXRAY_AVAILABLE not set)")
        #endif
    }

    // Validates the xray-core JSON config and logs key outbound fields.
    // Returns nil if valid, or a short error string describing the first problem.
    private func validateAndLogConfig(_ configJson: String) -> String? {
        guard let data = configJson.data(using: .utf8),
              let obj  = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
        else {
            return "Config is not valid JSON"
        }

        // Log the proxy outbound's key fields so every connect attempt is diagnosable.
        if let outbounds = obj["outbounds"] as? [[String: Any]],
           let proxy = outbounds.first(where: { ($0["tag"] as? String) == "proxy" }) {
            let proto = proxy["protocol"] as? String ?? "(nil)"
            let ss    = proxy["streamSettings"] as? [String: Any]
            let net   = ss?["network"]  as? String ?? "(nil)"
            let sec   = ss?["security"] as? String ?? "(nil)"
            let rs    = ss?["realitySettings"] as? [String: Any]
            let sni   = rs?["serverName"] as? String
                     ?? (ss?["tlsSettings"] as? [String: Any])?["serverName"] as? String
                     ?? "(nil)"
            let vnext = (proxy["settings"] as? [String: Any])?["vnext"] as? [[String: Any]]
            let addr  = vnext?.first?["address"] as? String ?? "(nil)"
            let port  = vnext?.first?["port"] ?? "(nil)"
            let users = vnext?.first?["users"] as? [[String: Any]]
            let flow  = users?.first?["flow"] as? String ?? "(absent)"
            appendLog("Outbound: protocol=\(proto) network=\(net) security=\(sec)")
            appendLog("Server: \(addr):\(port) sni=\(sni) flow=\(flow)")
        }

        guard let outbounds = obj["outbounds"] as? [[String: Any]], !outbounds.isEmpty else {
            return "outbounds array is missing or empty"
        }
        for (i, ob) in outbounds.enumerated() {
            guard let proto = ob["protocol"] as? String, !proto.isEmpty else {
                return "outbounds[\(i)] missing or empty 'protocol' field"
            }
        }
        guard let inbounds = obj["inbounds"] as? [[String: Any]], !inbounds.isEmpty else {
            return "inbounds array is missing or empty"
        }
        for (i, ib) in inbounds.enumerated() {
            guard let proto = ib["protocol"] as? String, !proto.isEmpty else {
                return "inbounds[\(i)] missing or empty 'protocol' field"
            }
        }
        let outProtos = (obj["outbounds"] as? [[String: Any]])?.compactMap { $0["protocol"] as? String } ?? []
        let inProtos  = (obj["inbounds"]  as? [[String: Any]])?.compactMap { $0["protocol"] as? String } ?? []
        appendLog("Config OK (\(configJson.count) bytes): out=[\(outProtos.joined(separator: ","))] in=[\(inProtos.joined(separator: ","))]")
        return nil
    }

    private func stopXrayCore() {
        #if LIBXRAY_AVAILABLE
        _ = LibXrayStopXray()   // v26+: returns base64 CallResponse; discard on stop
        #endif
    }

    // MARK: - Helpers

    private func appendLog(_ line: String) {
        let ts = ISO8601DateFormatter().string(from: Date())
        log.append("[\(ts)] \(line)")
    }

    private func flushLog(to shared: UserDefaults) {
        shared.set(log, forKey: kLogKey)
    }

    private func fail(_ message: String,
                      _ completionHandler: @escaping (Error?) -> Void) {
        appendLog("FAIL: \(message)")
        let shared = UserDefaults(suiteName: kAppGroup)
        shared?.set(message,          forKey: kErrorKey)
        shared?.set(false,            forKey: kProbeOkKey)
        flushLog(to: shared ?? .standard)
        completionHandler(NSError(domain: "no.setalink.tunnel", code: -1,
                                  userInfo: [NSLocalizedDescriptionKey: message]))
    }

    private func elapsed(since t0: Date) -> String {
        return String(format: "%.2fs", -t0.timeIntervalSinceNow)
    }

    private func stopReasonDescription(_ reason: NEProviderStopReason) -> String {
        switch reason {
        case .none:                   return "none"
        case .userInitiated:          return "userInitiated"
        case .providerFailed:         return "providerFailed"
        case .noNetworkAvailable:     return "noNetworkAvailable"
        case .unrecoverableNetworkChange: return "unrecoverableNetworkChange"
        case .providerDisabled:       return "providerDisabled"
        case .authenticationCanceled: return "authenticationCanceled"
        case .configurationFailed:    return "configurationFailed"
        case .idleTimeout:            return "idleTimeout"
        case .configurationDisabled:  return "configurationDisabled"
        case .configurationRemoved:   return "configurationRemoved"
        case .superceded:             return "superceded"
        case .userLogout:             return "userLogout"
        case .userSwitch:             return "userSwitch"
        case .connectionFailed:       return "connectionFailed"
        case .sleep:                  return "sleep"
        case .appUpdate:              return "appUpdate"
        @unknown default:             return "unknown(\(reason.rawValue))"
        }
    }
}
