package com.setalink.vpn

import android.content.Intent
import android.content.pm.ServiceInfo
import android.net.VpnService
import android.os.Build
import android.os.IBinder
import android.os.ParcelFileDescriptor
import android.util.Log
import com.setalink.notification.NotificationHelper
import kotlinx.coroutines.*
import java.io.File
import java.net.Socket

class XrayVpnService : VpnService() {

    companion object {
        private const val TAG         = "XrayVpnService"
        private const val BINARY_VER  = "xray-26.3.27+t2s-2.6.0" // bump when updating assets

        const val ACTION_START = "com.setalink.vpn.START"
        const val ACTION_STOP  = "com.setalink.vpn.STOP"
        const val EXTRA_CONFIG = "config_json"

        const val BROADCAST_CONNECTED    = "com.setalink.vpn.CONNECTED"
        const val BROADCAST_DISCONNECTED = "com.setalink.vpn.DISCONNECTED"
        const val BROADCAST_STEP         = "com.setalink.vpn.STEP"
        const val EXTRA_ERROR            = "error_message"
        const val EXTRA_STEP             = "step_name"
        const val EXTRA_STEP_OK          = "step_ok"
        const val EXTRA_STEP_MSG         = "step_msg"
    }

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private var tunFd:          ParcelFileDescriptor? = null
    private var xrayProcess:    Process?              = null
    private var tun2socksProc:  Process?              = null

