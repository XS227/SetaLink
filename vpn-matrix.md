# SetaLink — Iran Connectivity Test Matrix

Generated: 2026-05-15  
Server: edge.setalink.no (Ubuntu 24.04, nginx 1.24, Xray 26.3.27)  
Test UUID (testuser): `9280e04d-ffdb-45b4-9558-66b9d6f89b49`

---

## Profile Matrix

| # | Name | Transport | Port | Path | DPI Resistance | Notes |
|---|------|-----------|------|------|----------------|-------|
| 1 | EDGE-WS1 | VLESS WS TLS | 443 | /ws | Medium | Current working config, Turkey verified |
| 2 | EDGE-WS2 | VLESS WS TLS (no Host param) | 443 | /ws | Medium | Host header = SNI only, slightly cleaner TLS |
| 3 | EDGE-CHROME | VLESS WS TLS + uTLS | 443 | /ws | Medium-High | Chrome fingerprint + h1.1 ALPN — best client-side disguise for WS |
| 4 | EDGE-XHTTP | VLESS XHTTP TLS | 443 | /xhttp | High | SplitHTTP — chunked responses, harder to DPI |
| 5 | EDGE-HTTPUP | VLESS HTTPUpgrade TLS | 443 | /httpup | Medium | Simple HTTP upgrade, like WS but different wire format |
| 6 | EDGE-REALITY | VLESS TCP Reality | 8443 | — | Very High | No nginx, TLS steals from microsoft.com, no detectable proxy |

---

## VLESS Client Links

Import into: v2rayN, NekoBox, v2rayNG, Hiddify, Streisand

### 1. EDGE-WS1 — WebSocket TLS (current baseline)
```
vless://9280e04d-ffdb-45b4-9558-66b9d6f89b49@edge.setalink.no:443?security=tls&type=ws&path=%2Fws&host=edge.setalink.no&sni=edge.setalink.no#EDGE-WS1
```

### 2. EDGE-WS2 — WebSocket TLS, no Host override
```
vless://9280e04d-ffdb-45b4-9558-66b9d6f89b49@edge.setalink.no:443?security=tls&type=ws&path=%2Fws&sni=edge.setalink.no#EDGE-WS2
```

### 3. EDGE-CHROME — WebSocket TLS + Chrome fingerprint + ALPN h1.1
```
vless://9280e04d-ffdb-45b4-9558-66b9d6f89b49@edge.setalink.no:443?security=tls&type=ws&path=%2Fws&host=edge.setalink.no&sni=edge.setalink.no&fp=chrome&alpn=http%2F1.1#EDGE-CHROME
```

### 4. EDGE-XHTTP — XHTTP / SplitHTTP TLS
```
vless://9280e04d-ffdb-45b4-9558-66b9d6f89b49@edge.setalink.no:443?security=tls&type=xhttp&path=%2Fxhttp&host=edge.setalink.no&sni=edge.setalink.no&fp=chrome#EDGE-XHTTP
```

### 5. EDGE-HTTPUP — HTTPUpgrade TLS
```
vless://9280e04d-ffdb-45b4-9558-66b9d6f89b49@edge.setalink.no:443?security=tls&type=httpupgrade&path=%2Fhttpup&host=edge.setalink.no&sni=edge.setalink.no#EDGE-HTTPUP
```

### 6. EDGE-REALITY — VLESS TCP Reality (direct port 8443)
```
vless://9280e04d-ffdb-45b4-9558-66b9d6f89b49@edge.setalink.no:8443?security=reality&type=tcp&flow=xtls-rprx-vision&sni=www.microsoft.com&fp=chrome&pbk=Lt23oNYSse3ElAqCEWqTcFYCplvuLWsjsI7ZH7E_rGU&sid=7f81892e&spx=%2F#EDGE-REALITY
```

---

## Reality Parameters (manual client config)

