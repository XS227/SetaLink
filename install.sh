#!/usr/bin/env bash
# SetaLink installer — Xray-core / VLESS+REALITY on Ubuntu 22.04.
# Idempotent. Designed to coexist with an existing nginx on ports 80/443.
#
# Env overrides (skip prompts):
#   SETALINK_HOST=vps.example.com   # public hostname or IP clients connect to
#   SETALINK_PORT=8443              # Xray listen port (default 8443)
#   SETALINK_SNI=www.cloudflare.com # REALITY masquerade target (TLS 1.3 + X25519)
#   SETALINK_NONINTERACTIVE=1       # accept all defaults, no prompts

set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
. "$SCRIPT_DIR/lib.sh"

require_root "$@"

# ---------------------------------------------------------------------------
# 0. Sanity checks
# ---------------------------------------------------------------------------
log "checking environment"

if [ ! -r /etc/os-release ]; then die "/etc/os-release missing — unsupported OS"; fi
. /etc/os-release
if [ "${ID:-}" != "ubuntu" ] || [ "${VERSION_ID:-}" != "22.04" ]; then
    warn "this installer targets Ubuntu 22.04; detected ${ID:-?} ${VERSION_ID:-?}"
    if [ "${SETALINK_NONINTERACTIVE:-0}" != "1" ]; then
        read -r -p "continue anyway? [y/N] " ans
        [[ "$ans" =~ ^[yY]$ ]] || die "aborted"
    fi
fi

# ---------------------------------------------------------------------------
# 1. Install dependencies
# ---------------------------------------------------------------------------
log "installing apt dependencies"
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq --no-install-recommends \
    curl ca-certificates jq qrencode ufw fail2ban openssl >/dev/null

# ---------------------------------------------------------------------------
# 2. Install Xray (official installer; idempotent)
# ---------------------------------------------------------------------------
if [ -x "$XRAY_BIN" ] && systemctl list-unit-files | grep -q '^xray\.service'; then
    log "xray already installed at $XRAY_BIN ($("$XRAY_BIN" version | head -n1))"
else
    log "installing xray-core via official script"
    bash -c "$(curl -fsSL https://github.com/XTLS/Xray-install/raw/main/install-release.sh)" \
        @ install -u root >/dev/null
fi
require_cmd "$XRAY_BIN"
mkdir -p "$XRAY_LOG_DIR"
chown root:root "$XRAY_LOG_DIR"
chmod 0755 "$XRAY_LOG_DIR"

# ---------------------------------------------------------------------------
# 3. Gather parameters
# ---------------------------------------------------------------------------
log "gathering parameters"

# Public host: prefer env, else try to detect, else prompt.
detect_public_ip() {
    local ip=""
    for url in https://api.ipify.org https://ifconfig.me https://ipinfo.io/ip; do
        ip="$(curl -fsS --max-time 4 "$url" 2>/dev/null || true)"
        if [[ "$ip" =~ ^[0-9a-fA-F:.]+$ ]]; then printf '%s' "$ip"; return; fi
    done
}

HOST="${SETALINK_HOST:-}"
if [ -z "$HOST" ]; then
    DETECTED="$(detect_public_ip || true)"
    if [ "${SETALINK_NONINTERACTIVE:-0}" = "1" ]; then
        HOST="${DETECTED:?could not detect public IP; set SETALINK_HOST}"
    else
        read -r -p "public hostname or IP clients will connect to [${DETECTED:-required}]: " HOST
        HOST="${HOST:-$DETECTED}"
        [ -n "$HOST" ] || die "host is required"
    fi
fi

PORT="${SETALINK_PORT:-8443}"
if [ "${SETALINK_NONINTERACTIVE:-0}" != "1" ] && [ -z "${SETALINK_PORT:-}" ]; then
    read -r -p "xray listen port [$PORT]: " ans
    PORT="${ans:-$PORT}"
fi
if ! [[ "$PORT" =~ ^[0-9]+$ ]] || [ "$PORT" -lt 1 ] || [ "$PORT" -gt 65535 ]; then
    die "invalid port: $PORT"
fi
case "$PORT" in
    22|80|443) die "port $PORT conflicts with ssh/nginx; choose another (default 8443)";;
esac
# Refuse if something else is already listening on that port (and it's not xray).
if ss -tlnH "sport = :$PORT" 2>/dev/null | grep -q .; then
    if ! ss -tlnpH "sport = :$PORT" 2>/dev/null | grep -q '"xray"'; then
        die "port $PORT is already in use by another process (see: ss -tlnp 'sport = :$PORT')"
    fi
fi

SNI="${SETALINK_SNI:-www.cloudflare.com}"
if [ "${SETALINK_NONINTERACTIVE:-0}" != "1" ] && [ -z "${SETALINK_SNI:-}" ]; then
    read -r -p "REALITY masquerade SNI (must be a TLS-1.3 + X25519 site) [$SNI]: " ans
    SNI="${ans:-$SNI}"
fi

log "host=$HOST  port=$PORT  sni=$SNI"

# ---------------------------------------------------------------------------
# 4. Create /etc/setalink and generate REALITY keys
# ---------------------------------------------------------------------------
mkdir -p "$SETALINK_DIR" "$SETALINK_USERS_DIR" "$SETALINK_BACKUPS_DIR"
chmod 0700 "$SETALINK_DIR" "$SETALINK_USERS_DIR"
chmod 0750 "$SETALINK_BACKUPS_DIR"