    // ── Lifecycle ─────────────────────────────────────────────────────────────

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        when (intent?.action) {
            ACTION_START -> {
                val config = intent.getStringExtra(EXTRA_CONFIG)
                    ?: return broadcastError("No config provided").let { START_NOT_STICKY }
                val notification = NotificationHelper.buildConnected(this)
                // Android 14 (API 34) enforces that startForeground() must include the type
                // declared in the manifest — omitting it throws MissingForegroundServiceTypeException.
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
                    startForeground(
                        NotificationHelper.NOTIFICATION_ID,
                        notification,
                        ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE
                    )
                } else {
                    startForeground(NotificationHelper.NOTIFICATION_ID, notification)
                }
                scope.launch { establishTunnel(config) }
            }
            ACTION_STOP -> tearDownTunnel()
        }
        return START_NOT_STICKY
    }

    override fun onDestroy() {
        super.onDestroy()
        scope.cancel()
        tearDownTunnel()
    }

    override fun onRevoke() {
        tearDownTunnel()
        super.onRevoke()
    }

    override fun onBind(intent: Intent?): IBinder? = null

    // ── Tunnel setup ──────────────────────────────────────────────────────────

    private suspend fun establishTunnel(configJson: String) {
        try {
            // 1. Extract binaries from assets (cached by version stamp)
            broadcastStep("binaries", true, "Extracting Xray + tun2socks (ver=$BINARY_VER)")
            val xrayBin     = extractBinary("xray-arm64",     "xray")
            val tun2sockBin = extractBinary("tun2socks-arm64","tun2socks")

            // 2. Write Xray config to disk
            val configFile = File(filesDir, "xray.json")
            configFile.writeText(configJson)
            broadcastStep("config", true, "Config written to disk")

            // 3. Start Xray subprocess
            broadcastStep("xray_start", true, "Starting Xray process")
            xrayProcess = ProcessBuilder(xrayBin.absolutePath, "run", "-c", configFile.absolutePath)
                .redirectErrorStream(true)
                .start()
            scope.launch { streamLog(xrayProcess!!, "Xray") }

            // 4. Wait up to 8 s for Xray SOCKS5 to open
            if (!waitForPort(10808, 8_000)) {
                broadcastStep("xray_socks5", false, "SOCKS5 port 10808 not ready — check UUID/server config")
                throw Exception("Xray failed to open SOCKS5 port within 8 s — check server config or UUID")
            }
            broadcastStep("xray_socks5", true, "SOCKS5 listening on :10808")

            // 5. Build TUN — route everything through tunnel, exclude own app at OS level
            val builder = Builder()
                .setSession("SetaLink")
                .addAddress("10.0.0.2", 24)
                .addAddress("fdfe:dcba:9876::2", 64)   // IPv6 TUN address
                .addDnsServer("1.1.1.1")
                .addDnsServer("8.8.8.8")
                .addDnsServer("2606:4700:4700::1111")   // Cloudflare IPv6 DNS
                .setMtu(1500)
                .addRoute("0.0.0.0", 0)
                .addDisallowedApplication(packageName)  // Xray/tun2socks subprocesses inherit our UID

            // Full IPv6 route
            try { builder.addRoute("::", 0) } catch (_: Exception) {}

            // Unmetered so Android doesn't throttle the VPN interface (API 29+)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                builder.setMetered(false)
            }

            tunFd = builder.establish()
                ?: throw Exception("Failed to establish TUN interface — VPN permission missing?")
            val tunFdInt    = tunFd!!.fd
            // Use /proc/PID/fd/N instead of fd://N so tun2socks opens the fd by filesystem path.
            // This avoids the FD_CLOEXEC inheritance problem entirely — the child process opens
            // the fd itself via the proc symlink rather than inheriting it across exec().
            val procFdPath  = "/proc/${android.os.Process.myPid()}/fd/$tunFdInt"
            broadcastStep("tun", true, "TUN established fd=$tunFdInt (app=$packageName excluded from tunnel)")

            // 6. Start tun2socks (bridges TUN ↔ Xray SOCKS5)
            broadcastStep("tun2socks_start", true, "Starting tun2socks $procFdPath → socks5://127.0.0.1:10808")
            tun2socksProc = ProcessBuilder(
                tun2sockBin.absolutePath,
                "--device", procFdPath,
                "--proxy",  "socks5://127.0.0.1:10808",
                "--loglevel", "warn"
            ).redirectErrorStream(true).start()
            scope.launch { streamLog(tun2socksProc!!, "tun2socks") }

            // Give tun2socks a moment to attach to the fd
            delay(1200)

            if (!tun2socksProc!!.isAlive) {
                val exitCode = tun2socksProc!!.exitValue()
                broadcastStep("tun2socks_alive", false, "Exited immediately (code=$exitCode)")
                throw Exception("tun2socks exited immediately (code=$exitCode) — TUN fd may not have been inherited")
            }
            broadcastStep("tun2socks_alive", true, "tun2socks running — tunnel active")

            Log.i(TAG, "VPN tunnel active")
            sendBroadcast(Intent(BROADCAST_CONNECTED).setPackage(packageName))

            // 7. Watch for process death
            scope.launch {
                while (isActive) {
                    delay(3_000)
                    val xAlive = xrayProcess?.isAlive == true
                    val tAlive = tun2socksProc?.isAlive == true
                    if (!xAlive || !tAlive) {
                        Log.e(TAG, "Process died: xray=$xAlive tun2socks=$tAlive")
                        broadcastError("VPN process died unexpectedly")
                        tearDownTunnel()
                        break
                    }
                }
            }

        } catch (e: Exception) {
            Log.e(TAG, "Tunnel setup failed: ${e.message}", e)
            broadcastError(e.message ?: "Unknown VPN error")
            tearDownTunnel()
        }
    }

    // ── Teardown ──────────────────────────────────────────────────────────────

    private fun tearDownTunnel() {
        xrayProcess?.destroy();   xrayProcess   = null
        tun2socksProc?.destroy(); tun2socksProc = null
        try { tunFd?.close() } catch (_: Exception) {}
        tunFd = null
        sendBroadcast(Intent(BROADCAST_DISCONNECTED).setPackage(packageName))
        stopForeground(STOP_FOREGROUND_REMOVE)
        stopSelf()
    }

    private fun broadcastError(msg: String) {
        sendBroadcast(Intent(BROADCAST_DISCONNECTED).apply {
            setPackage(packageName)
            putExtra(EXTRA_ERROR, msg)
        })
    }

    private fun broadcastStep(step: String, ok: Boolean, msg: String) {
        sendBroadcast(Intent(BROADCAST_STEP).apply {
            setPackage(packageName)
            putExtra(EXTRA_STEP, step)
            putExtra(EXTRA_STEP_OK, ok)
            putExtra(EXTRA_STEP_MSG, msg)
        })
        Log.i(TAG, "[STEP] $step=${if (ok) "OK" else "FAIL"} — $msg")
    }

    // ── Utilities ─────────────────────────────────────────────────────────────

    private fun extractBinary(assetName: String, outName: String): File {
        val outFile   = File(filesDir, outName)
        val stampFile = File(filesDir, "$outName.ver")
        if (!outFile.exists() || stampFile.readTextOrEmpty() != BINARY_VER) {
            Log.i(TAG, "Extracting asset: $assetName")
            assets.open(assetName).use { src ->
                outFile.outputStream().use { dst -> src.copyTo(dst) }
            }
            outFile.setExecutable(true, false)
            stampFile.writeText(BINARY_VER)
        }
        return outFile
    }

    private fun File.readTextOrEmpty() = try { readText() } catch (_: Exception) { "" }

    private suspend fun waitForPort(port: Int, timeoutMs: Long): Boolean {
        val deadline = System.currentTimeMillis() + timeoutMs
        while (System.currentTimeMillis() < deadline) {
            try { Socket("127.0.0.1", port).use { return true } } catch (_: Exception) {}
            delay(250)
        }
        return false
    }

    private fun streamLog(process: Process, label: String) {
        try {
            process.inputStream.bufferedReader().forEachLine { line ->
                Log.d("$TAG/$label", line)
            }
        } catch (_: Exception) {}
    }
}
