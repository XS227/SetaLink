import Foundation
import NetworkExtension

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

    // MARK: - Thread safety

    @objc static func requiresMainQueueSetup() -> Bool { false }
}
