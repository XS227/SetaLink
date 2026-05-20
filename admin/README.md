# SetaLink Admin Dashboard

Production admin SPA for SetaLink. Single-page PHP application — no external JS frameworks, no build step.

## Architecture

```
   browser ──HTTPS──► nginx :443
                           │  SNI=shahnameh.setaei.com
                           │  auth_basic (/etc/setalink/admin/htpasswd)
                           ▼
                    php-fpm (www-data)
                     ├── index.php  ── all HTML/CSS/JS (SPA router)
                     ├── api.php    ── all JSON endpoints
                     └── qr.php     ── proxy for QR PNG (PHP can't read directly)
                           │
                           ├── sudo (NOPASSWD, single binary only)
                           ▼
                    setalink-cli  (root:root, 0755)
                           │  re-validates username ^[a-z0-9][a-z0-9._-]{0,31}$
                           ▼
                    /etc/setalink/  (Xray user config, quota, etc.)

   SQLite: /var/www/setalink/data/analytics.db
   Version JSON: /var/www/setalink/public/download/version.json
   APK releases: /var/www/setalink/public/releases/{stable,beta,hotfix}/
```

### Auth model

- nginx `auth_basic` gate at `/_setalink-admin/` — credentials in `/etc/setalink/admin/htpasswd`
- `index.php` sets a session cookie `_sl_session = HMAC-SHA256("sl-session:admin", csrf_secret)`
- `api.php` validates that cookie on every XHR — avoids re-triggering the Basic Auth dialog
- All state-mutating API actions also require a `_csrf` token from `?action=csrf`

---

## Setup

```sh
sudo /var/www/setalink/setup-admin.sh
```

This will:
1. Install `apache2-utils` (for `htpasswd`) if missing
2. Prompt for admin username + password → `/etc/setalink/admin/htpasswd` (0640 root:www-data)
3. Generate `/etc/setalink/admin/csrf.secret` (0640 root:www-data)
4. Write `/etc/sudoers.d/setalink-admin`
5. Write `/etc/nginx/snippets/setalink-admin.conf`
6. Reload nginx (after `nginx -t`)

Then browse to `https://shahnameh.setaei.com/_setalink-admin/`

### Adding / removing admins

```sh
sudo htpasswd /etc/setalink/admin/htpasswd <new-user>
sudo htpasswd -D /etc/setalink/admin/htpasswd <user>
```

### Rotating the CSRF secret (invalidates all open sessions)

```sh
sudo openssl rand -hex 32 \
  | sudo install -m 0640 -o root -g www-data /dev/stdin /etc/setalink/admin/csrf.secret
```

---

## Files

| File | Purpose |
|------|---------|
| `index.php` | SPA shell: PHP auth bootstrap + all HTML views + vanilla JS router |
| `api.php` | All JSON API endpoints (mobile + admin) |
| `style.css` | Dark theme, emerald accent, protocol/error badges |
| `qr.php` | Proxy for per-user QR codes (root-owned files) |
| `setalink-cli` | Sole sudo-whitelisted binary for user management |

---

## API Endpoint Reference

All endpoints served by `api.php`. Admin endpoints require the `_sl_session` cookie.
Mobile endpoints require `Authorization: Bearer setalink-mobile-diag-v1`.

### Mobile API (POST)

| Action | Auth | Description |
|--------|------|-------------|
| `register-device` | Bearer token | Auto-register device on first launch; returns `device_id` |
| `use-referral` | Bearer token | Apply a referral code; credits both referrer and new device |
| `report-usage` | Bearer token | Report bandwidth used since last report |
| `update-status` | Bearer token | Push VPN connect/disconnect event |
| `telemetry` | Bearer token | Submit connection attempt result (success/fail, latency, SNI, protocol, error_msg) |

### Admin GET

