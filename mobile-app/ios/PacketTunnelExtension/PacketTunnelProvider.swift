import NetworkExtension
import Foundation
import CryptoKit

// PacketTunnelProvider — routes device traffic through xray-core (VLESS/Reality).
//
// Architecture: NEProxySettings proxy mode (no tun2socks).
//   iOS apps → HTTP proxy 127.0.0.1:10809
//           → xray http-in → xray proxy outbound → VPN server
//
// IPC contract with XrayModule.swift (main app):
//   App Group: group.no.setalink.realink
//   Keys written BEFORE start:  xray_config_json, diag_device_id, diag_country, diag_app_version
//   Keys written AFTER attempt: last_tunnel_error, last_probe_ok, connection_log

private let kAppGroup      = "group.no.setalink.realink"
private let kConfigKey     = "xray_config_json"
private let kErrorKey      = "last_tunnel_error"
private let kProbeOkKey    = "last_probe_ok"
private let kLogKey        = "connection_log"
private let kDiagDeviceId  = "diag_device_id"
private let kDiagCountry   = "diag_country"
private let kDiagAppVer    = "diag_app_version"

private let kSocksPort: Int = 10808
private let kHttpPort:  Int = 10809

private let kUploadURL = "https://setalink.no/api.php?mobile=1&action=submit-tunnel-log"

// ── Parsed fields from the proxy outbound ──────────────────────────────────────
private struct ConfigMeta {
    var proto:      String = "(nil)"
    var network:    String = "(nil)"
    var security:   String = "(nil)"
    var serverName: String = "(nil)"
    var flow:       String = "(absent)"
    var addr:       String = "(nil)"
    var port:       Any    = "(nil)"
    var outbound0:  String = "{}"
    var inbound0:   String = "{}"
}

class PacketTunnelProvider: NEPacketTunnelProvider {

    private var log: [String]  = []
    private let startTime      = Date()

    // Captured during the attempt — assembled into the upload payload on finish.
    private var xrayVersion    = "(not reached)"
    private var lastStep       = "init"
    private var configMeta     = ConfigMeta()
    private var libxraySuccess = false
    private var libxrayError   = ""
    private var configSha256   = ""
    private var configLength   = 0
    private var configValid    = false
    private var sanitizedCfg   = ""

    // MARK: - Start

    override func startTunnel(options: [String: NSObject]? = nil,
                              completionHandler: @escaping (Error?) -> Void) {

        let pi = ProcessInfo.processInfo
        step("start")
        appendLog("Extension: \(Bundle.main.bundleIdentifier ?? "unknown") pid=\(pi.processIdentifier)")
        appendLog("iOS: \(pi.operatingSystemVersionString)")
        appendLog("App Group: \(kAppGroup)")

        // xray-core version — logged before RunXrayFromJSON so it appears even on config failures.
        captureXrayVersion()

        // Confirm which symbols the embedded LibXray.xcframework actually exports.
        // Runs before any libxray call so the result appears even on config failures.
        logLibxraySymbols()

        // ── Phase 1: load config ──────────────────────────────────────────────
        guard let shared = UserDefaults(suiteName: kAppGroup) else {
            fail("App Group \(kAppGroup) inaccessible — check entitlements", shared: nil,
                 completionHandler)
            return
        }
        guard let configJson = shared.string(forKey: kConfigKey), !configJson.isEmpty else {
            fail("No xray config in App Group — XrayModule.start() must be called first",
                 shared: shared, completionHandler)
            return
        }
        step("config loaded")
        configLength = configJson.count
        configSha256 = sha256(configJson)
        sanitizedCfg = sanitizeConfig(configJson)
        appendLog("Config: \(configLength) bytes sha256=\(configSha256)")

        // ── Phase 2: validate ─────────────────────────────────────────────────
        step("config validating")
        if let validationError = validateAndLogConfig(configJson) {
            appendLog("Config validation FAILED: \(validationError)")
            appendLog("Config head: \(configJson.prefix(400))")
            fail("Config validation: \(validationError)", shared: shared, completionHandler)
            return
        }
        configValid = true
        step("config valid")

        // ── Phase 3: start xray-core ──────────────────────────────────────────
        step("xray starting")
        let xrayT0 = Date()
        if let xrayError = startXrayCore(configJson: configJson) {
            fail(xrayError, shared: shared, completionHandler)
            return
        }
        step("xray started")
        appendLog("xray-core started in \(elapsed(since: xrayT0))")

        // ── Phase 4: apply NEPacketTunnelNetworkSettings ──────────────────────
        step("route install")
        applyNetworkSettings { [weak self] error in
            guard let self = self else { return }
            if let error = error {
                self.appendLog("NetSettings FAILED — \(error.localizedDescription)")
                self.fail("NEPacketTunnelNetworkSettings: \(error.localizedDescription)",
                          shared: shared, completionHandler)
                return
            }
            self.step("route installed")
            self.appendLog("Route installed (\(self.elapsed(since: self.startTime)) total)")

            // ── Phase 5: dual probe ───────────────────────────────────────────
            self.step("probing")
            self.runDualProbe { ok, summary in
                shared.set(ok, forKey: kProbeOkKey)
                if ok {
                    self.step("connected")
                    self.appendLog("STATE: connected (\(self.elapsed(since: self.startTime)) total)")
                    self.flushLog(to: shared)
                    // Upload async — do not block tunnel establishment for diagnostics.
                    let (deviceId, appVersion, country) = self.readDiagContext(from: shared)
                    DispatchQueue.global(qos: .background).async {
                        self.uploadDiagnostics(deviceId: deviceId, appVersion: appVersion,
                                               country: country, success: true, errorMsg: "",
                                               waitForCompletion: false)
                    }
                    completionHandler(nil)
                } else {
                    self.step("failed")
                    self.appendLog("STATE: failed — \(summary)")
                    self.fail(summary, shared: shared, completionHandler)
                }
            }
        }
    }

