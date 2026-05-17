package com.setalink.modules

import android.app.Activity
import android.app.ActivityManager
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

    // Tunnel setup step log — cleared on each start(), appended via BROADCAST_STEP
    private val stepLog     = mutableListOf<String>()
    private val stepLogLock = Any()

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
                XrayVpnService.BROADCAST_STEP -> {
                    val step = intent.getStringExtra(XrayVpnService.EXTRA_STEP) ?: return
                    val ok   = intent.getBooleanExtra(XrayVpnService.EXTRA_STEP_OK, false)
                    val msg  = intent.getStringExtra(XrayVpnService.EXTRA_STEP_MSG) ?: ""
                    val icon = if (ok) "✓" else "✗"
                    synchronized(stepLogLock) {
                        stepLog.add("$icon $step${if (msg.isNotEmpty()) ": $msg" else ""}")
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
            addAction(XrayVpnService.BROADCAST_STEP)
        }
        ContextCompat.registerReceiver(
            reactContext, vpnReceiver, filter, ContextCompat.RECEIVER_NOT_EXPORTED
        )
        reactContext.addActivityEventListener(this)

        // Restore running state when app is restarted while the VPN service is active.
        // getRunningServices() still returns own-package services on API 26+ per Android docs.
        if (isVpnServiceRunning()) {
            running   = true
            startedAt = System.currentTimeMillis()
            Log.i(TAG, "VPN service already running — restoring connected state")
        }
    }

    // ── Helpers ───────────────────────────────────────────────────────────────

    @Suppress("DEPRECATION")
    private fun isVpnServiceRunning(): Boolean {
        return try {
            val am = reactContext.getSystemService(Context.ACTIVITY_SERVICE) as ActivityManager
            am.getRunningServices(Int.MAX_VALUE)
                .any { it.service.className == XrayVpnService::class.java.name }
        } catch (e: Exception) {
            Log.w(TAG, "Could not check running services: ${e.message}")
            false
        }
    }

    // ── TurboModule interface ─────────────────────────────────────────────────

    override fun getName(): String = NAME

    @ReactMethod
    override fun start(config: String, promise: Promise) {
        synchronized(stepLogLock) { stepLog.clear() }
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

    @ReactMethod
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

    @ReactMethod
    override fun isRunning(promise: Promise) = promise.resolve(running)

    @ReactMethod
    override fun getLastError(promise: Promise) = promise.resolve(lastError)

    @ReactMethod
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

    @ReactMethod
    override fun validateConfig(config: String, promise: Promise) =
        promise.resolve(config.trim().startsWith("{"))

    @ReactMethod
    override fun getConnectionLog(promise: Promise) {
        synchronized(stepLogLock) {
            val arr = com.facebook.react.bridge.WritableNativeArray()
            stepLog.forEach { arr.pushString(it) }
            promise.resolve(arr)
        }
    }

    @ReactMethod
    override fun getXrayLog(promise: Promise) {
        try {
            val logFile = java.io.File(reactContext.filesDir, XrayVpnService.XRAY_LOG_FILE)
            if (!logFile.exists()) {
                promise.resolve("(no xray.log — tunnel not yet started)")
                return
            }
            val lines = logFile.readLines().takeLast(100)
            promise.resolve(lines.joinToString("\n"))
        } catch (e: Exception) {
            promise.resolve("(error reading xray.log: ${e.message})")
        }
    }

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
