#!/usr/bin/env bash
# SetaLink shared library — sourced by install.sh, add-user.sh, remove-user.sh,
# list-users.sh, backup.sh. Contains constants, logging helpers, and the
# config-regeneration logic shared between add/remove.
# shellcheck disable=SC2034  # constants are consumed by sourcing scripts

# ---------------------------------------------------------------------------
# Paths and constants
# ---------------------------------------------------------------------------
SETALINK_DIR="/etc/setalink"
SETALINK_USERS_DIR="${SETALINK_DIR}/users"
SETALINK_USERS_DB="${SETALINK_DIR}/users.json"
SETALINK_ENV="${SETALINK_DIR}/setalink.env"
SETALINK_BACKUPS_DIR="/var/backups/setalink"

XRAY_CONFIG="/usr/local/etc/xray/config.json"
XRAY_BIN="/usr/local/bin/xray"
XRAY_LOG_DIR="/var/log/xray"

MAX_USERS=50

# ---------------------------------------------------------------------------
# Logging
# ---------------------------------------------------------------------------
if [ -t 1 ]; then
    C_RED='\033[0;31m'; C_YEL='\033[0;33m'; C_GRN='\033[0;32m'; C_CYN='\033[0;36m'; C_RST='\033[0m'
else
    C_RED=''; C_YEL=''; C_GRN=''; C_CYN=''; C_RST=''
fi

log()  { printf "${C_CYN}[setalink]${C_RST} %s\n" "$*"; }
ok()   { printf "${C_GRN}[ ok ]${C_RST} %s\n" "$*"; }
warn() { printf "${C_YEL}[warn]${C_RST} %s\n" "$*" >&2; }
err()  { printf "${C_RED}[err ]${C_RST} %s\n" "$*" >&2; }
die()  { err "$*"; exit 1; }

# ---------------------------------------------------------------------------
# Guards
# ---------------------------------------------------------------------------
require_root() {
    [ "$(id -u)" = "0" ] || die "must run as root (try: sudo $0 $*)"
}

require_cmd() {
    command -v "$1" >/dev/null 2>&1 || die "required command not found: $1"
}

# Username: lowercase letters, digits, dot, dash, underscore. 1–32 chars.
validate_username() {
    local name="$1"
    [[ "$name" =~ ^[a-z0-9][a-z0-9._-]{0,31}$ ]] || \
        die "invalid username '$name' (allowed: a-z 0-9 . _ -, max 32 chars, must start with alnum)"
}

# ---------------------------------------------------------------------------
# Config regeneration
# ---------------------------------------------------------------------------
# Rebuild /usr/local/etc/xray/config.json from $SETALINK_USERS_DB and
# $SETALINK_ENV. Writes atomically (temp file + mv) and validates with
# `xray test` before swapping in. Caller is responsible for restarting xray.
regenerate_xray_config() {
    [ -r "$SETALINK_ENV" ]      || die "missing env file: $SETALINK_ENV"
    [ -r "$SETALINK_USERS_DB" ] || die "missing users db: $SETALINK_USERS_DB"

    # shellcheck disable=SC1090
    . "$SETALINK_ENV"

    : "${SETALINK_HOST:?SETALINK_HOST not set in env}"
    : "${SETALINK_PORT:?SETALINK_PORT not set in env}"
    : "${SETALINK_SNI:?SETALINK_SNI not set in env}"
    : "${SETALINK_PRIVATE_KEY:?SETALINK_PRIVATE_KEY not set in env}"

    local tmp
    tmp="$(mktemp /tmp/xray-config.XXXXXX.json)"
    # Always include "" (empty) shortId so a config without users still parses;
    # client shortIds from users.json are unioned in.
    jq -n \
        --arg port "$SETALINK_PORT" \
        --arg sni  "$SETALINK_SNI" \
        --arg pk   "$SETALINK_PRIVATE_KEY" \
        --slurpfile db "$SETALINK_USERS_DB" \
        '
        {
          log: {
            loglevel: "warning",
            access:   "/var/log/xray/access.log",
            error:    "/var/log/xray/error.log"
          },
          inbounds: [{
            listen:   "0.0.0.0",
            port:     ($port | tonumber),
            protocol: "vless",
            settings: {
              clients: ($db[0].users | map({
                id:    .uuid,
                flow:  "xtls-rprx-vision",
                email: .name
              })),
              decryption: "none"
            },
            streamSettings: {
              network:  "tcp",
              security: "reality",
              realitySettings: {
                show:        false,
                dest:        ($sni + ":443"),
                xver:        0,
                serverNames: [$sni],
                privateKey:  $pk,
                shortIds:    (["", ($db[0].users | map(.shortId))] | flatten | unique)
              }
            },
            sniffing: { enabled: true, destOverride: ["http","tls","quic"] }
          }],
          outbounds: [
            { protocol: "freedom",   tag: "direct" },
            { protocol: "blackhole", tag: "block"  }
          ],
          routing: {
            domainStrategy: "AsIs",
            rules: [
              {
                type: "field",
                ip: [
                  "10.0.0.0/8","172.16.0.0/12","192.168.0.0/16",
                  "127.0.0.0/8","169.254.0.0/16",
                  "::1/128","fc00::/7","fe80::/10"
                ],
                outboundTag: "block"
              }
            ]
          }
        }
        ' > "$tmp"

    # Validate before swap. xray test exits non-zero on bad config.
    if ! "$XRAY_BIN" test -config "$tmp" >/dev/null 2>&1; then
        local out; out="$("$XRAY_BIN" test -config "$tmp" 2>&1 || true)"
        rm -f "$tmp"
        err "generated xray config failed validation:"
        printf "%s\n" "$out" >&2
        return 1
    fi

    install -m 0644 -o root -g root "$tmp" "$XRAY_CONFIG"
    rm -f "$tmp"
}

# Reload-or-restart Xray. Restart is fine — connections are stateless and
# REALITY clients reconnect transparently. Quiet on success.
restart_xray() {
    systemctl restart xray
    sleep 1
    systemctl is-active --quiet xray || die "xray failed to start; check: journalctl -u xray -n 50"
}

# ---------------------------------------------------------------------------
# VLESS URL builder
# ---------------------------------------------------------------------------
# Args: <uuid> <shortId> <name>
# Reads HOST/PORT/SNI/PUBLIC_KEY from $SETALINK_ENV.
build_vless_url() {
    local uuid="$1" sid="$2" name="$3"
    # shellcheck disable=SC1090
    . "$SETALINK_ENV"

    local frag
    frag="$(printf '%s' "$name" | jq -sRr @uri)"
    printf 'vless://%s@%s:%s?encryption=none&security=reality&sni=%s&fp=chrome&pbk=%s&sid=%s&type=tcp&flow=xtls-rprx-vision#%s\n' \
        "$uuid" "$SETALINK_HOST" "$SETALINK_PORT" "$SETALINK_SNI" "$SETALINK_PUBLIC_KEY" "$sid" "$frag"
}
