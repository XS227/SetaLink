import Foundation
import UIKit
import NetworkExtension
import Security
import CoreTelephony
import Network

typealias RCTPromiseResolveBlock = (Any?) -> Void
typealias RCTPromiseRejectBlock  = (String?, String?, Error?) -> Void

// XrayModule — bridges React Native JS to the PacketTunnelProvider extension.
//
// Architecture:
//   1. JS calls start(configJson) → config saved to App Group → NETunnelProviderManager
//      tells the OS to launch PacketTunnelExtension/PacketTunnelProvider.
//   2. PacketTunnelProvider reads the config, sets up the TUN, starts xray-core,
//      probes for connectivity, and reports success/failure via completionHandler.
//   3. JS polls isRunning() → tunnel manager .connection.status == .connected.
//   4. On failure the extension writes the error to the App Group; JS reads it
//      via getLastError() and surfaces it in the connect log.
//
// IPC keys in App Group (group.no.setalink.realink):
//   xray_config_json  — written by start()  before   tunnel launch
//   last_tunnel_error — written by extension after    tunnel attempt
//   last_probe_ok     — written by extension after    probe
//   connection_log    — written by extension (String array)

@objc(XrayModule)
class XrayModule: NSObject {

    private static let appGroupID  = "group.no.setalink.realink"
    private static let extensionID = "no.setalink.realink.tunnel"
    private static let configKey      = "xray_config_json"
    private static let errorKey       = "last_tunnel_error"
    private static let probeKey       = "last_probe_ok"
    private static let logKey         = "connection_log"
    private static let diagDeviceIdKey = "diag_device_id"
    private static let diagCountryKey  = "diag_country"
    private static let diagAppVerKey   = "diag_app_version"

    private var shared: UserDefaults? {
        UserDefaults(suiteName: Self.appGroupID)
    }

    // MARK: - tunnel manager resolution
    //
    // CRITICAL: a Packet Tunnel Provider MUST be managed via NETunnelProviderManager,
    // NOT NEVPNManager.shared(). NEVPNManager is for Personal VPN (IKEv2/IPSec) only.
    // Assigning a NETunnelProviderProtocol to it makes saveToPreferences fail with
    // "Missing protocol or protocol has invalid type", so startVPNTunnel() is never
    // reached and the extension never launches. (Apple DevForums thread 96777.)

    // Cached after the first resolve so stop/isRunning/getStats reuse the same manager
    // object — its .connection reflects live tunnel state, no extra preference load.
    private static var cachedManager: NETunnelProviderManager?

    // Loads the tunnel manager that owns our extension, or (when create=true) makes a
    // fresh one. Calls back with nil + nil error when none exists and create=false.
    private func resolveManager(create: Bool,
                                completion: @escaping (NETunnelProviderManager?, Error?) -> Void) {
        NETunnelProviderManager.loadAllFromPreferences { managers, error in
            if let error = error { completion(nil, error); return }
            var manager = managers?.first { mgr in
                (mgr.protocolConfiguration as? NETunnelProviderProtocol)?
                    .providerBundleIdentifier == Self.extensionID
            } ?? managers?.first
            if manager == nil && create { manager = NETunnelProviderManager() }
            if let m = manager { Self.cachedManager = m }
            completion(manager, nil)
        }
    }

    // MARK: - start

    @objc func start(_ config: String,
                     resolver resolve: @escaping RCTPromiseResolveBlock,
                     rejecter reject: @escaping RCTPromiseRejectBlock) {
        guard !config.isEmpty else {
            reject("INVALID_CONFIG", "Config string is empty", nil)
            return
        }

        // Write config BEFORE waking the extension — it reads this on startTunnel.
        shared?.set(config, forKey: Self.configKey)
        shared?.removeObject(forKey: Self.errorKey)
        shared?.removeObject(forKey: Self.logKey)
        // Write app version for diagnostic upload (read by PacketTunnelProvider).
        let ver   = Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "?"
        let build = Bundle.main.infoDictionary?["CFBundleVersion"] as? String ?? "?"
        shared?.set("\(ver) (\(build))", forKey: Self.diagAppVerKey)

        DispatchQueue.main.async { [weak self] in
            guard let self = self else { return }
            // Write session context so PacketTunnelProvider can include it in diagnostics.
            let carrier = CTTelephonyNetworkInfo().serviceSubscriberCellularProviders?.values.first?.carrierName ?? ""
            self.shared?.set(carrier, forKey: "session_carrier")
            var sysInfo = utsname(); uname(&sysInfo)
            let model = withUnsafeBytes(of: &sysInfo.machine) { ptr in
                ptr.bindMemory(to: CChar.self).baseAddress.map { String(cString: $0) } ?? "unknown"
            }
            self.shared?.set(model, forKey: "session_device_model")
            self.shared?.synchronize()

            self.resolveManager(create: true) { manager, loadError in
                if let err = loadError {
                    reject("LOAD_PREFS_FAILED", err.localizedDescription, err)
                    return
                }
                guard let manager = manager else {
                    reject("LOAD_PREFS_FAILED", "Could not create NETunnelProviderManager", nil)
                    return
                }
                self.configureAndLaunch(manager, resolve: resolve, reject: reject)
            }
        }
    }

