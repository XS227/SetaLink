package com.setalink.vpn

import android.content.Intent
import android.net.VpnService
import android.os.IBinder
import android.os.ParcelFileDescriptor
import android.system.OsConstants
import android.util.Log
import com.setalink.notification.NotificationHelper
import kotlinx.coroutines.*
import org.json.JSONObject
import java.io.File
import java.net.Inet4Address
import java.net.InetAddress
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
                startForeground(
                    NotificationHelper.NOTIFICATION_ID,
                    NotificationHelper.buildConnected(this)
                )
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

            // 2. Parse server address for split routing
            val serverAddr = parseServerAddress(configJson)
                ?: throw Exception("Cannot parse server address from config")
            broadcastStep("resolve", true, "Server: $serverAddr")

            val serverIp = withContext(Dispatchers.IO) {
                runCatching { InetAddress.getByName(serverAddr).hostAddress }.getOrNull()
            }
            broadcastStep("dns", serverIp != null, "Resolved: ${serverIp ?: "failed"}")

            // 3. Write Xray config to disk
            val configFile = File(filesDir, "xray.json")
            configFile.writeText(configJson)
            broadcastStep("config", true, "Config written to disk")

            // 4. Start Xray subprocess
            broadcastStep("xray_start", true, "Starting Xray process")
            xrayProcess = ProcessBuilder(xrayBin.absolutePath, "run", "-c", configFile.absolutePath)
                .redirectErrorStream(true)
                .start()
            scope.launch { streamLog(xrayProcess!!, "Xray") }

            // 5. Wait up to 8 s for Xray SOCKS5 to open
            if (!waitForPort(10808, 8_000)) {
                broadcastStep("xray_socks5", false, "SOCKS5 port 10808 not ready — check UUID/server config")
                throw Exception("Xray failed to open SOCKS5 port within 8 s — check server config or UUID")
            }
            broadcastStep("xray_socks5", true, "SOCKS5 listening on :10808")

            // 6. Build TUN with split routing (exclude server IP so Xray bypasses VPN)
            val builder = Builder()
                .setSession("SetaLink")
                .addAddress("10.0.0.2", 24)
                .addDnsServer("1.1.1.1")
                .addDnsServer("8.8.8.8")
                .setMtu(1500)

            val routes = if (serverIp != null) buildExcludeRoutes(serverIp)
                         else listOf(Pair("0.0.0.0", 0))
            Log.i(TAG, "Adding ${routes.size} split routes (excluding $serverIp)")
            for ((addr, prefix) in routes) {
                try { builder.addRoute(addr, prefix) } catch (e: Exception) {
                    Log.w(TAG, "Skipped route $addr/$prefix: ${e.message}")
                }
            }

            tunFd = builder.establish()
                ?: throw Exception("Failed to establish TUN interface — VPN permission missing?")
            val tunFdInt = tunFd!!.fd
            broadcastStep("tun", true, "TUN interface established (fd=$tunFdInt, ${routes.size} routes)")

            // Clear FD_CLOEXEC so tun2socks child process can inherit the TUN file descriptor.
            // Android sets FD_CLOEXEC on all fds by default; without clearing it the fd is closed
            // before exec() runs and tun2socks receives an invalid fd://N argument.
            // Os.fcntl is a hidden (@hide) API absent from android.jar; call via reflection.
            try {
                Class.forName("android.system.Os")
                    .getMethod("fcntl", java.io.FileDescriptor::class.java,
                        Int::class.javaPrimitiveType, Int::class.javaPrimitiveType)
                    .invoke(null, tunFd!!.fileDescriptor, OsConstants.F_SETFD, 0)
                broadcastStep("fd_inherit", true, "FD_CLOEXEC cleared — fd is inheritable")
            } catch (e: Exception) {
                broadcastStep("fd_inherit", false, "fcntl via reflection: ${e.message}")
                Log.w(TAG, "Could not clear FD_CLOEXEC (non-fatal): ${e.message}")
            }

            // 7. Start tun2socks (bridges TUN ↔ Xray SOCKS5)
            broadcastStep("tun2socks_start", true, "Starting tun2socks fd://$tunFdInt → socks5://127.0.0.1:10808")
            tun2socksProc = ProcessBuilder(
                tun2sockBin.absolutePath,
                "--device", "fd://$tunFdInt",
                "--proxy",  "socks5://127.0.0.1:10808",
                "--loglevel", "warn"
            ).redirectErrorStream(true).start()
            scope.launch { streamLog(tun2socksProc!!, "tun2socks") }

            // Give tun2socks a moment to attach to the fd
            delay(600)

            if (!tun2socksProc!!.isAlive) {
                val exitCode = tun2socksProc!!.exitValue()
                broadcastStep("tun2socks_alive", false, "Exited immediately (code=$exitCode)")
                throw Exception("tun2socks exited immediately (code=$exitCode) — TUN fd may not have been inherited")
            }
            broadcastStep("tun2socks_alive", true, "tun2socks running — tunnel active")

            Log.i(TAG, "VPN tunnel active")
            sendBroadcast(Intent(BROADCAST_CONNECTED))

            // 8. Watch for process death
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
        sendBroadcast(Intent(BROADCAST_DISCONNECTED))
        stopForeground(STOP_FOREGROUND_REMOVE)
        stopSelf()
    }

    private fun broadcastError(msg: String) {
        sendBroadcast(Intent(BROADCAST_DISCONNECTED).apply { putExtra(EXTRA_ERROR, msg) })
    }

    private fun broadcastStep(step: String, ok: Boolean, msg: String) {
        sendBroadcast(Intent(BROADCAST_STEP).apply {
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

    private fun parseServerAddress(configJson: String): String? {
        return try {
            val outbounds = JSONObject(configJson).optJSONArray("outbounds") ?: return null
            for (i in 0 until outbounds.length()) {
                val ob = outbounds.getJSONObject(i)
                if (ob.optString("tag") == "proxy") {
                    val vnext = ob.optJSONObject("settings")?.optJSONArray("vnext") ?: continue
                    if (vnext.length() > 0) {
                        return vnext.getJSONObject(0).optString("address").ifBlank { null }
                    }
                }
            }
            null
        } catch (_: Exception) { null }
    }

    private suspend fun waitForPort(port: Int, timeoutMs: Long): Boolean {
        val deadline = System.currentTimeMillis() + timeoutMs
        while (System.currentTimeMillis() < deadline) {
            try { Socket("127.0.0.1", port).use { return true } } catch (_: Exception) {}
            delay(250)
        }
        return false
    }

    /**
     * Covers 0.0.0.0/0 minus [excludeIp]/32 using a binary CIDR split.
     * Generates at most 32 routes. Xray's outbound traffic to [excludeIp]
     * naturally bypasses the VPN because no matching route exists.
     */
    private fun buildExcludeRoutes(excludeIp: String): List<Pair<String, Int>> {
        val results = mutableListOf<Pair<String, Int>>()
        try {
            val addr = InetAddress.getByName(excludeIp)
            if (addr !is Inet4Address) return listOf(Pair("0.0.0.0", 0))
            val excl = ipToLong(addr.address)

            var netAddr = 0L
            var prefix  = 0
            while (prefix < 32) {
                val halfBit = 1L shl (31 - prefix)
                val halfPfx = prefix + 1
                if (excl and halfBit == 0L) {
                    // excluded IP is in lower half → add upper half, descend lower
                    results.add(Pair(longToIp(netAddr or halfBit), halfPfx))
                    prefix = halfPfx
                } else {
                    // excluded IP is in upper half → add lower half, descend upper
                    results.add(Pair(longToIp(netAddr), halfPfx))
                    netAddr = netAddr or halfBit
                    prefix  = halfPfx
                }
            }
            // at prefix == 32 we're at the excluded IP itself — omit it
        } catch (e: Exception) {
            Log.e(TAG, "buildExcludeRoutes failed for $excludeIp: ${e.message}")
            return listOf(Pair("0.0.0.0", 0))
        }
        return results
    }

    private fun ipToLong(b: ByteArray) =
        ((b[0].toLong() and 0xFF) shl 24) or
        ((b[1].toLong() and 0xFF) shl 16) or
        ((b[2].toLong() and 0xFF) shl 8)  or
        (b[3].toLong()  and 0xFF)

    private fun longToIp(ip: Long) =
        "${(ip shr 24) and 0xFF}.${(ip shr 16) and 0xFF}.${(ip shr 8) and 0xFF}.${ip and 0xFF}"

    private fun streamLog(process: Process, label: String) {
        try {
            process.inputStream.bufferedReader().forEachLine { line ->
                Log.d("$TAG/$label", line)
            }
        } catch (_: Exception) {}
    }
}
