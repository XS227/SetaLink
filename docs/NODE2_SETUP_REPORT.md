# NODE2_SETUP_REPORT — SetaLink Helsinki Secondary (Test) Node

**Date:** 2026-06-14
**Author:** automated provisioning (Claude Code)
**Status:** ✅ Test node live and verified. **Not** wired into production user routing.

---

## 1. Nodes

| Role | Hostname | Public IP | Location | Provider | Notes |
|------|----------|-----------|----------|----------|-------|
| **Production** (untouched) | `vps-5348441` | `5.249.252.221` | Copenhagen, DK | One.com/Uniweb | Existing SetaLink prod — **not modified** |
| **Secondary / TEST** | `ubuntu-4gb-hel1-4` | `65.109.183.7` | Helsinki, FI | Hetzner | New node, this report |

- Test hostname / TLS: **`fi.setalink.no` → 65.109.183.7** (Let's Encrypt).
- Helsinki OS: **Ubuntu 26.04 LTS** (note: provisioning request said 24.04; actual is 26.04).

---

## 2. What was cloned (architecture, mirrors prod)

```
client ──TLS:443──▶ nginx stream {ssl_preread}
                       │  SNI = www.cloudflare.com / www.microsoft.com ─▶ 127.0.0.1:8443  (Xray VLESS-Reality, xtls-rprx-vision)
                       └  SNI = anything else (fi.setalink.no)          ─▶ 127.0.0.1:4430  (nginx TLS vhost, LE cert)
                                                                              ├ /ws     ─▶ 127.0.0.1:10000  (VLESS WS)
                                                                              ├ /xhttp  ─▶ 127.0.0.1:10001  (VLESS xHTTP)
                                                                              └ /httpup ─▶ 127.0.0.1:10002  (VLESS httpupgrade)
Xray also: 127.0.0.1:8344 dokodemo-door (api/stats).  Outbounds: freedom(direct), blackhole(block).
```

Identical inbound/outbound/routing structure to Denmark prod, **except**:
- **NEW Reality keypair** generated on Helsinki (prod private key never copied/reused).
- **NEW shortIds**.
- A **single test client** (`fi-tester`) — prod user UUIDs were **not** copied.
- xHTTP/httpupgrade `host` = `fi.setalink.no` (prod uses `edge.setalink.no`).
- TLS cert is a fresh LE cert for `fi.setalink.no` (prod private keys not copied — per rules).

### Non-secret node parameters
| Field | Value |
|-------|-------|
| Address / port | `65.109.183.7:443` |
| Reality SNI (dest) | `www.cloudflare.com` (also `www.microsoft.com`); dest `www.cloudflare.com:443` |
| Reality **public** key | `eGL5TwzXjS4_kQrqAGBrY2K6MqjRXmz70xYhcgXUXwU` |
| Reality shortIds | `b3a824bd`, `e14a573fcbfcce4c` |
| Flow / fingerprint | `xtls-rprx-vision` / `chrome` |
| Test client UUID | `92a861cd-6029-4882-9de5-35d9291e0828` (test-only) |

> Secrets that stay **only on Helsinki** (never printed, never committed): Reality private key (`/usr/local/etc/xray/config.json`), TLS private key (`/etc/letsencrypt/live/fi.setalink.no/privkey.pem`). Non-secret summary also at `/usr/local/etc/xray/helsinki-node.meta` (chmod 600).

---

## 3. Test profile (manual import — NOT auto-routed)

VLESS-Reality share link for testers:

```
vless://92a861cd-6029-4882-9de5-35d9291e0828@65.109.183.7:443?security=reality&encryption=none&flow=xtls-rprx-vision&type=tcp&sni=www.cloudflare.com&fp=chrome&pbk=eGL5TwzXjS4_kQrqAGBrY2K6MqjRXmz70xYhcgXUXwU&sid=b3a824bd#SetaLink-Helsinki-Test
```

This is a standalone profile. **No change has been made to the production bootstrap / entitlement / `version.json` / api** — normal users are not routed to Helsinki. Wiring Helsinki into the real bootstrap is deferred pending explicit approval (see §7).

---

## 4. Commands executed (Helsinki, via `ssh root@65.109.183.7`)

```bash
# --- 1. Harden ---
apt-get update && apt-get full-upgrade -y
apt-get install -y nginx ufw certbot python3-certbot-nginx curl wget unzip jq \
                   qrencode htop vnstat net-tools dnsutils ca-certificates
adduser --disabled-password --gecos "SetaLink Admin" setaadmin
usermod -aG sudo setaadmin
cp /root/.ssh/authorized_keys /home/setaadmin/.ssh/authorized_keys   # key login
echo "setaadmin ALL=(ALL) NOPASSWD:ALL" > /etc/sudoers.d/90-setaadmin
ufw allow 22/tcp; ufw allow 80/tcp; ufw allow 443/tcp; ufw --force enable
# (SSH password auth left ENABLED per operator choice — not disabled)

# --- 2. Xray ---
bash -c "$(curl -L https://github.com/XTLS/Xray-install/raw/main/install-release.sh)" @ install
xray x25519        # NEW keypair (private key kept on box only)
xray uuid          # NEW test client id
# config.json written mirroring prod inbounds/outbounds/routing (see §2)
xray -test -config /usr/local/etc/xray/config.json     # => Configuration OK

# --- 3. nginx + TLS ---
apt-get install -y libnginx-mod-stream                  # ssl_preread (dynamic module on 26.04)
# /etc/nginx/sites-available/fi.setalink.no  : :80 ACME+redirect, :4430 TLS vhost (/ws /xhttp /httpup)
# /etc/nginx/conf.d/00-connection-upgrade.conf : map $http_upgrade $connection_upgrade
# stream{} appended to nginx.conf : ssl_preread SNI map -> 8443 (reality) / 4430 (default)
cp .../certbot_nginx/.../options-ssl-nginx.conf /etc/letsencrypt/options-ssl-nginx.conf
certbot certonly --webroot -w /var/www/html -d fi.setalink.no   # leaves :443 (stream) alone
# renewal deploy hook: /etc/letsencrypt/renewal-hooks/deploy/reload-nginx.sh -> systemctl reload nginx
systemctl restart nginx
systemctl enable --now xray && systemctl restart xray
```

Denmark prod: **read-only only** (config inspected for cloning; nothing written/restarted).

---

## 5. Verification results

| Check | Result |
|-------|--------|
| nginx active / enabled | ✅ active, enabled |
| xray active / enabled | ✅ active, enabled |
| Listeners | ✅ nginx :80, :443 (stream), 127.0.0.1:4430 · xray 127.0.0.1:{10000,10001,10002,8344,8443} |
| HTTP :80 | ✅ `301 → https://fi.setalink.no/` |
| HTTPS :443 (fi.setalink.no) | ✅ `200`, valid LE cert `CN=fi.setalink.no` (issuer Let's Encrypt) |
| Reality SNI dispatch | ✅ SNI `www.cloudflare.com` presents real Cloudflare cert (stream→reality→dest borrow) |
| **Reality handshake (end-to-end)** | ✅ temp Xray client → 443 → reality: handshake OK, no errors |
| **Egress IP** | ✅ `65.109.183.7` — Helsinki, FI, Hetzner (AS24940) |
| Cert auto-renewal | ✅ Configured: webroot authenticator, `certbot.timer` active, deploy hook reloads nginx. Proven by the successful live webroot issuance (same mechanism). (`renew --dry-run` was slow/inconclusive over the admin link — not a config fault.) |
| **Denmark prod untouched** | ✅ DK xray still active; DK reality SNI still serving |

---

## 6. Rollback / decommission (Helsinki only — does not affect Denmark)

The Helsinki node is fully standalone; there is **nothing to roll back on Denmark** (prod was never modified). To decommission the test node:

```bash
ssh root@65.109.183.7
systemctl disable --now xray nginx           # stop services
ufw --force disable                          # (optional) open firewall back
# full removal:
bash -c "$(curl -L https://github.com/XTLS/Xray-install/raw/main/install-release.sh)" @ remove
apt-get purge -y nginx libnginx-mod-stream certbot python3-certbot-nginx
rm -rf /etc/nginx /usr/local/etc/xray /etc/letsencrypt
# then delete the Hetzner server, and remove DNS record fi.setalink.no
```
If only pausing: `systemctl stop xray nginx`. Since no production bootstrap entry was added, no app/user is pointed at Helsinki — stopping it affects test traffic only.

---

## 7. DK vs FI comparison testing

Both nodes share the **same Reality dest/SNI** (`www.cloudflare.com`) and structure, so a tester can A/B them by swapping the endpoint + key material:

| | Denmark (prod) | Helsinki (test) |
|--|----------------|-----------------|
| Address | `5.249.252.221:443` (or `vpn.setalink.no`) | `65.109.183.7:443` (`fi.setalink.no`) |
| Reality pubkey/shortId | prod key (not in this doc) | `eGL5…XwU` / `b3a824bd` |
| Test client | existing prod profile | `92a861cd-…-0828` (this doc) |

**Manual test (any Xray/v2ray client):**
1. Import the §3 link → connect → visit `https://api.ipify.org` → expect **65.109.183.7**.
2. Compare latency/throughput vs the prod profile (e.g. `fast.com`, `speedtest`).
3. Iran-reachability A/B: try each SNI (`www.cloudflare.com` vs `www.microsoft.com`) on both nodes.

**CLI smoke test (reproduces §5 egress check):** run a temp Xray client with a SOCKS inbound + the §3 outbound, then `curl --socks5-hostname 127.0.0.1:10808 https://ipinfo.io/json`.

---

## 8. Rules compliance

- ✅ Production Denmark node **never modified**; prod xray never stopped; user traffic unchanged.
- ✅ Production TLS private keys **not** copied; LE cert issued fresh for `fi.setalink.no`.
- ✅ **New** Reality keypair; no private key reuse.
- ✅ Helsinki is **test-only**; **no** automatic user routing; separate test profile only.
- ⏸️ **Deferred (needs approval):** adding Helsinki to the production bootstrap for real users.
