package com.setalink.modules

import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import androidx.core.app.NotificationManagerCompat
import androidx.work.Constraints
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.NetworkType
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import com.setalink.notification.DmPollWorker
import com.setalink.notification.NotificationHelper
import java.util.concurrent.TimeUnit

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

    /** Enable/disable the periodic background DM poll (WorkManager, ~15 min).
     *  Delivers notifications even when the app is killed — no FCM needed. */
    @ReactMethod
    fun setBackgroundPolling(enabled: Boolean, promise: Promise) {
        try {
            val wm = WorkManager.getInstance(context)
            if (enabled) {
                val req = PeriodicWorkRequestBuilder<DmPollWorker>(15, TimeUnit.MINUTES)
                    .setConstraints(
                        Constraints.Builder()
                            .setRequiredNetworkType(NetworkType.CONNECTED)
                            .build()
                    )
                    .build()
                wm.enqueueUniquePeriodicWork(
                    DmPollWorker.UNIQUE_NAME, ExistingPeriodicWorkPolicy.KEEP, req
                )
            } else {
                wm.cancelUniqueWork(DmPollWorker.UNIQUE_NAME)
            }
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
