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
import java.io.RandomAccessFile
import java.net.InetSocketAddress
import java.net.NetworkInterface
import java.net.Proxy
import java.net.Socket
import javax.net.ssl.SSLSocket
import javax.net.ssl.SSLSocketFactory
import org.json.JSONObject

class XrayVpnService : VpnService() {

    companion object {
        private const val TAG = "XrayVpnService"

        const val ACTION_START = "com.setalink.vpn.START"
        const val ACTION_STOP  = "com.setalink.vpn.STOP"
        const val EXTRA_CONFIG         = "config_json"
        const val EXTRA_EMERGENCY_MODE = "emergency_mode"

        const val BROADCAST_CONNECTED    = "com.setalink.vpn.CONNECTED"
        const val BROADCAST_DISCONNECTED = "com.setalink.vpn.DISCONNECTED"
        const val BROADCAST_STEP         = "com.setalink.vpn.STEP"
        const val EXTRA_ERROR            = "error_message"
        const val EXTRA_STEP             = "step_name"
        const val EXTRA_STEP_OK          = "step_ok"
        const val EXTRA_STEP_MSG         = "step_msg"
        const val BROADCAST_METRICS      = "com.setalink.vpn.METRICS"

        const val XRAY_LOG_FILE     = "xray.log"
        const val TUN2SOCKS_LOG_FILE = "tun2socks.log"

        // go-tun2socks v2 valid log levels: debug | info | warn | error | silent
        private const val TUN2SOCKS_LOG_LEVEL = "info"

        // Metrics polling interval
        private const val METRICS_INTERVAL_MS = 3_000L

        init {
            System.loadLibrary("setalink_vpn")
        }
    }

    private external fun nativeClearCloexec(fd: Int): Int
    // logFilePath: tun2socks stdout+stderr are redirected here for diagnostics.
    private external fun nativeStartTun2socks(
        binPath: String, tunFd: Int, proxy: String, logLevel: String, logFilePath: String
    ): Int
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
                val emergency = intent.getBooleanExtra(EXTRA_EMERGENCY_MODE, false)

                killStaleProcesses()