    private func configureAndLaunch(_ manager: NETunnelProviderManager,
                                    resolve: @escaping RCTPromiseResolveBlock,
                                    reject:  @escaping RCTPromiseRejectBlock) {
        let proto = NETunnelProviderProtocol()
        proto.providerBundleIdentifier = Self.extensionID
        proto.serverAddress = "vpn.setalink.no"

        manager.protocolConfiguration = proto
        manager.localizedDescription  = "Realink VPN"
        manager.isEnabled             = true
        manager.isOnDemandEnabled     = false   // prevent auto-reconnect on stop

        manager.saveToPreferences { saveError in
            if let err = saveError {
                reject("SAVE_PREFS_FAILED", err.localizedDescription, err)
                return
            }
            // A save invalidates the in-memory config; iOS requires a reload before
            // startVPNTunnel() or it throws NEVPNError "configuration is stale".
            manager.loadFromPreferences { reloadError in
                if let err = reloadError {
                    reject("LOAD_PREFS_FAILED", err.localizedDescription, err)
                    return
                }
                // startVPNTunnel() asks iOS to launch the PacketTunnelProvider extension.
                // It returns immediately; the extension runs asynchronously.
                // JS polls isRunning() every 500 ms (vpnBridge.ts) until connected or timeout.
                do {
                    try manager.connection.startVPNTunnel()
                    resolve(nil)
                } catch {
                    reject("START_TUNNEL_FAILED", error.localizedDescription, error)
                }
            }
        }
    }

    // MARK: - startEmergency (same path, extension uses same config key)

    @objc func startEmergency(_ config: String,
                              resolver resolve: @escaping RCTPromiseResolveBlock,
                              rejecter reject: @escaping RCTPromiseRejectBlock) {
        start(config, resolver: resolve, rejecter: reject)
    }

    // MARK: - stop

    @objc func stop(_ resolve: @escaping RCTPromiseResolveBlock,
                    rejecter reject: @escaping RCTPromiseRejectBlock) {
        DispatchQueue.main.async { [weak self] in
            let doStop: (NETunnelProviderManager?) -> Void = { manager in
                guard let m = manager else { resolve(nil); return }
                // Disable on-demand BEFORE stopping — if it stays true iOS re-launches
                // the tunnel immediately after stopVPNTunnel() returns.
                if m.isOnDemandEnabled {
                    m.isOnDemandEnabled = false
                    m.saveToPreferences { _ in
                        m.connection.stopVPNTunnel()
                        resolve(nil)
                    }
                } else {
                    m.connection.stopVPNTunnel()
                    resolve(nil)
                }
            }
            if let m = Self.cachedManager {
                doStop(m)
            } else {
                self?.resolveManager(create: false) { manager, _ in doStop(manager) }
            }
        }
    }

    // MARK: - isRunning

    @objc func isRunning(_ resolve: @escaping RCTPromiseResolveBlock,
                         rejecter reject: @escaping RCTPromiseRejectBlock) {
        DispatchQueue.main.async { [weak self] in
            if let m = Self.cachedManager {
                resolve(m.connection.status == .connected)
            } else {
                self?.resolveManager(create: false) { manager, _ in
                    resolve(manager?.connection.status == .connected)
                }
            }
        }
    }

    // MARK: - getStats

