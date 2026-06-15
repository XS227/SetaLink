package com.setalink.modules

import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import androidx.core.app.NotificationManagerCompat
import com.setalink.notification.NotificationHelper

/**
 * Thin JS bridge for direct-message local notifications (old-arch NativeModule,
 * so it does not touch TurboModule codegen). The JS DM poll calls notifyMessage()
 * when a new incoming message arrives; tapping the notification opens the app and
 * the launch intent carries a "setalink_route=inbox" extra that consumeInitialRoute
 * returns so JS can navigate to the Inbox.
 */
class DmNotificationModule(private val context: ReactApplicationContext) :
    ReactContextBaseJavaModule(context) {

    override fun getName(): String = "DmNotification"

    @ReactMethod
    fun notifyMessage(title: String, body: String?, id: Double, promise: Promise) {
        try {
            NotificationHelper.showMessage(context, title, body, id.toInt())
            promise.resolve(true)
        } catch (e: Exception) {
            promise.resolve(false)
        }
    }

    @ReactMethod
    fun areNotificationsEnabled(promise: Promise) {
        try {
            promise.resolve(NotificationManagerCompat.from(context).areNotificationsEnabled())
        } catch (e: Exception) {
            promise.resolve(false)
        }
    }

    /** Returns and clears the route the app was launched/resumed into via a
     *  notification tap (e.g. "inbox"), or null if launched normally. */
    @ReactMethod
    fun consumeInitialRoute(promise: Promise) {
        try {
            val activity = currentActivity
            val intent = activity?.intent
            val route = intent?.getStringExtra("setalink_route")
            intent?.removeExtra("setalink_route")
            promise.resolve(route)
        } catch (e: Exception) {
            promise.resolve(null)
        }
    }
}