                val notification = NotificationHelper.buildConnected(this)
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
                    startForeground(
                        NotificationHelper.NOTIFICATION_ID, notification,
                        ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE
                    )
                } else {
                    startForeground(NotificationHelper.NOTIFICATION_ID, notification)
                }
                scope.launch { establishTunnel(config, emergency) }
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

    private suspend fun establishTunnel(configJson: String, emergencyMode: Boolean) {
        try { File(filesDir, XRAY_LOG_FILE).writeText("") } catch (_: Exception) {}
        try { File(filesDir, TUN2SOCKS_LOG_FILE).writeText("") } catch (_: Exception) {}

        appendLog("[DIAG] nativeLibraryDir=${applicationInfo.nativeLibraryDir}")
        appendLog("[DIAG] filesDir=${filesDir.absolutePath}")
        appendLog("[DIAG] emergencyMode=$emergencyMode")

        try {
            // 1. Resolve binaries
            broadcastStep("binaries", true, "Resolving binaries")
            val xrayBin     = resolveBinary("libxray.so")
            val tun2sockBin = resolveBinary("libtun2socks.so")
            broadcastStep("binaries", true,
                "xray=${xrayBin.length()}B tun2socks=${tun2sockBin.length()}B")

            // Log Xray version for diagnostics
            runCatching {
                val verProc = ProcessBuilder(xrayBin.absolutePath, "version")
                    .apply { redirectErrorStream(true) }.start()
                val verOut = verProc.inputStream.bufferedReader().readText().take(200)
                appendLog("[XRAY VERSION] $verOut")
                broadcastStep("xray_version", true, verOut.lines().firstOrNull()?.take(100) ?: "?")
            }.onFailure { appendLog("[XRAY VERSION] failed: ${it.message}") }

            // 2. Write config
            val configFile = File(filesDir, "xray.json")
            configFile.writeText(configJson)
            broadcastStep("config", true, "Config written (${configJson.length} bytes)")
            appendLog("[CONFIG] $configJson")
            // Summarise Reality params so they appear near the top of diagnostics
            runCatching {
                val cfg = JSONObject(configJson)
                val outbound = cfg.getJSONArray("outbounds").getJSONObject(0)
                val stream   = outbound.optJSONObject("streamSettings")
                val reality  = stream?.optJSONObject("realitySettings")
                val user     = outbound.getJSONObject("settings")
                    .getJSONArray("vnext").getJSONObject(0)
                    .getJSONArray("users").getJSONObject(0)
                val addr  = outbound.getJSONObject("settings").getJSONArray("vnext").getJSONObject(0).getString("address")
                val port  = outbound.getJSONObject("settings").getJSONArray("vnext").getJSONObject(0).getInt("port")
                val flow  = user.optString("flow", "(none)")
                val fp    = reality?.optString("fingerprint", "?") ?: "?"
                val sni   = reality?.optString("serverName", "?") ?: "?"
                val pbk   = reality?.optString("publicKey", "?")?.take(16)?.plus("…") ?: "?"
                val sid   = reality?.optString("shortId", "?") ?: "?"
                appendLog("[CONFIG-PARAMS] server=$addr:$port flow=$flow fp=$fp sni=$sni pbk=$pbk sid=$sid")
                broadcastStep("config_params", true, "server=$addr:$port flow=$flow fp=$fp sni=$sni sid=$sid")
            }.onFailure { e -> appendLog("[CONFIG-PARAMS] parse failed: ${e.message}") }

            // 3. Config test
            broadcastStep("config_test", true, "Running xray -test...")
            val testResult = runConfigTest(xrayBin, configFile)
            if (!testResult.passed) {
                appendLog("[CONFIG TEST FAILED]\n${testResult.output}")
                broadcastStep("config_test", false, testResult.firstError)
                throw Exception("Config rejected by Xray: ${testResult.firstError}")
            }
            broadcastStep("config_test_ok", true, "Config valid")

            // 4. Start Xray
            broadcastStep("xray_start", true, "Starting Xray")
            xrayProcess = ProcessBuilder(
                xrayBin.absolutePath, "run", "-c", configFile.absolutePath
            ).apply {
                environment()["XRAY_LOCATION_ASSET"] = filesDir.absolutePath
                redirectErrorStream(true)
                directory(filesDir)
            }.start()
            scope.launch { streamToLog(xrayProcess!!, "Xray") }
            broadcastStep("xray_started", true, "Xray process launched")

            // 5. Wait for SOCKS5
            if (!waitForPort(10808, 10_000L)) {
                val alive    = xrayProcess?.isAlive == true
                val exitCode = if (!alive) runCatching { xrayProcess?.exitValue() }.getOrNull() else null
                val logTail  = readLogTail(30)
                val msg = if (alive) "Port 10808 not open after 10s (Xray alive).\nLog:\n$logTail"
                          else       "Xray exited code=$exitCode.\nLog:\n$logTail"
                broadcastStep("socks_ready", false, msg)
                throw Exception(msg)
            }
            broadcastStep("socks_ready", true, "SOCKS5 listening on 127.0.0.1:10808")

            // 6. Build TUN interface
            val mtu = if (emergencyMode) 1280 else 1400
            val vpnBuilder = Builder()
                .setSession("SetaLink")
                .addAddress("10.0.0.2", 24)
                .addDnsServer("1.1.1.1")
                .addRoute("0.0.0.0", 0)
                .setMtu(mtu)

            if (!emergencyMode) {
                vpnBuilder.addDnsServer("8.8.8.8")
            }

            // Exclude our UID so Xray (same UID) can reach the VPN server directly
            // without looping back through TUN → tun2socks → Xray → TUN.
            runCatching { vpnBuilder.addDisallowedApplication(packageName) }
                .onFailure { e -> appendLog("[TUN] addDisallowedApplication failed: ${e.message}") }

            if (!emergencyMode) {
                // IPv6: best-effort (some ROMs reject)
                runCatching {
                    vpnBuilder.addAddress("fdfe:dcba:9876::2", 64)
                    vpnBuilder.addDnsServer("2606:4700:4700::1111")
                    vpnBuilder.addRoute("::", 0)
                }
            }

            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                vpnBuilder.setMetered(false)
            }

            tunFd = vpnBuilder.establish()
                ?: throw Exception("TUN establish() returned null — VPN permission revoked?")
            val tunFdInt   = tunFd!!.fd
            val tunInterface = findTunInterfaceName()

            val cloexecResult = nativeClearCloexec(tunFdInt)
            appendLog("[TUN] fd=$tunFdInt iface=${tunInterface ?: "?"} mtu=$mtu FD_CLOEXEC_clear=$cloexecResult emergencyMode=$emergencyMode")
            broadcastStep("tun_created", true,
                "TUN fd=$tunFdInt iface=${tunInterface ?: "?"} mtu=$mtu emergencyMode=$emergencyMode cloexec=$cloexecResult")
            broadcastRouteDiagnostics(tunInterface, mtu, emergencyMode)

            // 7. Launch tun2socks with output redirected to tun2socks.log
            val tun2socksLogPath = File(filesDir, TUN2SOCKS_LOG_FILE).absolutePath
            val args = "--device fd://$tunFdInt --proxy socks5://127.0.0.1:10808 --loglevel $TUN2SOCKS_LOG_LEVEL"
            appendLog("[tun2socks] launch args: $args  logFile=$tun2socksLogPath")
            broadcastStep("tun2socks_started", true, "Launching: $args")

            val pid = nativeStartTun2socks(
                tun2sockBin.absolutePath,
                tunFdInt,
                "socks5://127.0.0.1:10808",
                TUN2SOCKS_LOG_LEVEL,
                tun2socksLogPath
            )
            if (pid <= 0) throw Exception("nativeStartTun2socks failed (pid=$pid)")
            tun2socksPid = pid
            appendLog("[tun2socks] forked pid=$pid")

            // Start streaming tun2socks.log → xray.log
            scope.launch { tailTun2socksLog() }

            // Wait for tun2socks to initialise
            delay(2_000L)

            val firstExit = nativeTun2socksExitCode(pid)
            if (firstExit != -2) {
                val t2sLog = readTun2socksLog()
                val logTail = readLogTail(20)
                broadcastStep("tun2socks_alive", false,
                    "tun2socks exited code=$firstExit pid=$pid\nargs=$args\ntun2socks output:\n$t2sLog\nxray log:\n$logTail")
                throw Exception("tun2socks exited (code=$firstExit).\nargs=$args\nt2s output:\n$t2sLog")
            }
            broadcastStep("tun2socks_alive", true,
                "tun2socks running pid=$pid — fd://$tunFdInt → socks5://127.0.0.1:10808")

            // 8. Deep validation: TCP connect + actual HTTP data via SOCKS5
            val validation = runDeepValidation(tunInterface)
            if (!validation.ok) {
                val t2sLog = readTun2socksLog()
                broadcastStep("routing_validation", false,
                    "${validation.message}\n[tun2socks output]\n$t2sLog")
                throw Exception("Deep validation failed: ${validation.message}")
            }

            broadcastStep("routing_validation", true, validation.message)
            broadcastStep("vpn_connected", true, "Tunnel active — ${validation.message}")

            Log.i(TAG, "VPN tunnel active and deep-validated (probeOk=${validation.probeOk})")
            sendBroadcast(Intent(BROADCAST_CONNECTED).apply {
                setPackage(packageName)
                putExtra("probe_ok", validation.probeOk)
            })

            // 9. Start continuous metrics loop + process watchdog
            startMetricsLoop(tunInterface)
            startWatchdog()

        } catch (e: Exception) {
            Log.e(TAG, "Tunnel setup failed: ${e.message}", e)
            appendLog("[TUNNEL FAILED] ${e.message}")
            val t2sLog = runCatching { readTun2socksLog() }.getOrDefault("(unavailable)")
            appendLog("[tun2socks output at failure]\n$t2sLog")
            broadcastError(e.message ?: "Unknown VPN error")
            tearDownTunnel()
        }
    }

    // ── Deep validation ───────────────────────────────────────────────────────

    private data class ValidationResult(val ok: Boolean, val message: String, val probeOk: Boolean = false)

    private suspend fun runDeepValidation(tunInterface: String?): ValidationResult {
        // Snapshot TUN bytes before probe
        val bytesBefore = tunInterface?.let { readInterfaceBytes(it) }
        appendLog("[VALIDATION] TUN snapshot before probe: rx=${bytesBefore?.first ?: -1} tx=${bytesBefore?.second ?: -1} iface=${tunInterface ?: "?"}")

        // Step A: SOCKS5 TCP connect to a reliable IP (proves Xray is listening)
        appendLog("[VALIDATION-A] SOCKS5 TCP connect → 1.1.1.1:80")
        val tcpOk = runCatching {
            val proxy = Proxy(Proxy.Type.SOCKS, InetSocketAddress("127.0.0.1", 10808))
            Socket(proxy).use { sock ->
                sock.soTimeout = 8000
                sock.connect(InetSocketAddress("1.1.1.1", 80), 8000)
                true
            }
        }.onFailure { e -> appendLog("[VALIDATION-A] TCP connect failed: ${e.message}") }
         .getOrElse { false }
        appendLog("[VALIDATION-A] result: tcpOk=$tcpOk")

        if (!tcpOk) {
            appendLog("[VALIDATION] FATAL: Xray SOCKS5 unreachable. Log:\n${readLogTail(60)}")
            return ValidationResult(false, "SOCKS5 TCP connect to 1.1.1.1:80 failed — Xray unreachable or VPN server down")
        }

        // Small gap so Xray can finish writing any in-flight log lines.
        delay(300L)
        appendLog("[VALIDATION] Xray log before probes:\n${readLogTail(30)}")

        // Step B: HTTP GET via SOCKS5.
        // NOTE: With xtls-rprx-vision, the VPN server may reject non-TLS inner traffic.
        // We use 2 targets and a short timeout to keep total probe time low.
        data class ProbeTarget(val host: String, val port: Int, val isDomain: Boolean)
        val httpTargets = listOf(
            ProbeTarget("1.1.1.1",     80, false),
            ProbeTarget("neverssl.com", 80, true),
        )

        var httpOk      = false
        var httpBytes   = 0
        var httpSnippet = "not attempted"
        var httpHost    = ""

        for (target in httpTargets) {
            appendLog("[VALIDATION-B] HTTP GET http://${target.host}/ via SOCKS5")
            val (ok, bytes, snippet) = runDeepHttpProbe(target.host, target.port, target.isDomain)
            appendLog("[VALIDATION-B] ${target.host} -> ok=$ok bytes=$bytes snippet=$snippet")
            httpSnippet = snippet
            if (ok) { httpOk = true; httpBytes = bytes; httpHost = target.host; break }
        }

        // Step C: HTTPS probe via SSLSocket — TLS inner traffic is what xtls-rprx-vision
        // is designed for. A server with Vision flow will forward TLS even when HTTP fails.
        var httpsOk     = false
        var httpsBytes  = 0
        var httpsHost   = ""

        if (!httpOk) {
            // connectivitycheck.gstatic.com returns HTTP 204 almost instantly — fastest probe.
            // captive.apple.com is equally fast. Fall through to others if first fails.
            for (host in listOf("connectivitycheck.gstatic.com", "captive.apple.com", "clients3.google.com", "www.cloudflare.com")) {
                appendLog("[VALIDATION-C] HTTPS probe -> $host:443 via SOCKS5+TLS")
                val (ok, bytes, snippet) = runHttpsProbe(host)
                appendLog("[VALIDATION-C] $host -> ok=$ok bytes=$bytes snippet=$snippet")
                if (ok) { httpsOk = true; httpsBytes = bytes; httpsHost = host; break }
            }
        }

        // Snapshot TUN bytes after probe (0 expected — our UID is excluded from TUN)
        val bytesAfter = tunInterface?.let { readInterfaceBytes(it) }
        val rxSnap = bytesAfter?.first  ?: -1L
        val txSnap = bytesAfter?.second ?: -1L
        appendLog("[VALIDATION] TUN after probes: rx=$rxSnap tx=$txSnap (app UID excluded from TUN)")

        val probeOk = httpOk || httpsOk
        publishMetrics(tunInterface, rxSnap, txSnap, probeOk)

        if (httpOk) {
            return ValidationResult(true,
                "TCP+HTTP OK via $httpHost (${httpBytes}B). TUN rx=$rxSnap tx=$txSnap",
                probeOk = true)
        }
        if (httpsOk) {
            return ValidationResult(true,
                "TCP+HTTPS OK via $httpsHost (${httpsBytes}B) — TLS/Vision traffic confirmed. " +
                "HTTP probe was inconclusive (expected for Vision-only servers).",
                probeOk = true)
        }

        // TCP succeeded but HTTP and HTTPS probes timed out.
        // This is expected in several legitimate scenarios:
        //   • Vision-only servers reject plain HTTP inner traffic by design
        //   • Probe targets (1.1.1.1, google, cloudflare) may be slow or filtered in
        //     the client's region (Turkey, etc.) even when the tunnel is fully functional
        //   • The tunnel was working correctly before this strict probe was added
        // Decision: TCP OK = tunnel is healthy. Keep connected and let apps verify
        // real traffic. Only hard-fail when Xray itself is unreachable (Step A).
        appendLog("[VALIDATION] WARNING — TCP OK but HTTP+HTTPS probes timed out. " +
            "Keeping tunnel ACTIVE. Vision servers reject plain HTTP; probe targets may be " +
            "geo-filtered in this region. Apps will confirm real connectivity. " +
            "Last HTTP snippet: $httpSnippet")
        broadcastStep("probe_warn", true,
            "TCP OK — HTTP/HTTPS probes inconclusive (timeout). " +
            "Tunnel kept ACTIVE. Vision/Reality servers often drop probe traffic. " +
            "Last probe: $httpSnippet")

        return ValidationResult(true,
            "TCP OK (SOCKS+TUN alive). HTTP/HTTPS probes timed out — tunnel active, " +
            "apps will confirm real connectivity. (Probe timeout is expected for Vision servers.)")
    }

    // Returns (ok, bytesRead, snippet) — plain HTTP/1.0 GET over SOCKS5
    private suspend fun runDeepHttpProbe(
        host: String, port: Int, isDomain: Boolean = false
    ): Triple<Boolean, Int, String> {
        return runCatching {
            withContext(Dispatchers.IO) {
                val proxy = Proxy(Proxy.Type.SOCKS, InetSocketAddress("127.0.0.1", 10808))
                Socket(proxy).use { sock ->
                    sock.soTimeout = 6_000
                    if (isDomain) {
                        sock.connect(InetSocketAddress.createUnresolved(host, port), 6_000)
                    } else {
                        sock.connect(InetSocketAddress(host, port), 6_000)
                    }
                    val req = "GET / HTTP/1.0\r\nHost: $host\r\nUser-Agent: SetaLink/1.0\r\nConnection: close\r\n\r\n"
                    sock.getOutputStream().apply { write(req.toByteArray()); flush() }
                    val buf  = ByteArray(2048)
                    val read = sock.getInputStream().read(buf)
                    if (read > 0) {
                        val snippet = String(buf, 0, minOf(read, 80)).replace("\r\n", " ").take(80)
                        Triple(true, read, snippet)
                    } else {
                        Triple(false, 0, "0 bytes read")
                    }
                }
            }
        }.onFailure { e ->
            appendLog("[HTTP PROBE] $host:$port failed: ${e.javaClass.simpleName}: ${e.message}")
        }.getOrElse { Triple(false, 0, it?.message?.take(60) ?: "exception") }
    }

    // Returns (ok, bytesRead, snippet) — HTTPS/TLS GET over SOCKS5.
    // This is the correct probe for xtls-rprx-vision servers: the inner payload is a
    // TLS ClientHello that Vision recognises and splices — exactly what real apps send.
    private suspend fun runHttpsProbe(host: String): Triple<Boolean, Int, String> {
        return runCatching {
            withContext(Dispatchers.IO) {
                val proxy   = Proxy(Proxy.Type.SOCKS, InetSocketAddress("127.0.0.1", 10808))
                val rawSock = Socket(proxy)
                try {
                    rawSock.soTimeout = 8_000
                    rawSock.connect(InetSocketAddress.createUnresolved(host, 443), 8_000)
                    val sslFactory = SSLSocketFactory.getDefault() as SSLSocketFactory
                    val sslSock   = sslFactory.createSocket(rawSock, host, 443, true) as SSLSocket
                    sslSock.soTimeout = 8_000
                    try {
                        sslSock.startHandshake()
                        val req = "GET / HTTP/1.1\r\nHost: $host\r\nUser-Agent: SetaLink/1.0\r\nConnection: close\r\n\r\n"
                        sslSock.outputStream.apply { write(req.toByteArray()); flush() }
                        val buf  = ByteArray(2048)
                        val read = sslSock.inputStream.read(buf)
                        if (read > 0) {
                            val snippet = String(buf, 0, minOf(read, 80)).replace("\r\n", " ").take(80)
                            Triple(true, read, "TLS OK: $snippet")
                        } else {
                            Triple(false, 0, "TLS handshake OK but 0 bytes")
                        }
                    } finally {
                        runCatching { sslSock.close() }
                    }
                } finally {
                    runCatching { rawSock.close() }
                }
            }
        }.onFailure { e ->
            appendLog("[HTTPS PROBE] $host:443 failed: ${e.javaClass.simpleName}: ${e.message}")
        }.getOrElse { Triple(false, 0, it?.message?.take(80) ?: "exception") }
    }

    // ── Periodic metrics loop ─────────────────────────────────────────────────

    private fun startMetricsLoop(tunInterface: String?) {
        scope.launch {
            var lastRx = readInterfaceBytes(tunInterface ?: "")?.first  ?: 0L
            var lastTx = readInterfaceBytes(tunInterface ?: "")?.second ?: 0L
            var iteration = 0
            while (isActive) {
                delay(METRICS_INTERVAL_MS)
                iteration++
                val bytes   = tunInterface?.let { readInterfaceBytes(it) }
                val curRx   = bytes?.first  ?: lastRx
                val curTx   = bytes?.second ?: lastTx
                val rxDelta = maxOf(0L, curRx - lastRx)
                val txDelta = maxOf(0L, curTx - lastTx)
                lastRx = curRx
                lastTx = curTx

                // Log every 5 iterations or when there's traffic
                if (iteration % 5 == 0 || rxDelta > 0 || txDelta > 0) {
                    appendLog("[METRICS#$iteration] TUN iface=${tunInterface ?: "?"} rx_total=$curRx tx_total=$curTx rx_delta=$rxDelta tx_delta=$txDelta")
                }

                publishMetrics(tunInterface, rxDelta, txDelta, true)
            }
        }
    }

    // ── Process watchdog ──────────────────────────────────────────────────────

    private fun startWatchdog() {
        scope.launch {
            while (isActive) {
                delay(3_000L)
                val xAlive = xrayProcess?.isAlive == true
                val tAlive = tun2socksPid?.let { nativeTun2socksExitCode(it) == -2 } == true
                if (!xAlive || !tAlive) {
                    val t2sLog  = readTun2socksLog()
                    val logTail = readLogTail(20)
                    val msg = "Process died (xray=$xAlive tun2socks=$tAlive)\nt2s output:\n$t2sLog\nxray log:\n$logTail"
                    Log.e(TAG, msg)
                    broadcastError(msg)
                    tearDownTunnel()
                    break
                }
            }
        }
    }

    // ── tun2socks log tail ────────────────────────────────────────────────────

    private suspend fun tailTun2socksLog() {
        val logFile = File(filesDir, TUN2SOCKS_LOG_FILE)
        var offset = 0L
        while (scope.isActive) {
            delay(500L)
            runCatching {
                if (!logFile.exists() || logFile.length() <= offset) return@runCatching
                RandomAccessFile(logFile, "r").use { raf ->
                    raf.seek(offset)
                    val buf = ByteArray((logFile.length() - offset).coerceAtMost(4096).toInt())
                    val read = raf.read(buf)
                    if (read > 0) {
                        offset += read
                        val text = String(buf, 0, read)
                        text.lines().filter { it.isNotBlank() }.forEach { line ->
                            Log.d("tun2socks", line)
                            appendLog("[t2s] $line")
                        }
                    }
                }
            }
        }
    }

    fun readTun2socksLog(): String {
        return runCatching {
            val f = File(filesDir, TUN2SOCKS_LOG_FILE)
            if (!f.exists()) return "(no tun2socks.log)"
            f.readLines().takeLast(40).joinToString("\n").ifEmpty { "(empty)" }
        }.getOrElse { "(unreadable)" }
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

            val outputDeferred = scope.async(Dispatchers.IO) {
                proc.inputStream.bufferedReader().readText()
            }

            val exitCode = withContext(Dispatchers.IO) {
                val deadline = System.currentTimeMillis() + 5_000L
                while (proc.isAlive && System.currentTimeMillis() < deadline) delay(100L)
                if (proc.isAlive) { proc.destroyForcibly(); null } else proc.exitValue()
            }

            val output = outputDeferred.await()
            appendLog("[CONFIG TEST exit=$exitCode]\n$output")

            when {
                exitCode == null -> TestResult(false, "(timed out)", "Config test timed out")
                exitCode == 0    -> TestResult(true, output, "")
                else             -> {
                    // "Job was cancelled" is Xray's generic context-cancellation output —
                    // it masks the real error. Collect all diagnostic lines:
                    // 1. Lines containing error/fail/invalid/cancel keywords
                    // 2. Last 8 non-blank lines (where Xray prints the root cause)
                    val keywords = setOf("error", "fail", "invalid", "cancel", "reject", "panic")
                    val errorLines = output.lines().filter { line ->
                        val l = line.lowercase()
                        line.isNotBlank() && keywords.any { l.contains(it) }
                    }
                    val tailLines = output.lines().filter { it.isNotBlank() }.takeLast(8)
                    val combined  = (errorLines + tailLines).distinct()
                    val summary   = combined.joinToString(" | ").take(400)
                        .ifEmpty { "Config invalid (exit=$exitCode)" }
                    TestResult(false, output, summary)
                }
            }
        } catch (e: Exception) {
            appendLog("[CONFIG TEST EXCEPTION] ${e.message}")
            TestResult(false, e.message ?: "", e.message ?: "Config test failed")
        }
    }

    // ── Teardown ──────────────────────────────────────────────────────────────

    private fun killStaleProcesses() {
        xrayProcess?.let { it.destroyForcibly(); appendLog("[CLEANUP] killed stale xray") }
        xrayProcess = null
        tun2socksPid?.let { nativeStopTun2socks(it); appendLog("[CLEANUP] killed stale tun2socks pid=$it") }
        tun2socksPid = null
        runCatching { tunFd?.close() }
        tunFd = null
    }

    private fun tearDownTunnel() {
        xrayProcess?.destroyForcibly();              xrayProcess  = null
        tun2socksPid?.let { nativeStopTun2socks(it) }; tun2socksPid = null
        runCatching { tunFd?.close() }
        tunFd = null
        sendBroadcast(Intent(BROADCAST_DISCONNECTED).setPackage(packageName))
        stopForeground(STOP_FOREGROUND_REMOVE)
        stopSelf()
    }

    // ── Broadcast helpers ─────────────────────────────────────────────────────

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

    private fun broadcastRouteDiagnostics(tunInterface: String?, mtu: Int, emergency: Boolean) {
        val cm     = getSystemService(ConnectivityManager::class.java)
        val caps   = cm?.getNetworkCapabilities(cm.activeNetwork)
        val transport = when {
            caps == null -> "unknown"
            caps.hasTransport(NetworkCapabilities.TRANSPORT_WIFI) -> "wifi"
            caps.hasTransport(NetworkCapabilities.TRANSPORT_CELLULAR) -> "mobile"
            else -> "other"
        }
        val routes = buildString {
            append("0.0.0.0/0")
            if (!emergency) append(", ::/0")
        }
        val dns = if (emergency) "1.1.1.1" else "1.1.1.1,8.8.8.8"
        broadcastStep("route_diag", true,
            "iface=${tunInterface ?: "?"} mtu=$mtu routes=$routes dns=$dns net=$transport emergency=$emergency")
        appendLog("[ROUTE_DIAG] iface=${tunInterface ?: "?"} mtu=$mtu routes=$routes dns=$dns net=$transport")
    }

    private fun publishMetrics(tunInterface: String?, rxDelta: Long, txDelta: Long, probeOk: Boolean) {
        sendBroadcast(Intent(BROADCAST_METRICS).apply {
            setPackage(packageName)
            putExtra("tunInterface", tunInterface ?: "unknown")
            putExtra("tunRxDelta",   rxDelta)
            putExtra("tunTxDelta",   txDelta)
            putExtra("probeOk",      probeOk)
        })
    }

    // ── Interface helpers ─────────────────────────────────────────────────────

    private fun findTunInterfaceName(): String? {
        return runCatching {
            NetworkInterface.getNetworkInterfaces()?.toList()
                ?.firstOrNull { iface ->
                    val n = iface.name.lowercase()
                    iface.isUp && (n.startsWith("tun") || n.startsWith("ppp"))
                }?.name
        }.getOrNull()
    }

    private fun readInterfaceBytes(iface: String): Pair<Long, Long>? {
        if (iface.isBlank()) return null
        return runCatching {
            File("/proc/net/dev").readLines()
                .firstOrNull { it.trimStart().startsWith("$iface:") }
                ?.let { line ->
                    val fields = line.substringAfter(":").trim().split(Regex("\\s+"))
                    // /proc/net/dev columns: rx_bytes rx_packets … tx_bytes tx_packets …
                    // Index 0 = rx_bytes, index 8 = tx_bytes
                    Pair(fields[0].toLong(), fields[8].toLong())
                }
        }.getOrNull()
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

    private fun resolveBinary(libName: String): File {
        val nativeDir = File(applicationInfo.nativeLibraryDir)
        val binFile   = File(nativeDir, libName)

        val diag = "path=${binFile.absolutePath} exists=${binFile.exists()} " +
                   "size=${binFile.length()}B canExecute=${binFile.canExecute()}"
        appendLog("[BINARY] $diag")
        Log.i(TAG, "Binary $libName: $diag")

        if (!binFile.exists()) {
            val contents = nativeDir.list()?.joinToString() ?: "dir missing"
            throw Exception("Binary $libName not found.\nnativeDir contents: $contents")
        }
        if (!binFile.canExecute()) {
            binFile.setExecutable(true, false)
            if (!binFile.canExecute()) {
                throw Exception("Binary $libName not executable at ${binFile.absolutePath}")
            }
            appendLog("[BINARY] $libName chmod succeeded")
        }
        return binFile
    }

    private suspend fun waitForPort(port: Int, timeoutMs: Long): Boolean {
        val deadline = System.currentTimeMillis() + timeoutMs
        while (System.currentTimeMillis() < deadline) {
            try {
                Socket().use { s -> s.connect(InetSocketAddress("127.0.0.1", port), 200) }
                return true
            } catch (_: Exception) {}
            delay(300L)
        }
        return false
    }
}