    // MARK: - Stop

    override func stopTunnel(with reason: NEProviderStopReason,
                             completionHandler: @escaping () -> Void) {
        appendLog("STATE: stop reason=\(reason.rawValue) (\(stopReasonDescription(reason)))")
        stopXrayCore()
        if let shared = UserDefaults(suiteName: kAppGroup) { flushLog(to: shared) }
        completionHandler()
    }

    // MARK: - Network settings (proxy mode)

    private func applyNetworkSettings(completion: @escaping (Error?) -> Void) {
        let settings = NEPacketTunnelNetworkSettings(tunnelRemoteAddress: "10.255.0.1")
        settings.mtu = 1280
        appendLog("NetSettings: tunnelRemoteAddress=10.255.0.1 mtu=1280")

        // ── IPv4: claim the DEFAULT route so iOS applies NEProxySettings to ALL app
        // traffic (Safari, etc.). With includedRoutes=[] the proxy was installed but
        // NOT applied to apps — the connect probe passed only because it set the proxy
        // explicitly, while real browsing went direct and stalled (CONNECTED-but-hangs).
        // The VPN server IP is excluded so xray's own outbound to the node does not loop
        // back into the tunnel (iOS has no Android-style socket protect()).
        let ipv4 = NEIPv4Settings(addresses: ["10.255.0.2"], subnetMasks: ["255.255.255.0"])
        ipv4.includedRoutes = [NEIPv4Route.default()]
        var excluded4: [NEIPv4Route] = []
        if isIPv4Literal(configMeta.addr) {
            excluded4.append(NEIPv4Route(destinationAddress: configMeta.addr,
                                         subnetMask: "255.255.255.255"))
            appendLog("NetSettings: excludedRoute(server)=\(configMeta.addr)/32 (loop prevention)")
        } else {
            appendLog("NetSettings: ⚠️ server addr \"\(configMeta.addr)\" is not an IPv4 literal — cannot exclude (edge transport?); risk of routing loop")
        }
        ipv4.excludedRoutes = excluded4
        settings.ipv4Settings = ipv4
        appendLog("NetSettings: IPv4=10.255.0.2/24 includedRoutes=[default] excluded=\(excluded4.count) (full-tunnel proxy)")

        // ── IPv6: claim + drop. Iranian LTE carries IPv6; if the tunnel ignores it,
        // Safari (Happy Eyeballs) prefers IPv6, connects DIRECTLY (bypassing the IPv4
        // proxy), hits blocked/poisoned routes and hangs. Claiming ::/0 with no IPv6
        // packet handler fast-fails IPv6 so the OS immediately falls back to IPv4
        // (which is proxied). This also kills direct QUIC/UDP-443 over IPv6.
        let ipv6 = NEIPv6Settings(addresses: ["fd00::2"], networkPrefixLengths: [64])
        ipv6.includedRoutes = [NEIPv6Route.default()]
        ipv6.excludedRoutes = []
        settings.ipv6Settings = ipv6
        appendLog("NetSettings: IPv6=fd00::2/64 includedRoutes=[default] (claim+drop → force IPv4 fallback)")

        let dns = NEDNSSettings(servers: ["1.1.1.1", "8.8.8.8"])
        dns.matchDomains = [""]
        settings.dnsSettings = dns
        appendLog("NetSettings: DNS=[1.1.1.1,8.8.8.8] matchDomains=[all]")

        let proxy = NEProxySettings()
        proxy.httpEnabled  = true
        proxy.httpServer   = NEProxyServer(address: "127.0.0.1", port: kHttpPort)
        proxy.httpsEnabled = true
        proxy.httpsServer  = NEProxyServer(address: "127.0.0.1", port: kHttpPort)
        proxy.excludeSimpleHostnames = true
        settings.proxySettings = proxy
        appendLog("NetSettings: HTTP/HTTPS proxy=127.0.0.1:\(kHttpPort) excludeSimpleHostnames=true")

        appendLog("NetSettings: calling setTunnelNetworkSettings…")
        setTunnelNetworkSettings(settings) { error in
            if let error = error {
                self.appendLog("NetSettings: setTunnelNetworkSettings ERROR — \(error.localizedDescription) (code=\((error as NSError).code))")
            } else {
                self.appendLog("NetSettings: setTunnelNetworkSettings OK — route installed")
            }
            completion(error)
        }
    }

