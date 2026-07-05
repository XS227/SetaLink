# ReaLink VPS Helper

Gives a **server-side** exit through a ReaLink node so that tools running **on a
user's VPS** (e.g. Claude Code / the Anthropic API) reach the internet via
Finland/Germany instead of the VPS's own — often censored or sanctioned — IP.

## Why this is a separate thing from mobile Smart Mode

There are two distinct cases. The mobile app already handles the first; this
helper is the second.

**Case 1 — Normal mobile Smart Mode (handled by the app):**
per-app / per-domain routing on the phone. Iranian apps/domains go direct
(bypass), everything global/blocked goes through the ReaLink exit. The user does
no server-side work. This is `feat/smart-iran-bypass` in `mobile-app/`.

**Case 2 — Advanced VPS/SSH (this helper):**
the user SSHes into their own VPS with Termius and runs Claude *there*. That
traffic originates **on the VPS**, never on the phone — so Android per-app bypass
cannot touch it, and Anthropic blocks the VPS's Iranian IP regardless. The fix
must live on the VPS. We must not ask users to hand-roll xray, so this packages
it: one provisioned identity, one install command, a local-only proxy, and a
clean revoke.

```
Phone (Termius) ──SSH──▶ VPS (Iran)
                          │  claude  ──HTTPS_PROXY──▶ 127.0.0.1:10809 (xray client)
                          │                                   │ VLESS+Reality
                          ▼                                   ▼
                    (SSH untouched)                    ReaLink Finland node ──▶ api.anthropic.com
```

The phone VPN is **not involved** in Case 2 and should be off. Termius connects
direct (Iran→Iran, stable); only Claude's traffic is proxied out via Finland.

## Components

| File | Runs where | Purpose |
|------|-----------|---------|
| `realink-vps-helper.sh` | on the user's VPS | installs xray-core, writes a **loopback-only** SOCKS(10808)+HTTP(10809) client → ReaLink node, systemd service, prints `HTTPS_PROXY`/`HTTP_PROXY` exports, verifies the exit IP. `--uninstall` / `--status` / `--verify`. |
| `provision.sh` | operator / backend | provisions a dedicated node UUID (namespaced `vpsh-<label>`), emits the base64 profile + one-line install command + `--json`. `--revoke` removes the node identity. |
| `nodes.env` | operator / backend | public Reality params per exit node (no private keys). |

Hosted installer (for the one-liner): `https://setalink.no/download/vps-helper`
(served extensionless — the webroot denies `.sh`; the installer carries **no**
secrets, the secret is the runtime `REALINK_PROFILE`).

## Safety model (deliberate non-goals)

- Proxy binds **only** to `127.0.0.1`. Never publicly exposed.
- **Application** proxy (opt-in via env). No TUN, no iptables/nft redirect, no
  global proxy → the inbound **SSH/Termius session and all other VPS traffic are
  untouched**. Only processes you point at it use the node.
- Profile is a **bearer secret** (contains the node UUID). Per-VPS, revocable.
- Fully reversible: VPS side `--uninstall`; node side `provision.sh --revoke`.
- The node egress IP is verified after install (`api.ipify.org` through the
  proxy must equal the node IP), plus an `api.anthropic.com` reachability probe.

## Operator quick start

```sh
# provision one VPS (Finland is the Iran-working node; Germany is failover)
./provision.sh --node finland --label <user-or-device-id>
# → prints the one-line install command to paste into the VPS via Termius

# revoke later
./provision.sh --node finland --revoke --label <user-or-device-id>
# and on the VPS:  bash realink-vps-helper.sh --uninstall
```

## Reusability seam — exposing this in admin / app later (no manual work)

`provision.sh --json` already emits a machine-readable record:

```json
{ "label": "...", "email": "vpsh-...", "node": "finland", "uuid": "...",
  "exit_ip": "65.109.183.7", "profile_b64": "...", "install_oneliner": "curl ... | bash" }
```

That is the contract a wrapper consumes. Two ways to expose it without users
touching xray:

1. **Admin panel button** (`admin/`, PHP): "Generate VPS Helper" → server shells
   `provision.sh --node <n> --label <deviceId> --json`, shows the one-liner +
   copy button + a Revoke button (calls `--revoke`). The backend host needs SSH
   access to the node key. This mirrors `admin/builds.php` (standalone page, no
   SPA coupling).
2. **In-app** ("Advanced → VPS Helper"): app calls an authenticated backend
   endpoint `action=vps-helper-provision` (device-bound) which runs the same
   `--json` path and returns the one-liner for the user to paste into their SSH
   client. Revoke = `action=vps-helper-revoke`.

Backend endpoint contract (to implement on setalink.no when wanted):

```
POST api.php?action=vps-helper-provision   { device_id, node? }  -> { install_oneliner, exit_ip, email }
POST api.php?action=vps-helper-revoke      { device_id, node? }  -> { revoked }
```

Node identity is namespaced `vpsh-<label>` so VPS Helper sessions are
attributable in the node access log and never collide with phone client tags
(`sl-*`, `fi-tester`).

## Status

- Engine (installer + provision + revoke): **built and end-to-end verified**
  2026-07-05 — provisioned `vpsh-f877790f` on Finland, ran the exact client
  config, exit IP = `65.109.183.7`, `api.anthropic.com` reachable (HTTP 401 =
  through the tunnel). First real user is the Android tester's VPS.
- Admin/app exposure: **designed, not built** (contract above). Intentionally
  deferred — the CLI engine is the reusable core; wrappers are thin.