    @objc func getStats(_ resolve: @escaping RCTPromiseResolveBlock,
                        rejecter reject: @escaping RCTPromiseRejectBlock) {
        // Byte counters require libXray to report them via App Group.
        // Until then, report 0 so the UI shows "connected" without fake numbers.
        let report: (NETunnelProviderManager?) -> Void = { manager in
            let conn = manager?.connection
            let uptime: Int
            if let conn = conn, conn.status == .connected, let since = conn.connectedDate {
                uptime = Int(Date().timeIntervalSince(since))
            } else {
                uptime = 0
            }
            resolve([
                "uploadBytes":   0,
                "downloadBytes": 0,
                "pingMs":        0,
                "uptime":        uptime,
            ])
        }
        DispatchQueue.main.async { [weak self] in
            if let m = Self.cachedManager {
                report(m)
            } else {
                self?.resolveManager(create: false) { manager, _ in report(manager) }
            }
        }
    }

    // MARK: - validateConfig

    @objc func validateConfig(_ config: String,
                              resolver resolve: @escaping RCTPromiseResolveBlock,
                              rejecter reject: @escaping RCTPromiseRejectBlock) {
        resolve(config.trimmingCharacters(in: .whitespaces).hasPrefix("{"))
    }

    // MARK: - getLastError

    @objc func getLastError(_ resolve: @escaping RCTPromiseResolveBlock,
                            rejecter reject: @escaping RCTPromiseRejectBlock) {
        // The extension writes the error to App Group on failure.
        resolve(shared?.string(forKey: Self.errorKey))
    }

    // MARK: - getLastProbeResult

    @objc func getLastProbeResult(_ resolve: @escaping RCTPromiseResolveBlock,
                                  rejecter reject: @escaping RCTPromiseRejectBlock) {
        resolve(shared?.bool(forKey: Self.probeKey) ?? false)
    }

    // MARK: - getConnectionLog

    @objc func getConnectionLog(_ resolve: @escaping RCTPromiseResolveBlock,
                                rejecter reject: @escaping RCTPromiseRejectBlock) {
        let lines = shared?.stringArray(forKey: Self.logKey)
            ?? ["[PacketTunnelProvider] No log — extension has not run yet"]
        resolve(lines)
    }

    // MARK: - getXrayLog

    @objc func getXrayLog(_ resolve: @escaping RCTPromiseResolveBlock,
                          rejecter reject: @escaping RCTPromiseRejectBlock) {
        // Xray runs inside the extension process. We expose what the extension
        // writes to App Group via the connection_log key.
        let lines = shared?.stringArray(forKey: Self.logKey) ?? []
        resolve(lines.isEmpty ? "(no xray log — extension has not run)" : lines.joined(separator: "\n"))
    }

    // MARK: - getTun2socksLog

    @objc func getTun2socksLog(_ resolve: @escaping RCTPromiseResolveBlock,
                               rejecter reject: @escaping RCTPromiseRejectBlock) {
        resolve("(tun2socks not used on iOS — xray handles TUN routing via PacketTunnelProvider)")
    }

    // MARK: - getGeneratedConfig

    @objc func getGeneratedConfig(_ resolve: @escaping RCTPromiseResolveBlock,
                                  rejecter reject: @escaping RCTPromiseRejectBlock) {
        resolve(shared?.string(forKey: Self.configKey) ?? "(no config in App Group)")
    }

    // MARK: - getDeviceInfo

    // Smart Mode per-app bypass is ANDROID-ONLY. iOS consumer VPNs cannot do
    // app-level split tunneling (NEPacketTunnelProvider has no per-app scoping
    // outside MDM). These stubs keep bridge parity and answer honestly so the
    // JS layer can feature-detect: empty app list, accepted-but-ignored save.
    @objc func getInstalledApps(_ resolve: @escaping RCTPromiseResolveBlock,
                                rejecter reject: @escaping RCTPromiseRejectBlock) {
        resolve("[]")
    }

    @objc func setBypassApps(_ packagesJson: String,
                             resolver resolve: @escaping RCTPromiseResolveBlock,
                             rejecter reject: @escaping RCTPromiseRejectBlock) {
        resolve(nil)
    }

    @objc func getDeviceInfo(_ resolve: @escaping RCTPromiseResolveBlock,
                             rejecter reject: @escaping RCTPromiseRejectBlock) {
        resolve([
            "model":           UIDevice.current.model,
            "manufacturer":    "Apple",
            "brand":           "Apple",
            "androidSdk":      0,
            "androidRelease":  UIDevice.current.systemVersion,
        ])
    }

    // MARK: - getNetworkInfo

