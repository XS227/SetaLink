package com.setalink.modules

import android.app.Activity
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.net.VpnService
import android.util.Log
import androidx.core.content.ContextCompat
import com.facebook.react.bridge.*
import com.setalink.vpn.XrayVpnService

/**
 * TurboModule — bridges React Native JS to the Android VPN service.
 *
 * Key responsibilities:
 *   • Request VPN system permission via ActivityEventListener before starting
 *   • Start / stop XrayVpnService
 *   • Expose isRunning, getStats, getLastError to the JS adapter
 */
class XrayModule(private val reactContext: ReactApplicationContext) :
    NativeXrayModuleSpec(reactContext), ActivityEventListener {

    companion object {
        const val NAME                  = "XrayModule"
        const val VPN_PERM_REQUEST_CODE = 0xBEEF
        private const val TAG           = "XrayModule"
    }

    private var running    = false
    private var startedAt  = 0L
    private var lastError: String? = null

    // Stored while Android VPN-permission dialog is shown
    private var pendingConfig:  String?  = null
    private var pendingPromise: Promise? = null

    // Stats — uptime is real; bytes/ping remain mocked until libXray integration
    private val statsLock    = Any()
    private var uploadBytes  = 0L
    private var downloadBytes= 0L
    private var lastPingMs   = 24L

    // ── Broadcast receiver (must be declared before init block) ──────────────

    private val vpnReceiver = object : BroadcastReceiver() {
        override fun onReceive(context: Context, intent: Intent) {
            when (intent.action) {
                XrayVpnService.BROADCAST_CONNECTED -> {
                    running   = true
                    startedAt = System.currentTimeMillis()
                    lastError = null
                    Log.i(TAG, "VPN connected")
                }
                XrayVpnService.BROADCAST_DISCONNECTED -> {
                    running   = false
                    val err   = intent.getStringExtra(XrayVpnService.EXTRA_ERROR)
                    if (err != null) {
                        lastError = err
                        Log.e(TAG, "VPN disconnected with error: $err")
                    } else {
                        Log.i(TAG, "VPN disconnected")
                    }
                }
            }
        }
    }

    // ── Init ─────────────────────────────────────────────────────────────────

    init {
        val filter = IntentFilter().apply {
            addAction(XrayVpnService.BROADCAST_CONNECTED)
            addAction(XrayVpnService.BROADCAST_DISCONNECTED)
        }
        ContextCompat.registerReceiver(
            reactContext, vpnReceiver, filter, ContextCompat.RECEIVER_NOT_EXPORTED
        )
        reactContext.addActivityEventListener(this)
    }

    // ── TurboModule interface ─────────────────────────────────────────────────

    override fun getName(): String = NAME

    override fun start(config: String, promise: Promise) {
        try {
            val permIntent = VpnService.prepare(reactContext)
            if (permIntent != null) {
                val activity = reactContext.currentActivity
                if (activity == null) {
                    promise.reject("VPN_NO_ACTIVITY", "Bring the app to foreground before connecting")
                    return
                }
                Log.i(TAG, "Requesting VPN permission from user")
                pendingConfig  = config
                pendingPromise = promise
                activity.startActivityForResult(permIntent, VPN_PERM_REQUEST_CODE)
                return          // promise resolved/rejected later in onActivityResult
            }
            startVpnService(config, promise)
        } catch (e: Exception) {
            Log.e(TAG, "start() error: ${e.message}", e)
            promise.reject("VPN_START_ERROR", e.message ?: "Unknown error starting VPN", e)
        }
    }

    override fun stop(promise: Promise) {
        try {
            reactContext.startService(
                Intent(reactContext, XrayVpnService::class.java).apply {
                    action = XrayVpnService.ACTION_STOP
                }
            )
            running = false
            promise.resolve(null)
        } catch (e: Exception) {
            promise.reject("VPN_STOP_ERROR", e.message, e)
        }
    }

    override fun isRunning(promise: Promise) = promise.resolve(running)

    override fun getLastError(promise: Promise) = promise.resolve(lastError)

    override fun getStats(promise: Promise) {
        synchronized(statsLock) {
            val uptime = if (startedAt > 0) (System.currentTimeMillis() - startedAt) / 1000 else 0L
            promise.resolve(WritableNativeMap().apply {
                putDouble("uploadBytes",   uploadBytes.toDouble())
                putDouble("downloadBytes", downloadBytes.toDouble())
                putDouble("pingMs",        lastPingMs.toDouble())
                putDouble("uptime",        uptime.toDouble())
            })
        }
    }

    override fun validateConfig(config: String, promise: Promise) =
        promise.resolve(config.trim().startsWith("{"))

    // ── VPN permission result ─────────────────────────────────────────────────

    override fun onActivityResult(activity: Activity?, requestCode: Int, resultCode: Int, data: Intent?) {
        if (requestCode != VPN_PERM_REQUEST_CODE) return
        val config  = pendingConfig  ?: return
        val promise = pendingPromise ?: return
        pendingConfig  = null
        pendingPromise = null

        if (resultCode == Activity.RESULT_OK) {
            Log.i(TAG, "VPN permission granted")
            startVpnService(config, promise)
        } else {
            Log.w(TAG, "VPN permission denied by user")
            promise.reject("VPN_PERMISSION_DENIED", "VPN permission denied — tap to grant access")
        }
    }

    override fun onNewIntent(intent: Intent?) {}

    // ── Private helpers ───────────────────────────────────────────────────────

    private fun startVpnService(config: String, promise: Promise) {
        try {
            lastError = null
            reactContext.startForegroundService(
                Intent(reactContext, XrayVpnService::class.java).apply {
                    action = XrayVpnService.ACTION_START
                    putExtra(XrayVpnService.EXTRA_CONFIG, config)
                }
            )
            Log.i(TAG, "XrayVpnService started")
            promise.resolve(null)
        } catch (e: Exception) {
            Log.e(TAG, "startVpnService failed: ${e.message}", e)
            promise.reject("VPN_START_ERROR", e.message ?: "Failed to start VPN service", e)
        }
    }

    // ── Cleanup ───────────────────────────────────────────────────────────────

    override fun invalidate() {
        super.invalidate()
        runCatching { reactContext.removeActivityEventListener(this) }
        runCatching { reactContext.unregisterReceiver(vpnReceiver) }
    }
}
