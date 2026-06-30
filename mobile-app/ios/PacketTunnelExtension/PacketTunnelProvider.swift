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

private let kSocksPort: Int = 10808

private enum TunnelState: String {
    case connecting         = "connecting"
    case connectedVerified  = "connected_verified"
    case failed             = "failed"
}

class PacketTunnelProvider: NEPacketTunnelProvider {

    private var log:           [String]             = []
    private var livenessTimer: DispatchSourceTimer?
    private var pathMonitor:   NWPathMonitor?

    // MARK: - startTunnel

    override func startTunnel(options: [String: NSObject]?,
                              completionHandler: @escaping (Error?) -> Void) {
        guard let shared = UserDefaults(suiteName: kAppGroup) else {
            return completionHandler(NSError(domain: "no.setalink.tunnel", code: -1,
                userInfo: [NSLocalizedDescriptionKey: "App Group unavailable"]))
        }
        shared.set(TunnelState.connecting.rawValue, forKey: kTunnelStateKey)
        appendLog("START")

        // 1. Read config written by XrayModule.swift
        guard let configJSON = shared.string(forKey: kConfigKey), !configJSON.isEmpty else {
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
            return fail("Xray: undecodable response from libxray", shared: shared, completionHandler)
        }
        let xrayOk  = respJSON["success"] as? Bool   ?? false
        let xrayErr = respJSON["error"]   as? String ?? ""
        guard xrayOk else {
            return fail("Xray: \(xrayErr.isEmpty ? "unknown error" : xrayErr)", shared: shared, completionHandler)
        }
        appendLog("XRAY: started")

        // 3. Poll SOCKS5 port (up to 5 s)
        var portReady = false
        for _ in 0 ..< 25 {
            if isSocksPortOpen() { portReady = true; break }
            Thread.sleep(forTimeInterval: 0.2)
        }
        guard portReady else {
            return fail("SOCKS5 port \(kSocksPort) not ready after 5 s", shared: shared, completionHandler)
        }
        appendLog("XRAY: SOCKS5 :\(kSocksPort) ready")

        // 4. Apply network settings (proxy → xray)
        let serverAddr = parseServerAddress(from: configJSON)
        setTunnelNetworkSettings(buildNetworkSettings(serverAddr: serverAddr)) { [weak self] error in
            guard let self = self else { return }
            if let e = error {
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
            self.appendLog("CONNECTED: HTTP 127.0.0.1:10809 / SOCKS5 127.0.0.1:\(kSocksPort)")
            completionHandler(nil)
        }
    }

    // MARK: - stopTunnel

    override func stopTunnel(with reason: NEProviderStopReason,
                             completionHandler: @escaping () -> Void) {
        appendLog("STOP: \(stopReasonDescription(reason))")
        livenessTimer?.cancel(); livenessTimer = nil
        pathMonitor?.cancel();   pathMonitor   = nil
        LibXrayStopXray()
        if let shared = UserDefaults(suiteName: kAppGroup) {
            flushLog(to: shared)
        }
        completionHandler()
    }

    // MARK: - Network settings

    private func buildNetworkSettings(serverAddr: String?) -> NEPacketTunnelNetworkSettings {
        let s = NEPacketTunnelNetworkSettings(tunnelRemoteAddress: "127.0.0.1")

        // Minimal IPv4 — no default route through TUN.
        // All traffic is handled by proxy settings below; the TUN interface is
        // a placeholder so the system considers the VPN "up".
        let ipv4 = NEIPv4Settings(addresses: ["10.255.0.2"], subnetMasks: ["255.255.255.0"])
        ipv4.includedRoutes = []
        s.ipv4Settings = ipv4

        // DNS through tunnel (prevents DNS leaks)
        s.dnsSettings = NEDNSSettings(servers: ["1.1.1.1", "8.8.8.8"])

        // HTTP CONNECT proxy → xray HTTP inbound on :10809.
        // iOS 26 SDK removed socksEnabled/socksServer from NEProxySettings; HTTP CONNECT
        // handles all standard app traffic. xray's SOCKS5 inbound on :10808 is still
        // started (isSocksPortOpen() probes it) but is not advertised via NEProxySettings.
        let httpProx = NEProxyServer(address: "127.0.0.1", port: 10809)
        let proxy = NEProxySettings()
        proxy.httpEnabled            = true
        proxy.httpServer             = httpProx
        proxy.httpsEnabled           = true
        proxy.httpsServer            = httpProx
        proxy.excludeSimpleHostnames = true
        proxy.exceptionList          = ["localhost", "127.0.0.1", "::1"]
        // matchDomains=[""] means empty string is a suffix of every hostname → all connections
        // use this proxy. Without this line the proxy settings are ignored by iOS (nil = inactive).
        proxy.matchDomains           = [""]
        s.proxySettings = proxy

        let mdLog = proxy.matchDomains.map { $0.isEmpty ? "[\"\"]" : "\($0)" } ?? "nil"
        if let addr = serverAddr {
            appendLog("SETTINGS: server=\(addr) proxy=HTTP:10809 matchDomains=\(mdLog)")
        } else {
            appendLog("SETTINGS: proxy=HTTP:10809 matchDomains=\(mdLog)")
        }
        return s
    }

    // MARK: - Helpers

    private func isSocksPortOpen() -> Bool {
        let fd = socket(AF_INET, SOCK_STREAM, 0)
        guard fd != -1 else { return false }
        defer { close(fd) }
        var addr        = sockaddr_in()
        addr.sin_family = sa_family_t(AF_INET)
        addr.sin_port   = UInt16(kSocksPort).bigEndian
        addr.sin_addr.s_addr = inet_addr("127.0.0.1")
        let rc = withUnsafePointer(to: &addr) { p in
            p.withMemoryRebound(to: sockaddr.self, capacity: 1) {
                connect(fd, $0, socklen_t(MemoryLayout<sockaddr_in>.size))
            }
        }
        return rc == 0
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
            self?.appendLog("NET: \(path.status == .satisfied ? "up" : "down")")
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

}