    // Connection Diagnostics (2026-07-20): network type + best-effort cellular
    // generation for connect_telemetry (see docs/CONNECTION_DIAGNOSTICS.md).
    // NWPathMonitor is callback-based, not synchronous, so this resolves the
    // promise from the first path update (or a 1.5s timeout, so a slow/absent
    // path update never hangs the caller) — mirrors the timeout pattern
    // runTraceTest() above already uses for network calls.
    @objc func getNetworkInfo(_ resolve: @escaping RCTPromiseResolveBlock,
                              rejecter reject: @escaping RCTPromiseRejectBlock) {
        let generation = Self.currentCellularGeneration()
        let monitor = NWPathMonitor()
        let queue = DispatchQueue(label: "no.setalink.netinfo")
        var resolved = false
        let finish: (String) -> Void = { type in
            guard !resolved else { return }
            resolved = true
            monitor.cancel()
            resolve(["type": type, "generation": generation])
        }
        queue.asyncAfter(deadline: .now() + 1.5) { finish("unknown") }
        monitor.pathUpdateHandler = { path in
            if path.usesInterfaceType(.wifi) { finish("wifi") }
            else if path.usesInterfaceType(.cellular) { finish("mobile") }
            else { finish("unknown") }
        }
        monitor.start(queue: queue)
    }

    // Best-effort cellular generation from CoreTelephony's radio access
    // technology string. Empty/nil (e.g. on Wi-Fi, or a locked-down carrier)
    // -> "unknown", same honest-null semantics as the Android side.
    private static func currentCellularGeneration() -> String {
        guard let tech = CTTelephonyNetworkInfo().serviceCurrentRadioAccessTechnology?.values.first else {
            return "unknown"
        }
        switch tech {
        case CTRadioAccessTechnologyNRNSA, CTRadioAccessTechnologyNR:
            return "5g"
        case CTRadioAccessTechnologyLTE:
            return "4g"
        case CTRadioAccessTechnologyWCDMA, CTRadioAccessTechnologyHSDPA, CTRadioAccessTechnologyHSUPA,
             CTRadioAccessTechnologyCDMAEVDORev0, CTRadioAccessTechnologyCDMAEVDORevA,
             CTRadioAccessTechnologyCDMAEVDORevB, CTRadioAccessTechnologyeHRPD:
            return "3g"
        case CTRadioAccessTechnologyEdge, CTRadioAccessTechnologyGPRS, CTRadioAccessTechnologyCDMA1x:
            return "2g"
        default:
            return "unknown"
        }
    }

    // MARK: - reportTelemetry

    @objc func reportTelemetry(_ payload: String,
                               resolver resolve: @escaping RCTPromiseResolveBlock,
                               rejecter reject: @escaping RCTPromiseRejectBlock) {
        resolve(nil)
    }

    // MARK: - runTraceTest

    // Fetches cloudflare.com/cdn-cgi/trace through the active NEProxySettings
    // (HTTP CONNECT on :10809 → xray → VLESS). Parses the ip= field and returns
    // routedIp so the UI can show the VPN exit IP and confirm traffic is tunnelled.
    @objc func runTraceTest(_ resolve: @escaping RCTPromiseResolveBlock,
                            rejecter reject: @escaping RCTPromiseRejectBlock) {
        DispatchQueue.global(qos: .userInitiated).async {
            guard let url = URL(string: "https://cloudflare.com/cdn-cgi/trace") else {
                resolve(["ok": false, "error": "invalid URL"])
                return
            }
            let cfg = URLSessionConfiguration.ephemeral
            cfg.timeoutIntervalForRequest  = 10
            cfg.timeoutIntervalForResource = 10
            let t0 = Date()
            URLSession(configuration: cfg).dataTask(with: URLRequest(url: url)) { data, resp, err in
                let elapsed = String(format: "%.2fs", -t0.timeIntervalSinceNow)
                if let err = err {
                    resolve(["ok": false, "error": "\(err.localizedDescription) (\(elapsed))"])
                    return
                }
                let code  = (resp as? HTTPURLResponse)?.statusCode ?? 0
                let bytes = data?.count ?? 0
                let body  = data.flatMap { String(data: $0, encoding: .utf8) } ?? ""
                let ip    = body.components(separatedBy: "\n")
                               .first(where: { $0.hasPrefix("ip=") })
                               .map { String($0.dropFirst(3)) }
                let ok = code == 200 && ip != nil
                var result: [String: Any] = [
                    "ok":         ok,
                    "statusCode": code,
                    "bytesIn":    bytes,
                    "body":       String(body.prefix(512)),
                ]
                if let ip = ip { result["routedIp"] = ip }
                if !ok {
                    result["error"] = ip == nil
                        ? "no ip= field in response (HTTP \(code), \(elapsed))"
                        : "HTTP \(code) (\(elapsed))"
                }
                resolve(result)
            }.resume()
        }
    }