| Action | Description |
|--------|-------------|
| `csrf` | Issue a fresh CSRF token (required before any POST) |
| `status` | Xray/nginx/system status, active user count |
| `list` | Full user list from `setalink-cli list` |
| `server-stats` | CPU, RAM, uptime, load |
| `connection-analytics` | Recent connection attempts from `test_results` |
| `test-results` | Raw test_results rows with filters |
| `logs` | Structured log rows from `analytics.db`; accepts `q`, `sev`, `limit` params |
| `protocol-health` | Success rate per protocol over last 24 h |
| `inbound-stats` | Per-inbound traffic totals from Xray stats API |
| `active-sessions` | Live session count, top IPs, protocol distribution |
| `iran-score` | Summary score for Iran reachability (0–100) |
| `iran-debug` | Full Iran diagnostics: SNI×protocol matrix, ISP breakdown, error patterns |
| `no-internet-analysis` | Breakdown of TCP-ok/no-HTTP and full-timeout failures |
| `sni-leaderboard` | Top SNIs by success rate and attempt count |
| `app-analytics` | Aggregated app metrics (connects, disconnects, errors by day) |
| `devices-list` | Device list with optional `q`, `plan`, `status` filters |
| `device-breakdown` | Devices by OS, plan, status |
| `session-stats` | Session duration histogram |
| `profile-stats` | Per-profile success/fail counts |
| `learning-stats` | AI optimizer learning events |
| `release-status` | APK inventory per channel: filename, size, SHA256, mtime, symlink health |
| `get-settings` | Current admin settings from `settings.json` |
| `get-remote-config` | Current remote config JSON sent to mobile app |
| `watchdog-log` | Last N lines from watchdog log |
| `heartbeat` | Quick liveness: Xray PID, nginx, DB write, API reachability, tun2socks |
| `debug-status` | Detailed per-service diagnostics with structured log entries |
| `payment-queue` | Pending payment submissions |
| `node-list` | Multi-node list (if configured) |
| `lookup-isp` | ISP lookup for a given IP |

### Admin POST

| Action | Description |
|--------|-------------|
| `device-block` | Block a device by device_id |
| `device-unblock` | Unblock a device |
| `device-set-quota` | Override quota for a device |
| `save-settings` | Persist admin settings JSON |
| `save-remote-config` | Persist remote config (SNI list, kill-switch domains, protocol order) |
| `record-test` | Manually log a test result |
| `save-bundle` | Upload a JS bundle for OTA |
| `payment-approve` / `payment-reject` | Process payment queue entry |
| `delete-old-apk` | Delete a named APK from a channel dir (refuses to delete symlink target) |
| `add-user` / `remove-user` / `disable-user` / `enable-user` | Delegate to `setalink-cli` |

---

## Release Pipeline

### Channels

| Channel | Purpose | Audience |
|---------|---------|---------|
| `stable` | Production releases | All users |
| `beta` | Feature testing | Opt-in testers |
| `hotfix` | Emergency patches | Rapid rollout |

### Deploying a new APK

```sh
# 1. Build
cd mobile-app/android
./gradlew assembleRelease

# 2. Copy to channel dir
cp app/build/outputs/apk/release/*.apk \
   /var/www/setalink/public/releases/stable/setalink-vX.Y.Z.apk

# 3. Update symlinks
ln -sf setalink-vX.Y.Z.apk \
   /var/www/setalink/public/releases/stable/setalink-latest.apk
ln -sf ../releases/stable/setalink-vX.Y.Z.apk \
   /var/www/setalink/public/download/setalink-latest.apk

# 4. Compute SHA256
sha256sum /var/www/setalink/public/releases/stable/setalink-vX.Y.Z.apk

# 5. Update version.json
# Edit /var/www/setalink/public/download/version.json:
#   version, versionCode, releaseDate, apkSha256, changelog, channels{}

# 6. Verify with repo-health script
bash /var/www/setalink/scripts/repo-health.sh

# 7. Commit
git add public/download/version.json
git commit -m "release: vX.Y.Z — <one-line summary>"
```

The mobile app polls `version.json` on every launch. If `versionCode` is higher than the installed build, it prompts (or forces if `forceUpdate: true`) an in-app update.

### Cleaning up old APKs

Use the Release tab in the admin UI. Each APK row has a **Delete** button that:
- Confirms before acting
- Refuses to delete the file that the channel symlink currently points to
- Calls `?action=delete-old-apk` (POST with CSRF token)

Or manually:
```sh
ls -lh /var/www/setalink/public/releases/stable/
rm /var/www/setalink/public/releases/stable/setalink-vOLD.apk
```

### Verifying a release

```sh
# Check symlinks, SHA256, version.json consistency
bash /var/www/setalink/scripts/repo-health.sh

# Manual SHA256 verify
sha256sum /var/www/setalink/public/releases/stable/setalink-vX.Y.Z.apk
# compare with apkSha256 in version.json
```

---

## Iran Monitoring Workflow

SetaLink's primary users are behind Iranian ISP filtering. The admin panel's **Iran Debug** tab gives you a live picture of what's working and what's being blocked.

