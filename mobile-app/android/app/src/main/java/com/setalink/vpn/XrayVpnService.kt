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
import java.io.FileWriter
import java.net.InetSocketAddress
import java.net.Socket

class XrayVpnService : VpnService() {

    companion object {
        private const val TAG = "XrayVpnService"

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

        const val XRAY_LOG_FILE = "xray.log"

        init {
            System.loadLibrary("setalink_vpn")
        }
    }

    // Calls fcntl(fd, F_SETFD, flags & ~FD_CLOEXEC) via JNI so the fd survives exec().
    private external fun nativeClearCloexec(fd: Int): Int

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private var tunFd:         ParcelFileDescriptor? = null
    private var xrayProcess:   Process?              = null
    private var tun2socksProc: Process?              = null

    // ── Lifecycle ─────────────────────────────────────────────────────────────

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        when (intent?.action) {
            ACTION_START -> {
                val config = intent.getStringExtra(EXTRA_CONFIG)
                    ?: return broadcastError("No config provided").let { START_NOT_STICKY }
                val notification = NotificationHelper.buildConnected(this)
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
        // Reset log for this attempt
        try { File(filesDir, XRAY_LOG_FILE).writeText("") } catch (_: Exception) {}

        try {
            // 1. Resolve binaries from nativeLibraryDir (exec-safe, unlike filesDir)
            appendLog("[DIAG] nativeLibraryDir=${applicationInfo.nativeLibraryDir}")
            appendLog("[DIAG] filesDir=${filesDir.absolutePath} (noexec on many OEMs — NOT used for binaries)")
            broadcastStep("binaries", true, "Resolving binaries from nativeLibraryDir")
            val xrayBin     = resolveBinary("libxray.so")
            val tun2sockBin = resolveBinary("libtun2socks.so")
            broadcastStep("binaries", true,
                "xray=${xrayBin.length()}B tun2socks=${tun2sockBin.length()}B " +
                "nativeDir=${applicationInfo.nativeLibraryDir}"
            )

            // 2. Write config
            val configFile = File(filesDir, "xray.json")
            configFile.writeText(configJson)
            broadcastStep("config", true, "Config written (${configJson.length} bytes)")

            // 3. Config test — run xray in test mode to catch malformed configs early
            broadcastStep("config_test", true, "Running xray -test...")
            val testResult = runConfigTest(xrayBin, configFile)
            if (!testResult.passed) {
                appendLog("[CONFIG TEST FAILED]\n${testResult.output}")
                broadcastStep("config_test", false, testResult.firstError)
                throw Exception("Config rejected by Xray: ${testResult.firstError}")
            }
            broadcastStep("config_test", true, "Config valid (xray accepted)")

            // 4. Start Xray
            broadcastStep("xray_start", true, "Starting Xray process")
            xrayProcess = ProcessBuilder(
                xrayBin.absolutePath, "run", "-c", configFile.absolutePath
            ).apply {
                environment()["XRAY_LOCATION_ASSET"] = filesDir.absolutePath
                redirectErrorStream(true)
                directory(filesDir)
            }.start()
            scope.launch { streamToLog(xrayProcess!!, "Xray") }

            // 5. Wait for SOCKS5 port
            if (!waitForPort(10808, 10_000L)) {
                val alive    = xrayProcess?.isAlive == true
                val exitCode = if (!alive) runCatching { xrayProcess?.exitValue() }.getOrNull() else null
                val logTail  = readLogTail(30)
                broadcastStep("xray_socks5", false,
                    if (alive) "Port 10808 not open (alive). Last output:\n$logTail"
                    else       "Xray exited code=$exitCode. Last output:\n$logTail"
                )
                throw Exception(
                    if (alive) "Xray running but SOCKS5 not ready after 10s.\nLast output:\n$logTail"
                    else       "Xray exited prematurely (code=$exitCode).\nLast output:\n$logTail"
                )
            }
            broadcastStep("xray_socks5", true, "SOCKS5 listening on :10808")

            // 6. Build TUN interface
            val vpnBuilder = Builder()
                .setSession("SetaLink")
                .addAddress("10.0.0.2", 24)
                .addDnsServer("1.1.1.1")
                .addDnsServer("8.8.8.8")
                .setMtu(1500)
                .addRoute("0.0.0.0", 0)
                .addDisallowedApplication(packageName)

            // IPv6: best-effort (some ROMs reject these calls)
            runCatching {
                vpnBuilder.addAddress("fdfe:dcba:9876::2", 64)
                vpnBuilder.addDnsServer("2606:4700:4700::1111")
                vpnBuilder.addRoute("::", 0)
            }

            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                vpnBuilder.setMetered(false)
            }

            tunFd = vpnBuilder.establish()
                ?: throw Exception("TUN establish() returned null — was VPN permission revoked?")
            val tunFdInt = tunFd!!.fd

            // Clear FD_CLOEXEC so this fd survives exec() into tun2socks.
            // By default Android sets CLOEXEC on all fds; exec() would close it,
            // leaving tun2socks with an invalid fd number when we pass fd://<N>.
            val cloexecResult = nativeClearCloexec(tunFdInt)
            appendLog("[TUN] fd=$tunFdInt FD_CLOEXEC clear result=$cloexecResult (0=ok, -1=err)")

            broadcastStep("tun", true, "TUN fd=$tunFdInt established (inheritable)")

            // 7. Start tun2socks — pass fd://<N> so tun2socks uses the inherited fd directly.
            // Passing /proc/<pid>/fd/<N> fails on Android because the child process cannot
            // open another process's fd symlinks under SELinux default policy.
            broadcastStep("tun2socks_start", true, "Starting tun2socks → socks5://127.0.0.1:10808")
            tun2socksProc = ProcessBuilder(
                tun2sockBin.absolutePath,
                "--device",   "fd://$tunFdInt",
                "--proxy",    "socks5://127.0.0.1:10808",
                "--loglevel", "warning"
            ).apply {
                redirectErrorStream(true)
                directory(filesDir)
            }.start()
            scope.launch { streamToLog(tun2socksProc!!, "tun2socks") }

            delay(1500L)

            if (tun2socksProc?.isAlive != true) {
                val exitCode = runCatching { tun2socksProc?.exitValue() }.getOrNull()
                val logTail  = readLogTail(15)
                broadcastStep("tun2socks_alive", false, "Exited code=$exitCode. Log:\n$logTail")
                throw Exception("tun2socks exited (code=$exitCode).\nLog:\n$logTail")
            }
            broadcastStep("tun2socks_alive", true, "tun2socks running — tunnel active")

            Log.i(TAG, "VPN tunnel active")
            sendBroadcast(Intent(BROADCAST_CONNECTED).setPackage(packageName))

            // 8. Watch for process death
            scope.launch {
                while (isActive) {
                    delay(3_000L)
                    val xAlive = xrayProcess?.isAlive == true
                    val tAlive = tun2socksProc?.isAlive == true
                    if (!xAlive || !tAlive) {
                        val logTail = readLogTail(20)
                        val msg = "Process died unexpectedly (xray=$xAlive tun2socks=$tAlive).\n$logTail"
                        Log.e(TAG, msg)
                        broadcastError(msg)
                        tearDownTunnel()
                        break
                    }
                }
            }

        } catch (e: Exception) {
            Log.e(TAG, "Tunnel setup failed: ${e.message}", e)
            appendLog("[TUNNEL FAILED] ${e.message}")
            broadcastError(e.message ?: "Unknown VPN error")
            tearDownTunnel()
        }
    }

