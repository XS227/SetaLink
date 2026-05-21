# SetaLink — Iran Connectivity Test Matrix

Updated: 2026-05-21  
Server: 178.104.77.231 (Hetzner Nuremberg, Germany — Ubuntu 24.04, nginx 1.24, Xray 26.3.27)  
Edge proxy: edge.setalink.no → 5.249.252.221 (WS / XHTTP / HTTPUpgrade, CF UUID whitelisted)

**Active Reality inbounds — 3 independent keypairs:**
- `fd709d48-a983-484a-99e3-afc97e2c3692` — SetaLink-Cloudflare :443
- `c8af7366-b531-4f35-bea2-6fb70d1e4850` — SetaLink-Oracle :8443
- `1580e282-be00-4ddc-932b-9bbcd69f0dad` — SetaLink-Amazon :2052

---

## Profile Matrix

| # | Name | Transport | Port | Path | DPI Resistance | Notes |
|---|------|-----------|------|------|----------------|-------|
| 1 | SetaLink-Cloudflare | VLESS TCP Reality | 443 | — | Very High | TLS impersonates cloudflare.com |
| 2 | SetaLink-Oracle | VLESS TCP Reality | 8443 | — | Very High | TLS impersonates oracle.com |
| 3 | SetaLink-Amazon | VLESS TCP Reality | 2052 | — | Very High | TLS impersonates amazon.com |
| 4 | EDGE-XHTTP | VLESS XHTTP TLS | 443 | /xhttp/ | High | SplitHTTP via edge.setalink.no |
| 5 | EDGE-WS | VLESS WS TLS + uTLS | 443 | /ws | Medium-High | Chrome fingerprint via edge proxy |
| 6 | EDGE-HTTPUP | VLESS HTTPUpgrade TLS | 443 | /httpup | Medium | HTTP upgrade via edge proxy |

---

## VLESS Client Links — Hetzner Reality Inbounds

Import into: v2rayN, NekoBox, v2rayNG, Hiddify, Streisand

### 1. SetaLink-Cloudflare — TCP Reality :443 (Primary)
```
vless://fd709d48-a983-484a-99e3-afc97e2c3692@178.104.77.231:443?type=tcp&encryption=none&security=reality&pbk=IJXsDOA55gNiMZprjOdfaS6pN9ifm4MSqlsiZDGzki8&fp=chrome&sni=www.cloudflare.com&sid=d93af82f2ecb7f6a#SetaLink-Cloudflare
```

### 2. SetaLink-Oracle — TCP Reality :8443
```
vless://c8af7366-b531-4f35-bea2-6fb70d1e4850@178.104.77.231:8443?type=tcp&encryption=none&security=reality&pbk=5eItT4D3ZmR8Nit_JWjpm9XfX4CzZGzvhovxF4n_6CY&fp=chrome&sni=www.oracle.com&sid=70df7a#SetaLink-Oracle
```

### 3. SetaLink-Amazon — TCP Reality :2052
```
vless://1580e282-be00-4ddc-932b-9bbcd69f0dad@178.104.77.231:2052?type=tcp&encryption=none&security=reality&pbk=Wo4-Iz8anzOfnQye9L1ARwDElePwwLPq1b82A_ZEsjo&fp=chrome&sni=www.amazon.com&sid=a4#SetaLink-Amazon
```

---

## VLESS Client Links — Edge Transport (via edge.setalink.no)

*CF UUID (fd709d48) is whitelisted on old server Xray WS/XHTTP/HTTPUpgrade inbounds.*

### 4. EDGE-XHTTP — SplitHTTP TLS
```
vless://fd709d48-a983-484a-99e3-afc97e2c3692@edge.setalink.no:443?security=tls&type=xhttp&path=%2Fxhttp%2F&host=edge.setalink.no&sni=edge.setalink.no&fp=chrome#SETALINK-XHTTP
```

### 5. EDGE-WS — WebSocket TLS + Chrome fingerprint
```
vless://fd709d48-a983-484a-99e3-afc97e2c3692@edge.setalink.no:443?security=tls&type=ws&path=%2Fws&host=edge.setalink.no&sni=edge.setalink.no&fp=chrome&alpn=http%2F1.1#SETALINK-WS
```

