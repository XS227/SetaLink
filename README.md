# SetaLink

A small private VPN access system built on **Xray-core** with **VLESS + REALITY**.
CLI-driven by default; an optional admin web dashboard layers on top for the same
operations from a browser. No public registration; the operator runs everything
over SSH or via the dashboard behind HTTP basic auth.

- Target OS: **Ubuntu 22.04**
- Cap: **50 users**
- Coexists with an existing nginx on ports 80/443 — Xray shares :443 via an
  SNI-aware nginx `stream` multiplexer (see *Network architecture* below)
- Per-user traffic accounting + auto-disable on quota
- systemd-managed, ufw firewall, fail2ban for SSH

## Files

| File                       | Purpose                                                                 |
| -------------------------- | ----------------------------------------------------------------------- |
| `install.sh`               | One-shot installer. Idempotent — safe to re-run.                        |
| `lib.sh`                   | Shared paths, logging, config-regeneration logic, package definitions.  |
| `add-user.sh`              | Add a user (`--package=5GB|10GB|15GB|unlimited`), regen, print link+QR. |
| `remove-user.sh`           | Remove a user and their files, regenerate config.                       |
| `disable-user.sh`          | Set `disabled=true` (filtered from xray clients[]) and restart.         |
| `enable-user.sh`           | Set `disabled=false` and restart.                                       |
| `list-users.sh`            | List users (table), or show one user's detail.                          |
| `migrate-users-v3.sh`      | One-shot migration to Phase 3 schema (idempotent).                      |
| `poll-traffic.sh`          | Read xray's stats API (atomic reset), accumulate to `users.json`.       |
| `check-quotas.sh`          | Run `poll-traffic.sh` then auto-disable users over quota.               |
| `setup-admin.sh`           | Install + configure the admin web dashboard (PHP + nginx).              |
| `backup.sh`                | Snapshot `/etc/setalink` + Xray config to a tar.gz.                     |
| `admin/`                   | The web dashboard — see [`admin/README.md`](admin/README.md).           |

## Storage layout

Sensitive runtime data is **NOT** under `/var/www/`. It lives where nginx can never accidentally serve it:

```
/etc/setalink/                      # 0700 root
├── setalink.env                    # 0600  HOST, ports, SNI, REALITY priv/pub keys, toggles
├── users.json                      # 0600  user roster (Phase 3 schema below)
├── admin/                          # 0750 root:www-data (Phase 2)
│   ├── htpasswd                    # 0640  basic-auth credentials
│   └── csrf.secret                 # 0640  HMAC key for CSRF tokens
└── users/<name>/
    ├── link.txt                    # 0600  vless:// URL
    └── qr.png                      # 0600  scannable QR

/usr/local/etc/xray/config.json     # rendered from users.json + setalink.env
/var/log/xray/{access,error}.log    # Xray logs
/var/log/setalink-quotas.log        # check-quotas.sh / poll-traffic.sh cron output
/var/backups/setalink/              # backup.sh output + per-phase pre-change snapshots
/etc/cron.d/setalink-quotas         # */5min poll + auto-disable
/etc/sudoers.d/setalink-admin       # www-data → admin/setalink-cli (Phase 2)
/etc/nginx/snippets/setalink-admin.conf   # the admin /location/ block (Phase 2)
```

### `users.json` schema (Phase 3)

```json
{
  "users": [
    {
      "name":         "alice",
      "uuid":         "<v4 UUID>",
      "shortId":      "<8 random bytes hex>",
      "created":      "2026-05-09T01:33:43Z",
      "package_name": "5GB",            // 5GB | 10GB | 15GB | unlimited
      "quota_bytes":  5368709120,       // 0 == unlimited (no auto-disable)
      "used_bytes":   0,                // accumulated by poll-traffic.sh
      "disabled":     false,            // true → filtered from xray clients[]
      "last_seen_at": null              // ISO 8601 UTC, set by poll-traffic.sh
    }
  ]
}
```

Pre-Phase-3 records (no quota fields) are migrated by `migrate-users-v3.sh` (idempotent — re-running is a no-op).

## Install

```bash
sudo ./install.sh
```

The installer:

1. Installs `xray-core` (official `Xray-install` script), `jq`, `qrencode`, `ufw`, `fail2ban`.
2. Generates a fresh REALITY x25519 keypair (preserved on re-runs).
3. Asks for **public host**, **port** (default `8443`), **REALITY SNI** (default `www.cloudflare.com`).
4. Writes `/etc/setalink/setalink.env` and the initial Xray config.
5. Enables `xray.service`, configures `ufw` (preserves 22/80/443 + opens the Xray port), enables a `sshd` jail in `fail2ban`.

### Non-interactive install

```bash
sudo SETALINK_HOST=vpn.example.com \
     SETALINK_PORT=8443 \
     SETALINK_SNI=www.cloudflare.com \
     SETALINK_NONINTERACTIVE=1 \
     ./install.sh
```

### Network architecture (Phase 2: REALITY on :443 via nginx stream)

REALITY ideally listens on 443 — and on this VPS it does, despite nginx being there too. The stack:

```
public :443
   │
   ▼
nginx stream {} (ssl_preread on, proxy_protocol on)
   │
   ├─ SNI = www.cloudflare.com  ─►  127.0.0.1:8443  ─►  xray VLESS+REALITY
   └─ default                   ─►  127.0.0.1:8444  ─►  nginx http {} vhosts
                                                          (shahnameh.setaei.com,
                                                           admin.shahnameh.setaei.com,
                                                           trustai.no, ...)

public :80  ─►  nginx http (HTTP→HTTPS redirect, ACME challenges)
```

`ssl_preread` reads only the SNI from the TLS ClientHello; the original handshake passes through untouched, so REALITY's TLS-impostor semantics still work end-to-end. The HTTPS vhosts are configured with `proxy_protocol` and `set_real_ip_from 127.0.0.1; real_ip_header proxy_protocol;` so they still see the real client IP. xray's REALITY inbound has `streamSettings.tcpSettings.acceptProxyProtocol: true` so it parses the same PROXY-v1 preamble.

This pattern is forced rather than chosen: the hosting provider's edge firewall on this VPS only permits inbound 22/80/443 — every other port is silently dropped before reaching the NIC. If you deploy SetaLink on a host without that constraint, set `SETALINK_ACCEPT_PROXY_PROTOCOL=0` in `setalink.env` and revert the nginx stream block; xray will work standalone on whichever `SETALINK_PORT` is set.

## Add / remove / list / disable / enable users

```bash
sudo ./add-user.sh alice                      # default package: unlimited
sudo ./add-user.sh alice --package=5GB        # 5 / 10 / 15 GB or unlimited
sudo ./list-users.sh                          # table of all users
sudo ./list-users.sh alice                    # detail view (link + paths)
sudo ./list-users.sh --json                   # raw users.json
sudo ./disable-user.sh alice                  # set disabled=true (kept in DB)
sudo ./enable-user.sh alice                   # set disabled=false
sudo ./remove-user.sh alice                   # delete record + per-user files
```

User names: `[a-z0-9][a-z0-9._-]{0,31}` — keep them short and ASCII (they go into the VLESS URL fragment as the client display label).

Each `add-user.sh` writes:

- `/etc/setalink/users/<name>/link.txt` — the `vless://…` URL
- `/etc/setalink/users/<name>/qr.png` — PNG QR code (8 px modules, 2 px margin)
- and prints both to stdout, plus an in-terminal ANSI QR

## Packages and quotas (Phase 3)

Built-in package names and their quotas (`quota_bytes` field in `users.json`):

| Package     | Quota                  | Auto-disable on quota? |
| ----------- | ---------------------- | ---------------------- |
| `5GB`       | 5 × 1024³ = 5 368 709 120 B  | yes              |
| `10GB`      | 10 × 1024³ = 10 737 418 240 B | yes             |
| `15GB`      | 15 × 1024³ = 16 106 127 360 B | yes             |
| `unlimited` | 0 (sentinel)            | **never**             |

Add a new package by editing `PACKAGE_NAMES` and `package_to_bytes()` in `lib.sh`, then teaching the admin UI's `VALID_PACKAGES` and styling the badge.

### Change a user's package

```bash
sudo /var/www/setalink/admin/setalink-cli change-package alice 10GB
```

Or, in the dashboard: row → *more…* → pick package → *change pkg*. **Changing the package does NOT auto-enable a previously auto-disabled user** — explicitly run `enable-user.sh` or click *enable* in the dashboard once the user is back under quota.

### Reset a user's traffic counter