    // MARK: - Dual probe

    private func runDualProbe(completion: @escaping (Bool, String) -> Void) {
        let proxyDict: [AnyHashable: Any] = [
            kCFNetworkProxiesHTTPEnable as String: 1,
            kCFNetworkProxiesHTTPProxy  as String: "127.0.0.1",
            kCFNetworkProxiesHTTPPort   as String: kHttpPort,
        ]

        // IP-direct probe MUST be HTTPS: iOS App Transport Security blocks plain
        // http:// ("requires the use of a secure connection"), so an http:// probe
        // fails inside URLSession before it ever reaches xray — a false negative
        // that made a working tunnel look like "xray is NOT forwarding traffic".
        // 1.1.1.1 presents a valid certificate for the IP literal, so this stays a
        // genuine DNS-free reachability test while satisfying ATS.
        let ipURL = URL(string: "https://1.1.1.1/cdn-cgi/trace")!
        appendLog("Probe TX[1]: HTTPS → 1.1.1.1/cdn-cgi/trace (IP-direct, DNS bypass) via 127.0.0.1:\(kHttpPort)")
        fetchURL(ipURL, via: proxyDict, timeout: 10) { [weak self] status, bytes, err, t in
            guard let self = self else { return }
            let ipOk = err == nil && status != nil
            if ipOk {
                self.appendLog("Probe RX[1]: IP-direct OK — status=\(status!) bytes=\(bytes) elapsed=\(t)")
                self.appendLog("Outbound: established — xray is forwarding TCP to internet")
            } else {
                let reason = err?.localizedDescription ?? "status=\(status.map{"\($0)"} ?? "nil")"
                self.appendLog("Probe RX[1]: IP-direct FAIL — \(reason) elapsed=\(t)")
                self.appendLog("Outbound: xray is NOT forwarding traffic")
            }

            self.step("dns probe")
            let cpURL = URL(string: "https://cp.cloudflare.com/")!
            self.appendLog("Probe TX[2]: HTTPS → cp.cloudflare.com (DNS+proxy) via 127.0.0.1:\(kHttpPort)")
            self.fetchURL(cpURL, via: proxyDict, timeout: 12) { status2, bytes2, err2, t2 in
                // cp.cloudflare.com is a captive-portal / connectivity-check endpoint:
                // it returns 204 No Content BY DESIGN (the same contract as Google's
                // generate_204). Requiring exactly 200 here made a fully working tunnel
                // report failure — the request reached cp.cloudflare.com through xray
                // and got its genuine 204 reply. Accept 200 or 204; both prove the
                // first packet went out and a real response came back.
                let dnsOk = err2 == nil && (status2 == 200 || status2 == 204)
                if dnsOk {
                    self.appendLog("Probe RX[2]: DNS+proxy OK — status=\(status2!) bytes=\(bytes2) elapsed=\(t2)")
                    self.appendLog("DNS: resolution OK (cp.cloudflare.com resolved through xray dns-out)")
                    // ── Probe 3 (diagnostic, NON-gating): system-routed, NO explicit
                    // proxy dict. Tests whether iOS actually applies the tunnel's
                    // NEProxySettings to ordinary app traffic (what Safari does). If this
                    // FAILS while probe 2 passed, the proxy isn't reaching apps → browsers
                    // hang despite CONNECTED. (May under-report inside the extension's own
                    // process, so it warns rather than fails the tunnel.)
                    self.step("system probe")
                    self.appendLog("Probe TX[3]: HTTPS → cp.cloudflare.com (SYSTEM-routed, no explicit proxy)")
                    self.fetchURL(URL(string: "https://cp.cloudflare.com/")!, via: [:], timeout: 10) { s3, _, e3, t3 in
                        let sysOk = e3 == nil && (s3 == 200 || s3 == 204)
                        if sysOk {
                            self.appendLog("Probe RX[3]: SYSTEM-routed OK — status=\(s3!) elapsed=\(t3) — app traffic IS using the tunnel")
                        } else {
                            let r3 = e3?.localizedDescription ?? "status=\(s3.map { "\($0)" } ?? "nil")"
                            self.appendLog("Probe RX[3]: SYSTEM-routed FAIL — \(r3) elapsed=\(t3)")
                            self.appendLog("⚠️ Proxy may NOT be applied to app traffic — browsers (Safari) could hang despite CONNECTED")
                        }
                        self.appendLog("First packet sent+received — end-to-end connectivity confirmed")
                        completion(true, "ok")
                    }
                } else {
                    let reason2 = err2?.localizedDescription ?? "status=\(status2.map{"\($0)"} ?? "nil")"
                    self.appendLog("Probe RX[2]: DNS+proxy FAIL — \(reason2) elapsed=\(t2)")
                    let errCode = (err2 as NSError?)?.code
                    let dnsHint: String
                    if errCode == NSURLErrorCannotFindHost || errCode == NSURLErrorDNSLookupFailed {
                        dnsHint = "DNS: FAILED — NSURLError \(errCode!) (cannot resolve hostname)"
                    } else if ipOk {
                        dnsHint = "DNS: likely FAILED (IP probe passed, hostname probe failed)"
                    } else {
                        dnsHint = "DNS: unknown (IP probe also failed — xray itself may be down)"
                    }
                    self.appendLog(dnsHint)
                    let summary = ipOk
                        ? "DNS probe failed: \(reason2)"
                        : "Proxy probe failed: \(reason2)"
                    completion(false, summary)
                }
            }
        }
    }