### 6. EDGE-HTTPUP — HTTPUpgrade TLS
```
vless://fd709d48-a983-484a-99e3-afc97e2c3692@edge.setalink.no:443?security=tls&type=httpupgrade&path=%2Fhttpup&host=edge.setalink.no&sni=edge.setalink.no&fp=chrome#SETALINK-HTTPUP
```

---

## Reality Parameters

### SetaLink-Cloudflare (Primary)
| Field | Value |
|-------|-------|
| Server IP | 178.104.77.231 |
| Port | 443 |
| UUID | fd709d48-a983-484a-99e3-afc97e2c3692 |
| Flow | (none) |
| Security | reality |
| SNI | www.cloudflare.com |
| Fingerprint | chrome |
| Public Key | IJXsDOA55gNiMZprjOdfaS6pN9ifm4MSqlsiZDGzki8 |
| Short ID | d93af82f2ecb7f6a |

### SetaLink-Oracle (Alt 1)
| Field | Value |
|-------|-------|
| Server IP | 178.104.77.231 |
| Port | 8443 |
| UUID | c8af7366-b531-4f35-bea2-6fb70d1e4850 |
| Flow | (none) |
| Security | reality |
| SNI | www.oracle.com |
| Fingerprint | chrome |
| Public Key | 5eItT4D3ZmR8Nit_JWjpm9XfX4CzZGzvhovxF4n_6CY |
| Short ID | 70df7a |

### SetaLink-Amazon (Alt 2)
| Field | Value |
|-------|-------|
| Server IP | 178.104.77.231 |
| Port | 2052 |
| UUID | 1580e282-be00-4ddc-932b-9bbcd69f0dad |
| Flow | (none) |
| Security | reality |
| SNI | www.amazon.com |
| Fingerprint | chrome |
| Public Key | Wo4-Iz8anzOfnQye9L1ARwDElePwwLPq1b82A_ZEsjo |
| Short ID | a4 |

---

## Server Port Map

| Port | Binding | Profile | Transport |
|------|---------|---------|-----------|
| 443 | public (Xray direct, Hetzner) | SetaLink-Cloudflare | Reality — TLS impersonates cloudflare.com |
| 8443 | public (Xray direct, Hetzner) | SetaLink-Oracle | Reality — TLS impersonates oracle.com |
| 2052 | public (Xray direct, Hetzner) | SetaLink-Amazon | Reality — TLS impersonates amazon.com |
| 443 | edge.setalink.no (old server, nginx TLS) | WS, XHTTP, HTTPUP | TLS terminated by nginx, proxied to Xray |
| 10000 | 127.0.0.1 (old server) | WS inbound | tag: inbound-ws |
| 10001 | 127.0.0.1 (old server) | XHTTP inbound | tag: inbound-xhttp |
| 10002 | 127.0.0.1 (old server) | HTTPUpgrade inbound | tag: inbound-httpup |

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
| 1st | SetaLink-Cloudflare | :443 — most likely unblocked, cloudflare.com SNI |
| 2nd | SetaLink-Oracle | :8443 — alternate port, oracle.com SNI |
| 3rd | SetaLink-Amazon | :2052 — CDN port, amazon.com SNI |
| 4th | EDGE-XHTTP | SplitHTTP — chunked body looks like file download |
| 5th | EDGE-WS | WebSocket with Chrome fingerprint |
| Last | EDGE-HTTPUP | Different HTTP upgrade wire format |

---

## Migration History

| Date | Change |
|------|--------|
| 2026-05-19 | Fixed UUID/SNI mismatch on old server (One.com/5.249.252.221) |
| 2026-05-21 | **Migrated to Hetzner Nuremberg (178.104.77.231)** — 3 Reality inbounds with independent keypairs |
| 2026-05-21 | CF UUID (fd709d48) whitelisted on old server for WS/XHTTP/HTTPUpgrade continuity |
| 2026-05-21 | Bootstrap hardcode + API updated to Hetzner CF inbound |

---

## Quick Diagnostics

```bash
# Watch Xray accepted sessions on Hetzner:
sudo journalctl -u xray -f | grep "accepted"

# Watch Xray errors:
sudo tail -f /var/log/xray/error.log

# Watch edge transport paths on old server (edge.setalink.no):
sudo tail -f /var/log/nginx/access.log | grep -E '/ws|/xhttp|/httpup'

# DNS check:
dig vpn.setalink.no +short    # Should → 178.104.77.231
dig edge.setalink.no +short   # → 5.249.252.221 (old server, still used for WS/XHTTP)
```
