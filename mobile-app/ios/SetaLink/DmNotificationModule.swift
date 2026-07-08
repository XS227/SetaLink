import Foundation
import UserNotifications

// DmNotificationModule (iOS) — mirrors the Android DmNotification native module so
// the shared JS (services/dmNotifications.ts) posts local DM notifications and
// deep-links a tap into its inbox thread on iOS too.
//
//  • notifyMessage(title, body, id, route) schedules a local UNNotification whose
//    userInfo carries "setalink_route" ("inbox" | "inbox:<threadKey>").
//  • The tap is captured by AppDelegate (UNUserNotificationCenterDelegate), which
//    stashes the route in UserDefaults[kSetalinkRouteKey].
//  • consumeInitialRoute() returns and clears that route; JS parseInboxRoute()
//    turns it into a navigation into the Inbox / a specific thread.
@objc(DmNotification)
class DmNotificationModule: NSObject {

  typealias Resolve = (Any?) -> Void
  typealias Reject  = (String?, String?, Error?) -> Void

  // Ensure we have (or request, once) notification authorization, then run `then`
  // on the main queue with whether we may post.
  private func withAuthorization(_ then: @escaping (Bool) -> Void) {
    let center = UNUserNotificationCenter.current()
    center.getNotificationSettings { settings in
      switch settings.authorizationStatus {
      case .authorized, .provisional, .ephemeral:
        then(true)
      case .notDetermined:
        center.requestAuthorization(options: [.alert, .sound, .badge]) { granted, _ in
          then(granted)
        }
      default:
        then(false)   // denied → best-effort no-op
      }
    }
  }

  @objc(notifyMessage:body:id:route:resolver:rejecter:)
  func notifyMessage(_ title: String,
                     body: String?,
                     id: Double,
                     route: String?,
                     resolver resolve: @escaping Resolve,
                     rejecter reject: @escaping Reject) {
    withAuthorization { granted in
      guard granted else { resolve(false); return }

      let content = UNMutableNotificationContent()
      content.title = title
      if let b = body, !b.isEmpty { content.body = b }
      content.sound = .default
      content.userInfo = [kSetalinkRouteKey: (route?.isEmpty == false ? route! : "inbox")]

      // Immediate delivery; stable id per message so re-posts collapse.
      let request = UNNotificationRequest(
        identifier: "dm-\(Int(id))",
        content: content,
        trigger: nil
      )
      UNUserNotificationCenter.current().add(request) { error in
        DispatchQueue.main.async { resolve(error == nil) }
      }
    }
  }

  @objc(areNotificationsEnabled:rejecter:)
  func areNotificationsEnabled(_ resolve: @escaping Resolve, rejecter reject: @escaping Reject) {
    UNUserNotificationCenter.current().getNotificationSettings { settings in
      DispatchQueue.main.async {
        resolve(settings.authorizationStatus == .authorized
                || settings.authorizationStatus == .provisional
                || settings.authorizationStatus == .ephemeral)
      }
    }
  }

  // Returns and clears the route stashed by a notification tap (see AppDelegate),
  // e.g. "inbox" or "inbox:<threadKey>", or nil if launched normally.
  @objc(consumeInitialRoute:rejecter:)
  func consumeInitialRoute(_ resolve: @escaping Resolve, rejecter reject: @escaping Reject) {
    let defaults = UserDefaults.standard
    let route = defaults.string(forKey: kSetalinkRouteKey)
    if route != nil { defaults.removeObject(forKey: kSetalinkRouteKey) }
    resolve(route)
  }

  @objc static func requiresMainQueueSetup() -> Bool { return false }
}