### What to check after each release

**1. Open Iran Debug tab in admin**

The summary card shows an overall reachability score (0–100). Below 70 means something important is broken.

**2. SNI × Protocol matrix**

Each row is a `(protocol, SNI)` combination tried by Iranian users. Columns:
- `Total` — connection attempts
- `Success` — full HTTP routing confirmed
- `Fail` — any failure
- `TCP-only` — TCP handshake succeeded but no HTTP data returned (DPI pattern)
- `No-internet` — complete timeout / connection refused

**Red flags:**
- Any SNI with `TCP-only > 10%` of attempts → DPI is fingerprinting that SNI, rotate it
- A protocol where `Success < 40%` across all SNIs → entire protocol may be blocked by ISP
- `No-internet` spike after a release → check TUN routing fix (EPERM fallback)

**3. ISP breakdown**

Hamrah/Irancell/MCI/Mobin/Shatel/Rightel/TCI are tracked separately. If one ISP shows 0% success while others are fine, that ISP is running a targeted block. Prioritize testing from that ISP.

**4. Error patterns**

The top-30 error strings are shown with counts. Map them to categories:

| Pattern in error_msg | Category | Action |
|---------------------|---------|--------|
| `connection reset`, `forcibly closed` | DPI Blocked | Rotate SNI; try different TLS fingerprint |
| `NXDOMAIN`, `no such host` | DNS Poisoned | Switch to DoH; update bootstrap DNS in remote config |
| `tls`, `handshake`, `certificate` | TLS Failed | Check cert validity; SNI mismatch; verify ALPN in Xray config |
| `alpn` | ALPN Mismatch | Ensure `alpn: [http/1.1]` for WS/HTTPUpgrade inbounds |
| `tcp.*ok.*no.*http`, `tcp_only` | TCP-only / No Routing | Check tun2socks; Xray outbound; TUN interface |
| `EPERM`, `operation not permitted`, `bindSocket` | Android VPN | Expected — handled by EPERM fallback; monitor fallback success rate |
| `ipv6`, `::/0` | IPv6 Routing | Ensure blackhole rule for `::/0` in Xray config |
| `mtu`, `emsgsize` | MTU Issue | Reduce MTU in tun2socks config; try 1200 |

**5. No-Internet Analysis endpoint**

Queries `test_results` for rows where `tcp_ok=1 AND http_ok=0` (TCP-only) and where both are 0 (full block). If TCP-only is rising, ISPs are upgrading from DNS-block to DPI. If full-block is rising, new IP ranges may be blocked.

### Recommended weekly workflow

```
Monday:
  - Check Iran Debug → summary score
  - Review error patterns for new DPI signatures
  - Check ISP breakdown for any new ISP-specific block

After each release:
  - Run repo-health.sh to verify APK + symlinks
  - Check Release tab for SHA256 match
  - Watch Iran Debug score over next 2 h for regression

When score drops below 70:
  1. Check top error patterns → identify category
  2. If DPI: update SNI priority list in Config → Remote Config → save
  3. If DNS: add new DoH resolver to bootstrap list
  4. If ALPN: check Xray inbound configs
  5. Push update via OTA (save-remote-config) without rebuilding APK
  6. Monitor score recovery over 30 min
```

### OTA config update (no APK rebuild needed)

For SNI rotations and DNS changes, use the **Config** tab → **Remote Config** section:
- `sniPriorities` — ordered list of SNIs to try; put best-performing first
- `killSwitchDomains` — domains to block when VPN is off
- `protocolOrder` — order to try protocols (e.g. `["reality","xhttp","ws","httpupgrade"]`)

Mobile app fetches this config on each launch. Changes take effect within 1–2 minutes for active users.

---

## Quota enforcement

Cron at `/etc/cron.d/setalink-quotas`:

```
*/5 * * * * root /var/www/setalink/check-quotas.sh >>/var/log/setalink-quotas.log 2>&1
```

Polls Xray stats API → accumulates per-user `used_bytes` → auto-disables users over quota (skips `quota_bytes == 0` = unlimited).

---

## Uninstall

```sh
sudo rm /etc/sudoers.d/setalink-admin
sudo rm /etc/nginx/snippets/setalink-admin.conf
# Remove include line from vhost, then:
sudo nginx -t && sudo systemctl reload nginx
sudo rm -rf /etc/setalink/admin
```