    // MARK: - getTunnelState

    // Returns the last tunnel_state written by PacketTunnelProvider to the App Group.
    // Build 77 states: connecting → connected_probing → connected_verified, or
    // degraded (tunnel up, real internet probe failed) / failed. Only
    // "connected_verified" means genuinely online — the app must not show a green
    // "connected" for "connected_probing" or "degraded".
    @objc func getTunnelState(_ resolve: @escaping RCTPromiseResolveBlock,
                               rejecter reject: @escaping RCTPromiseRejectBlock) {
        resolve(shared?.string(forKey: "tunnel_state") ?? "unknown")
    }

    // Build 77 — real probe + QUIC evidence for the diagnostics export (no mocks).
    // Typed locals, not one big literal: a 7-entry heterogeneous dictionary of
    // `?? `-defaulted expressions makes the Swift type-checker give up
    // ("unable to type-check this expression in reasonable time", build 80 CI).
    @objc func getProbeDiagnostics(_ resolve: @escaping RCTPromiseResolveBlock,
                                    rejecter reject: @escaping RCTPromiseRejectBlock) {
        let tunnelState: String = shared?.string(forKey: "tunnel_state") ?? "unknown"
        let probeOk:     Bool   = shared?.bool(forKey: Self.probeKey) ?? false
        let probeMs:     Int    = shared?.integer(forKey: "last_probe_latency_ms") ?? 0
        let probeAt:     Int    = shared?.integer(forKey: "last_probe_at") ?? 0
        let probeDetail: String = shared?.string(forKey: "last_probe_detail") ?? ""
        let quicEvidence: String = shared?.string(forKey: "last_quic_evidence") ?? ""
        // Build 80 — the extension's own (direct-path) measurement, kept as a
        // control alongside the app-path evidence above.
        let quicEvidenceDirect: String = shared?.string(forKey: "last_quic_evidence_direct") ?? ""
        let out: [String: Any] = [
            "tunnelState":        tunnelState,
            "probeOk":            probeOk,
            "probeMs":            probeMs,
            "probeAt":            probeAt,
            "probeDetail":        probeDetail,
            "quicEvidence":       quicEvidence,
            "quicEvidenceDirect": quicEvidenceDirect,
        ]
        resolve(out)
    }

    // MARK: - runQuicProbe (build 80)

    // QUIC/UDP evidence measured from the APP process. The packet-tunnel
    // extension's own sockets are exempt from the tunnel routes, so a probe
    // there measures the DIRECT path — from Iran, instagram.com is blocked
    // directly and the verdict is always BOTH_FAIL (a false negative; proven
    // by build 77-79 telemetry). The app's sockets ARE captured by the TUN
    // (HEV, layer 3), so this probe exercises the exact path Instagram uses:
    // app QUIC → TUN → HEV UDP → Xray socks → udp/443 rule → proxy(-quic).
    // TCP vs forced-H3 to the same host; the pair proves/disproves a QUIC
    // blackhole on the TUNNEL path. Result goes to the App Group (same key
    // the diagnostics export reads) and back to JS, which owns telemetry.
    // Classifies a failed probe's raw error into one of a small, fixed set of
    // reasons an admin can actually act on (matches lib/node_intel.php's
    // NI_ERROR_CATEGORIES additions: 'dns_failed', 'tls_failed', 'timeout').
    // Built from URLError.Code, which is Apple's own stable classification
    // of what went wrong in the URL Loading System -- not a guess from the
    // human-readable description string, which varies by locale/iOS version.
    private static func probeFailureCategory(ok: Bool, error: Error?) -> String {
        if ok { return "ok" }
        guard let urlErr = error as? URLError else { return "unknown" }
        switch urlErr.code {
        case .cannotFindHost, .dnsLookupFailed:
            return "dns_failed"
        case .secureConnectionFailed, .serverCertificateUntrusted,
             .serverCertificateHasBadDate, .serverCertificateNotYetValid,
             .serverCertificateHasUnknownRoot, .clientCertificateRejected:
            return "tls_failed"
        case .timedOut:
            return "timeout"
        case .cannotConnectToHost, .networkConnectionLost, .notConnectedToInternet:
            return "connection_failed"
        default:
            return "unknown"
        }
    }