| Field | Value |
|-------|-------|
| Server | edge.setalink.no |
| Port | 8443 |
| UUID | 9280e04d-ffdb-45b4-9558-66b9d6f89b49 |
| Flow | xtls-rprx-vision |
| Security | reality |
| SNI | www.microsoft.com |
| Fingerprint | chrome |
| Public Key | Lt23oNYSse3ElAqCEWqTcFYCplvuLWsjsI7ZH7E_rGU |
| Short ID | 7f81892e |

---

## Server Port Map

| Port | Binding | Profile | Transport |
|------|---------|---------|-----------|
| 443 | public (nginx) | WS1, WS2, CHROME, XHTTP, HTTPUP | TLS terminated by nginx |
| 8443 | public (Xray direct) | REALITY | TLS by Xray Reality |
| 10000 | 127.0.0.1 | WS inbound | tag: inbound-ws |
| 10001 | 127.0.0.1 | XHTTP inbound | tag: inbound-xhttp |
| 10002 | 127.0.0.1 | HTTPUpgrade inbound | tag: inbound-httpup |
| 8344 | 127.0.0.1 | Xray Stats API | tag: api |

---

## Iran Tester Instructions

Test ONE profile at a time. Record for each:
- Connect: Yes / No / Timeout
- Latency (ms), Download speed (Mbps)
- ISP / Operator (Irancell, MCI, Shatel, Rightel, etc.)
- Time of day

### Recommended test order

| Priority | Profile | Why |
|----------|---------|-----|
| 1st | EDGE-REALITY | Indistinguishable from Microsoft TLS — hardest to block |
| 2nd | EDGE-XHTTP | Chunked HTTP body — DPI reads it as file download |
| 3rd | EDGE-CHROME | WS with Chrome TLS fingerprint — looks like browser |
| 4th | EDGE-HTTPUP | Different HTTP upgrade path than WS |
| 5th | EDGE-WS1 | Baseline — works when ISP not filtering |
| Last | EDGE-WS2 | Catches Host header edge cases |

---

## Log Interpretation

| Observation | Meaning |
|---|---|
| No nginx log entry at all | Blocked before server — ISP/GFW drop |
| nginx `101` on /ws or /httpup | Handshake OK — check Xray for auth result |
| nginx `502` on any path | nginx up, Xray inbound down — `systemctl status xray` |
| nginx `400` on /ws | Xray got request, rejected it (wrong UUID or client mismatch) |
| Xray error: `invalid request` | UUID mismatch |
| Xray error: `failed to read` / `connection reset` | ISP injected TCP RST mid-stream |
| Connected, no traffic | Routing issue in client or DNS leak |

---

## Quick Diagnostics

```bash
# Full system check:
sudo setalink-test.sh

# Watch all transport paths live:
sudo tail -f /var/log/nginx/access.log | grep -E '/ws|/xhttp|/httpup'

# Watch Xray errors live:
sudo tail -f /var/log/xray/error.log

# Count nginx 502s (Xray unreachable):
sudo grep ' 502 ' /var/log/nginx/access.log | wc -l

# Temporarily raise Xray log level for debugging:
# Edit /usr/local/etc/xray/config.json → "loglevel": "info"
# sudo systemctl restart xray
```

---

## Backups

```
/usr/local/etc/xray/config.json.backup-20260515134226
/etc/nginx/sites-available/default.backup-20260515134226
/root/nginx-default.backup-before-fix
```

---

## Notes

- gRPC not added: this nginx build lacks `ngx_http_grpc_module`. To add later: recompile nginx or use `nginx-extras` package, then add a `grpc_pass grpc://127.0.0.1:10003` location.
- REALITY on port 8443 (not 443): Xray warns about this but it works. Port 443 is occupied by nginx. Port 8443 is open in UFW.
- WS and HTTPUpgrade are deprecated in Xray 26.x in favour of XHTTP — fully functional but may be removed in a future release.
- All users in the Xray config have access to all 6 profiles.