if [ -f "$SETALINK_ENV" ]; then
    log "preserving existing REALITY keypair from $SETALINK_ENV"
    # shellcheck disable=SC1090
    . "$SETALINK_ENV"
    PRIV="$SETALINK_PRIVATE_KEY"
    PUB="$SETALINK_PUBLIC_KEY"
else
    log "generating fresh REALITY x25519 keypair"
    KEYS="$("$XRAY_BIN" x25519)"
    PRIV="$(printf '%s\n' "$KEYS" | awk -F': *' '/Private key/{print $2; exit}')"
    PUB="$( printf '%s\n' "$KEYS" | awk -F': *' '/Public key/ {print $2; exit}')"
    if [ -z "$PRIV" ] || [ -z "$PUB" ]; then
        die "could not parse 'xray x25519' output"
    fi
fi

umask 077
cat > "$SETALINK_ENV" <<EOF
# SetaLink environment — sourced by all setalink scripts.
# Keep this file 0600 / root:root.
SETALINK_HOST="$HOST"
SETALINK_PORT="$PORT"
SETALINK_SNI="$SNI"
SETALINK_PRIVATE_KEY="$PRIV"
SETALINK_PUBLIC_KEY="$PUB"
EOF
chmod 0600 "$SETALINK_ENV"
chown root:root "$SETALINK_ENV"
umask 022

# ---------------------------------------------------------------------------
# 5. Initialize users database (preserve if exists)
# ---------------------------------------------------------------------------
if [ ! -f "$SETALINK_USERS_DB" ]; then
    log "initializing empty users database at $SETALINK_USERS_DB"
    echo '{"users":[]}' > "$SETALINK_USERS_DB"
    chmod 0600 "$SETALINK_USERS_DB"
else
    log "preserving existing users database ($(jq '.users | length' "$SETALINK_USERS_DB") users)"
fi

# ---------------------------------------------------------------------------
# 6. Generate xray config from current users.json
# ---------------------------------------------------------------------------
log "writing xray config"
regenerate_xray_config

# ---------------------------------------------------------------------------
# 7. Enable + start systemd
# ---------------------------------------------------------------------------
log "enabling + starting xray.service"
systemctl daemon-reload
systemctl enable --now xray >/dev/null
sleep 1
systemctl is-active --quiet xray || die "xray failed to start; check: journalctl -u xray -n 50"

# ---------------------------------------------------------------------------
# 8. Firewall — preserve existing nginx, allow Xray port + SSH
# ---------------------------------------------------------------------------
log "configuring ufw (preserving 22/80/443)"
# Detect SSH port from sshd_config; default to 22.
SSH_PORT="$(awk '/^[[:space:]]*Port[[:space:]]/{print $2; exit}' /etc/ssh/sshd_config 2>/dev/null || true)"
SSH_PORT="${SSH_PORT:-22}"

ufw --force default deny incoming >/dev/null
ufw --force default allow outgoing >/dev/null
ufw allow "${SSH_PORT}/tcp"   comment 'ssh'        >/dev/null
ufw allow 80/tcp              comment 'nginx http' >/dev/null
ufw allow 443/tcp             comment 'nginx https'>/dev/null
ufw allow "${PORT}/tcp"       comment 'setalink xray reality' >/dev/null

if ! ufw status | grep -q "Status: active"; then
    # Avoid lockout: only enable non-interactively if SSH rule is in place.
    yes | ufw enable >/dev/null || warn "ufw enable failed; review manually"
fi
ufw reload >/dev/null || true

# ---------------------------------------------------------------------------
# 9. fail2ban — sshd jail (Xray's UUID auth doesn't expose a useful authlog)
# ---------------------------------------------------------------------------
log "configuring fail2ban (sshd jail)"
mkdir -p /etc/fail2ban/jail.d
cat > /etc/fail2ban/jail.d/setalink-sshd.conf <<EOF
# Managed by SetaLink installer. Edit if you have stricter requirements.
[sshd]
enabled  = true
port     = ${SSH_PORT}
backend  = systemd
maxretry = 5
findtime = 10m
bantime  = 1h
EOF
systemctl enable --now fail2ban >/dev/null
systemctl restart fail2ban || warn "fail2ban restart failed"

# ---------------------------------------------------------------------------
# 10. Done
# ---------------------------------------------------------------------------
ok "installation complete"
cat <<EOF

  host          : $HOST
  port          : $PORT (TCP)
  sni           : $SNI
  public key    : $PUB
  config        : $XRAY_CONFIG
  users db      : $SETALINK_USERS_DB
  per-user dir  : $SETALINK_USERS_DIR/<name>/
  systemd unit  : xray.service (enabled)
  firewall      : ufw (allows ${SSH_PORT}, 80, 443, $PORT)
  fail2ban      : sshd jail enabled

next steps:
  $SCRIPT_DIR/add-user.sh alice         # add a user, print VLESS link + QR
  $SCRIPT_DIR/list-users.sh             # list all users
  $SCRIPT_DIR/backup.sh                 # snapshot keys + users to $SETALINK_BACKUPS_DIR

EOF