    @objc func runQuicProbe(_ resolve: @escaping RCTPromiseResolveBlock,
                             rejecter reject: @escaping RCTPromiseRejectBlock) {
        DispatchQueue.global(qos: .userInitiated).async { [weak self] in
            let host = "https://www.instagram.com/favicon.ico"
            func probe(http3: Bool) -> (ok: Bool, ms: Int, detail: String, category: String) {
                let cfg = URLSessionConfiguration.ephemeral
                cfg.requestCachePolicy = .reloadIgnoringLocalAndRemoteCacheData
                cfg.timeoutIntervalForRequest = 6.0
                let session = URLSession(configuration: cfg)
                var req = URLRequest(url: URL(string: host)!)
                if http3, #available(iOS 15.0, *) { req.assumesHTTP3Capable = true }
                let start = Date(); let sem = DispatchSemaphore(value: 0)
                var ok = false; var detail = ""; var rawError: Error? = nil
                let task = session.dataTask(with: req) { _, resp, err in
                    if let h = resp as? HTTPURLResponse { ok = true; detail = "HTTP \(h.statusCode)" }
                    else if let e = err { detail = e.localizedDescription; rawError = e }
                    sem.signal()
                }
                task.resume()
                if sem.wait(timeout: .now() + 6.5) == .timedOut {
                    task.cancel(); detail = "timeout"
                    rawError = URLError(.timedOut)
                }
                let category = XrayModule.probeFailureCategory(ok: ok, error: rawError)
                return (ok, Int(Date().timeIntervalSince(start) * 1000), detail, category)
            }
            let tcp  = probe(http3: false)
            let quic = probe(http3: true)
            let verdict = (tcp.ok && !quic.ok) ? "QUIC_BLACKHOLE_LIKELY"
                        : (tcp.ok && quic.ok) ? "QUIC_OK"
                        : (!tcp.ok && !quic.ok) ? "BOTH_FAIL"
                        : "TCP_FAIL_QUIC_OK"
            let line = "TCP=\(tcp.ok ? "ok" : "fail")(\(tcp.ms)ms,\(tcp.detail),\(tcp.category)) " +
                       "QUIC=\(quic.ok ? "ok" : "fail")(\(quic.ms)ms,\(quic.detail),\(quic.category)) ⇒ \(verdict) [app-path]"
            self?.shared?.set(line, forKey: "last_quic_evidence")
            self?.shared?.set(Int(Date().timeIntervalSince1970), forKey: "last_quic_evidence_at")
            self?.shared?.synchronize()
            let out: [String: Any] = [
                "verdict":      verdict,
                "line":         line,
                "tcpOk":        tcp.ok,
                "tcpMs":        tcp.ms,
                "tcpDetail":    tcp.detail,
                "tcpCategory":  tcp.category,
                "quicOk":       quic.ok,
                "quicMs":       quic.ms,
                "quicDetail":   quic.detail,
                "quicCategory": quic.category,
            ]
            resolve(out)
        }
    }

    // MARK: - runSelfTest