    private func fetchURL(_ url: URL,
                          via proxyDict: [AnyHashable: Any],
                          timeout: TimeInterval,
                          completion: @escaping (Int?, Int, Error?, String) -> Void) {
        let t0  = Date()
        let cfg = URLSessionConfiguration.ephemeral
        cfg.timeoutIntervalForRequest  = timeout
        cfg.timeoutIntervalForResource = timeout
        cfg.connectionProxyDictionary  = proxyDict
        let task = URLSession(configuration: cfg).dataTask(with: URLRequest(url: url)) { data, resp, err in
            completion((resp as? HTTPURLResponse)?.statusCode, data?.count ?? 0, err, self.elapsed(since: t0))
        }
        task.resume()
    }

    // MARK: - libXray integration

    private func startXrayCore(configJson: String) -> String? {
        #if LIBXRAY_AVAILABLE
        // Validate JSON structure and log key outbound fields before calling libxray.
        // validateAndLogConfig captures configMeta and logs Outbound: / Server: / Config OK lines.
        // It is called earlier (Phase 2) so this path is only reached after configValid=true.

        // Build base64-wrapped request for libxray v25+ RunXrayFromJSON.
        // Payload: { datDir: "", configJSON: "<raw xray json string>" }
        // datDir is empty — routing rules use IP/port only, no geo dat files needed.
        guard let requestData = try? JSONSerialization.data(withJSONObject: [
            "datDir":     "",
            "configJSON": configJson,
        ]) else {
            return "Failed to serialize libxray request"
        }
        let base64Request = requestData.base64EncodedString()
        step("libxray call")
        appendLog("LibXrayRunXrayFromJSON: request \(base64Request.count) base64 chars")
        appendLog("libxray input struct: datDir=\"\" configJSON=<\(configJson.count) chars, sha256=\(configSha256)>")

        // ── Pre-flight: round-trip decode the exact bytes libxray will receive ──
        // Decode base64Request → outer JSON → extract configJSON → parse inner JSON.
        // If Swift can parse the payload and find outbounds[0].protocol but libxray
        // rejects it, the problem is the API contract (wrong field name / encoding),
        // not our config generation.
        verifyLibxrayPayload(base64Request)

        let base64Response = LibXrayRunXrayFromJSON(base64Request)
        step("libxray response")

        appendLog("libxray raw response: \(base64Response.prefix(200))")

        guard !base64Response.isEmpty,
              let responseData = Data(base64Encoded: base64Response),
              let json = try? JSONSerialization.jsonObject(with: responseData) as? [String: Any]
        else {
            appendLog("libxray response: undecodable (xcframework version mismatch?)")
            libxrayError = "libxray returned unreadable response"
            return libxrayError
        }

        libxraySuccess = json["success"] as? Bool ?? false
        libxrayError   = json["error"]   as? String ?? ""

        appendLog("libxray CallResponse: success=\(libxraySuccess)\(libxrayError.isEmpty ? "" : " error=\"\(libxrayError)\"")")

        // If protocol error: log outbound[0], inbound[0], and config head for cross-check.
        if !libxraySuccess &&
           libxrayError.lowercased().contains("protocol") {
            appendLog("⚠️ Protocol error — dumping outbound[0] and inbound[0] for cross-check")
            appendLog("outbound[0]: \(configMeta.outbound0)")
            appendLog("inbound[0]:  \(configMeta.inbound0)")
            appendLog("config head (first 800 chars, sanitized):")
            let head = sanitizedCfg.prefix(800)
            appendLog(String(head))
        }

        if libxraySuccess { return nil }
        return libxrayError.isEmpty ? "xray-core failed (no error detail)" : libxrayError
        #else
        return "libXray not embedded — CI build required for real VPN."
        #endif
    }

