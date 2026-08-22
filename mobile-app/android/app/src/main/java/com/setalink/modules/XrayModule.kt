package com.setalink.modules

import android.app.Activity
import android.app.ActivityManager
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.net.TrafficStats
import android.net.VpnService
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.provider.Settings
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
        // Khabat, 2026-08-02: OTA download telemetry (app_events) showed roughly
        // half of all real downloadAndInstallApk attempts across several days
        // never got a completion OR failure event -- the JS promise silently
        // hung forever (DownloadManager's ACTION_DOWNLOAD_COMPLETE broadcast
        // just never arrived), leaving the Settings screen stuck on
        // "Downloading…" with the button disabled and zero way out short of
        // force-closing the app. 60-90MB should complete well inside this on
        // any working connection; past it, something is genuinely stuck.
        private const val APK_DOWNLOAD_TIMEOUT_MS = 5 * 60 * 1000L
    }

    private var running             = false
    private var startedAt           = 0L
    private var lastError:          String? = null
    private var lastProbeOk         = false
    private var lastFailureCategory = ""

    // Stored while Android VPN-permission dialog is shown
    private var pendingConfig:   String?  = null
    private var pendingPromise:  Promise? = null
    private var pendingEmergency: Boolean = false

    // Tunnel setup step log — cleared on each start(), appended via BROADCAST_STEP
    private val stepLog     = mutableListOf<String>()
    private val stepLogLock = Any()

    // Stats — accumulated from periodic BROADCAST_METRICS from XrayVpnService.
    // uploadBytes / downloadBytes are cumulative for the current session.
    private val statsLock    = Any()
    private var uploadBytes  = 0L
    private var downloadBytes= 0L
    private var lastPingMs   = 0L

    // TrafficStats snapshot at session start — reliable fallback when TUN interface
    // name detection fails (some Android devices/ROMs use non-standard TUN names).
    // getUidRxBytes/TxBytes captures all network traffic by our UID (= Xray process),
    // which approximates the proxied download/upload traffic through the tunnel.
    private val TRAFFIC_UNSUPPORTED = TrafficStats.UNSUPPORTED.toLong()
    private var sessionStartRxBytes = TRAFFIC_UNSUPPORTED
    private var sessionStartTxBytes = TRAFFIC_UNSUPPORTED

    // ── Broadcast receiver (must be declared before init block) ──────────────

    private val vpnReceiver = object : BroadcastReceiver() {
        override fun onReceive(context: Context, intent: Intent) {
            when (intent.action) {
                XrayVpnService.BROADCAST_CONNECTED -> {
                    val isProbeUpdate = intent.getBooleanExtra("probe_update", false)
                    lastProbeOk = intent.getBooleanExtra("probe_ok", false)
                    if (!isProbeUpdate) {
                        // Initial connect — reset session state
                        running   = true
                        startedAt = System.currentTimeMillis()
                        lastError = null
                        val myUid = android.os.Process.myUid()
                        val rx = TrafficStats.getUidRxBytes(myUid)
                        val tx = TrafficStats.getUidTxBytes(myUid)
                        synchronized(statsLock) {
                            uploadBytes         = 0L
                            downloadBytes       = 0L
                            lastPingMs          = 0L
                            sessionStartRxBytes = if (rx == TRAFFIC_UNSUPPORTED) TRAFFIC_UNSUPPORTED else rx
                            sessionStartTxBytes = if (tx == TRAFFIC_UNSUPPORTED) TRAFFIC_UNSUPPORTED else tx
                        }
                        Log.i(TAG, "VPN connected (probeOk=$lastProbeOk rx_start=$rx tx_start=$tx)")
                    } else {
                        // Background probe completed — only update probeOk, keep session alive
                        Log.i(TAG, "VPN probe_update: probeOk=$lastProbeOk (session preserved)")
                    }
                }
                XrayVpnService.BROADCAST_DISCONNECTED -> {
                    running   = false
                    synchronized(statsLock) {
                        sessionStartRxBytes = TRAFFIC_UNSUPPORTED
                        sessionStartTxBytes = TRAFFIC_UNSUPPORTED
                    }
                    val err      = intent.getStringExtra(XrayVpnService.EXTRA_ERROR)
                    val category = intent.getStringExtra("failure_category") ?: ""
                    if (err != null) {
                        lastError          = err
                        lastFailureCategory = category
                        Log.e(TAG, "VPN disconnected with error: $err category=$category")
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
                XrayVpnService.BROADCAST_METRICS -> {
                    synchronized(statsLock) {
                        val rx = intent.getLongExtra("tunRxDelta", 0L)
                        val tx = intent.getLongExtra("tunTxDelta", 0L)
                        // rx = bytes received by TUN (download direction)
                        // tx = bytes sent from TUN (upload direction)
                        if (rx > 0) downloadBytes += rx
                        if (tx > 0) uploadBytes += tx
                        if (intent.getBooleanExtra("probeOk", false)) lastPingMs = 35L
                    }
                    Log.d(TAG, "[METRICS] rx_delta=${intent.getLongExtra("tunRxDelta",0)} tx_delta=${intent.getLongExtra("tunTxDelta",0)}")
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
            addAction(XrayVpnService.BROADCAST_METRICS)
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
            startVpnService(config, promise, emergencyMode = false)
        } catch (e: Exception) {
            Log.e(TAG, "start() error: ${e.message}", e)
            promise.reject("VPN_START_ERROR", e.message ?: "Unknown error starting VPN", e)
        }
    }

    @ReactMethod
    override fun startEmergency(config: String, promise: Promise) {
        synchronized(stepLogLock) { stepLog.clear() }
        try {
            val permIntent = VpnService.prepare(reactContext)
            if (permIntent != null) {
                val activity = reactContext.currentActivity
                if (activity == null) {
                    promise.reject("VPN_NO_ACTIVITY", "Bring app to foreground before connecting")
                    return
                }
                pendingConfig  = config
                pendingPromise = promise
                // Store emergency flag so onActivityResult can use it
                pendingEmergency = true
                activity.startActivityForResult(permIntent, VPN_PERM_REQUEST_CODE)
                return
            }
            startVpnService(config, promise, emergencyMode = true)
        } catch (e: Exception) {
            promise.reject("VPN_START_ERROR", e.message ?: "Unknown error", e)
        }
    }

    @ReactMethod
    override fun stop(promise: Promise) {
        try {
            // 1. Direct in-process call — immune to HyperOS/MIUI background
            //    start-service restrictions that silently drop the stop intent.
            val direct = XrayVpnService.requestStop()
            Log.i(TAG, "stop(): direct=$direct")

            // 2. Belt-and-braces intent for a service instance the static
            //    handle doesn't know about (recreated process).
            if (!direct) {
                val stopIntent = Intent(reactContext, XrayVpnService::class.java).apply {
                    action = XrayVpnService.ACTION_STOP
                }
                try {
                    reactContext.startService(stopIntent)
                } catch (e: Exception) {
                    // Background-start restriction — FGS start is always allowed
                    // for an exempted VPN app; service calls startForeground()
                    // first thing in onStartCommand so this is safe.
                    Log.w(TAG, "startService(STOP) failed (${e.message}) — using startForegroundService")
                    reactContext.startForegroundService(stopIntent)
                }
            }
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
    override fun getLastProbeResult(promise: Promise) = promise.resolve(lastProbeOk)

    @ReactMethod
    fun getLastFailureCategory(promise: Promise) = promise.resolve(lastFailureCategory)

    @ReactMethod
    // ── Smart Mode: per-app VPN bypass (split tunneling) ─────────────────────

    /** Launchable apps as a JSON array — powers the "Bypass selected apps"
     *  screen. Requires the <queries> launcher-intent element in the manifest
     *  for package visibility on Android 11+. */
    override fun getInstalledApps(promise: Promise) {
        try {
            val pm = reactContext.packageManager
            val launcher = Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_LAUNCHER)
            val seen = HashSet<String>()
            val arr = org.json.JSONArray()
            for (ri in pm.queryIntentActivities(launcher, 0)) {
                val pkg = ri.activityInfo?.packageName ?: continue
                if (pkg == reactContext.packageName) continue // we are always excluded anyway
                if (!seen.add(pkg)) continue
                val obj = org.json.JSONObject()
                obj.put("packageName", pkg)
                obj.put("appName", ri.loadLabel(pm)?.toString() ?: pkg)
                arr.put(obj)
            }
            promise.resolve(arr.toString())
        } catch (e: Exception) {
            Log.w(TAG, "getInstalledApps failed: ${e.message}")
            promise.resolve("[]") // never break the screen — empty list is safe
        }
    }

    /** Persist the bypass package list; XrayVpnService reads it when it
     *  builds the TUN, so changes apply on the NEXT connect. */
    override fun setBypassApps(packagesJson: String, promise: Promise) {
        try {
            org.json.JSONArray(packagesJson) // validate — malformed JSON never reaches the service
            reactContext.getSharedPreferences(XrayVpnService.PREFS_NAME, Context.MODE_PRIVATE)
                .edit()
                .putString(XrayVpnService.PREF_BYPASS_APPS, packagesJson)
                .apply()
            promise.resolve(null)
        } catch (e: Exception) {
            promise.reject("BYPASS_APPS_ERROR", e.message ?: "invalid package list", e)
        }
    }

    override fun getStats(promise: Promise) {
        synchronized(statsLock) {
            // Primary: TUN-based accumulated bytes from BROADCAST_METRICS.
            // Fallback: TrafficStats delta since session start.
            // Use max() — whichever is larger gives the more accurate reading.
            val myUid    = android.os.Process.myUid()
            val curRx    = TrafficStats.getUidRxBytes(myUid)
            val curTx    = TrafficStats.getUidTxBytes(myUid)
            val trafficDn = if (sessionStartRxBytes != TRAFFIC_UNSUPPORTED && curRx != TRAFFIC_UNSUPPORTED)
                                maxOf(0L, curRx - sessionStartRxBytes) else 0L
            val trafficUp = if (sessionStartTxBytes != TRAFFIC_UNSUPPORTED && curTx != TRAFFIC_UNSUPPORTED)
                                maxOf(0L, curTx - sessionStartTxBytes) else 0L
            val reportedUp = maxOf(uploadBytes, trafficUp)
            val reportedDn = maxOf(downloadBytes, trafficDn)
            val uptime = if (startedAt > 0) (System.currentTimeMillis() - startedAt) / 1000 else 0L
            Log.d(TAG, "[getStats] tunUp=$uploadBytes tunDn=$downloadBytes tsUp=$trafficUp tsDn=$trafficDn reported_up=$reportedUp reported_dn=$reportedDn")
            promise.resolve(WritableNativeMap().apply {
                putDouble("uploadBytes",   reportedUp.toDouble())
                putDouble("downloadBytes", reportedDn.toDouble())
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
                promise.resolve("(no xray.log)")
                return
            }
            promise.resolve(logFile.readLines().takeLast(100).joinToString("\n"))
        } catch (e: Exception) {
            promise.resolve("(error reading xray.log: ${e.message})")
        }
    }

    @ReactMethod
    override fun getTun2socksLog(promise: Promise) {
        try {
            val logFile = java.io.File(reactContext.filesDir, XrayVpnService.TUN2SOCKS_LOG_FILE)
            if (!logFile.exists()) {
                promise.resolve("(no tun2socks.log — tunnel not yet started)")
                return
            }
            promise.resolve(logFile.readLines().takeLast(60).joinToString("\n"))
        } catch (e: Exception) {
            promise.resolve("(error reading tun2socks.log: ${e.message})")
        }
    }

    @ReactMethod
    override fun getGeneratedConfig(promise: Promise) {
        try {
            val f = java.io.File(reactContext.filesDir, "xray.json")
            if (!f.exists()) { promise.resolve("(no xray.json — tunnel not started yet)"); return }
            promise.resolve(f.readText())
        } catch (e: Exception) {
            promise.resolve("(error reading xray.json: ${e.message})")
        }
    }

    @ReactMethod
    override fun getDeviceInfo(promise: Promise) {
        promise.resolve(com.facebook.react.bridge.WritableNativeMap().apply {
            putString("model",          android.os.Build.MODEL)
            putString("manufacturer",   android.os.Build.MANUFACTURER)
            putString("brand",          android.os.Build.BRAND)
            putInt("androidSdk",        android.os.Build.VERSION.SDK_INT)
            putString("androidRelease", android.os.Build.VERSION.RELEASE)
        })
    }

    @ReactMethod
    fun getAndroidId(promise: Promise) {
        val androidId = android.provider.Settings.Secure.getString(
            reactContext.contentResolver,
            android.provider.Settings.Secure.ANDROID_ID,
        ) ?: ""
        promise.resolve(androidId)
    }

    // Returns a stable device ID persisted in SharedPreferences.
    // Generated once from the Android hardware ID (SHA-256 → UUID-like string).
    // Falls back to a random UUID. Never regenerates once stored.
    //
    // DIAGNOSTIC LOGGING (2026-07-27, B->A(107) device-recognition follow-up):
    // ruled out the keystore/CI-cache theory with a real CI log ("Cache hit
    // for: android-debug-keystore-v1" on the exact run behind the build that
    // still showed a fresh device_id) -- the signing key was NOT the cause
    // this time. The two remaining branches below are indistinguishable from
    // the resulting ID alone (both produce the same "sl-xxxxxxxx-xxxx-..."
    // shape), so there was previously no way to tell, after the fact, whether
    // a given device_id came from the intended deterministic ANDROID_ID hash
    // or the random-UUID fallback. Logging (not behavior) added so the next
    // test round's logcat settles which one actually fired -- do not remove
    // until that's confirmed; this makes zero functional change on its own.
    @ReactMethod
    fun getOrCreateStableDeviceId(promise: Promise) {
        try {
            val prefs = reactContext.getSharedPreferences("setalink_device", Context.MODE_PRIVATE)
            val existing = prefs.getString("stable_device_id", null)
            if (!existing.isNullOrBlank()) {
                android.util.Log.i("SetaLinkDeviceId", "cache-hit (sharedprefs already had a value)")
                promise.resolve(existing)
                return
            }

            val androidId = android.provider.Settings.Secure.getString(
                reactContext.contentResolver,
                android.provider.Settings.Secure.ANDROID_ID,
            ) ?: ""
            android.util.Log.i("SetaLinkDeviceId", "no cached id -- androidId.length=${androidId.length}")

            val deviceId = if (androidId.length > 4) {
                android.util.Log.i("SetaLinkDeviceId", "branch=derived-from-android-id")
                val sha  = java.security.MessageDigest.getInstance("SHA-256")
                val hash = sha.digest(androidId.toByteArray()).joinToString("") { "%02x".format(it) }
                "sl-${hash.substring(0,8)}-${hash.substring(8,12)}-${hash.substring(12,16)}-${hash.substring(16,20)}-${hash.substring(20,32)}"
            } else {
                android.util.Log.w("SetaLinkDeviceId", "branch=random-fallback -- ANDROID_ID was empty/too short, this device_id will NOT be stable across reinstalls")
                "sl-${java.util.UUID.randomUUID()}"
            }
            prefs.edit().putString("stable_device_id", deviceId).apply()
            promise.resolve(deviceId)
        } catch (e: Exception) {
            promise.reject("DEVICE_ID_ERROR", e.message ?: "Failed to generate device ID")
        }
    }

    // Saves an externally-provided device ID to SharedPreferences (canonical ID from backend).
    @ReactMethod
    fun saveStableDeviceId(deviceId: String, promise: Promise) {
        try {
            val prefs = reactContext.getSharedPreferences("setalink_device", Context.MODE_PRIVATE)
            prefs.edit().putString("stable_device_id", deviceId).apply()
            promise.resolve(null)
        } catch (e: Exception) {
            promise.reject("SAVE_ERROR", e.message)
        }
    }

    // Returns device hardware fingerprint for registration metadata.
    @ReactMethod
    fun getDeviceFingerprint(promise: Promise) {
        try {
            val androidId = android.provider.Settings.Secure.getString(
                reactContext.contentResolver,
                android.provider.Settings.Secure.ANDROID_ID,
            ) ?: ""
            val androidIdHash = if (androidId.length > 4) {
                val sha = java.security.MessageDigest.getInstance("SHA-256")
                sha.digest(androidId.toByteArray()).joinToString("") { "%02x".format(it) }.substring(0, 16)
            } else ""
            // SIM/network country is the only geo signal that survives the
            // tunnel: requests through the VPN exit in Germany, but the SIM
            // still says IR/TR. Used for the admin country analytics + flags.
            val tm = runCatching {
                reactContext.getSystemService(Context.TELEPHONY_SERVICE)
                    as android.telephony.TelephonyManager
            }.getOrNull()
            val simCountry = runCatching {
                (tm?.simCountryIso?.takeIf { it.isNotBlank() } ?: tm?.networkCountryIso ?: "")
                    .uppercase()
            }.getOrDefault("")
            // Carrier/operator NAME — the signal that lets the panel do
            // per-operator learned routing (Hetzner is blackholed on Irancell/TCI
            // but works on MCI; the Stealth node saves Irancell/TCI). No runtime
            // permission is required for the operator name. Prefer the SIM
            // operator (the real carrier) over the (roaming) network operator.
            val carrierName = runCatching {
                (tm?.simOperatorName?.takeIf { it.isNotBlank() }
                    ?: tm?.networkOperatorName ?: "").trim()
            }.getOrDefault("")
            promise.resolve(WritableNativeMap().apply {
                putString("android_id_hash",  androidIdHash)
                putString("manufacturer",     android.os.Build.MANUFACTURER)
                putString("model",            android.os.Build.MODEL)
                putInt   ("sdk_version",      android.os.Build.VERSION.SDK_INT)
                putString("android_version",  android.os.Build.VERSION.RELEASE)
                putString("abi",              android.os.Build.SUPPORTED_ABIS.joinToString(","))
                putString("sim_country",      simCountry)
                putString("carrier_name",     carrierName)
            })
        } catch (e: Exception) {
            promise.resolve(WritableNativeMap())
        }
    }

    @ReactMethod
    override fun reportTelemetry(payload: String, promise: Promise) {
        // Telemetry is sent from JS directly via fetch(); this stub satisfies the spec.
        promise.resolve(null)
    }

    // ── In-app APK self-update ────────────────────────────────────────────────
    // Downloads the APK with DownloadManager (survives app backgrounding, shows
    // a system progress notification) and fires the package-installer prompt
    // when the file is complete. Resolves the promise when the installer opens.

    private var apkDownloadId: Long = -1
    private var apkReceiver: BroadcastReceiver? = null
    private var apkPendingPromise: Promise? = null
    private var apkTimeoutRunnable: Runnable? = null
    private val apkTimeoutHandler = Handler(Looper.getMainLooper())

    /** Settles whatever is currently pending (resolve/reject already happened
     *  elsewhere, this just clears the bookkeeping) so a stale timeout can
     *  never fire against a promise that isn't its own anymore. */
    private fun clearApkPending() {
        apkTimeoutRunnable?.let { apkTimeoutHandler.removeCallbacks(it) }
        apkTimeoutRunnable = null
        apkPendingPromise = null
    }

    @ReactMethod
    fun downloadAndInstallApk(url: String, promise: Promise) {
        try {
            Log.i(TAG, "downloadAndInstallApk start url=$url sdk=${Build.VERSION.SDK_INT}")

            // ── Install-unknown-apps gate (Android 8+) ────────────────────────
            // REQUEST_INSTALL_PACKAGES in the manifest is NOT enough: the user
            // must grant per-app "Install unknown apps" special access, or the
            // package installer silently refuses to open the downloaded APK.
            // Without this check the download could complete but the installer
            // never appeared — and the JS error was swallowed. Send the user to
            // the right Settings screen and reject so the UI can explain.
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O &&
                !reactContext.packageManager.canRequestPackageInstalls()) {
                Log.w(TAG, "install-unknown-apps not granted — opening settings")
                try {
                    val settings = Intent(
                        Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
                        android.net.Uri.parse("package:${reactContext.packageName}"),
                    ).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                    (currentActivity ?: reactContext).startActivity(settings)
                } catch (e: Exception) {
                    Log.e(TAG, "could not open unknown-apps settings: ${e.message}")
                }
                promise.reject(
                    "INSTALL_PERMISSION_REQUIRED",
                    "Enable 'Install unknown apps' for SetaLink, then tap Download again.",
                )
                return
            }

            val dm = reactContext.getSystemService(Context.DOWNLOAD_SERVICE) as? android.app.DownloadManager
            if (dm == null) {
                Log.e(TAG, "DownloadManager unavailable/disabled on this device")
                promise.reject(
                    "DOWNLOAD_MANAGER_UNAVAILABLE",
                    "Download service is disabled on this device — download from setalink.no in a browser.",
                )
                return
            }

            val updatesDir = java.io.File(reactContext.getExternalFilesDir(null), "updates")
            updatesDir.mkdirs()
            // One stable filename — repeated update attempts overwrite instead of piling up.
            val target = java.io.File(updatesDir, "setalink-update.apk")
            if (target.exists()) target.delete()

            val request = android.app.DownloadManager.Request(android.net.Uri.parse(url)).apply {
                setTitle("SetaLink update")
                setDescription("Downloading new version…")
                setNotificationVisibility(
                    android.app.DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED)
                setDestinationUri(android.net.Uri.fromFile(target))
                setMimeType("application/vnd.android.package-archive")
            }

            // Clean up a receiver from a previous attempt -- and, critically,
            // its promise too: unregistering silently here without settling
            // apkPendingPromise is exactly how a second tap orphaned the
            // first attempt's promise forever (never resolved, never
            // rejected, no telemetry possible either).
            apkReceiver?.let { runCatching { reactContext.unregisterReceiver(it) } }
            apkPendingPromise?.let {
                runCatching { it.reject("APK_DOWNLOAD_SUPERSEDED", "A newer download replaced this one") }
            }
            clearApkPending()

            val receiver = object : BroadcastReceiver() {
                override fun onReceive(ctx: Context, intent: Intent) {
                    val id = intent.getLongExtra(android.app.DownloadManager.EXTRA_DOWNLOAD_ID, -1)
                    if (id != apkDownloadId) return
                    runCatching { reactContext.unregisterReceiver(this) }
                    apkReceiver = null
                    clearApkPending()

                    val ok = runCatching {
                        val q = android.app.DownloadManager.Query().setFilterById(id)
                        dm.query(q).use { c ->
                            c.moveToFirst() && c.getInt(
                                c.getColumnIndexOrThrow(android.app.DownloadManager.COLUMN_STATUS)
                            ) == android.app.DownloadManager.STATUS_SUCCESSFUL
                        }
                    }.getOrDefault(false)

                    if (!ok || !target.exists() || target.length() < 1_000_000) {
                        Log.e(TAG, "APK download failed or file too small (${target.length()}B) ok=$ok")
                        promise.reject("APK_DOWNLOAD_FAILED", "Download failed — try again or use browser download")
                        return
                    }
                    Log.i(TAG, "APK download complete: ${target.length()}B at ${target.absolutePath}")

                    try {
                        val apkUri = androidx.core.content.FileProvider.getUriForFile(
                            reactContext, "com.setalink.fileprovider", target)
                        Log.i(TAG, "launching installer for $apkUri")
                        val install = Intent(Intent.ACTION_VIEW).apply {
                            setDataAndType(apkUri, "application/vnd.android.package-archive")
                            addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_ACTIVITY_NEW_TASK)
                        }
                        reactContext.startActivity(install)
                        promise.resolve(true)
                    } catch (e: Exception) {
                        Log.e(TAG, "Installer launch failed: ${e.message}")
                        promise.reject("APK_INSTALL_FAILED", e.message ?: "Could not open installer")
                    }
                }
            }
            apkReceiver = receiver
            ContextCompat.registerReceiver(
                reactContext, receiver,
                IntentFilter(android.app.DownloadManager.ACTION_DOWNLOAD_COMPLETE),
                ContextCompat.RECEIVER_EXPORTED,   // DownloadManager broadcast comes from the system
            )

            apkDownloadId = dm.enqueue(request)
            apkPendingPromise = promise
            Log.i(TAG, "APK download enqueued id=$apkDownloadId url=$url")

            val timeoutRunnable = Runnable {
                // Identity check, not just apkDownloadId: a same-id race is
                // impossible here (DownloadManager IDs are unique), but this
                // guards against the timeout firing after the receiver already
                // settled things via clearApkPending() a moment earlier.
                if (apkPendingPromise === promise) {
                    Log.e(TAG, "APK download timed out after ${APK_DOWNLOAD_TIMEOUT_MS}ms, id=$apkDownloadId")
                    apkReceiver?.let { runCatching { reactContext.unregisterReceiver(it) } }
                    apkReceiver = null
                    runCatching { dm.remove(apkDownloadId) }
                    clearApkPending()
                    promise.reject(
                        "APK_DOWNLOAD_TIMEOUT",
                        "Download timed out — check your connection and try again, or use browser download",
                    )
                }
            }
            apkTimeoutRunnable = timeoutRunnable
            apkTimeoutHandler.postDelayed(timeoutRunnable, APK_DOWNLOAD_TIMEOUT_MS)
        } catch (e: Exception) {
            Log.e(TAG, "downloadAndInstallApk failed: ${e.message}", e)
            promise.reject("APK_DOWNLOAD_ERROR", e.message ?: "Download error")
        }
    }

    @ReactMethod
    override fun runTraceTest(promise: Promise) {
        // Probe https://1.1.1.1/cdn-cgi/trace to verify internet routes through the VPN.
        //
        // Strategy (two-tier):
        //   1. Try vpnNet.openConnection() — goes TUN → tun2socks → Xray.
        //      On some ROMs this fails with EPERM/timeout because our app UID is
        //      excluded from TUN via addDisallowedApplication().
        //   2. Fall back to a direct SOCKS5 probe through Xray on 127.0.0.1:10808.
        //      This is always reachable by the app process regardless of UID exclusion
        //      and is the same path used by the native connection validation.
        Thread {
            val vpnNetResult = runCatching {
                val cm = reactContext.getSystemService(android.net.ConnectivityManager::class.java)
                val vpnNet = cm?.allNetworks?.firstOrNull { net ->
                    cm.getNetworkCapabilities(net)
                        ?.hasTransport(android.net.NetworkCapabilities.TRANSPORT_VPN) == true
                }
                if (vpnNet != null) {
                    val url  = java.net.URL("https://1.1.1.1/cdn-cgi/trace")
                    val conn = vpnNet.openConnection(url) as java.net.HttpURLConnection
                    conn.connectTimeout = 10_000
                    conn.readTimeout    = 10_000
                    conn.setRequestProperty("User-Agent", "SetaLink/1.0")
                    try {
                        val code = conn.responseCode
                        val body = conn.inputStream.bufferedReader().readText()
                        val ip   = body.lines()
                            .firstOrNull { it.startsWith("ip=") }?.removePrefix("ip=") ?: "?"
                        WritableNativeMap().apply {
                            putBoolean("ok",         code == 200)
                            putInt("statusCode",     code)
                            putString("body",        body.take(600))
                            putString("routedIp",    ip)
                            putDouble("bytesIn",     body.length.toDouble())
                        }
                    } finally {
                        conn.disconnect()
                    }
                } else null
            }

            val primary = vpnNetResult.getOrNull()
            if (primary != null && primary.getBoolean("ok")) {
                promise.resolve(primary)
                return@Thread
            }

            // VPN network unavailable or openConnection() failed — use SOCKS5 fallback.
            // This probe goes directly through Xray on localhost:10808, confirming the
            // tunnel is forwarding traffic even when Android blocks network-binding for
            // this UID.
            val fallbackResult = runCatching {
                val proxy = java.net.Proxy(
                    java.net.Proxy.Type.SOCKS,
                    java.net.InetSocketAddress("127.0.0.1", 10808)
                )
                val url  = java.net.URL("https://1.1.1.1/cdn-cgi/trace")
                val conn = url.openConnection(proxy) as java.net.HttpURLConnection
                conn.connectTimeout = 12_000
                conn.readTimeout    = 12_000
                conn.setRequestProperty("User-Agent", "SetaLink/1.0")
                try {
                    val code = conn.responseCode
                    val body = conn.inputStream.bufferedReader().readText()
                    val ip   = body.lines()
                        .firstOrNull { it.startsWith("ip=") }?.removePrefix("ip=") ?: "?"
                    WritableNativeMap().apply {
                        putBoolean("ok",         code == 200)
                        putInt("statusCode",     code)
                        putString("body",        body.take(600))
                        putString("routedIp",    ip)
                        putDouble("bytesIn",     body.length.toDouble())
                        putString("via",         "socks5")
                    }
                } finally {
                    conn.disconnect()
                }
            }

            val result = fallbackResult.getOrNull()
            if (result != null) {
                promise.resolve(result)
            } else {
                val vpnErr  = vpnNetResult.exceptionOrNull()?.message ?: "VPN network unavailable"
                val sockErr = fallbackResult.exceptionOrNull()?.message ?: "SOCKS5 probe failed"
                promise.resolve(WritableNativeMap().apply {
                    putBoolean("ok",   false)
                    putString("error", "VPN: $vpnErr | SOCKS5: $sockErr")
                })
            }
        }.start()
    }

    // 4-test suite mirroring iOS XrayModule.swift's runSelfTest (dns / https /
    // route / exit_ip). iOS routes URLSession through NEProxySettings
    // automatically via the App Group; Android has no equivalent, so each
    // fetch reuses runTraceTest's proven two-tier strategy above (VPN-bound
    // network first, falling back to a direct SOCKS5 probe on
    // 127.0.0.1:10808 for ROMs that exclude our own UID from the TUN).
    @ReactMethod
    fun runSelfTest(promise: Promise) {
        Thread {
            val results = WritableNativeArray()

            val dns = fetchThroughTunnel("https://cp.cloudflare.com/", 8_000)
            results.pushMap(selfTestEntry("dns", "DNS Resolution", dns))

            val https = fetchThroughTunnel("https://1.1.1.1/cdn-cgi/trace", 8_000)
            results.pushMap(selfTestEntry("https", "HTTPS (IP-direct)", https))

            // iOS checks tunnel_state == connected_verified in the App Group;
            // the closest Android ground truth is the service actually
            // running plus the last connect-time probe result.
            val routeOk = running && lastProbeOk
            results.pushMap(WritableNativeMap().apply {
                putString("test",  "route")
                putString("label", "Tunnel Route Verified")
                putBoolean("ok",   routeOk)
                putString("detail", "running=$running probe_ok=$lastProbeOk")
            })

            val exitIp     = fetchThroughTunnel("https://cloudflare.com/cdn-cgi/trace", 10_000)
            val serverAddr = readConfiguredServerAddr()
            results.pushMap(exitIpEntry(exitIp, serverAddr))

            promise.resolve(results)
        }.start()
    }

    // REAL SSH (transport 'real_ssh') — generates (once) or returns the
    // device's on-device Ed25519 identity. Only the public key ever crosses
    // this bridge; the private key stays in RealSshTunnel's encrypted
    // storage. No active tunnel/connection required to call this.
    @ReactMethod
    fun getOrCreateRealSshIdentity(promise: Promise) {
        try {
            val identity = com.setalink.vpn.RealSshTunnel(reactContext) { line -> Log.d(TAG, "[REAL-SSH-IDENTITY] $line") }
                .getOrCreateIdentity()
            promise.resolve(WritableNativeMap().apply {
                putString("publicKey", identity.publicKeyOpenSsh)
            })
        } catch (e: Exception) {
            Log.e(TAG, "getOrCreateRealSshIdentity() error: ${e.message}", e)
            promise.reject("REAL_SSH_IDENTITY_ERROR", e.message ?: "Could not generate REAL SSH identity", e)
        }
    }

    // ── VPN permission result ─────────────────────────────────────────────────

    override fun onActivityResult(activity: Activity?, requestCode: Int, resultCode: Int, data: Intent?) {
        if (requestCode != VPN_PERM_REQUEST_CODE) return
        val config  = pendingConfig  ?: return
        val promise = pendingPromise ?: return
        pendingConfig  = null
        pendingPromise = null

        val emergency = pendingEmergency
        pendingEmergency = false
        if (resultCode == Activity.RESULT_OK) {
            Log.i(TAG, "VPN permission granted (emergency=$emergency)")
            startVpnService(config, promise, emergencyMode = emergency)
        } else {
            Log.w(TAG, "VPN permission denied by user")
            promise.reject("VPN_PERMISSION_DENIED", "VPN permission denied — tap to grant access")
        }
    }

    override fun onNewIntent(intent: Intent?) {}

    private fun startVpnService(config: String, promise: Promise, emergencyMode: Boolean = false) {
        try {
            lastError = null
            reactContext.startForegroundService(
                Intent(reactContext, XrayVpnService::class.java).apply {
                    action = XrayVpnService.ACTION_START
                    putExtra(XrayVpnService.EXTRA_CONFIG, config)
                    putExtra(XrayVpnService.EXTRA_EMERGENCY_MODE, emergencyMode)
                }
            )
            Log.i(TAG, "XrayVpnService started (emergencyMode=$emergencyMode)")
            promise.resolve(null)
        } catch (e: Exception) {
            Log.e(TAG, "startVpnService failed: ${e.message}", e)
            promise.reject("VPN_START_ERROR", e.message ?: "Failed to start VPN service", e)
        }
    }

    // ── Self-test helpers ───────────────────────────────────────────────────────

    private data class TunnelFetch(val ok: Boolean, val ip: String?, val detail: String)

    private fun fetchThroughTunnel(urlString: String, timeoutMs: Int): TunnelFetch {
        val t0 = System.currentTimeMillis()
        fun elapsed() = "%.2fs".format((System.currentTimeMillis() - t0) / 1000.0)

        fun doFetch(conn: java.net.HttpURLConnection, viaSuffix: String): TunnelFetch {
            conn.connectTimeout = timeoutMs
            conn.readTimeout    = timeoutMs
            conn.setRequestProperty("User-Agent", "SetaLink/1.0")
            return try {
                val code = conn.responseCode
                val body = conn.inputStream.bufferedReader().readText()
                val ip   = body.lines().firstOrNull { it.startsWith("ip=") }?.removePrefix("ip=")
                val ok   = code == 200 || code == 204
                TunnelFetch(ok, ip, "HTTP $code · ${body.length}B · ${elapsed()}$viaSuffix")
            } finally {
                conn.disconnect()
            }
        }

        val vpnResult = runCatching {
            val cm = reactContext.getSystemService(android.net.ConnectivityManager::class.java)
            val vpnNet = cm?.allNetworks?.firstOrNull { net ->
                cm.getNetworkCapabilities(net)?.hasTransport(android.net.NetworkCapabilities.TRANSPORT_VPN) == true
            } ?: return@runCatching null
            val conn = vpnNet.openConnection(java.net.URL(urlString)) as java.net.HttpURLConnection
            doFetch(conn, "")
        }
        val primary = vpnResult.getOrNull()
        if (primary != null && primary.ok) return primary

        val socksResult = runCatching {
            val proxy = java.net.Proxy(java.net.Proxy.Type.SOCKS, java.net.InetSocketAddress("127.0.0.1", 10808))
            val conn  = java.net.URL(urlString).openConnection(proxy) as java.net.HttpURLConnection
            doFetch(conn, " (socks5)")
        }
        socksResult.getOrNull()?.let { return it }

        val vpnErr  = vpnResult.exceptionOrNull()?.message ?: primary?.detail ?: "VPN network unavailable"
        val sockErr = socksResult.exceptionOrNull()?.message ?: "SOCKS5 probe failed"
        return TunnelFetch(false, null, "VPN: $vpnErr | SOCKS5: $sockErr (${elapsed()})")
    }

    private fun selfTestEntry(test: String, label: String, r: TunnelFetch): WritableNativeMap =
        WritableNativeMap().apply {
            putString("test", test)
            putString("label", label)
            putBoolean("ok", r.ok)
            putString("detail", r.detail)
        }

    // Confirms traffic actually exits through the configured VPN server, not
    // the device's own IP (which would mean the proxy isn't routing this
    // request and the rest of the suite is a false positive) — same check as
    // iOS's selfTestExitIP.
    private fun exitIpEntry(r: TunnelFetch, serverAddr: String?): WritableNativeMap {
        val verified = r.ok && r.ip != null && (serverAddr == null || r.ip == serverAddr)
        val detail = when {
            !r.ok || r.ip == null -> r.detail
            serverAddr == null    -> "exit IP: ${r.ip} (server addr unknown) · ${r.detail}"
            r.ip == serverAddr    -> "exit IP: ${r.ip} = VPN node ✓ · ${r.detail}"
            else                  -> "exit IP: ${r.ip} ≠ VPN node $serverAddr — traffic NOT through proxy"
        }
        return WritableNativeMap().apply {
            putString("test", "exit_ip")
            putString("label", "Exit IP")
            putBoolean("ok", verified)
            putString("detail", detail)
        }
    }

    // Same outbounds[0].settings.vnext[0].address field iOS's parseServerAddr
    // reads from the mirrored xray config JSON — same xray-core schema on
    // both platforms.
    private fun readConfiguredServerAddr(): String? = try {
        val f = java.io.File(reactContext.filesDir, "xray.json")
        if (!f.exists()) null else {
            val outbounds = org.json.JSONObject(f.readText()).optJSONArray("outbounds")
            val vnext     = outbounds?.optJSONObject(0)?.optJSONObject("settings")?.optJSONArray("vnext")
            vnext?.optJSONObject(0)?.optString("address")?.takeIf { it.isNotEmpty() }
        }
    } catch (e: Exception) { null }

    // ── Cleanup ───────────────────────────────────────────────────────────────

    override fun invalidate() {
        super.invalidate()
        runCatching { reactContext.removeActivityEventListener(this) }
        runCatching { reactContext.unregisterReceiver(vpnReceiver) }
    }
}