    // 4-test suite that runs while the tunnel is active.
    // URLSession requests go through the active NEProxySettings (HTTP CONNECT on :10809),
    // which routes through xray to the Reality server.
    @objc func runSelfTest(_ resolve: @escaping RCTPromiseResolveBlock,
                            rejecter reject: @escaping RCTPromiseRejectBlock) {
        DispatchQueue.global(qos: .userInitiated).async { [weak self] in
            guard let self = self else { return }
            var results: [[String: Any]] = []
            let group = DispatchGroup()

            // Test 1 — DNS: hostname must resolve through tunnel DNS (1.1.1.1 / 8.8.8.8)
            group.enter()
            self.selfTestFetch("https://cp.cloudflare.com/",
                               testName: "dns",
                               timeout: 8) { ok, detail in
                results.append(["test": "dns", "label": "DNS Resolution", "ok": ok, "detail": detail])
                group.leave()
            }

            // Test 2 — HTTPS: IP-literal fetch, no DNS needed — tests TCP+TLS through tunnel
            group.enter()
            self.selfTestFetch("https://1.1.1.1/cdn-cgi/trace",
                               testName: "https",
                               timeout: 8) { ok, detail in
                results.append(["test": "https", "label": "HTTPS (IP-direct)", "ok": ok, "detail": detail])
                group.leave()
            }

            // Test 3 — Tunnel route: check tunnel_state == connected_verified
            let state   = self.shared?.string(forKey: "tunnel_state") ?? "unknown"
            let probeOk = self.shared?.bool(forKey: Self.probeKey) ?? false
            let routeOk = state == "connected_verified" && probeOk
            results.append(["test": "route",
                            "label": "Tunnel Route Verified",
                            "ok": routeOk,
                            "detail": "state=\(state) probe_ok=\(probeOk)"])

            // Test 4 — Exit IP: confirm traffic exits through VPN server, not device IP
            group.enter()
            self.selfTestExitIP(timeout: 10) { ok, detail in
                results.append(["test": "exit_ip", "label": "Exit IP", "ok": ok, "detail": detail])
                group.leave()
            }

            group.notify(queue: .main) {
                resolve(results)
            }
        }
    }

    private func selfTestFetch(_ urlString: String,
                                testName: String,
                                timeout: TimeInterval,
                                completion: @escaping (Bool, String) -> Void) {
        guard let url = URL(string: urlString) else {
            completion(false, "invalid URL")
            return
        }
        let cfg = URLSessionConfiguration.ephemeral
        cfg.timeoutIntervalForRequest  = timeout
        cfg.timeoutIntervalForResource = timeout
        let t0 = Date()
        URLSession(configuration: cfg).dataTask(with: URLRequest(url: url)) { data, resp, err in
            let elapsed = String(format: "%.2fs", -t0.timeIntervalSinceNow)
            if let err = err {
                completion(false, "\(err.localizedDescription) (\(elapsed))")
            } else if let code = (resp as? HTTPURLResponse)?.statusCode {
                let ok = code == 200 || code == 204
                completion(ok, "HTTP \(code) · \(data?.count ?? 0)B · \(elapsed)")
            } else {
                completion(false, "no response (\(elapsed))")
            }
        }.resume()
    }

    private func selfTestExitIP(timeout: TimeInterval, completion: @escaping (Bool, String) -> Void) {
        guard let url = URL(string: "https://cloudflare.com/cdn-cgi/trace") else {
            completion(false, "invalid URL")
            return
        }
        // The configured VPN server address — used to verify the exit IP is actually
        // the VPN node, not the device's own public IP (which would mean the proxy
        // is NOT routing traffic and the self-test is a false positive).
        let serverAddr = shared.flatMap { $0.string(forKey: "xray_config_json") }
            .flatMap { Self.parseServerAddr(from: $0) }

        let cfg = URLSessionConfiguration.ephemeral
        cfg.timeoutIntervalForRequest  = timeout
        cfg.timeoutIntervalForResource = timeout
        let t0 = Date()
        URLSession(configuration: cfg).dataTask(with: URLRequest(url: url)) { data, resp, err in
            let elapsed = String(format: "%.2fs", -t0.timeIntervalSinceNow)
            if let err = err {
                completion(false, "request failed: \(err.localizedDescription) (\(elapsed))")
                return
            }
            guard let data = data, let body = String(data: data, encoding: .utf8) else {
                completion(false, "no response body (\(elapsed))")
                return
            }
            guard let ipLine = body.split(separator: "\n").first(where: { $0.hasPrefix("ip=") }) else {
                completion(false, "ip= not found in trace response (\(elapsed))")
                return
            }
            let ip = String(ipLine.dropFirst(3))
            if let server = serverAddr {
                if ip == server {
                    completion(true,  "exit IP: \(ip) = VPN node ✓ (\(elapsed))")
                } else {
                    // Traffic went direct — proxy is NOT routing this URLSession.
                    completion(false, "exit IP: \(ip) ≠ VPN node \(server) — traffic NOT through proxy (\(elapsed))")
                }
            } else {
                // No server address in config — can't verify, report what we got.
                completion(true, "exit IP: \(ip) (server addr unknown) (\(elapsed))")
            }
        }.resume()
    }