    // Open LibXray.framework via dlopen and check which entry points are actually
    // exported. Runs once per tunnel attempt, before any libxray call.
    //
    // Why: gomobile bind output varies by libxray version and build flags.
    // A symbol that appears in the header might be absent or renamed in the dylib.
    // dlsym is the only runtime check that proves the symbol resolves.
    private func logLibxraySymbols() {
        appendLog("LibXray symbol audit — scanning Bundle.allFrameworks…")

        // Locate LibXray.framework among the loaded bundles.
        // In the extension process this is typically at:
        //   <app>.appex/Frameworks/LibXray.framework
        var libxrayBundle: Bundle?
        for b in Bundle.allFrameworks {
            if b.bundlePath.contains("LibXray.framework") {
                libxrayBundle = b
                break
            }
        }

        guard let bundle = libxrayBundle else {
            appendLog("LibXray.framework: NOT FOUND in Bundle.allFrameworks")
            let names = Bundle.allFrameworks
                .map { URL(fileURLWithPath: $0.bundlePath).lastPathComponent }
                .joined(separator: ", ")
            appendLog("Loaded frameworks: \(names)")
            return
        }

        appendLog("LibXray.framework path: \(bundle.bundlePath)")

        guard let execURL = bundle.executableURL else {
            appendLog("LibXray executable: nil — bundle has no executable")
            return
        }
        appendLog("LibXray executable: \(execURL.lastPathComponent) @ \(execURL.path)")

        // dlopen the dylib directly so we can probe its symbol table.
        guard let handle = dlopen(execURL.path, RTLD_NOW | RTLD_LOCAL) else {
            let reason = String(cString: dlerror())
            appendLog("dlopen FAILED: \(reason)")
            return
        }
        defer { dlclose(handle) }

        // All known entry-point names across libxray versions.
        // The one we call is marked with ← CURRENT.
        let candidates: [(name: String, note: String)] = [
            ("LibXrayRunXrayFromJSON", "← CURRENT call site (v25+ base64 API)"),
            ("LibXrayXrayVersion",     "version query — must be present if framework loaded"),
            ("LibXrayStopXray",        "stop call"),
            ("LibXrayRunXray",         "old raw-JSON API (pre-v25)"),
            ("LibXrayInitEnv",         "init required by some versions"),
            ("RunXrayFromJSON",        "without LibXray prefix"),
            ("runXrayFromJSON",        "lowercase variant"),
            ("LibXrayTestXray",        "test/validate variant"),
        ]

        var found: [String] = []
        var missing: [String] = []
        for c in candidates {
            let ptr = dlsym(handle, c.name)
            let status = ptr != nil ? "EXPORTED ✓" : "not found ✗"
            appendLog("  \(c.name): \(status)  \(c.note)")
            if ptr != nil { found.append(c.name) } else { missing.append(c.name) }
        }

        appendLog("LibXray audit: \(found.count) found [\(found.joined(separator: ", "))]")
        if missing.contains("LibXrayRunXrayFromJSON") {
            appendLog("⚠️  LibXrayRunXrayFromJSON is NOT exported — every call to it invokes an undefined stub")
        }
        if missing.contains("LibXrayXrayVersion") {
            appendLog("⚠️  LibXrayXrayVersion missing — framework may not be LibXray at all")
        }
    }

