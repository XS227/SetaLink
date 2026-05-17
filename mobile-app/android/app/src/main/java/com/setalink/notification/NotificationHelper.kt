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

    fun buildConnected(context: Context): Notification {
        createChannel(context)

        val openIntent = PendingIntent.getActivity(
            context,
            0,
            Intent(context, MainActivity::class.java),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        return NotificationCompat.Builder(context, CHANNEL_ID)
            .setContentTitle("SetaLink VPN")
            .setContentText("Connected — your traffic is protected")
            .setSmallIcon(R.drawable.ic_stat_vpn)
            .setOngoing(true)
            .setContentIntent(openIntent)
            .build()
    }

    fun buildConnecting(context: Context): Notification {
        createChannel(context)

        return NotificationCompat.Builder(context, CHANNEL_ID)
            .setContentTitle("SetaLink VPN")
            .setContentText("Connecting…")
            .setSmallIcon(R.drawable.ic_stat_vpn)
            .setOngoing(true)
            .build()
    }
}