    // ── Config test ───────────────────────────────────────────────────────────

    private data class TestResult(val passed: Boolean, val output: String, val firstError: String)

    private suspend fun runConfigTest(xrayBin: File, configFile: File): TestResult {
        return try {
            val proc = ProcessBuilder(
                xrayBin.absolutePath, "run", "-test", "-c", configFile.absolutePath
            ).apply {
                environment()["XRAY_LOCATION_ASSET"] = filesDir.absolutePath
                redirectErrorStream(true)
                directory(filesDir)
            }.start()

            // Drain output in a coroutine so it doesn't fill the pipe buffer and deadlock
            val outputDeferred = scope.async(Dispatchers.IO) {
                proc.inputStream.bufferedReader().readText()
            }

            // waitFor() on IO dispatcher so we don't block the calling coroutine's thread
            val exitCode = withContext(Dispatchers.IO) {
                // 5-second hard limit — xray -test should be near-instant
                val deadline = System.currentTimeMillis() + 5_000L
                while (proc.isAlive && System.currentTimeMillis() < deadline) {
                    delay(100L)
                }
                if (proc.isAlive) {
                    proc.destroyForcibly()
                    null  // null means timed out
                } else {
                    proc.exitValue()
                }
            }

            val output = outputDeferred.await()
            appendLog("[CONFIG TEST exit=$exitCode]\n$output")
            Log.i(TAG, "[CONFIG TEST] exit=$exitCode | output=$output")

            when {
                exitCode == null -> TestResult(false, "(timed out)", "Config test timed out after 5 s")
                exitCode == 0    -> TestResult(true, output, "")
                else             -> {
                    val firstErr = output.lines()
                        .firstOrNull { it.contains("error", ignoreCase = true) && it.isNotBlank() }
                        ?: output.lines().firstOrNull { it.isNotBlank() }
                        ?: "Config invalid (exit=$exitCode)"
                    TestResult(false, output, firstErr.take(200))
                }
            }
        } catch (e: Exception) {
            appendLog("[CONFIG TEST EXCEPTION] ${e.message}")
            TestResult(false, e.message ?: "", e.message ?: "Config test failed")
        }
    }