    // Round-trip decode the exact base64 payload that is about to be handed to
    // LibXrayRunXrayFromJSON and verify the inner xray config is intact.
    //
    // Logged unconditionally so every build captures the result.
    // Does NOT abort — libxray is still called regardless of what Swift finds.
    //
    // Expected decode chain:
    //   base64Request
    //     → base64-decode → outer JSON: { datDir, configJSON }
    //       → configJSON string → parse inner JSON: xray config
    //         → outbounds[0].protocol   must == "vless"
    //         → outbounds[0].streamSettings.security  must == "reality"
    private func verifyLibxrayPayload(_ base64Request: String) {
        appendLog("PreFlight: verifying exact payload libxray will receive…")

        // Step 1 — base64 decode
        guard let outerData = Data(base64Encoded: base64Request) else {
            appendLog("PreFlight FAIL [1]: base64 decode failed (length=\(base64Request.count))")
            return
        }
        appendLog("PreFlight [1]: base64 decoded OK → \(outerData.count) bytes")

        // Step 2 — parse outer JSON { datDir, configJSON }
        guard let outerObj = try? JSONSerialization.jsonObject(with: outerData) as? [String: Any] else {
            appendLog("PreFlight FAIL [2]: outer JSON parse failed")
            appendLog("PreFlight outer raw (first 200): \(String(data: outerData, encoding: .utf8)?.prefix(200) ?? "(not utf8)")")
            return
        }
        let datDir    = outerObj["datDir"]    as? String ?? "(missing)"
        let hasConfig = outerObj["configJSON"] is String
        appendLog("PreFlight [2]: outer JSON OK — keys=[\(outerObj.keys.sorted().joined(separator: ","))] datDir=\"\(datDir)\" configJSON=\(hasConfig ? "present" : "MISSING")")

        // Step 3 — extract configJSON string
        guard let innerJson = outerObj["configJSON"] as? String else {
            appendLog("PreFlight FAIL [3]: configJSON field is missing or not a String (type=\(type(of: outerObj["configJSON"])))")
            return
        }
        appendLog("PreFlight [3]: configJSON string extracted — \(innerJson.count) chars")

        // Step 4 — parse inner JSON (the actual xray config)
        guard let innerData = innerJson.data(using: .utf8),
              let xrayCfg  = try? JSONSerialization.jsonObject(with: innerData) as? [String: Any]
        else {
            appendLog("PreFlight FAIL [4]: inner JSON parse failed")
            appendLog("PreFlight inner head (200 chars): \(innerJson.prefix(200))")
            return
        }
        let topKeys = xrayCfg.keys.sorted().joined(separator: ",")
        appendLog("PreFlight [4]: inner JSON parsed OK — top-level keys=[\(topKeys)]")

        // Step 5 — check outbounds array
        guard let outbounds = xrayCfg["outbounds"] as? [[String: Any]], !outbounds.isEmpty else {
            appendLog("PreFlight FAIL [5]: outbounds missing or empty (keys=[\(topKeys)])")
            return
        }
        appendLog("PreFlight [5]: outbounds count=\(outbounds.count)")

        // Step 6 — check outbounds[0].protocol
        let ob0      = outbounds[0]
        let proto    = ob0["protocol"] as? String
        let protoOk  = proto == "vless"
        appendLog("PreFlight [6]: outbounds[0].protocol=\(proto ?? "(nil)") → \(protoOk ? "✓ PASS" : "✗ FAIL — expected \"vless\"")")

        // Step 7 — check outbounds[0].streamSettings.security
        let ss       = ob0["streamSettings"] as? [String: Any]
        let security = ss?["security"] as? String
        let secOk    = security == "reality"
        appendLog("PreFlight [7]: outbounds[0].streamSettings.security=\(security ?? "(nil)") → \(secOk ? "✓ PASS" : "✗ FAIL — expected \"reality\"")")

        // Step 8 — check inbounds
        let inbounds   = xrayCfg["inbounds"] as? [[String: Any]] ?? []
        let ib0proto   = inbounds.first?["protocol"] as? String ?? "(none)"
        appendLog("PreFlight [8]: inbounds count=\(inbounds.count) inbounds[0].protocol=\(ib0proto)")

        // Summary
        let allOk = protoOk && secOk
        appendLog("PreFlight SUMMARY: \(allOk ? "ALL CHECKS PASSED — payload is valid; if libxray rejects it the problem is in the API contract, not our config" : "CHECKS FAILED — see individual step results above")")
    }

    // Reads and logs xray-core version; stores in xrayVersion for the meta payload.
    private func captureXrayVersion() {
        #if LIBXRAY_AVAILABLE
        let raw = LibXrayXrayVersion()
        if let data = Data(base64Encoded: raw),
           let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
           let ver  = json["data"] as? String, !ver.isEmpty {
            xrayVersion = ver
            appendLog("xray-core version: \(ver)")
        } else {
            xrayVersion = "(unreadable)"
            appendLog("xray-core version: unreadable — base64=\(raw.prefix(60))")
        }
        #else
        xrayVersion = "(stub — LIBXRAY_AVAILABLE not set)"
        appendLog("xray-core version: \(xrayVersion)")
        #endif
    }

    // Validates JSON config, captures configMeta, and logs key outbound fields.
    // Returns nil on success or a short error string.
    private func validateAndLogConfig(_ configJson: String) -> String? {
        guard let data = configJson.data(using: .utf8),
              let obj  = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
        else {
            return "Config is not valid JSON"
        }

        // ── Capture proxy outbound fields ──────────────────────────────────────
        let outbounds = obj["outbounds"] as? [[String: Any]] ?? []
        let inbounds  = obj["inbounds"]  as? [[String: Any]] ?? []

        if let proxy = outbounds.first(where: { ($0["tag"] as? String) == "proxy" })
                    ?? outbounds.first {
            configMeta.proto      = proxy["protocol"] as? String ?? "(nil)"
            let ss                = proxy["streamSettings"] as? [String: Any]
            configMeta.network    = ss?["network"]  as? String ?? "(nil)"
            configMeta.security   = ss?["security"] as? String ?? "(nil)"
            let rs                = ss?["realitySettings"] as? [String: Any]
            configMeta.serverName = rs?["serverName"] as? String
                                 ?? (ss?["tlsSettings"] as? [String: Any])?["serverName"] as? String
                                 ?? "(nil)"
            let vnext             = (proxy["settings"] as? [String: Any])?["vnext"] as? [[String: Any]]
            configMeta.addr       = vnext?.first?["address"] as? String ?? "(nil)"
            configMeta.port       = vnext?.first?["port"] ?? "(nil)"
            let users             = vnext?.first?["users"] as? [[String: Any]]
            configMeta.flow       = users?.first?["flow"] as? String ?? "(absent)"

            // Sanitized outbound[0] for error dumps
            if let sanitized = sanitizeJsonObject(proxy) {
                configMeta.outbound0 = sanitized
            }
        }
        if let ib0 = inbounds.first, let sanitized = sanitizeJsonObject(ib0) {
            configMeta.inbound0 = sanitized
        }

        appendLog("Outbound: protocol=\(configMeta.proto) network=\(configMeta.network) security=\(configMeta.security)")
        appendLog("Server: \(configMeta.addr):\(configMeta.port) sni=\(configMeta.serverName) flow=\(configMeta.flow)")

        // ── Validate all outbounds and inbounds have protocol ──────────────────
        guard !outbounds.isEmpty else { return "outbounds array is missing or empty" }
        for (i, ob) in outbounds.enumerated() {
            guard let p = ob["protocol"] as? String, !p.isEmpty else {
                return "outbounds[\(i)] missing or empty 'protocol' field"
            }
        }
        guard !inbounds.isEmpty else { return "inbounds array is missing or empty" }
        for (i, ib) in inbounds.enumerated() {
            guard let p = ib["protocol"] as? String, !p.isEmpty else {
                return "inbounds[\(i)] missing or empty 'protocol' field"
            }
        }

        let outProtos = outbounds.compactMap { $0["protocol"] as? String }
        let inProtos  = inbounds.compactMap  { $0["protocol"] as? String }
        appendLog("Config OK \(configJson.count)B: out=[\(outProtos.joined(separator: ","))] in=[\(inProtos.joined(separator: ","))]")
        return nil
    }

