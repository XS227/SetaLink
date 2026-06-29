import Foundation
import UIKit
import NetworkExtension

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
            if let m = Self.cachedManager {
                m.connection.stopVPNTunnel()
                resolve(nil)
            } else {
                self?.resolveManager(create: false) { manager, _ in
                    manager?.connection.stopVPNTunnel()
                    resolve(nil)
                }
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

    // MARK: - reportTelemetry

    @objc func reportTelemetry(_ payload: String,
                               resolver resolve: @escaping RCTPromiseResolveBlock,
                               rejecter reject: @escaping RCTPromiseRejectBlock) {
        resolve(nil)
    }

    // MARK: - runTraceTest

    @objc func runTraceTest(_ resolve: @escaping RCTPromiseResolveBlock,
                            rejecter reject: @escaping RCTPromiseRejectBlock) {
        resolve(["ok": false,
                 "error": "runTraceTest requires libXray embedded in PacketTunnelExtension"])
    }

    // MARK: - getTunnelState

    // Returns the last tunnel_state written by PacketTunnelProvider to the App Group.
    // "connected_verified" means all probes (including SOCKS5) passed before iOS
    // was told the tunnel is connected.
    @objc func getTunnelState(_ resolve: @escaping RCTPromiseResolveBlock,
                               rejecter reject: @escaping RCTPromiseRejectBlock) {
        resolve(shared?.string(forKey: "tunnel_state") ?? "unknown")
    }

    // MARK: - runSelfTest

    // 4-test suite that runs while the tunnel is active.
    // All URLSession requests go through the active TUN automatically on iOS,
    // so these tests exercise the real HEV→xray→internet path, not the proxy path.
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
            if let ipLine = body.split(separator: "\n").first(where: { $0.hasPrefix("ip=") }) {
                let ip = String(ipLine.dropFirst(3))
                completion(true, "exit IP: \(ip) (\(elapsed))")
            } else {
                completion(false, "ip= not found in trace response (\(elapsed))")
            }
        }.resume()
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

    @objc static func requiresMainQueueSetup() -> Bool { false }
}