    // ── Teardown ──────────────────────────────────────────────────────────────

    private fun tearDownTunnel() {
        xrayProcess?.destroy();    xrayProcess   = null
        tun2socksProc?.destroy();  tun2socksProc = null
        runCatching { tunFd?.close() }
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

    // ── Log helpers ───────────────────────────────────────────────────────────

    private fun appendLog(text: String) {
        try {
            FileWriter(File(filesDir, XRAY_LOG_FILE), true).use { it.write("$text\n") }
        } catch (_: Exception) {}
    }

    fun readLogTail(lines: Int = 50): String {
        return try {
            val f = File(filesDir, XRAY_LOG_FILE)
            if (!f.exists()) return "(no log)"
            f.readLines().takeLast(lines).joinToString("\n").ifEmpty { "(empty)" }
        } catch (_: Exception) { "(unreadable)" }
    }

    private fun streamToLog(process: Process, label: String) {
        try {
            process.inputStream.bufferedReader().forEachLine { line ->
                Log.d("$TAG/$label", line)
                appendLog("[$label] $line")
            }
        } catch (_: Exception) {}
    }

    // ── Binary helpers ────────────────────────────────────────────────────────

    /**
     * Resolves a binary from nativeLibraryDir — the exec-safe path Android uses for
     * extracted .so files (e.g. /data/app/com.setalink-XXX/lib/arm64/).
     * filesDir is mounted noexec on many OEMs (MIUI/HyperOS, ColorOS, some Samsung ROMs)
     * so we package binaries as libXXX.so in jniLibs/ and let the installer extract them.
     */
    private fun resolveBinary(libName: String): File {
        val nativeDir = File(applicationInfo.nativeLibraryDir)
        val binFile   = File(nativeDir, libName)

        val diagLine = "path=${binFile.absolutePath} exists=${binFile.exists()} " +
                       "size=${binFile.length()}B canExecute=${binFile.canExecute()}"
        appendLog("[BINARY] $diagLine")
        Log.i(TAG, "Binary $libName: $diagLine")

        if (!binFile.exists()) {
            val contents = nativeDir.list()?.joinToString() ?: "dir missing"
            throw Exception(
                "Binary $libName not found at ${binFile.absolutePath}\n" +
                "nativeLibraryDir contents: $contents"
            )
        }
        if (!binFile.canExecute()) {
            // Attempt chmod — may succeed on some ROMs even in nativeLibraryDir
            binFile.setExecutable(true, false)
            if (!binFile.canExecute()) {
                throw Exception(
                    "Binary $libName not executable at ${binFile.absolutePath}\n" +
                    "Mount: ${getMountLine(binFile)}"
                )
            }
            appendLog("[BINARY] $libName chmod succeeded despite canExecute=false initially")
        }
        return binFile
    }

    private fun getMountLine(file: File): String {
        return try {
            val path = file.absolutePath
            File("/proc/mounts").readLines()
                .lastOrNull { line -> path.startsWith(line.split(" ").getOrElse(1) { "" }) }
                ?: "no matching mount entry"
        } catch (_: Exception) { "unavailable" }
    }

    private suspend fun waitForPort(port: Int, timeoutMs: Long): Boolean {
        val deadline = System.currentTimeMillis() + timeoutMs
        while (System.currentTimeMillis() < deadline) {
            try {
                Socket().use { s ->
                    s.connect(InetSocketAddress("127.0.0.1", port), 200)
                }
                return true
            } catch (_: Exception) {}
            delay(300L)
        }
        return false
    }
}