    private func stopXrayCore() {
        #if LIBXRAY_AVAILABLE
        _ = LibXrayStopXray()
        #endif
    }

    // MARK: - Upload diagnostics

    private func readDiagContext(from shared: UserDefaults) -> (deviceId: String, appVersion: String, country: String) {
        let deviceId   = shared.string(forKey: kDiagDeviceId)  ?? "unknown"
        let appVersion = shared.string(forKey: kDiagAppVer)    ?? "unknown"
        let country    = shared.string(forKey: kDiagCountry)   ?? ""
        return (deviceId, appVersion, country)
    }

    private func uploadDiagnostics(deviceId: String, appVersion: String, country: String,
                                   success: Bool, errorMsg: String,
                                   waitForCompletion: Bool) {
        guard let url = URL(string: kUploadURL) else { return }

        // ── Build structured meta ──────────────────────────────────────────────
        var meta: [String: Any] = [
            "device_id":      deviceId,
            "app_version":    appVersion,
            "server":         "\(configMeta.addr):\(configMeta.port)",
            "country":        country,
            "timestamp":      ISO8601DateFormatter().string(from: Date()),
            "libxray_version": xrayVersion,
            "config_sha256":  configSha256,
            "config_length":  configLength,
            "config_valid":   configValid,
            "protocol":       configMeta.proto,
            "network":        configMeta.network,
            "security":       configMeta.security,
            "server_name":    configMeta.serverName,
            "flow":           configMeta.flow,
            "success":        success,
            "error":          errorMsg,
            "step":           lastStep,
        ]
        // Include protocol-error diagnostics when applicable
        if !success && errorMsg.lowercased().contains("protocol") {
            meta["outbound_0"]  = configMeta.outbound0
            meta["inbound_0"]   = configMeta.inbound0
            meta["config_head"] = String(sanitizedCfg.prefix(800))
            meta["config_sha256_verify"] = configSha256
        }

        guard let metaData = try? JSONSerialization.data(withJSONObject: meta),
              let metaJson = String(data: metaData, encoding: .utf8),
              let logData  = try? JSONSerialization.data(withJSONObject: log),
              let logJson  = String(data: logData, encoding: .utf8)
        else { return }

        // ── Encode body ────────────────────────────────────────────────────────
        var allowed = CharacterSet.alphanumerics
        allowed.insert(charactersIn: "-._~")
        func pct(_ s: String) -> String {
            s.addingPercentEncoding(withAllowedCharacters: allowed) ?? s
        }

        var bodyParts = [
            "device_id=\(pct(deviceId))",
            "log=\(pct(logJson))",
            "meta=\(pct(metaJson))",
        ]
        if !sanitizedCfg.isEmpty {
            bodyParts.append("config=\(pct(sanitizedCfg))")
        }
        let bodyString = bodyParts.joined(separator: "&")

        guard let bodyData = bodyString.data(using: .utf8) else { return }

        var req = URLRequest(url: url)
        req.httpMethod = "POST"
        req.setValue("application/x-www-form-urlencoded", forHTTPHeaderField: "Content-Type")
        req.httpBody   = bodyData
        req.timeoutInterval = 10

        // Bypass the extension's own proxy settings so upload goes direct.
        let cfg = URLSessionConfiguration.ephemeral
        cfg.connectionProxyDictionary = [:] as [AnyHashable: Any]

        appendLog("Uploading diagnostics to server (waitForCompletion=\(waitForCompletion))…")

        if waitForCompletion {
            let sema = DispatchSemaphore(value: 0)
            URLSession(configuration: cfg).dataTask(with: req) { [weak self] _, resp, err in
                let code = (resp as? HTTPURLResponse)?.statusCode ?? -1
                self?.appendLog("Upload result: http=\(code)\(err.map { " err=\($0.localizedDescription)" } ?? "")")
                sema.signal()
            }.resume()
            _ = sema.wait(timeout: .now() + 12)
        } else {
            URLSession(configuration: cfg).dataTask(with: req) { _, _, _ in }.resume()
        }
    }

