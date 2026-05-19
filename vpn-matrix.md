# SetaLink — Iran Connectivity Test Matrix

Updated: 2026-05-19  
Server: edge.setalink.no / 5.249.252.221 (Ubuntu 24.04, nginx 1.24, Xray 26.3.27)  

**Both UUIDs are valid** — use either set of links below.  
- `b5243b1c-af7a-40f0-ad31-97fc6f9ba3e3` — canonical app UUID (all mobile app installs)  
- `9280e04d-ffdb-45b4-9558-66b9d6f89b49` — iran-tester UUID (existing profiles, still works)  

---

## Profile Matrix

| # | Name | Transport | Port | Path | DPI Resistance | Notes |
|---|------|-----------|------|------|----------------|-------|
| 1 | EDGE-REALITY | VLESS TCP Reality | 8443 | — | Very High | No nginx, TLS impersonates microsoft.com |
| 2 | EDGE-XHTTP | VLESS XHTTP TLS | 443 | /xhttp | High | SplitHTTP — chunked body, reads as file download |
| 3 | EDGE-CHROME | VLESS WS TLS + uTLS | 443 | /ws | Medium-High | Chrome fingerprint + h1.1 ALPN |
| 4 | EDGE-WS1 | VLESS WS TLS | 443 | /ws | Medium | Baseline WebSocket |
| 5 | EDGE-HTTPUP | VLESS HTTPUpgrade TLS | 443 | /httpup | Medium | HTTP upgrade, different wire format from WS |
| 6 | EDGE-WS2 | VLESS WS TLS (no Host) | 443 | /ws | Medium | Host header = SNI only |

---

## VLESS Client Links — App UUID (b5243b1c)

Import into: v2rayN, NekoBox, v2rayNG, Hiddify, Streisand

### 1. EDGE-REALITY — TCP Reality (highest priority)
```
vless://b5243b1c-af7a-40f0-ad31-97fc6f9ba3e3@5.249.252.221:8443?security=reality&type=tcp&flow=xtls-rprx-vision&sni=www.microsoft.com&fp=chrome&pbk=Lt23oNYSse3ElAqCEWqTcFYCplvuLWsjsI7ZH7E_rGU&sid=7f81892e#SETALINK-REALITY
```

### 2. EDGE-XHTTP — SplitHTTP TLS
```
vless://b5243b1c-af7a-40f0-ad31-97fc6f9ba3e3@edge.setalink.no:443?security=tls&type=xhttp&path=%2Fxhttp&host=edge.setalink.no&sni=edge.setalink.no&fp=chrome#SETALINK-XHTTP
```

### 3. EDGE-CHROME — WebSocket TLS + Chrome fingerprint
```
vless://b5243b1c-af7a-40f0-ad31-97fc6f9ba3e3@edge.setalink.no:443?security=tls&type=ws&path=%2Fws&host=edge.setalink.no&sni=edge.setalink.no&fp=chrome&alpn=http%2F1.1#SETALINK-CHROME
```

### 4. EDGE-WS1 — WebSocket TLS baseline
```
vless://b5243b1c-af7a-40f0-ad31-97fc6f9ba3e3@edge.setalink.no:443?security=tls&type=ws&path=%2Fws&host=edge.setalink.no&sni=edge.setalink.no#SETALINK-WS
```

### 5. EDGE-HTTPUP — HTTPUpgrade TLS
```
vless://b5243b1c-af7a-40f0-ad31-97fc6f9ba3e3@edge.setalink.no:443?security=tls&type=httpupgrade&path=%2Fhttpup&host=edge.setalink.no&sni=edge.setalink.no#SETALINK-HTTPUP
```

---

## VLESS Client Links — Iran-Tester UUID (9280e04d)

*These profiles match existing client imports. All still valid — UUID is now in Xray config.*

### 1. EDGE-REALITY
```
vless://9280e04d-ffdb-45b4-9558-66b9d6f89b49@5.249.252.221:8443?security=reality&type=tcp&flow=xtls-rprx-vision&sni=www.microsoft.com&fp=chrome&pbk=Lt23oNYSse3ElAqCEWqTcFYCplvuLWsjsI7ZH7E_rGU&sid=7f81892e#EDGE-REALITY
```

