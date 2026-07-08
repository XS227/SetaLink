package com.setalink.notification

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import androidx.core.app.NotificationCompat
import com.setalink.MainActivity
import com.setalink.R

object NotificationHelper {

    const val NOTIFICATION_ID  = 1001
    private const val CHANNEL_ID   = "setalink_vpn"
    private const val CHANNEL_NAME = "VPN Status"

    // Separate channel for direct messages so users can mute VPN status and keep
    // message alerts (or vice-versa). Body is kept off the lock screen (PRIVATE).
    const val MESSAGES_CHANNEL_ID   = "setalink_messages"
    private const val MESSAGES_CHANNEL_NAME = "Realink Messages"
    private const val MESSAGES_BASE_ID = 2000

    fun createChannel(context: Context) {
        val channel = NotificationChannel(
            CHANNEL_ID,
            CHANNEL_NAME,
            NotificationManager.IMPORTANCE_LOW
        ).apply {
            description = "Shows VPN connection status"
            setShowBadge(false)
        }
        val manager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        manager.createNotificationChannel(channel)
    }

    fun createMessagesChannel(context: Context) {
        val channel = NotificationChannel(
            MESSAGES_CHANNEL_ID,
            MESSAGES_CHANNEL_NAME,
            NotificationManager.IMPORTANCE_HIGH
        ).apply {
            description = "New direct messages"
            setShowBadge(true)
            lockscreenVisibility = Notification.VISIBILITY_PRIVATE
        }
        val manager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        manager.createNotificationChannel(channel)
    }

    /**
     * Post a direct-message notification. Tapping opens the app and routes to the
     * Inbox (via the "setalink_route" extra). `body` is intentionally optional and
     * omitted by callers for privacy — only the sender label is shown.
     */
    fun showMessage(context: Context, title: String, body: String?, notifyId: Int, route: String = "inbox") {
        createMessagesChannel(context)

        val openIntent = Intent(context, MainActivity::class.java).apply {
            // Deep-link target: "inbox" (list) or "inbox:<threadKey>" (one thread).
            putExtra("setalink_route", route)
            flags = Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_NEW_TASK
        }
        val pending = PendingIntent.getActivity(
            context,
            MESSAGES_BASE_ID + notifyId,
            openIntent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        val builder = NotificationCompat.Builder(context, MESSAGES_CHANNEL_ID)
            .setContentTitle(title)
            .setSmallIcon(R.drawable.ic_stat_vpn)
            .setAutoCancel(true)
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setVisibility(NotificationCompat.VISIBILITY_PRIVATE)
            .setContentIntent(pending)
        if (!body.isNullOrEmpty()) builder.setContentText(body)

        val manager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        manager.notify(MESSAGES_BASE_ID + notifyId, builder.build())
    }

    fun buildConnected(context: Context): Notification {
        createChannel(context)

        val openIntent = PendingIntent.getActivity(
            context,
            0,
            Intent(context, MainActivity::class.java),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        return NotificationCompat.Builder(context, CHANNEL_ID)
            .setContentTitle("Realink VPN")
            .setContentText("Connected — your traffic is protected")
            .setSmallIcon(R.drawable.ic_stat_vpn)
            .setOngoing(true)
            .setContentIntent(openIntent)
            .build()
    }

    fun buildConnecting(context: Context): Notification {
        createChannel(context)

        return NotificationCompat.Builder(context, CHANNEL_ID)
            .setContentTitle("Realink VPN")
            .setContentText("Connecting…")
            .setSmallIcon(R.drawable.ic_stat_vpn)
            .setOngoing(true)
            .build()
    }
}
