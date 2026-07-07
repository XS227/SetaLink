import Foundation
import LocalAuthentication

// BiometricModule (iOS) — mirrors the Android BiometricModule so the shared JS
// biometricService works on both platforms. Uses .deviceOwnerAuthentication,
// which accepts Face ID / Touch ID OR the device passcode as a fallback (the
// iOS equivalent of Android's device-credential fallback).
@objc(BiometricModule)
class BiometricModule: NSObject {

  typealias Resolve = (Any?) -> Void
  typealias Reject  = (String?, String?, Error?) -> Void

  @objc(isAvailable:rejecter:)
  func isAvailable(_ resolve: @escaping Resolve, rejecter reject: @escaping Reject) {
    let ctx = LAContext()
    var err: NSError?
    resolve(ctx.canEvaluatePolicy(.deviceOwnerAuthentication, error: &err))
  }

  @objc(getStatus:rejecter:)
  func getStatus(_ resolve: @escaping Resolve, rejecter reject: @escaping Reject) {
    let ctx = LAContext()
    var err: NSError?
    if ctx.canEvaluatePolicy(.deviceOwnerAuthentication, error: &err) {
      resolve("available"); return
    }
    switch LAError.Code(rawValue: err?.code ?? -1) {
    case .some(.biometryNotEnrolled), .some(.passcodeNotSet):
      resolve("none_enrolled")
    case .some(.biometryNotAvailable):
      resolve("no_hardware")
    case .some(.biometryLockout):
      resolve("hw_unavailable")
    default:
      resolve("unknown")
    }
  }

  @objc(getStatusDetail:rejecter:)
  func getStatusDetail(_ resolve: @escaping Resolve, rejecter reject: @escaping Reject) {
    let ctx = LAContext()
    var err: NSError?
    let ok = ctx.canEvaluatePolicy(.deviceOwnerAuthentication, error: &err)
    var biometryType = 0
    if #available(iOS 11.0, *) { biometryType = ctx.biometryType.rawValue } // 0 none, 1 touch, 2 face
    resolve([
      "available":    ok,
      "biometryType": biometryType,
      "code":         err?.code ?? 0,
      "error":        err?.localizedDescription ?? "",
    ])
  }

  @objc(authenticate:subtitle:resolver:rejecter:)
  func authenticate(_ title: String,
                    subtitle: String,
                    resolver resolve: @escaping Resolve,
                    rejecter reject: @escaping Reject) {
    let ctx = LAContext()
    let reason = subtitle.isEmpty ? "Verify your identity to unlock" : subtitle
    ctx.evaluatePolicy(.deviceOwnerAuthentication, localizedReason: reason) { success, _ in
      DispatchQueue.main.async { resolve(success) }
    }
  }

  @objc static func requiresMainQueueSetup() -> Bool { return false }
}
