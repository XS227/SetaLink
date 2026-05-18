package com.setalink.vpn

import android.content.Intent
import android.content.pm.ServiceInfo
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
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
import java.net.NetworkInterface
import java.net.Proxy
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
        const val BROADCAST_METRICS      = "com.setalink.vpn.METRICS"

        const val XRAY_LOG_FILE = "xray.log"

        // Valid log levels accepted by this build of tun2socks (go-tun2socks / hev-socks5-tunnel).
        // The binary rejects "warning" with "unrecognized level: %q".
        private const val TUN2SOCKS_LOG_LEVEL = "warn"

        init {
            System.loadLibrary("setalink_vpn")
        }
    }

    // Calls fcntl(fd, F_SETFD, flags & ~FD_CLOEXEC) via JNI so the fd survives exec().
    private external fun nativeClearCloexec(fd: Int): Int
    private external fun nativeStartTun2socks(binPath: String, tunFd: Int, proxy: String, logLevel: String): Int
    private external fun nativeTun2socksExitCode(pid: Int): Int
    private external fun nativeStopTun2socks(pid: Int)

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private var tunFd:         ParcelFileDescriptor? = null
    private var xrayProcess:   Process?              = null
    private var tun2socksPid:  Int?                  = null

    // ── Lifecycle ─────────────────────────────────────────────────────────────

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        when (intent?.action) {
            ACTION_START -> {
                val config = intent.getStringExtra(EXTRA_CONFIG)
                    ?: return broadcastError("No config provided").let { START_NOT_STICKY }

                // Kill any stale processes from a previous connect attempt before starting fresh.
                killStaleProcesses()

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
            broadcastStep("config_test_ok", true, "Config valid (xray accepted)")

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
            broadcastStep("xray_started", true, "Xray process launched")

            // 5. Wait for SOCKS5 port
            if (!waitForPort(10808, 10_000L)) {
                val alive    = xrayProcess?.isAlive == true
                val exitCode = if (!alive) runCatching { xrayProcess?.exitValue() }.getOrNull() else null
                val logTail  = readLogTail(30)
                broadcastStep("socks_ready", false,
                    if (alive) "Port 10808 not open after 10 s (Xray alive). Log:\n$logTail"
                    else       "Xray exited code=$exitCode. Log:\n$logTail"
                )
                throw Exception(
                    if (alive) "Xray running but SOCKS5 not ready after 10s.\nLog:\n$logTail"
                    else       "Xray exited prematurely (code=$exitCode).\nLog:\n$logTail"
                )
            }
            broadcastStep("socks_ready", true, "SOCKS5 listening on 127.0.0.1:10808")

            // 6. Build TUN interface
            val vpnBuilder = Builder()
                .setSession("SetaLink")
                .addAddress("10.0.0.2", 24)
                .addDnsServer("1.1.1.1")
                .addDnsServer("8.8.8.8")
                .setMtu(1400)           // 1400 avoids fragmentation when VLESS/TLS adds headers
                .addRoute("0.0.0.0", 0)

            // Exclude our own app (and all its subprocesses — including Xray, same UID)
            // from the VPN routes.  Without this, Xray's outbound TCP to the VPN server
            // is captured by the TUN, routed back into tun2socks → Xray SOCKS, and loops
            // forever.  With this, Xray's sockets go directly to the real network while
            // all other apps' traffic still flows through TUN → tun2socks → Xray → internet.
            runCatching { vpnBuilder.addDisallowedApplication(packageName) }
                .onFailure { e -> appendLog("[TUN] addDisallowedApplication failed: ${e.message}") }

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
            val tunInterface = findTunInterfaceName()

            // Clear FD_CLOEXEC so this fd survives exec() into tun2socks.
            // By default Android sets CLOEXEC on all fds; exec() would close it,
            // leaving tun2socks with an invalid fd number when we pass fd://<N>.
            val cloexecResult = nativeClearCloexec(tunFdInt)
            appendLog("[TUN] fd=$tunFdInt FD_CLOEXEC clear result=$cloexecResult (0=ok, -1=err)")

            broadcastStep("tun_created", true, "TUN fd=$tunFdInt iface=${tunInterface ?: "unknown"} established (FD_CLOEXEC cleared, result=$cloexecResult)")
            broadcastRouteDiagnostics(tunInterface)

            // 7. Start tun2socks — pass fd://<N> so tun2socks uses the inherited fd directly.
            // Passing /proc/<pid>/fd/<N> fails on Android because the child process cannot
            // open another process's fd symlinks under SELinux default policy.
            //
            // Root-cause note: tun2socks accepts [debug|info|warn|error|silent].
            // "warning" is NOT a valid level and causes immediate exit with
            // "unrecognized level: warning". Use TUN2SOCKS_LOG_LEVEL = "warn".
            val tun2socksArgs = listOf("--device", "fd://$tunFdInt", "--proxy", "socks5://127.0.0.1:10808", "--loglevel", TUN2SOCKS_LOG_LEVEL)
            appendLog("[tun2socks] args: ${tun2socksArgs.joinToString(" ")}")
            broadcastStep("tun2socks_started", true,
                "Launching: ${tun2socksArgs.joinToString(" ")}")

            val pid = nativeStartTun2socks(
                tun2sockBin.absolutePath,
                tunFdInt,
                "socks5://127.0.0.1:10808",
                TUN2SOCKS_LOG_LEVEL
            )
            if (pid <= 0) {
                throw Exception("nativeStartTun2socks failed (pid=$pid)")
            }
            tun2socksPid = pid
            appendLog("[tun2socks] started via native fork/exec pid=$pid")

            delay(1500L)

            val firstExit = nativeTun2socksExitCode(pid)
            if (firstExit != -2) {
                val logTail  = readLogTail(20)
                broadcastStep("tun2socks_alive", false,
                    "tun2socks exited code=$firstExit pid=$pid\nargs: ${tun2socksArgs.joinToString(" ")}\nLog:\n$logTail")
                throw Exception(
                    "tun2socks exited (code=$firstExit pid=$pid).\nargs: ${tun2socksArgs.joinToString(" ")}\nLog:\n$logTail")
            }
            broadcastStep("tun2socks_alive", true, "tun2socks running — fd://$tunFdInt → socks5://127.0.0.1:10808")

            val validation = runRoutingValidation(tunInterface)
            if (!validation.ok) {
                broadcastStep("routing_validation", false, validation.message)
                throw Exception("Routing validation failed: ${validation.message}")
            }

            Log.i(TAG, "VPN tunnel active and validated")
            broadcastStep("routing_validation", true, validation.message)
            broadcastStep("vpn_connected", true, "Tunnel active + routing validated")
            sendBroadcast(Intent(BROADCAST_CONNECTED).setPackage(packageName))

            // 8. Watch for process death
            scope.launch {
                while (isActive) {
                    delay(3_000L)
                    val xAlive = xrayProcess?.isAlive == true
                    val tAlive = tun2socksPid?.let { nativeTun2socksExitCode(it) == -2 } == true
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

    private fun killStaleProcesses() {
        xrayProcess?.let {
            it.destroyForcibly()
            appendLog("[CLEANUP] killed stale xray process")
        }
        xrayProcess = null
        tun2socksPid?.let {
            nativeStopTun2socks(it)
            appendLog("[CLEANUP] killed stale tun2socks pid=$it")
        }
        tun2socksPid = null
        runCatching { tunFd?.close() }
        tunFd = null
    }

    private fun tearDownTunnel() {
        xrayProcess?.destroyForcibly();    xrayProcess   = null
        tun2socksPid?.let { nativeStopTun2socks(it) }; tun2socksPid = null
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

    private data class ValidationResult(val ok: Boolean, val message: String)

    private fun runRoutingValidation(tunInterface: String?): ValidationResult {
        appendLog("[VALIDATION] SOCKS5 probe: 127.0.0.1:10808 → CONNECT 1.1.1.1:80")

        // Our app UID is excluded from the VPN (addDisallowedApplication), so:
        //   • This socket connects to 127.0.0.1:10808 via loopback — never touches TUN.
        //   • Xray's subprocess (same UID) dials the VPN server directly on the real NIC.
        // A successful CONNECT proves end-to-end: app→SOCKS5→Xray→VPN server→internet.
        val socks5Ok = runCatching {
            val proxy = Proxy(Proxy.Type.SOCKS, InetSocketAddress("127.0.0.1", 10808))
            Socket(proxy).use { sock ->
                sock.soTimeout = 6000
                sock.connect(InetSocketAddress("1.1.1.1", 80), 6000)
                true
            }
        }.onFailure { e -> appendLog("[VALIDATION] SOCKS5 probe error: ${e.message}") }
         .getOrElse { false }

        appendLog("[VALIDATION] SOCKS5 probe result: $socks5Ok")

        // TUN counters — logged for diagnostics; not required to be non-zero at connect
        // time since other apps haven't sent traffic yet.
        val bytes  = tunInterface?.let { readInterfaceBytes(it) }
        val rxSnap = bytes?.first  ?: -1L
        val txSnap = bytes?.second ?: -1L
        appendLog("[VALIDATION] TUN snapshot: rx=$rxSnap tx=$txSnap iface=${tunInterface ?: "unknown"}")

        publishMetrics(tunInterface, rxSnap, txSnap, socks5Ok)

        return if (socks5Ok) {
            ValidationResult(true, "SOCKS5 probe OK — Xray can proxy traffic to internet (TUN rx=$rxSnap tx=$txSnap)")
        } else {
            ValidationResult(false, "SOCKS5 probe failed — VPN server unreachable or routing loop not cleared")
        }
    }

    private fun findTunInterfaceName(): String? {
        return runCatching {
            NetworkInterface.getNetworkInterfaces().toList()
                .firstOrNull { iface ->
                    val n = iface.name.lowercase()
                    iface.isUp && (n.startsWith("tun") || n.startsWith("ppp"))
                }?.name
        }.getOrNull()
    }

    private fun readInterfaceBytes(iface: String): Pair<Long, Long>? {
        return runCatching {
            File("/proc/net/dev").readLines().firstOrNull { it.trimStart().startsWith("$iface:") }?.let { line ->
                val fields = line.substringAfter(":").trim().split(Regex("\\s+"))
                Pair(fields[0].toLong(), fields[8].toLong())
            }
        }.getOrNull()
    }

    private fun broadcastRouteDiagnostics(tunInterface: String?) {
        val cm = getSystemService(ConnectivityManager::class.java)
        val active = cm?.activeNetwork
        val caps = cm?.getNetworkCapabilities(active)
        val transport = when {
            caps == null -> "unknown"
            caps.hasTransport(NetworkCapabilities.TRANSPORT_WIFI) -> "wifi"
            caps.hasTransport(NetworkCapabilities.TRANSPORT_CELLULAR) -> "mobile"
            else -> "other"
        }
        val msg = "iface=${tunInterface ?: "unknown"} route4=0.0.0.0/0 route6=::/0 dns=1.1.1.1,8.8.8.8 net=$transport ipv6=${caps?.hasCapability(NetworkCapabilities.NET_CAPABILITY_NOT_VPN) == false}"
        broadcastStep("route_diag", true, msg)
    }

    private fun publishMetrics(tunInterface: String?, rxDelta: Long, txDelta: Long, probeOk: Boolean) {
        sendBroadcast(Intent(BROADCAST_METRICS).apply {
            setPackage(packageName)
            putExtra("tunInterface", tunInterface ?: "unknown")
            putExtra("tunRxDelta", rxDelta)
            putExtra("tunTxDelta", txDelta)
            putExtra("probeOk", probeOk)
        })
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
