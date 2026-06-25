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

    // MARK: - Start

    override func startTunnel(options: [String: NSObject]? = nil,
                              completionHandler: @escaping (Error?) -> Void) {
        appendLog("startTunnel")

        guard let shared = UserDefaults(suiteName: kAppGroup) else {
            fail("App Group \(kAppGroup) inaccessible — check entitlements", completionHandler)
            return
        }
        guard let configJson = shared.string(forKey: kConfigKey), !configJson.isEmpty else {
            fail("No xray config in App Group — XrayModule.start() must be called first",
                 completionHandler)
            return
        }
        appendLog("Config: \(configJson.count) bytes")

        // Start xray-core first — we need the HTTP proxy up before the probe.
        if let xrayError = startXrayCore(configJson: configJson) {
            fail(xrayError, completionHandler)
            return
        }
        appendLog("xray-core started")

        // Apply tunnel settings (proxy mode — no default TUN route needed).
        applyNetworkSettings { [weak self] error in
            guard let self = self else { return }
            if let error = error {
                self.fail("NEPacketTunnelNetworkSettings: \(error.localizedDescription)",
                          completionHandler)
                return
            }
            self.appendLog("Network settings applied")

            // Probe through xray's HTTP proxy to confirm end-to-end connectivity.
            self.probe { ok in
                shared.set(ok, forKey: kProbeOkKey)
                if ok {
                    self.appendLog("Probe OK — tunnel active")
                    self.flushLog(to: shared)
                    completionHandler(nil)
                } else {
                    self.fail("Probe failed — xray is not forwarding traffic",
                              completionHandler)
                }
            }
        }
    }

    // MARK: - Stop

    override func stopTunnel(with reason: NEProviderStopReason,
                             completionHandler: @escaping () -> Void) {
        appendLog("stopTunnel reason=\(reason.rawValue)")
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

        // Minimal IPv4 — loopback-only range, no default route.
        let ipv4 = NEIPv4Settings(addresses: ["10.255.0.2"], subnetMasks: ["255.255.255.0"])
        ipv4.includedRoutes = []          // no TUN routing; proxy handles traffic
        ipv4.excludedRoutes = []
        settings.ipv4Settings = ipv4
        settings.ipv6Settings = nil       // xray outbounds are IPv4-only

        // DNS via xray's dns-out rule — resolves via 1.1.1.1 through the VPN server.
        let dns = NEDNSSettings(servers: ["1.1.1.1", "8.8.8.8"])
        dns.matchDomains = [""]           // catch-all: all DNS goes through this
        settings.dnsSettings = dns

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

        setTunnelNetworkSettings(settings, completionHandler: completion)
    }

    // MARK: - Probe

    // Sends an HTTPS request through xray's HTTP proxy to confirm end-to-end
    // connectivity through the VPN server.  Uses URLSession with an explicit
    // connectionProxyDictionary so the request goes through xray regardless of
    // whether the system proxy is fully applied yet.
    private func probe(completion: @escaping (Bool) -> Void) {
        appendLog("Probe: HTTPS via 127.0.0.1:\(kHttpPort) …")

        let cfg = URLSessionConfiguration.ephemeral
        cfg.timeoutIntervalForRequest  = 12
        cfg.timeoutIntervalForResource = 12
        cfg.connectionProxyDictionary = [
            kCFNetworkProxiesHTTPEnable as String: 1,
            kCFNetworkProxiesHTTPProxy  as String: "127.0.0.1",
            kCFNetworkProxiesHTTPPort   as String: kHttpPort,
        ]

        // cp.cloudflare.com returns HTTP 200 with a tiny JSON body from all regions.
        let url = URL(string: "https://cp.cloudflare.com/")!
        let session = URLSession(configuration: cfg)
        let task = session.dataTask(with: URLRequest(url: url)) { [weak self] _, resp, err in
            let ok = err == nil && (resp as? HTTPURLResponse)?.statusCode == 200
            let detail = err?.localizedDescription ?? (ok ? "200 OK" : "unexpected status")
            self?.appendLog("Probe: \(ok ? "OK" : "FAIL") — \(detail)")
            completion(ok)
        }
        task.resume()
    }

    // MARK: - libXray integration

    // Returns nil on success, or an error string to surface in the connect log.
    // LIBXRAY_AVAILABLE is set by CI via SWIFT_ACTIVE_COMPILATION_CONDITIONS.
    // Local dev (no LIBXRAY_AVAILABLE) fails fast with a clear message.
    private func startXrayCore(configJson: String) -> String? {
        #if LIBXRAY_AVAILABLE
        let result = LibXrayRunXray(configJson)
        return result.isEmpty ? nil : result
        #else
        return "libXray not embedded — CI build required for real VPN."
        #endif
    }

    private func stopXrayCore() {
        #if LIBXRAY_AVAILABLE
        LibXrayStopXray()
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
}