```bash
sudo /var/www/setalink/admin/setalink-cli reset-traffic alice
```

Sets `used_bytes` to 0. Note that any traffic already counted in xray's stats but not yet polled into `users.json` (max 5 minutes) will be added on the next `poll-traffic.sh` run. Run `sudo /var/www/setalink/poll-traffic.sh` immediately after a reset to fully zero both counters.

### Regenerate a user's link / QR (same UUID)

```bash
sudo /var/www/setalink/admin/setalink-cli regen-link alice
```

Useful if `link.txt`/`qr.png` were lost or `setalink.env` changed (e.g. SETALINK_CLIENT_PORT was edited). Does not change UUID or shortId — existing scanned QRs still work.

## Traffic tracking

xray exposes per-user upload/download counters via its gRPC stats API. SetaLink's regen template enables it on a localhost-only inbound at `127.0.0.1:8344`:

```jsonc
"stats": {},
"api":   { "tag": "api", "services": ["StatsService"] },
"policy": {
    "levels":  { "0": { "statsUserUplink": true, "statsUserDownlink": true } },
    "system":  { "statsInboundUplink": true, "statsInboundDownlink": true }
},
"inbounds": [
    { "tag": "api", "listen": "127.0.0.1", "port": 8344, "protocol": "dokodemo-door", ... }
],
"routing": { "rules": [ { "type": "field", "inboundTag": ["api"], "outboundTag": "api" }, ... ] }
```

`poll-traffic.sh` calls `xray api statsquery --reset --pattern "user>>>"` — atomically reads each per-user counter AND resets it to zero, so there's no double counting. The deltas are summed (uplink + downlink) and added to `users.json::users[].used_bytes`. `last_seen_at` is bumped to the poll timestamp for any user with a positive delta.

```bash
sudo /var/www/setalink/poll-traffic.sh    # one-shot
```

The cron job at `/etc/cron.d/setalink-quotas` runs `check-quotas.sh` every 5 minutes (which calls `poll-traffic.sh` then enforces). Disable by removing that file.

**Caveats:**
- Counters are in-memory only; a full xray restart loses any traffic accumulated since the last poll (worst case: ~5 min).
- Anonymous REALITY-fallback traffic (failed-auth → cloudflare proxy) is *not* counted against any user — only authenticated VLESS sessions tagged with the user's `email` field.

## Quota enforcement

`check-quotas.sh`:

1. Calls `poll-traffic.sh` (failures here don't block enforcement against last-known counters).
2. Lists users where `disabled != true && quota_bytes > 0 && used_bytes >= quota_bytes`.
3. Calls `disable-user.sh` for each — which regenerates the xray config with the user filtered out of `clients[]` and restarts xray.

Re-enabling is always manual (`enable-user.sh` or the dashboard's *enable* button) — usually after `reset-traffic` or `change-package` to a higher tier.

## Admin web dashboard (Phase 2 + 3)

A small PHP/HTML dashboard at `https://<your-vhost>/_setalink-admin/` exposing the same operations as the CLI. PHP-FPM cannot read `/etc/setalink/` directly (mode 0700/root); every privileged action goes through `admin/setalink-cli` (the only sudo-whitelisted binary for `www-data`). See [`admin/README.md`](admin/README.md) for setup, security model, and uninstall.

Setup (interactive — prompts for admin user + password):

```bash
sudo /var/www/setalink/setup-admin.sh
```

## Backup and restore

```bash
sudo ./backup.sh                  # → /var/backups/setalink/setalink-<UTC>.tar.gz
sudo ./backup.sh /tmp/snap.tar.gz # custom path
```

The archive contains the REALITY **private key** and every client UUID — treat it like SSH host keys. It's written `0600 root:root`.

To restore on a fresh Ubuntu 22.04 host:

```bash
sudo ./install.sh                                    # gets dependencies + xray
sudo tar -xzf setalink-YYYYMMDD-HHMMSSZ.tar.gz -C /  # restore /etc/setalink + xray config
sudo systemctl restart xray
```

## Client setup

Any VLESS+REALITY+Vision client works. Tested against:

- **v2rayN** (Windows)
- **v2rayNG** (Android)
- **Shadowrocket** (iOS)
- **NekoBox / NekoRay** (Linux/Windows/Mac/Android)

Two ways to onboard a user:

1. Send them `link.txt` (or scan `qr.png`).
2. Run `add-user.sh` over SSH and have them scan the ANSI QR right out of the terminal.

## Security notes

- **No public registration.** Adding users requires root on the VPS. The vless URL itself is the credential.
- **REALITY private key** never leaves `/etc/setalink/setalink.env` (mode 0600, root-only).
- **Routing rules** block proxying to RFC1918 / loopback / link-local. A user can't tunnel into your local nginx, mysql, or mongo through Xray.
- **fail2ban** protects SSH (`maxretry=5`, `bantime=1h`). Xray's UUID auth is match-or-drop with no useful authlog, so fail2ban for Xray itself isn't wired in by default. If you want it later, point a custom jail at `/var/log/xray/error.log` for `invalid request from` lines.
- **ufw** defaults to deny-incoming; explicit allow rules for `22/tcp` (or your custom SSH port), `80/tcp`, `443/tcp`, and the Xray port.
- **Logs** at `/var/log/xray/{access,error}.log` are not rotated by default — drop in `/etc/logrotate.d/xray` if you keep verbose logging on long-term.

## Troubleshooting

```bash
sudo systemctl status xray
sudo journalctl -u xray -n 100 --no-pager
sudo /usr/local/bin/xray test -config /usr/local/etc/xray/config.json
sudo ss -tlnp 'sport = :8443'
sudo ufw status verbose
sudo fail2ban-client status sshd
```

Common fixes:

- **Port already in use** — pick another (`SETALINK_PORT=…`) or stop the conflicting service.
- **REALITY handshake failing on client** — `SETALINK_SNI` must be a real site reachable from the VPS, supporting **TLS 1.3 + X25519**. `www.cloudflare.com`, `www.microsoft.com`, `gateway.icloud.com` are reliable.
- **Locked out of SSH after install** — your sshd is on a non-22 port and the installer's autodetect missed it. Edit `/etc/ssh/sshd_config`'s `Port` line so the first `Port` directive is uncommented, or `ufw allow <port>/tcp` from the console.

## Rollback

Each phase takes a timestamped backup before changing anything; the most recent ones live under `/var/backups/setalink/<UTC>-pre-<phase>/`:

```
/var/backups/setalink/
├── 2026-05-09T022636Z-pre-stream/    # before nginx stream multiplexing
├── 2026-05-09T031328Z-pre-admin/     # before the admin dashboard
└── 2026-05-09T034123Z-pre-phase3/    # before packages + traffic tracking
```

Each contains `etc-nginx.tar.gz`, `etc-setalink.tar.gz`, `xray-config.json`, and (for the admin and Phase 3 ones) a copy of the sudoers entry. Generic rollback recipe:

```bash
BD=/var/backups/setalink/<chosen-timestamp>
sudo tar -xzf "$BD/etc-nginx.tar.gz" -C /
sudo tar -xzf "$BD/etc-setalink.tar.gz" -C /
sudo cp -a "$BD/xray-config.json" /usr/local/etc/xray/config.json
sudo nginx -t && sudo systemctl reload nginx
sudo systemctl restart xray
```

For a Phase-3-only rollback (keep the dashboard, lose only the quota system):

```bash
# Stop the cron
sudo rm /etc/cron.d/setalink-quotas
# Strip Phase 3 fields from users.json (keeps the users; loses quotas + counters)
sudo jq '.users |= map(del(.package_name,.quota_bytes,.used_bytes,.last_seen_at))' \
    /etc/setalink/users.json | sudo tee /etc/setalink/users.json.new >/dev/null
sudo install -m 0600 -o root -g root /etc/setalink/users.json.new /etc/setalink/users.json
sudo rm /etc/setalink/users.json.new
# Revert lib.sh + scripts via git
cd /var/www/setalink && sudo git checkout HEAD -- lib.sh add-user.sh admin/setalink-cli admin/index.php admin/style.css
sudo /var/www/setalink/lib.sh  # source-test
# Regen + restart so the api inbound disappears
sudo /var/www/setalink/admin/setalink-cli list >/dev/null   # or any add/remove
```

## Roadmap

- Per-package expiry dates (`expires_at` field) — schema is already reserved, enforcement TBD.
- Logrotate config for `/var/log/setalink-quotas.log` and `/var/log/xray/*`.
- Auto-renewing Xray version pin and unattended-upgrades hooks.