### 2. EDGE-XHTTP
```
vless://9280e04d-ffdb-45b4-9558-66b9d6f89b49@edge.setalink.no:443?security=tls&type=xhttp&path=%2Fxhttp&host=edge.setalink.no&sni=edge.setalink.no&fp=chrome#EDGE-XHTTP
```

### 3. EDGE-CHROME
```
vless://9280e04d-ffdb-45b4-9558-66b9d6f89b49@edge.setalink.no:443?security=tls&type=ws&path=%2Fws&host=edge.setalink.no&sni=edge.setalink.no&fp=chrome&alpn=http%2F1.1#EDGE-CHROME
```

### 4. EDGE-WS1
```
vless://9280e04d-ffdb-45b4-9558-66b9d6f89b49@edge.setalink.no:443?security=tls&type=ws&path=%2Fws&host=edge.setalink.no&sni=edge.setalink.no#EDGE-WS1
```

### 5. EDGE-WS2
```
vless://9280e04d-ffdb-45b4-9558-66b9d6f89b49@edge.setalink.no:443?security=tls&type=ws&path=%2Fws&sni=edge.setalink.no#EDGE-WS2
```

### 6. EDGE-HTTPUP
```
vless://9280e04d-ffdb-45b4-9558-66b9d6f89b49@edge.setalink.no:443?security=tls&type=httpupgrade&path=%2Fhttpup&host=edge.setalink.no&sni=edge.setalink.no#EDGE-HTTPUP
```

---

## Reality Parameters

| Field | Value |
|-------|-------|
| Server IP | 5.249.252.221 |
| Server hostname | edge.setalink.no |
| Port | 8443 |
| UUID (app) | b5243b1c-af7a-40f0-ad31-97fc6f9ba3e3 |
| UUID (tester) | 9280e04d-ffdb-45b4-9558-66b9d6f89b49 |
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
| 443 | public (nginx TLS) | WS, XHTTP, HTTPUP | TLS terminated by nginx |
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

## What Was Fixed (2026-05-19)

| Problem | Root Cause | Fix |
|---------|-----------|-----|
| All connections rejected | UUID mismatch — bootstrap DB had wrong UUID from a different server | Bootstrap DB updated to canonical b5243b1c UUID |
| Wrong server in bootstrap | DB had 178.104.77.231 (vpn.setalink.no) instead of 5.249.252.221 | All bootstrap sources updated |
| Wrong public key | Bootstrap had key from vpn.setalink.no server | Derived correct key from live private key |
| iran-tester UUID not in Xray | 9280e04d was in client profiles but not in Xray config | Added 9280e04d as second client in all 4 inbounds |
| XHTTP plain GET 404 | Xray normalizes /xhttp → /xhttp/ internally | Expected — real XHTTP sessions use /xhttp/{session_id}/... |

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
| XHTTP 404 on plain GET /xhttp | Normal — real sessions use /xhttp/{id}/... not bare path |

---

## Quick Diagnostics

```bash
# Full system check:
sudo bash /var/www/setalink/scripts/check-inbounds.sh

# Watch all transport paths live:
sudo tail -f /var/log/nginx/access.log | grep -E '/ws|/xhttp|/httpup'

# Watch Xray errors live:
sudo tail -f /var/log/xray/error.log

# Watch Xray accepted sessions (external only):
sudo tail -f /var/log/xray/access.log | grep "accepted" | grep -v "127.0.0.1"

# Count UUID rejections:
sudo grep "invalid request user id" /var/log/xray/access.log | wc -l

# Count 502s (Xray unreachable):
sudo grep ' 502 ' /var/log/nginx/access.log | wc -l
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

- REALITY on port 8443: Port 443 is occupied by nginx. Port 8443 is open in UFW. Use IP or hostname — both work.
- gRPC not added: this nginx build lacks `ngx_http_grpc_module`.
- WS and HTTPUpgrade are deprecated in Xray 26.x in favour of XHTTP — fully functional.
- XHTTP plain GET /xhttp → 404 is correct behavior. Sessions use /xhttp/{session_id}/... paths.
