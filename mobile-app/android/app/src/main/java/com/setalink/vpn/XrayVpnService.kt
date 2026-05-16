package com.setalink.vpn

import android.content.Intent
import android.net.VpnService
import android.os.IBinder
import android.os.ParcelFileDescriptor
import com.setalink.notification.NotificationHelper
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch

/**
 * Foreground VPN service that owns the TUN interface.
 *
 * Lifecycle (driven by XrayModule):
 *   start  → onStartCommand with ACTION_START + JSON config
 *   stop   → onStartCommand with ACTION_STOP  (or stopSelf)
 *
 * The actual Xray-core process management (start/stop/stats) lives in
 * XrayModule — this class only owns the Android VpnService lifecycle
 * and the foreground notification.
 *
 * TODO: when integrating the real Xray binary, use libXray (Go mobile)
 * and forward packets through the TUN fd created by builder.establish().
 */
class XrayVpnService : VpnService() {

    companion object {
        const val ACTION_START = "com.setalink.vpn.START"
        const val ACTION_STOP  = "com.setalink.vpn.STOP"
        const val EXTRA_CONFIG = "config_json"

        // Broadcast back to XrayModule so the store knows the service is live
        const val BROADCAST_CONNECTED    = "com.setalink.vpn.CONNECTED"
        const val BROADCAST_DISCONNECTED = "com.setalink.vpn.DISCONNECTED"
    }

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private var tunFd: ParcelFileDescriptor? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        when (intent?.action) {
            ACTION_START -> {
                val config = intent?.getStringExtra(EXTRA_CONFIG) ?: return START_NOT_STICKY
                startForeground(NotificationHelper.NOTIFICATION_ID,
                    NotificationHelper.buildConnected(this))
                scope.launch { establishTunnel(config) }
            }
            ACTION_STOP -> {
                tearDownTunnel()
                stopForeground(STOP_FOREGROUND_REMOVE)
                stopSelf()
            }
        }
        return START_NOT_STICKY
    }

    private fun establishTunnel(config: String) {
        try {
            val builder = Builder()
                .setSession("SetaLink")
                .addAddress("10.0.0.2", 24)
                .addDnsServer("1.1.1.1")
                .addDnsServer("8.8.8.8")
                .addRoute("0.0.0.0", 0)   // all-traffic tunnel
                .setMtu(1500)

            tunFd = builder.establish()

            sendBroadcast(Intent(BROADCAST_CONNECTED))
        } catch (e: Exception) {
            sendBroadcast(Intent(BROADCAST_DISCONNECTED))
            stopSelf()
        }
    }

    private fun tearDownTunnel() {
        try {
            tunFd?.close()
            tunFd = null
        } catch (_: Exception) {}
        sendBroadcast(Intent(BROADCAST_DISCONNECTED))
    }

    override fun onDestroy() {
        super.onDestroy()
        tearDownTunnel()
        scope.cancel()
    }

    override fun onRevoke() {
        tearDownTunnel()
        super.onRevoke()
    }

    override fun onBind(intent: Intent?): IBinder? = null
}
