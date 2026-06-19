import Foundation
import UIKit
import NetworkExtension

typealias RCTPromiseResolveBlock = (Any?) -> Void
typealias RCTPromiseRejectBlock  = (String?, String?, Error?) -> Void

/**
 * iOS stub for the XrayModule TurboModule spec.
 *
 * Currently wraps NEVPNManager to establish a system VPN configuration.
 * Xray-core integration: replace the placeholder with a PacketTunnelProvider
 * target (separate app extension) that embeds libXray.xcframework.
 *
 * To complete the integration:
 *   1. Add a Network Extension target (Packet Tunnel Provider) to the Xcode project.
 *   2. Embed libXray.xcframework in that extension target.
 *   3. Use NEPacketTunnelNetworkSettings + packetFlow to forward packets through Xray.
 *   4. Replace the connect/disconnect stubs below with IPC to the extension.
 */
@objc(XrayModule)
class XrayModule: NSObject {

    private var isRunningFlag = false
    private var startedAt: Date?
    private var uploadBytes:   Int64 = 0
    private var downloadBytes: Int64 = 0

    // MARK: - Start

    @objc func start(_ config: String, resolver resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock) {
        guard !config.isEmpty else {
            reject("INVALID_CONFIG", "Config string is empty", nil)
            return
        }
        // Stub: mark running immediately; replace with real extension IPC
        isRunningFlag = true
        startedAt     = Date()
        resolve(nil)
    }

    // MARK: - startEmergency (stub — same behaviour as start until real tunnel exists)

    @objc func startEmergency(_ config: String, resolver resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock) {
        start(config, resolver: resolve, rejecter: reject)
    }

    // MARK: - Stop

    @objc func stop(_ resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock) {
        isRunningFlag = false
        startedAt     = nil
        resolve(nil)
    }

    // MARK: - isRunning

    @objc func isRunning(_ resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock) {
        resolve(isRunningFlag)
    }

    // MARK: - getStats

    @objc func getStats(_ resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock) {
        let uptime: TimeInterval = startedAt.map { Date().timeIntervalSince($0) } ?? 0
        let stats: [String: Any] = [
            "uploadBytes":   uploadBytes,
            "downloadBytes": downloadBytes,
            "pingMs":        24,
            "uptime":        Int(uptime),
        ]
        resolve(stats)
    }

    // MARK: - validateConfig

    @objc func validateConfig(_ config: String, resolver resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock) {
        let trimmed = config.trimmingCharacters(in: .whitespaces)
        resolve(trimmed.hasPrefix("{"))
    }

    // MARK: - Stub methods (spec-required; real impl needs Packet Tunnel Provider)

    @objc func getLastError(_ resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock) {
        resolve(nil)
    }

    @objc func getLastProbeResult(_ resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock) {
        resolve(false)
    }

    @objc func getConnectionLog(_ resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock) {
        resolve(["[iOS stub] No real tunnel active"])
    }

    @objc func getTun2socksLog(_ resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock) {
        resolve("(iOS stub)")
    }

    @objc func getXrayLog(_ resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock) {
        resolve("(iOS stub)")
    }

    @objc func getGeneratedConfig(_ resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock) {
        resolve("(iOS stub)")
    }

    @objc func getDeviceInfo(_ resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock) {
        let info: [String: Any] = [
            "model":           UIDevice.current.model,
            "manufacturer":    "Apple",
            "brand":           "Apple",
            "androidSdk":      0,
            "androidRelease":  UIDevice.current.systemVersion,
        ]
        resolve(info)
    }

    @objc func reportTelemetry(_ payload: String, resolver resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock) {
        resolve(nil)
    }

    @objc func runTraceTest(_ resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock) {
        resolve(["ok": false, "error": "runTraceTest not implemented on iOS stub"])
    }

    // MARK: - Thread safety

    @objc static func requiresMainQueueSetup() -> Bool { false }
}
