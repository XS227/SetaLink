package com.setalink.notification

import android.content.Context
import androidx.work.Worker
import androidx.work.WorkerParameters
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL

/**
 * Periodic background poll for new direct messages (v0.9.36) — the "Phase 2" of
 * the push feature that works without FCM. WorkManager runs this even when the
 * app is killed (min interval ~15 min), so users get a notification for new DMs
 * without keeping the app open. Privacy: title-only ("New message from SL-…"),
 * the body is never fetched into the notification.
 *
 * Self-sufficient: device_id is read from the app's SharedPreferences and the
 * API base/token match services/entitlementService.ts. Dedupe via the last
 * notified message id, also in SharedPreferences.
 */
class DmPollWorker(context: Context, params: WorkerParameters) : Worker(context, params) {

    companion object {
        const val UNIQUE_NAME = "setalink-dm-poll"
        private const val BASE = "https://setalink.no/api.php"
        private const val TOKEN = "setalink-mobile-diag-v1"
        private const val PREFS = "setalink_device"
        private const val KEY_DEVICE = "stable_device_id"
        private const val KEY_LAST = "dm_last_notified_id"
    }

    override fun doWork(): Result {
        try {
            val prefs = applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            val deviceId = prefs.getString(KEY_DEVICE, null) ?: return Result.success()
            val lastNotified = prefs.getLong(KEY_LAST, 0L)

            val url = "$BASE?mobile=1&action=list-messages&device_id=" +
                java.net.URLEncoder.encode(deviceId, "UTF-8") + "&_token=$TOKEN"
            val body = httpGet(url) ?: return Result.success()

            val root = JSONObject(body)
            if (!root.optBoolean("ok", false)) return Result.success()
            val messages = root.optJSONObject("data")?.optJSONArray("messages") ?: return Result.success()

            var maxId = lastNotified
            var newest: JSONObject? = null
            var newCount = 0
            for (i in 0 until messages.length()) {
                val m = messages.getJSONObject(i)
                val id = m.optLong("id", 0)
                val incoming = m.optString("direction") == "in"
                val unread = !m.optBoolean("read", false)
                if (incoming && unread && id > lastNotified) {
                    newCount++
                    if (newest == null || id > newest!!.optLong("id", 0)) newest = m
                }
                if (id > maxId) maxId = id
            }

            if (newCount > 0 && newest != null) {
                val sender = newest!!.optString("peer_user_id").ifEmpty {
                    newest!!.optString("peer_device").ifEmpty { "Realink" }
                }
                val title = if (newCount == 1) "New message from $sender" else "$newCount new messages"
                NotificationHelper.showMessage(applicationContext, title, null, newest!!.optLong("id").toInt())
            }
            if (maxId > lastNotified) prefs.edit().putLong(KEY_LAST, maxId).apply()
            return Result.success()
        } catch (e: Exception) {
            // Never fail hard — avoid WorkManager backoff storms.
            return Result.success()
        }
    }

    private fun httpGet(urlStr: String): String? {
        var conn: HttpURLConnection? = null
        return try {
            conn = (URL(urlStr).openConnection() as HttpURLConnection).apply {
                requestMethod = "GET"
                connectTimeout = 10000
                readTimeout = 10000
            }
            if (conn.responseCode in 200..299) conn.inputStream.bufferedReader().use { it.readText() }
            else null
        } catch (e: Exception) {
            null
        } finally {
            conn?.disconnect()
        }
    }
}
