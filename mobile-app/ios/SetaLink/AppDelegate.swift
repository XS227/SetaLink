import UIKit
import React
import React_RCTAppDelegate
import UserNotifications

// Shared key for the pending deep-link route captured from a notification tap.
// Mirrors Android's "setalink_route" launch-intent extra; consumeInitialRoute
// (DmNotificationModule) reads and clears it. Value is "inbox" or "inbox:<key>".
let kSetalinkRouteKey = "setalink_route"

@main
class AppDelegate: RCTAppDelegate, UNUserNotificationCenterDelegate {

    override func application(
        _ application: UIApplication,
        didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil
    ) -> Bool {
        self.moduleName   = "Realink"
        self.initialProps = [:]

        // Own the notification center so DM notification taps deep-link into the
        // inbox thread (mirrors the Android tap → route flow).
        UNUserNotificationCenter.current().delegate = self

        return super.application(application, didFinishLaunchingWithOptions: launchOptions)
    }

    // MARK: - Local notifications (DM deep-link)

    // Show DM notifications while the app is in the foreground too.
    func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        willPresent notification: UNNotification,
        withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void
    ) {
        if #available(iOS 14.0, *) {
            completionHandler([.banner, .sound, .badge])
        } else {
            completionHandler([.alert, .sound, .badge])
        }
    }

    // A tap on a DM notification: stash its route so JS consumeInitialRoute()
    // can navigate straight into that thread on the next active cycle.
    func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        didReceive response: UNNotificationResponse,
        withCompletionHandler completionHandler: @escaping () -> Void
    ) {
        if let route = response.notification.request.content.userInfo[kSetalinkRouteKey] as? String,
           !route.isEmpty {
            UserDefaults.standard.set(route, forKey: kSetalinkRouteKey)
        }
        completionHandler()
    }

    override func sourceURL(for bridge: RCTBridge) -> URL? {
        bundleURL()
    }

    override func bundleURL() -> URL? {
#if DEBUG
        RCTBundleURLProvider.sharedSettings().jsBundleURL(forBundleRoot: "index")
#else
        Bundle.main.url(forResource: "main", withExtension: "jsbundle")
#endif
    }

    // MARK: - Deep links

    override func application(
        _ app: UIApplication,
        open url: URL,
        options: [UIApplication.OpenURLOptionsKey: Any] = [:]
    ) -> Bool {
        return RCTLinkingManager.application(app, open: url, options: options)
    }

    override func application(
        _ application: UIApplication,
        continue userActivity: NSUserActivity,
        restorationHandler: @escaping ([UIUserActivityRestoring]?) -> Void
    ) -> Bool {
        return RCTLinkingManager.application(application, continue: userActivity, restorationHandler: restorationHandler)
    }
}
