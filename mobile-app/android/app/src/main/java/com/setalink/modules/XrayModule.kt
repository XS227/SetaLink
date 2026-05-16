package com.setalink.modules

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.net.VpnService
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.WritableNativeMap
import com.setalink.vpn.XrayVpnService

/**
 * TurboModule implementation of NativeXrayModule.ts spec.
 *
 * Currently a stub: start/stop drive the VPN service lifecycle;
 * getStats returns mock values until the Xray-core Go-mobile bridge is linked.
 *
 * To integrate real Xray:
 *   1. Add libXray.aar (or libxray.so) to android/app/libs/
 *   2. Call libXray.Libxray.startXray(config) inside startTunnel()
 *   3. Call libXray.Libxray.queryStats() inside getStats()
 */
class XrayModule(private val reactContext: ReactApplicationContext) :
    NativeXrayModuleSpec(reactContext) {

    companion object {
        const val NAME = "XrayModule"
    }

    private var running    = false
    private var startedAt  = 0L
    private val statsLock  = Any()

    // Mocked counters — replace with real Xray stats bridge
    private var uploadBytes   = 0L
    private var downloadBytes = 0L
    private var lastPingMs    = 24L

    private val vpnReceiver = object : BroadcastReceiver() {
        override fun onReceive(context: Context, intent: Intent) {
            when (intent.action) {
                XrayVpnService.BROADCAST_CONNECTED    -> { running = true;  startedAt = System.currentTimeMillis() }
                XrayVpnService.BROADCAST_DISCONNECTED -> { running = false }
            }
        }
    }

    init {
        val filter = IntentFilter().apply {
            addAction(XrayVpnService.BROADCAST_CONNECTED)
            addAction(XrayVpnService.BROADCAST_DISCONNECTED)
        }
        reactContext.registerReceiver(vpnReceiver, filter)
    }

    override fun getName(): String = NAME

    @ReactMethod
    override fun start(config: String, promise: Promise) {
        try {
            val permIntent = VpnService.prepare(reactContext)
            if (permIntent != null) {
                promise.reject("VPN_PERMISSION", "VPN permission not granted")
                return
            }
            val intent = Intent(reactContext, XrayVpnService::class.java).apply {
                action = XrayVpnService.ACTION_START
                putExtra(XrayVpnService.EXTRA_CONFIG, config)
            }
            reactContext.startForegroundService(intent)
            promise.resolve(null)
        } catch (e: Exception) {
            promise.reject("VPN_START_ERROR", e.message, e)
        }
    }

    @ReactMethod
    override fun stop(promise: Promise) {
        try {
            val intent = Intent(reactContext, XrayVpnService::class.java).apply {
                action = XrayVpnService.ACTION_STOP
            }
            reactContext.startService(intent)
            running = false
            promise.resolve(null)
        } catch (e: Exception) {
            promise.reject("VPN_STOP_ERROR", e.message, e)
        }
    }

    @ReactMethod
    override fun isRunning(promise: Promise) {
        promise.resolve(running)
    }

    @ReactMethod
    override fun getStats(promise: Promise) {
        synchronized(statsLock) {
            val uptime = if (startedAt > 0) (System.currentTimeMillis() - startedAt) / 1000 else 0L
            val map = WritableNativeMap().apply {
                putDouble("uploadBytes",   uploadBytes.toDouble())
                putDouble("downloadBytes", downloadBytes.toDouble())
                putDouble("pingMs",        lastPingMs.toDouble())
                putDouble("uptime",        uptime.toDouble())
            }
            promise.resolve(map)
        }
    }

    @ReactMethod
    override fun validateConfig(config: String, promise: Promise) {
        // Stub: accept any non-empty JSON string
        promise.resolve(config.trim().startsWith("{"))
    }

    override fun invalidate() {
        super.invalidate()
        try { reactContext.unregisterReceiver(vpnReceiver) } catch (_: Exception) {}
    }
}