    // MARK: - fail() helper

    private func fail(_ message: String,
                      shared: UserDefaults?,
                      _ completionHandler: @escaping (Error?) -> Void) {
        appendLog("FAIL: \(message)")
        shared?.set(message, forKey: kErrorKey)
        shared?.set(false,   forKey: kProbeOkKey)
        flushLog(to: shared ?? .standard)

        // Upload synchronously — extension process will be killed after completionHandler.
        let (deviceId, appVersion, country) = readDiagContext(from: shared ?? .standard)
        uploadDiagnostics(deviceId: deviceId, appVersion: appVersion, country: country,
                          success: false, errorMsg: message,
                          waitForCompletion: true)

        completionHandler(NSError(domain: "no.setalink.tunnel", code: -1,
                                  userInfo: [NSLocalizedDescriptionKey: message]))
    }

    // MARK: - Helpers

    private func step(_ name: String) {
        lastStep = name
        appendLog("STATE: \(name)")
    }

    private func appendLog(_ line: String) {
        let ts = ISO8601DateFormatter().string(from: Date())
        log.append("[\(ts)] \(line)")
    }

    private func flushLog(to shared: UserDefaults) {
        shared.set(log, forKey: kLogKey)
    }

    private func elapsed(since t0: Date) -> String {
        String(format: "%.2fs", -t0.timeIntervalSinceNow)
    }

    // SHA256 of a UTF-8 string, hex-encoded.
    private func sha256(_ string: String) -> String {
        let data   = Data(string.utf8)
        let digest = SHA256.hash(data: data)
        return digest.map { String(format: "%02x", $0) }.joined()
    }

    // Mask secret fields (id/UUID, publicKey, shortId) in a raw JSON string.
    private func sanitizeConfig(_ json: String) -> String {
        var result = json
        let patterns: [(String, String)] = [
            (#""id"\s*:\s*"[0-9a-fA-F\-]{8,}""#,  #""id":"***""#),
            (#""publicKey"\s*:\s*"[^"]+""#,         #""publicKey":"***""#),
            (#""shortId"\s*:\s*"[^"]*""#,           #""shortId":"***""#),
        ]
        for (pattern, replacement) in patterns {
            if let re = try? NSRegularExpression(pattern: pattern) {
                let range = NSRange(result.startIndex..., in: result)
                result = re.stringByReplacingMatches(in: result, range: range,
                                                     withTemplate: replacement)
            }
        }
        return result
    }

    // Serialize a JSON-compatible dictionary to a sanitized string (masks secrets).
    private func sanitizeJsonObject(_ obj: [String: Any]) -> String? {
        guard let data   = try? JSONSerialization.data(withJSONObject: obj),
              let raw    = String(data: data, encoding: .utf8)
        else { return nil }
        return sanitizeConfig(raw)
    }

    // True only for dotted-quad IPv4 literals (e.g. "178.104.77.231"). Used to decide
    // whether the server address can be added to excludedRoutes for loop prevention.
    private func isIPv4Literal(_ s: String) -> Bool {
        let parts = s.split(separator: ".", omittingEmptySubsequences: false)
        guard parts.count == 4 else { return false }
        return parts.allSatisfy { p in
            guard let n = Int(p), n >= 0, n <= 255, String(n) == p else { return false }
            return true
        }
    }

    private func stopReasonDescription(_ reason: NEProviderStopReason) -> String {
        switch reason {
        case .none:                       return "none"
        case .userInitiated:              return "userInitiated"
        case .providerFailed:             return "providerFailed"
        case .noNetworkAvailable:         return "noNetworkAvailable"
        case .unrecoverableNetworkChange: return "unrecoverableNetworkChange"
        case .providerDisabled:           return "providerDisabled"
        case .authenticationCanceled:     return "authenticationCanceled"
        case .configurationFailed:        return "configurationFailed"
        case .idleTimeout:                return "idleTimeout"
        case .configurationDisabled:      return "configurationDisabled"
        case .configurationRemoved:       return "configurationRemoved"
        case .superceded:                 return "superceded"
        case .userLogout:                 return "userLogout"
        case .userSwitch:                 return "userSwitch"
        case .connectionFailed:           return "connectionFailed"
        case .sleep:                      return "sleep"
        case .appUpdate:                  return "appUpdate"
        @unknown default:                 return "unknown(\(reason.rawValue))"
        }
    }
}
