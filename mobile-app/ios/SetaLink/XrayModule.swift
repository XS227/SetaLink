import Foundation
import UIKit
import NetworkExtension

typealias RCTPromiseResolveBlock = (Any?) -> Void
typealias RCTPromiseRejectBlock  = (String?, String?, Error?) -> Void

// XrayModule — bridges React Native JS to the PacketTunnelProvider extension.
//
// Architecture:
//   1. JS calls start(configJson) → config saved to App Group → NEVPNManager
//      tells the OS to launch PacketTunnelExtension/PacketTunnelProvider.
//   2. PacketTunnelProvider reads the config, sets up the TUN, starts xray-core,
//      probes for connectivity, and reports success/failure via completionHandler.
//   3. JS polls isRunning() → NEVPNManager.connection.status == .connected.
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
    private static let configKey   = "xray_config_json"
    private static let errorKey    = "last_tunnel_error"
    private static let probeKey    = "last_probe_ok"
    private static let logKey      = "connection_log"

    private var shared: UserDefaults? {
        UserDefaults(suiteName: Self.appGroupID)
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

        DispatchQueue.main.async {
            NEVPNManager.shared().loadFromPreferences { [weak self] loadError in
                if let err = loadError {
                    reject("LOAD_PREFS_FAILED", err.localizedDescription, err)
                    return
                }
                self?.configureAndLaunch(resolve: resolve, reject: reject)
            }
        }
    }

    private func configureAndLaunch(resolve: @escaping RCTPromiseResolveBlock,
                                    reject:  @escaping RCTPromiseRejectBlock) {
        let manager = NEVPNManager.shared()

        let proto = NETunnelProviderProtocol()
        proto.providerBundleIdentifier = Self.extensionID
        proto.serverAddress = "vpn.setalink.no"

        manager.protocolConfiguration = proto
        manager.localizedDescription   = "Realink VPN"
        manager.isEnabled              = true

        manager.saveToPreferences { error in
            if let err = error {
                reject("SAVE_PREFS_FAILED", err.localizedDescription, err)
                return
            }
            // startVPNTunnel() asks iOS to launch the PacketTunnelProvider extension.
            // It returns immediately; the extension runs asynchronously.
            // JS polls isRunning() every 500 ms (vpnBridge.ts) until connected or timeout.
            do {
                try NEVPNManager.shared().connection.startVPNTunnel()
                resolve(nil)
            } catch {
                reject("START_TUNNEL_FAILED", error.localizedDescription, error)
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
        DispatchQueue.main.async {
            NEVPNManager.shared().connection.stopVPNTunnel()
            resolve(nil)
        }
    }

    // MARK: - isRunning

    @objc func isRunning(_ resolve: @escaping RCTPromiseResolveBlock,
                         rejecter reject: @escaping RCTPromiseRejectBlock) {
        DispatchQueue.main.async {
            let status = NEVPNManager.shared().connection.status
            resolve(status == .connected)
        }
    }

    // MARK: - getStats

    @objc func getStats(_ resolve: @escaping RCTPromiseResolveBlock,
                        rejecter reject: @escaping RCTPromiseRejectBlock) {
        DispatchQueue.main.async {
            let conn = NEVPNManager.shared().connection
            let uptime: Int
            if conn.status == .connected, let since = conn.connectedDate {
                uptime = Int(Date().timeIntervalSince(since))
            } else {
                uptime = 0
            }
            // Byte counters require libXray to report them via App Group.
            // Until then, report 0 so the UI shows "connected" without fake numbers.
            resolve([
                "uploadBytes":   0,
                "downloadBytes": 0,
                "pingMs":        0,
                "uptime":        uptime,
            ])
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

    @objc static func requiresMainQueueSetup() -> Bool { false }
}
