# SetaLink

A small, CLI-only private VPN access system built on **Xray-core** with **VLESS + REALITY**.
No public registration, no admin web UI — just shell scripts a single operator runs over SSH.

- Target OS: **Ubuntu 22.04**
- Cap: **50 users**
- Coexists with an existing nginx on ports 80/443 (Xray uses a different port)
- systemd-managed, ufw firewall, fail2ban for SSH

## Files

| File              | Purpose                                                       |
| ----------------- | ------------------------------------------------------------- |
| `install.sh`      | One-shot installer. Idempotent — safe to re-run.              |
| `add-user.sh`     | Add a user, regenerate config, print VLESS link + QR.         |
| `remove-user.sh`  | Remove a user and their files, regenerate config.             |
| `list-users.sh`   | List users (table), or show one user's detail.                |
| `backup.sh`       | Snapshot `/etc/setalink` + Xray config to a tar.gz.           |
| `lib.sh`          | Shared paths, logging, config-regeneration logic.             |

## Storage layout

Sensitive runtime data is **NOT** under `/var/www/`. It lives where nginx can never accidentally serve it:

```
/etc/setalink/
├── setalink.env          # 0600  HOST, PORT, SNI, REALITY priv/pub keys
├── users.json            # 0600  user roster (name, uuid, shortId, created)
└── users/
    └── <name>/
        ├── link.txt      # 0600  vless:// URL
        └── qr.png        # 0600  scannable QR

/usr/local/etc/xray/config.json    # rendered from users.json + setalink.env
/var/log/xray/{access,error}.log   # Xray logs
/var/backups/setalink/             # backup.sh output
```

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

### Why port 8443 and not 443?

REALITY ideally listens on 443 (it impersonates real HTTPS), but **this VPS already runs nginx on 443**. Sharing 443 across nginx and Xray would require an SNI-based stream router and is fragile. SetaLink picks a separate port (default 8443) so existing sites keep working unchanged.

If you later want 443 for Xray, the cleanest path is moving nginx to a non-default port for HTTPS termination behind a stream-mode SNI router — out of scope for this repo.

## Add / remove / list users

```bash
sudo ./add-user.sh alice          # generate UUID + shortId, print link + QR
sudo ./list-users.sh              # table of all users
sudo ./list-users.sh alice        # detail view (link + paths)
sudo ./list-users.sh --json       # raw users.json
sudo ./remove-user.sh alice       # delete + regen config
```

User names: `[a-z0-9][a-z0-9._-]{0,31}` — keep them short and ASCII (they go into the VLESS URL fragment as the client display label).

Each `add-user.sh` writes:

- `/etc/setalink/users/<name>/link.txt` — the `vless://…` URL
- `/etc/setalink/users/<name>/qr.png` — PNG QR code (8 px modules, 2 px margin)
- and prints both to stdout, plus an in-terminal ANSI QR

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

## Roadmap

This is the CLI-first slice. Future, optional layers (intentionally out of scope here):

- Web admin (single-tenant, behind SSO) for adding/removing users without SSH.
- Per-user traffic accounting via Xray stats API.
- Auto-renewing Xray version pin and unattended-upgrades hooks.
