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
import java.net.HttpURLConnection
import java.net.InetSocketAddress
import java.net.NetworkInterface
import java.net.Proxy
import java.net.Socket
import java.net.URL
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

        const val BROADCAST_CONNECTED     = "com.setalink.vpn.CONNECTED"
        const val BROADCAST_DISCONNECTED  = "com.setalink.vpn.DISCONNECTED"
        const val BROADCAST_STEP          = "com.setalink.vpn.STEP"
        const val BROADCAST_ROUTING_FAIL  = "com.setalink.vpn.ROUTING_FAIL"
        const val EXTRA_ERROR            = "error_message"
        const val EXTRA_STEP             = "step_name"
        const val EXTRA_STEP_OK          = "step_ok"
        const val EXTRA_STEP_MSG         = "step_msg"
        const val BROADCAST_METRICS        = "com.setalink.vpn.METRICS"
        const val BROADCAST_TRAFFIC_STALL = "com.setalink.vpn.TRAFFIC_STALL"

        // Failure categories sent in BROADCAST_DISCONNECTED extra "failure_category"
        const val FAIL_REALITY_CLIENTHELLO = "reality_clienthello_failed"
        const val FAIL_WS_UPGRADE          = "ws_upgrade_failed"
        const val FAIL_XHTTP_PATH_MISMATCH = "xhttp_path_mismatch"
        const val FAIL_SOCKS_PROBE_TIMEOUT = "socks_probe_timeout"
        const val FAIL_DNS_FAILED          = "dns_failed"
        const val FAIL_NO_INTERNET         = "no_internet_routed"

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

            // Verify SOCKS5 with a real protocol handshake (not just TCP connect)
            Log.i(TAG, "SETALINK_SOCKS_READY port=10808 — verifying SOCKS5 handshake")
            val socksHandshakeOk = verifySocks5Handshake(10808)
            appendLog("[SOCKS5] handshake probe: ok=$socksHandshakeOk")
            if (!socksHandshakeOk) {
                val logTail = readLogTail(20)
                broadcastStep("socks_handshake", false,
                    "SOCKS5 handshake FAILED — Xray inbound not responding correctly on 127.0.0.1:10808\n$logTail")
                throw Exception("SOCKS5 handshake failed on port 10808 — Xray may not have SOCKS inbound configured")
            }
            broadcastStep("socks_handshake", true, "SOCKS5 handshake OK on 127.0.0.1:10808 — Xray inbound responding")

            // 6. Build TUN interface
            val mtu = if (emergencyMode) 1280 else 1400
            val vpnBuilder = Builder()
                .setSession("SetaLink")
                .addAddress("10.0.0.2", 24)
                .addDnsServer("1.1.1.1")
                .addRoute("0.0.0.0", 0)
                .addRoute("::", 0)
                .setMtu(mtu)

            if (!emergencyMode) {
                vpnBuilder.addDnsServer("8.8.8.8")
            }

            // Exclude our UID so Xray (same UID) can reach the VPN server directly
            // without looping back through TUN → tun2socks → Xray → TUN.
            runCatching { vpnBuilder.addDisallowedApplication(packageName) }
                .onFailure { e -> appendLog("[TUN] addDisallowedApplication failed: ${e.message}") }

            appendLog("[TUN] IPv4+IPv6 routed through TUN — Xray blackhole handles unsupported IPv6")

            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                vpnBuilder.setMetered(false)
            }

            tunFd = vpnBuilder.establish()
                ?: throw Exception("TUN establish() returned null — VPN permission revoked?")
            val tunFdInt   = tunFd!!.fd
            val tunInterface = findTunInterfaceName()

            val cloexecResult = nativeClearCloexec(tunFdInt)
            appendLog("[TUN] fd=$tunFdInt iface=${tunInterface ?: "?"} mtu=$mtu FD_CLOEXEC_clear=$cloexecResult emergencyMode=$emergencyMode")
            Log.i(TAG, "SETALINK_ROUTE_ADDED 0.0.0.0/0 ::/0 dns=${if (emergencyMode) "1.1.1.1" else "1.1.1.1,8.8.8.8"} iface=${tunInterface ?: "?"} fd=$tunFdInt mtu=$mtu")
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
            Log.i(TAG, "SETALINK_TUN_STARTED fd=$tunFdInt pid=$pid proxy=socks5://127.0.0.1:10808 iface=${tunInterface ?: "?"}")
            broadcastStep("tun2socks_alive", true,
                "tun2socks running pid=$pid — fd://$tunFdInt → socks5://127.0.0.1:10808")

            // 8. Probe internet via VPN network — confirms actual device traffic routing.
            // This goes through TUN → tun2socks → SOCKS5 → Xray, NOT via direct SOCKS5.
            // Uses Network.openConnection() which bypasses UID exclusion on the VPN network.
            // Do NOT mark CONNECTED until HTTP 200 body is received.
            broadcastStep("tun_probe", true, "Probing TUN routing — https://1.1.1.1/cdn-cgi/trace…")
            appendLog("[TUN-PROBE] Starting TUN routing verification via ConnectivityManager VPN network")
            val tunProbe = runTunNetworkProbe()

            if (!tunProbe.ok) {
                val category = tunProbe.category
                val msg = "Server connected, but internet is not routed through VPN. ${tunProbe.message}"
                broadcastStep("tun_probe", false, "[$category] $msg")
                // Log UUID being used — helps detect UUID mismatches in admin diagnostics.
                // "invalid request user id" in Xray log = UUID in this config doesn't match server.
                runCatching {
                    val cfg  = JSONObject(configJson)
                    val uuid = cfg.getJSONArray("outbounds").getJSONObject(0)
                        .getJSONObject("settings").getJSONArray("vnext").getJSONObject(0)
                        .getJSONArray("users").getJSONObject(0).optString("id", "?")
                    appendLog("[UUID-CHECK] uuid=${uuid.take(8)}… category=$category — if 'invalid request user id' appears above, UUID mismatch")
                }.onFailure {}
                appendLog("[TUN-PROBE FAILED] category=$category $msg")
                sendBroadcast(Intent(BROADCAST_ROUTING_FAIL).apply {
                    setPackage(packageName)
                    putExtra(EXTRA_ERROR, msg)
                    putExtra("failure_category", category)
                })
                broadcastError(msg, category)
                tearDownTunnel()
                return
            }

            broadcastStep("tun_probe", true, "TUN routing confirmed — ${tunProbe.message}")
            appendLog("[TUN-PROBE OK] ${tunProbe.message}")

            // 9. Broadcast CONNECTED — TUN routing verified by real HTTPS GET
            broadcastStep("vpn_connected", true, "Tunnel active — internet routing confirmed")
            Log.i(TAG, "VPN tunnel active — TUN routing verified")
            sendBroadcast(Intent(BROADCAST_CONNECTED).apply {
                setPackage(packageName)
                putExtra("probe_ok", true)
            })

            // 10. Start continuous metrics loop + process watchdog
            startMetricsLoop(tunInterface)
            startWatchdog()

            // 11. Background validation — now used mainly for metrics/ping
            scope.launch { runBackgroundValidation(tunInterface) }

        } catch (e: Exception) {
            Log.e(TAG, "Tunnel setup failed: ${e.message}", e)
            appendLog("[TUNNEL FAILED] ${e.message}")
            val t2sLog = runCatching { readTun2socksLog() }.getOrDefault("(unavailable)")
            appendLog("[tun2socks output at failure]\n$t2sLog")
            broadcastError(e.message ?: "Unknown VPN error")
            tearDownTunnel()
        }
    }

    // ── Background validation (non-blocking) ─────────────────────────────────

    private suspend fun runBackgroundValidation(tunInterface: String?) {
        try {
            // Log tun2socks status before probing
            val t2sLog = readTun2socksLog()
            val t2sHasErrors = t2sLog.lines().any { line ->
                val l = line.lowercase()
                l.contains("error") || l.contains("fatal") || l.contains("failed") ||
                l.contains("panic") || l.contains("exit")
            }
            if (t2sHasErrors) {
                broadcastStep("tun2socks_check", false,
                    "tun2socks reported errors — TUN forwarding may be degraded.\n$t2sLog")
            } else {
                broadcastStep("tun2socks_check", true, "tun2socks active")
            }

            val validation = runDeepValidation(tunInterface)

            broadcastStep("routing_validation", validation.ok, validation.message)

            if (!validation.ok) {
                broadcastStep("probe_warning", false,
                    "Internet probe failed — tunnel active but HTTP validation timed out. " +
                    "Apps may still work. ${validation.message}")
                appendLog("[BG-VALIDATION] WARN: ${validation.message}")
            } else {
                appendLog("[BG-VALIDATION] OK: probeOk=${validation.probeOk} — ${validation.message}")
            }

            // Publish final probe result without resetting session counters
            sendBroadcast(Intent(BROADCAST_CONNECTED).apply {
                setPackage(packageName)
                putExtra("probe_ok", validation.probeOk)
                putExtra("probe_update", true)
            })

            // Browser-compatibility probes: run after primary validation so they don't
            // delay the CONNECTED signal. Tests real websites and reports QUIC status.
            if (validation.probeOk) {
                runBrowserCompatibilityProbes()
            }
        } catch (e: Exception) {
            appendLog("[BG-VALIDATION] Exception: ${e.message}")
            broadcastStep("validation_error", false, "Background validation error: ${e.message}")
        }
    }

    // ── Browser compatibility probes ──────────────────────────────────────────
    // Probes real websites via TCP/TLS over SOCKS5 — confirms Chrome/Firefox browsing works.
    // UDP/443 (QUIC/HTTP3) is blackholed in the Xray routing config; Chrome falls back to
    // TCP HTTPS automatically. We report the QUIC mode here for the diagnostics UI.

    private suspend fun runBrowserCompatibilityProbes() {
        appendLog("[BROWSER-COMPAT] Starting browser compatibility probes")

        // TCP HTTPS probe — real websites Chrome would visit
        data class BrowserTarget(val host: String, val label: String)
        val targets = listOf(
            BrowserTarget("example.com",   "example.com"),
            BrowserTarget("vg.no",         "vg.no"),
            BrowserTarget("cloudflare.com","cloudflare.com"),
        )

        var tcpHttpsOk   = false
        var tcpHttpsHost = ""
        var tcpHttpsBytes = 0

        for (t in targets) {
            val (ok, bytes, snippet) = runHttpsProbe(t.host)
            appendLog("[BROWSER-COMPAT] ${t.label}:443 TCP/TLS → ok=$ok bytes=$bytes snippet=$snippet")
            broadcastStep("browser_probe_${t.label.replace('.', '_')}", ok,
                "${t.label}:443 TCP/TLS → ${if (ok) "OK (${bytes}B)" else "FAIL: $snippet"}")
            if (ok && !tcpHttpsOk) { tcpHttpsOk = true; tcpHttpsHost = t.label; tcpHttpsBytes = bytes }
        }

        // DNS probe — confirm hostname resolution works end-to-end
        val dnsOk = runCatching {
            withContext(kotlinx.coroutines.Dispatchers.IO) {
                val proxy = java.net.Proxy(java.net.Proxy.Type.SOCKS, InetSocketAddress("127.0.0.1", 10808))
                Socket(proxy).use { s ->
                    s.connect(InetSocketAddress.createUnresolved("one.one.one.one", 80), 5_000)
                    true
                }
            }
        }.onFailure { e -> appendLog("[BROWSER-COMPAT] DNS probe failed: ${e.message}") }
         .getOrElse { false }

        if (dnsOk) Log.i(TAG, "SETALINK_DNS_OK — one.one.one.one resolved via SOCKS5")
        broadcastStep("dns_resolve", dnsOk,
            if (dnsOk) "DNS OK — hostname resolution working through tunnel"
            else        "DNS FAIL — hostname resolution failed through tunnel")

        // QUIC/UDP status — always blocked (routing rule: udp port 443 → blackhole).
        // Chrome detects the fast rejection and retries over TCP/TLS without hanging.
        broadcastStep("quic_status", true,
            "UDP/443 blackholed — QUIC fast-rejected · Chrome uses TCP HTTPS fallback · No hang")

        // Overall browser compatibility verdict
        val tcpMsg = if (tcpHttpsOk)
            "TCP HTTPS OK via $tcpHttpsHost ($tcpHttpsBytes B) · DNS ${if (dnsOk) "OK" else "FAIL"} · QUIC blocked (TCP fallback active)"
        else
            "TCP HTTPS FAILED — browser browsing may not work through this tunnel"

        broadcastStep("browser_compat", tcpHttpsOk, tcpMsg)
        appendLog("[BROWSER-COMPAT] tcpHttpsOk=$tcpHttpsOk dnsOk=$dnsOk quic=blocked(blackhole) host=$tcpHttpsHost")

        // Publish QUIC-aware connected status so the UI can show the right message
        sendBroadcast(Intent(BROADCAST_CONNECTED).apply {
            setPackage(packageName)
            putExtra("probe_ok",     tcpHttpsOk)
            putExtra("probe_update", true)
            putExtra("quic_blocked", true)
            putExtra("tcp_https_ok", tcpHttpsOk)
            putExtra("dns_ok",       dnsOk)
        })
    }

    // ── Deep validation ───────────────────────────────────────────────────────

    private data class ValidationResult(val ok: Boolean, val message: String, val probeOk: Boolean = false, val category: String = FAIL_NO_INTERNET)

    private suspend fun runDeepValidation(tunInterface: String?): ValidationResult {
        // Snapshot TUN bytes before probe
        val bytesBefore = tunInterface?.let { readInterfaceBytes(it) }
        appendLog("[VALIDATION] TUN snapshot before probe: rx=${bytesBefore?.first ?: -1} tx=${bytesBefore?.second ?: -1} iface=${tunInterface ?: "?"}")

        // Step A: SOCKS5 TCP connect to a reliable IP (proves Xray is listening).
        // Use 1.1.1.1:80 — raw IP, no DNS, fast TCP-level confirmation.
        appendLog("[VALIDATION-A] SOCKS5 TCP connect → 1.1.1.1:80")
        val tcpOk = runCatching {
            val proxy = Proxy(Proxy.Type.SOCKS, InetSocketAddress("127.0.0.1", 10808))
            Socket(proxy).use { sock ->
                sock.connect(InetSocketAddress("1.1.1.1", 80), 10_000)
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

        // Step B: HTTPS probe via SSLSocket — tried FIRST because xtls-rprx-vision
        // (Vision flow) is specifically designed to splice TLS inner streams. Vision
        // correctly detects the TLS ClientHello and forwards raw bytes to the target.
        // Plain HTTP (non-TLS) requires Vision's fallback path which can be slower
        // under high-latency conditions. Trying HTTPS first maximises pass rate
        // on Vision Reality servers in high-latency regions (Turkey, Iran, etc.).
        var httpsOk     = false
        var httpsBytes  = 0
        var httpsHost   = ""

        for (host in listOf("connectivitycheck.gstatic.com", "captive.apple.com", "clients3.google.com", "www.cloudflare.com")) {
            appendLog("[VALIDATION-B] HTTPS probe -> $host:443 via SOCKS5+TLS")
            val (ok, bytes, snippet) = runHttpsProbe(host)
            appendLog("[VALIDATION-B] $host -> ok=$ok bytes=$bytes snippet=$snippet")
            if (ok) { httpsOk = true; httpsBytes = bytes; httpsHost = host; break }
        }

        // Step C: HTTP GET via SOCKS5 — fallback for servers without Vision flow
        // (e.g. WebSocket/XHTTP transport profiles).
        // connectivitycheck.gstatic.com returns HTTP 204, captive.apple.com HTTP 200.
        // 1.1.1.1 is a raw-IP fallback (no DNS resolution needed inside Xray).
        data class ProbeTarget(val host: String, val port: Int, val isDomain: Boolean)
        val httpTargets = listOf(
            ProbeTarget("connectivitycheck.gstatic.com", 80, true),
            ProbeTarget("captive.apple.com",             80, true),
            ProbeTarget("1.1.1.1",                       80, false),
        )

        var httpOk      = false
        var httpBytes   = 0
        var httpSnippet = "not attempted"
        var httpHost    = ""

        if (!httpsOk) {
            for (target in httpTargets) {
                appendLog("[VALIDATION-C] HTTP GET http://${target.host}/ via SOCKS5")
                val (ok, bytes, snippet) = runDeepHttpProbe(target.host, target.port, target.isDomain)
                appendLog("[VALIDATION-C] ${target.host} -> ok=$ok bytes=$bytes snippet=$snippet")
                httpSnippet = snippet
                if (ok) { httpOk = true; httpBytes = bytes; httpHost = target.host; break }
            }
        }

        // Snapshot TUN bytes after probe (0 expected — our UID is excluded from TUN)
        val bytesAfter = tunInterface?.let { readInterfaceBytes(it) }
        val rxSnap = bytesAfter?.first  ?: -1L
        val txSnap = bytesAfter?.second ?: -1L
        appendLog("[VALIDATION] TUN after probes: rx=$rxSnap tx=$txSnap (app UID excluded from TUN)")

        val probeOk = httpOk || httpsOk
        publishMetrics(tunInterface, rxSnap, txSnap, probeOk)

        if (httpsOk) {
            Log.i(TAG, "SETALINK_HTTP_OK via $httpsHost (${httpsBytes}B) TCP+HTTPS — TUN rx=$rxSnap tx=$txSnap")
            Log.i(TAG, "SETALINK_DNS_OK — hostname resolved via Xray SOCKS5")
            return ValidationResult(true,
                "TCP+HTTPS OK via $httpsHost (${httpsBytes}B) — TLS/Vision traffic confirmed. " +
                "TUN rx=$rxSnap tx=$txSnap",
                probeOk = true)
        }
        if (httpOk) {
            Log.i(TAG, "SETALINK_HTTP_OK via $httpHost (${httpBytes}B) TCP+HTTP — TUN rx=$rxSnap tx=$txSnap")
            return ValidationResult(true,
                "TCP+HTTP OK via $httpHost (${httpBytes}B). TUN rx=$rxSnap tx=$txSnap",
                probeOk = true)
        }

        // All probes failed.
        appendLog("[VALIDATION] HARD FAIL — TCP OK but ALL HTTPS+HTTP probes timed out. " +
            "Possible causes: wrong flow/SNI, wrong paths (WS/XHTTP), server-side drop. " +
            "HTTP snippet: $httpSnippet  Disconnecting to try next profile.")
        broadcastStep("probe_fail", false,
            "TCP OK — HTTPS+HTTP probes all failed. VPN not confirmed. Trying next profile.")

        return ValidationResult(false,
            "TCP OK — but no HTTP or HTTPS data received through tunnel. " +
            "HTTP snippet: $httpSnippet. VPN server may not be forwarding traffic.")
    }

    // ── TUN routing probe (ConnectivityManager VPN network) ───────────────────
    // Attempts a VPN-network-bound HTTPS probe first. Our app UID is excluded from
    // TUN (addDisallowedApplication) so Network.bindSocket() / openConnection() may
    // return EPERM on some devices. When EPERM occurs we fall back to process-health
    // validation: confirm Xray + tun2socks are alive and the TUN interface exists.

    private suspend fun runTunNetworkProbe(): ValidationResult {
        val cm = getSystemService(ConnectivityManager::class.java)
        appendLog("[TUN-PROBE] Waiting for VPN network to appear in ConnectivityManager…")

        var vpnNet: android.net.Network? = null
        val findDeadline = System.currentTimeMillis() + 8_000L
        while (System.currentTimeMillis() < findDeadline && vpnNet == null) {
            vpnNet = cm?.allNetworks?.firstOrNull { net ->
                cm.getNetworkCapabilities(net)
                    ?.hasTransport(NetworkCapabilities.TRANSPORT_VPN) == true
            }
            if (vpnNet == null) delay(500L)
        }

        if (vpnNet == null) {
            appendLog("[TUN-PROBE] VPN network not found in ConnectivityManager after 8s")
            return ValidationResult(false,
                "VPN network not registered with system — TUN routing unavailable")
        }
        appendLog("[TUN-PROBE] VPN network found: $vpnNet — GET https://1.1.1.1/cdn-cgi/trace")

        val probeOutcome = runCatching {
            withContext(Dispatchers.IO) {
                // Try several captive-portal / trace endpoints — choose the first 200 response.
                // Targets are chosen to be unrestricted in Iran and have minimal TLS overhead.
                val targets = listOf(
                    "https://1.1.1.1/cdn-cgi/trace",          // Cloudflare — primary
                    "http://cp.cloudflare.com/",               // Cloudflare HTTP captive portal
                    "http://connectivitycheck.gstatic.com/",   // Google Android captive check
                    "https://captive.apple.com/hotspot-detect.html",
                )
                var lastErr = ""
                var result: ValidationResult? = null
                for (target in targets) {
                    if (result != null) break
                    runCatching {
                        val url  = URL(target)
                        val conn = vpnNet.openConnection(url) as HttpURLConnection
                        // 25 s: Reality TLS (~50 ms RTT) + VLESS framing + target connection
                        // under Iran latency (packet loss, censorship overhead).
                        conn.connectTimeout = 25_000
                        conn.readTimeout    = 25_000
                        conn.setRequestProperty("User-Agent", "SetaLink/1.0")
                        try {
                            val code = conn.responseCode
                            if (code in 200..299) {
                                val body   = conn.inputStream.bufferedReader().readText()
                                val ipLine = body.lines().firstOrNull { it.startsWith("ip=") } ?: ""
                                val info   = if (ipLine.isNotEmpty()) ipLine else "HTTP $code ${body.length}B"
                                appendLog("[TUN-PROBE] OK: $target → $info")
                                result = ValidationResult(true, "$target → $info", probeOk = true)
                            } else {
                                appendLog("[TUN-PROBE] $target → HTTP $code (non-2xx)")
                                lastErr = "HTTP $code from $target"
                            }
                        } finally {
                            conn.disconnect()
                        }
                    }.onFailure { e ->
                        lastErr = "${e.javaClass.simpleName}: ${e.message?.take(80)}"
                        appendLog("[TUN-PROBE] $target failed: $lastErr")
                    }
                }
                result ?: ValidationResult(false,
                    "All TUN probes failed. Last: $lastErr")
            }
        }

        probeOutcome.onSuccess { r -> if (r.ok) return r }

        // vpnNet.openConnection() failed. Since our app UID is excluded from TUN via
        // addDisallowedApplication(), Network.openConnection() is inherently unreliable
        // and can fail with EPERM, timeout, SSL errors, or connection refused depending
        // on the Android ROM. Always fall back to SOCKS5-based internet validation which
        // is always reachable regardless of VPN UID exclusion.
        val err    = probeOutcome.exceptionOrNull()
        val errMsg = err?.message ?: ""
        appendLog("[TUN-PROBE] openConnection failed (${err?.javaClass?.simpleName}: $errMsg) — running SOCKS5 fallback")
        broadcastStep("tun_probe_fallback", true,
            "VPN network probe failed (${errMsg.take(80)}) — checking SOCKS5 routing")
        return runTunEpermFallback()
    }

    // Fallback when bindSocket returns EPERM (app UID excluded from VPN via addDisallowedApplication).
    // Validates by running a SOCKS5-based internet probe through Xray instead of binding to the VPN
    // network directly. This is the authoritative check: if Xray can forward real traffic, the
    // tunnel is working regardless of whether Network.openConnection() is available.
    private suspend fun runTunEpermFallback(): ValidationResult {
        val xrayAlive = xrayProcess?.isAlive == true
        val t2sAlive  = tun2socksPid?.let { nativeTun2socksExitCode(it) == -2 } == true
        val tunIface  = findTunInterfaceName()
        val tunExists = tunIface != null

        appendLog("[TUN-FALLBACK] processes: xray=$xrayAlive t2s=$t2sAlive tunIface=$tunIface")

        if (!xrayAlive || !t2sAlive || !tunExists) {
            val reasons = buildList<String> {
                if (!xrayAlive) add("Xray not running")
                if (!t2sAlive)  add("tun2socks not running")
                if (!tunExists) add("TUN interface missing")
            }.joinToString("; ")
            broadcastStep("tun_fallback_fail", false, "Processes unhealthy: $reasons")
            return ValidationResult(false, "VPN setup incomplete: $reasons")
        }

        // Run SOCKS5 HTTPS probe — this goes through Xray (localhost:10808) and confirms
        // the tunnel is actually forwarding traffic to the internet. Unlike Network.openConnection(),
        // SOCKS5 is always reachable by our process regardless of VPN UID exclusion.
        broadcastStep("tun_eperm_probe", true, "Running SOCKS5 probe to confirm internet routing…")
        var probeOk    = false
        var probeNote  = "not attempted"

        for (host in listOf("connectivitycheck.gstatic.com", "captive.apple.com", "clients3.google.com")) {
            val (ok, bytes, snippet) = runHttpsProbe(host)
            appendLog("[TUN-FALLBACK] SOCKS5 HTTPS probe → $host: ok=$ok bytes=$bytes snippet=$snippet")
            if (ok) { probeOk = true; probeNote = "HTTPS OK via $host (${bytes}B)"; break }
            probeNote = "HTTPS $host failed: $snippet"
        }

        if (!probeOk) {
            // Try plain HTTP fallback
            val (ok, bytes, snippet) = runDeepHttpProbe("connectivitycheck.gstatic.com", 80, true)
            appendLog("[TUN-FALLBACK] SOCKS5 HTTP probe: ok=$ok bytes=$bytes snippet=$snippet")
            if (ok) { probeOk = true; probeNote = "HTTP OK via connectivitycheck.gstatic.com (${bytes}B)" }
            else probeNote = "All SOCKS5 probes failed — last: $snippet"
        }

        val xrayLogTail = readLogTail(40)
        val failCategory = if (probeOk) FAIL_NO_INTERNET else classifyFailure(xrayLogTail)
        appendLog("[TUN-FALLBACK] result: probeOk=$probeOk category=$failCategory note=$probeNote xray=$xrayAlive t2s=$t2sAlive TUN=$tunIface")

        return if (probeOk) {
            Log.i(TAG, "SETALINK_HTTP_OK via SOCKS5 — $probeNote TUN=$tunIface")
            broadcastStep("tun_fallback_ok", true,
                "SOCKS5 internet confirmed: $probeNote TUN=$tunIface")
            ValidationResult(
                ok       = true,
                message  = "SOCKS5 probe passed: $probeNote TUN=$tunIface",
                probeOk  = true,
                category = FAIL_NO_INTERNET,
            )
        } else {
            broadcastStep("tun_fallback_fail", false,
                "EPERM fallback — SOCKS5 internet probe FAILED [$failCategory]: $probeNote")
            ValidationResult(
                ok       = false,
                message  = "Server connected but internet not routed through VPN. $probeNote",
                category = failCategory,
            )
        }
    }

    // Returns (ok, bytesRead, snippet) — plain HTTP/1.0 GET over SOCKS5.
    // 10s connect timeout: allows for Reality TLS handshake + VLESS setup + target
    // connection under high-latency conditions (Turkey ~50ms RTT, potential packet loss).
    private suspend fun runDeepHttpProbe(
        host: String, port: Int, isDomain: Boolean = false
    ): Triple<Boolean, Int, String> {
        return runCatching {
            withContext(Dispatchers.IO) {
                val proxy = Proxy(Proxy.Type.SOCKS, InetSocketAddress("127.0.0.1", 10808))
                Socket(proxy).use { sock ->
                    if (isDomain) {
                        sock.connect(InetSocketAddress.createUnresolved(host, port), 10_000)
                    } else {
                        sock.connect(InetSocketAddress(host, port), 10_000)
                    }
                    sock.soTimeout = 10_000   // read timeout after connect
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
    // This is the PRIMARY probe for xtls-rprx-vision servers: the inner TLS ClientHello
    // is exactly what Vision recognises and splices. Tried FIRST in the validation sequence.
    // 12s timeout: Reality TLS + VLESS + target TLS handshake + HTTP response in high-latency
    // regions (Turkey, Iran) with potential packet retransmits.
    private suspend fun runHttpsProbe(host: String): Triple<Boolean, Int, String> {
        return runCatching {
            withContext(Dispatchers.IO) {
                val proxy   = Proxy(Proxy.Type.SOCKS, InetSocketAddress("127.0.0.1", 10808))
                val rawSock = Socket(proxy)
                try {
                    rawSock.connect(InetSocketAddress.createUnresolved(host, 443), 12_000)
                    rawSock.soTimeout = 12_000
                    val sslFactory = SSLSocketFactory.getDefault() as SSLSocketFactory
                    val sslSock   = sslFactory.createSocket(rawSock, host, 443, true) as SSLSocket
                    sslSock.soTimeout = 12_000
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
            var noTrafficIterations = 0
            while (isActive) {
                delay(METRICS_INTERVAL_MS)
                iteration++

                // First iteration: async DNS health check (does not block CONNECTED state)
                if (iteration == 1) {
                    scope.launch {
                        val dnsOk = runCatching {
                            val proxy = Proxy(Proxy.Type.SOCKS, InetSocketAddress("127.0.0.1", 10808))
                            Socket(proxy).use { s ->
                                s.soTimeout = 5_000
                                s.connect(InetSocketAddress.createUnresolved("www.google.com", 80), 5_000)
                                true
                            }
                        }.getOrElse { e ->
                            appendLog("[DNS-CHECK] Failed: ${e.message}")
                            false
                        }
                        appendLog("[DNS-CHECK] dnsOk=$dnsOk (google.com:80 via SOCKS5)")
                        broadcastStep("dns_check", dnsOk,
                            if (dnsOk) "DNS OK — hostname resolution working"
                            else "DNS FAILED — hostname resolution may not work through tunnel")
                    }
                }

                val bytes   = tunInterface?.let { readInterfaceBytes(it) }
                val curRx   = bytes?.first  ?: lastRx
                val curTx   = bytes?.second ?: lastTx
                val rxDelta = maxOf(0L, curRx - lastRx)
                val txDelta = maxOf(0L, curTx - lastTx)
                lastRx = curRx
                lastTx = curTx

                // Traffic stall detection
                if (rxDelta == 0L && txDelta == 0L) {
                    noTrafficIterations++
                    if (noTrafficIterations % 10 == 0) {
                        val stallSec = noTrafficIterations * METRICS_INTERVAL_MS / 1000
                        appendLog("[STALL#$iteration] No TUN traffic for ${stallSec}s rx_total=$curRx tx_total=$curTx tun=${tunInterface ?: "?"}")
                        sendBroadcast(Intent(BROADCAST_TRAFFIC_STALL).apply {
                            setPackage(packageName)
                            putExtra("stall_seconds", stallSec)
                            putExtra("rx_total", curRx)
                            putExtra("tx_total", curTx)
                        })
                        broadcastStep("traffic_stall", false,
                            "No TUN traffic for ${stallSec}s — apps may have no internet")
                    }
                } else {
                    if (noTrafficIterations >= 10) {
                        val recoveredSec = noTrafficIterations * METRICS_INTERVAL_MS / 1000
                        appendLog("[STALL-RECOVERED#$iteration] Traffic resumed after ${recoveredSec}s stall")
                    }
                    noTrafficIterations = 0
                }

                // Log every 5 iterations or when there's traffic
                if (iteration % 5 == 0 || rxDelta > 0 || txDelta > 0) {
                    appendLog("[METRICS#$iteration] TUN iface=${tunInterface ?: "?"} rx_total=$curRx tx_total=$curTx rx_delta=$rxDelta tx_delta=$txDelta stall=${noTrafficIterations * 3}s")
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

    // Scans the Xray log to classify the transport failure category.
    // Categories map to admin failure_category field and help diagnose server-side errors.
    private fun classifyFailure(logTail: String): String {
        val log = logTail.lowercase()
        return when {
            log.contains("failed to read client hello") ||
            log.contains("clienthello")                  -> FAIL_REALITY_CLIENTHELLO
            log.contains("websocket protocol") ||
            log.contains("upgrade header") ||
            log.contains("not using the websocket")      -> FAIL_WS_UPGRADE
            log.contains("validate path") ||
            log.contains("path mismatch")                -> FAIL_XHTTP_PATH_MISMATCH
            log.contains("dns") &&
            (log.contains("failed") || log.contains("timeout")) -> FAIL_DNS_FAILED
            log.contains("timeout") ||
            log.contains("i/o timeout") ||
            log.contains("connection timed out")         -> FAIL_SOCKS_PROBE_TIMEOUT
            else                                         -> FAIL_NO_INTERNET
        }
    }

    private fun broadcastError(msg: String, failureCategory: String = FAIL_NO_INTERNET) {
        sendBroadcast(Intent(BROADCAST_DISCONNECTED).apply {
            setPackage(packageName)
            putExtra(EXTRA_ERROR, msg)
            putExtra("failure_category", failureCategory)
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
        val routes = "0.0.0.0/0, ::/0"
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

    // Sends a SOCKS5 greeting and reads the server method selection response.
    // Confirms Xray is actually serving SOCKS5, not just accepting TCP connections.
    private suspend fun verifySocks5Handshake(port: Int): Boolean {
        return runCatching {
            withContext(Dispatchers.IO) {
                Socket().use { sock ->
                    sock.connect(InetSocketAddress("127.0.0.1", port), 3_000)
                    sock.soTimeout = 3_000
                    // SOCKS5 greeting: VER=5, NMETHODS=1, METHOD=0x00 (no-auth)
                    sock.getOutputStream().write(byteArrayOf(0x05, 0x01, 0x00))
                    sock.getOutputStream().flush()
                    val resp = ByteArray(2)
                    val read = sock.getInputStream().read(resp)
                    // Valid SOCKS5 response: VER=0x05, METHOD=0x00 (no-auth selected)
                    read == 2 && resp[0] == 0x05.toByte() && resp[1] == 0x00.toByte()
                }
            }
        }.onFailure { e -> appendLog("[SOCKS5-HANDSHAKE] failed: ${e.javaClass.simpleName}: ${e.message}") }
         .getOrElse { false }
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