    // Parse the first vnext address from the xray config JSON (same field PacketTunnelProvider
    // uses for the server exclusion route). Returns nil if the config is absent or malformed.
    private static func parseServerAddr(from json: String) -> String? {
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

    // MARK: - setDiagnosticContext

    // Called from JS before each connect attempt with device_id and country.
    // Stored in App Group so PacketTunnelProvider can include them in the upload.
    @objc func setDiagnosticContext(_ deviceId: String,
                                    country: String,
                                    resolver resolve: @escaping RCTPromiseResolveBlock,
                                    rejecter reject: @escaping RCTPromiseRejectBlock) {
        shared?.set(deviceId, forKey: Self.diagDeviceIdKey)
        shared?.set(country,  forKey: Self.diagCountryKey)
        // Force a cross-process flush so the extension (separate process) reliably
        // sees the device_id before it reads the App Group on startTunnel.
        shared?.synchronize()
        resolve(nil)
    }

    // MARK: - Stable device ID (Keychain-backed)
    //
    // The device ID must survive:
    //   • App updates         (app container preserved — MMKV alone would work)
    //   • TestFlight reinstalls (app container wiped — MMKV fails, Keychain survives)
    //   • Device backups/restores (kSecAttrAccessibleAfterFirstUnlock)
    //
    // Only cleared by a full device reset or explicit Keychain wipe — never by
    // deleting/reinstalling the app.

    private static let keychainService = "no.setaei.realink.stable-id"
    private static let keychainAccount = "device_id"

    private func keychainRead() -> String? {
        let q: [CFString: Any] = [
            kSecClass:       kSecClassGenericPassword,
            kSecAttrService: Self.keychainService,
            kSecAttrAccount: Self.keychainAccount,
            kSecReturnData:  kCFBooleanTrue as Any,
            kSecMatchLimit:  kSecMatchLimitOne,
        ]
        var item: CFTypeRef?
        guard SecItemCopyMatching(q as CFDictionary, &item) == errSecSuccess,
              let data = item as? Data,
              let str  = String(data: data, encoding: .utf8),
              !str.isEmpty else { return nil }
        return str
    }

    @discardableResult
    private func keychainWrite(_ value: String) -> Bool {
        guard let data = value.data(using: .utf8) else { return false }
        let q: [CFString: Any] = [
            kSecClass:       kSecClassGenericPassword,
            kSecAttrService: Self.keychainService,
            kSecAttrAccount: Self.keychainAccount,
        ]
        let attrs: [CFString: Any] = [
            kSecValueData:      data,
            kSecAttrAccessible: kSecAttrAccessibleAfterFirstUnlock,
        ]
        let status = SecItemUpdate(q as CFDictionary, attrs as CFDictionary)
        if status == errSecItemNotFound {
            var insert = q
            insert[kSecValueData]       = data
            insert[kSecAttrAccessible]  = kSecAttrAccessibleAfterFirstUnlock
            SecItemAdd(insert as CFDictionary, nil)
        }
        return true
    }

    // Returns the stable device ID stored in Keychain, or generates and persists
    // a new one. Migration: also checks App Group UserDefaults for any ID that
    // was written there by older builds before migrating it to Keychain.
    @objc func getOrCreateStableDeviceId(
        _ resolve: @escaping RCTPromiseResolveBlock,
        rejecter reject: @escaping RCTPromiseRejectBlock
    ) {
        // 1. Keychain (survives reinstalls)
        if let existing = keychainRead() {
            resolve(existing)
            return
        }
        // 2. App Group UserDefaults migration (written by older builds via setDiagnosticContext)
        if let ud = UserDefaults(suiteName: Self.appGroupID),
           let migrated = ud.string(forKey: "setalink_stable_device_id"),
           migrated.hasPrefix("sl-"), migrated.count > 8 {
            keychainWrite(migrated)
            resolve(migrated)
            return
        }
        // 3. Generate a new ID and store in Keychain
        let newId = "sl-\(UUID().uuidString.lowercased())"
        keychainWrite(newId)
        resolve(newId)
    }

    // Persists a device ID (returned by the backend after registration) to Keychain.
    // Called from JS after every successful registration so the canonical server-side
    // ID is always in Keychain regardless of how it was generated.
    @objc func saveStableDeviceId(
        _ deviceId: String,
        resolver resolve: @escaping RCTPromiseResolveBlock,
        rejecter reject: @escaping RCTPromiseRejectBlock
    ) {
        keychainWrite(deviceId)
        resolve(nil)
    }

    @objc static func requiresMainQueueSetup() -> Bool { false }
}
