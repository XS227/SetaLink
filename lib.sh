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
# Packages — canonical list and quota mapping. quota_bytes=0 means unlimited
# (no auto-disable). Add a new package by adding a line below.
# ---------------------------------------------------------------------------
PACKAGE_NAMES=("7days" "30days" "unlimited" "5GB" "10GB" "15GB")

# Map a package name to its data quota in bytes (0 = unlimited/no cap).
package_to_bytes() {
    case "$1" in
        5GB)                       echo $(( 5  * 1024 * 1024 * 1024 ));;
        10GB)                      echo $(( 10 * 1024 * 1024 * 1024 ));;
        15GB)                      echo $(( 15 * 1024 * 1024 * 1024 ));;
        7days|30days|unlimited|*)  echo 0 ;;
    esac
}

# Map a package name to its validity in days (0 = never expires).
package_to_expiry_days() {
    case "$1" in
        7days)  echo 7 ;;
        30days) echo 30 ;;
        *)      echo 0 ;;
    esac
}

# Validate a package name against the canonical list; die() on mismatch.
validate_package_name() {
    local p="$1"
    local valid
    for valid in "${PACKAGE_NAMES[@]}"; do
        [ "$p" = "$valid" ] && return 0
    done
    die "invalid package '$p' (allowed: ${PACKAGE_NAMES[*]})"
}

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
# $SETALINK_ENV. In multi-transport mode (when SETALINK_REALITY_PRIVATE_KEY
# and SETALINK_EDGE_HOST are set) generates WS:10000 + XHTTP:10001 +
# HTTPUpgrade:10002 + Reality:8443. Falls back to legacy REALITY-only on
# $SETALINK_PORT when those vars are absent. Writes atomically and validates.
regenerate_xray_config() {
    [ -r "$SETALINK_ENV" ]      || die "missing env file: $SETALINK_ENV"
    [ -r "$SETALINK_USERS_DB" ] || die "missing users db: $SETALINK_USERS_DB"

    # shellcheck disable=SC1090
    . "$SETALINK_ENV"

    : "${SETALINK_HOST:?SETALINK_HOST not set in env}"
    : "${SETALINK_PORT:?SETALINK_PORT not set in env}"

    local tmp stats_port
    tmp="$(mktemp /tmp/xray-config.XXXXXX.json)"
    stats_port="${SETALINK_STATS_PORT:-8344}"

    if [ -n "${SETALINK_REALITY_PRIVATE_KEY:-}" ] && [ -n "${SETALINK_EDGE_HOST:-}" ]; then
        # ── Multi-transport mode (production) ────────────────────────────────
        local r_pk="${SETALINK_REALITY_PRIVATE_KEY}"
        local r_sni="${SETALINK_REALITY_SNI:-www.microsoft.com}"
        local r_port="${SETALINK_REALITY_PORT:-8443}"
        local r_sid="${SETALINK_REALITY_SHORT_ID_SERVER:-}"
        local ws_path="${SETALINK_WS_PATH:-/ws}"
        local xhttp_path="${SETALINK_XHTTP_PATH:-/xhttp}"
        local httpup_path="${SETALINK_HTTPUP_PATH:-/httpup}"
        local edge_host="${SETALINK_EDGE_HOST}"

        jq -n \
            --arg r_pk       "$r_pk" \
            --arg r_sni      "$r_sni" \
            --argjson r_port "$r_port" \
            --arg r_sid      "$r_sid" \
            --arg ws_path    "$ws_path" \
            --arg xhttp_path "$xhttp_path" \
            --arg httpup_path "$httpup_path" \
            --arg edge_host  "$edge_host" \
            --argjson stats_port "$stats_port" \
            --slurpfile db   "$SETALINK_USERS_DB" \
            '
            ($db[0].users | map(select((.disabled // false) != true))
              | map({ id: .uuid, email: .name })) as $plain_clients |
            ($db[0].users | map(select((.disabled // false) != true))
              | map({ id: .uuid, flow: "xtls-rprx-vision", email: .name })) as $reality_clients |
            (["", $r_sid,
              ($db[0].users | map(.shortId))] | flatten | unique) as $short_ids |
            {
              log: { loglevel: "warning",
                     access: "/var/log/xray/access.log",
                     error:  "/var/log/xray/error.log" },
              stats: {}, api: { tag: "api", services: ["StatsService"] },
              policy: {
                levels: { "0": { statsUserUplink: true, statsUserDownlink: true } },
                system: { statsInboundUplink: true, statsInboundDownlink: true,
                          statsOutboundUplink: true, statsOutboundDownlink: true }
              },
              inbounds: [
                { tag: "inbound-ws",
                  listen: "127.0.0.1", port: 10000, protocol: "vless",
                  settings: { clients: $plain_clients, decryption: "none" },
                  streamSettings: { network: "ws", security: "none",
                    wsSettings: { path: $ws_path } },
                  sniffing: { enabled: true, destOverride: ["http","tls","quic"] }
                },
                { tag: "inbound-xhttp",
                  listen: "127.0.0.1", port: 10001, protocol: "vless",
                  settings: { clients: $plain_clients, decryption: "none" },
                  streamSettings: { network: "xhttp", security: "none",
                    xhttpSettings: { path: $xhttp_path, host: $edge_host, mode: "auto" } },
                  sniffing: { enabled: true, destOverride: ["http","tls","quic"] }
                },
                { tag: "inbound-httpup",
                  listen: "127.0.0.1", port: 10002, protocol: "vless",
                  settings: { clients: $plain_clients, decryption: "none" },
                  streamSettings: { network: "httpupgrade", security: "none",
                    httpupgradeSettings: { path: $httpup_path, host: $edge_host } },
                  sniffing: { enabled: true, destOverride: ["http","tls","quic"] }
                },
                { tag: "inbound-reality",
                  listen: "0.0.0.0", port: $r_port, protocol: "vless",
                  settings: { clients: $reality_clients, decryption: "none" },
                  streamSettings: { network: "tcp", security: "reality",
                    realitySettings: { show: false, dest: ($r_sni+":443"), xver: 0,
                      serverNames: [$r_sni], privateKey: $r_pk, shortIds: $short_ids } },
                  sniffing: { enabled: true, destOverride: ["http","tls"] }
                }
              ] | (if $stats_port > 0 then . + [{
                listen: "127.0.0.1", port: $stats_port,
                protocol: "dokodemo-door",
                settings: { address: "127.0.0.1" }, tag: "api"
              }] else . end),
              outbounds: [
                { protocol: "freedom", tag: "direct" },
                { protocol: "blackhole", tag: "block" }
              ],
              routing: { domainStrategy: "AsIs",
                rules: ([{
                  type: "field",
                  ip: ["10.0.0.0/8","172.16.0.0/12","192.168.0.0/16",
                       "127.0.0.0/8","169.254.0.0/16","::1/128","fc00::/7","fe80::/10"],
                  outboundTag: "block"
                }] | (if $stats_port > 0
                  then [{ type: "field", inboundTag: ["api"], outboundTag: "api" }] + .
                  else . end))
              }
            }
            ' > "$tmp"
    else
        # ── Legacy REALITY-only mode ──────────────────────────────────────────
        : "${SETALINK_SNI:?SETALINK_SNI not set in env}"
        : "${SETALINK_PRIVATE_KEY:?SETALINK_PRIVATE_KEY not set in env}"
        jq -n \
            --arg port "$SETALINK_PORT" \
            --arg sni  "$SETALINK_SNI" \
            --arg pk   "$SETALINK_PRIVATE_KEY" \
            --arg accept_proxy "${SETALINK_ACCEPT_PROXY_PROTOCOL:-0}" \
            --argjson stats_port "$stats_port" \
            --slurpfile db "$SETALINK_USERS_DB" \
            '
            {
              log: { loglevel: "warning",
                     access: "/var/log/xray/access.log",
                     error:  "/var/log/xray/error.log" },
              stats: {}, api: { tag: "api", services: ["StatsService"] },
              policy: {
                levels: { "0": { statsUserUplink: true, statsUserDownlink: true } },
                system: { statsInboundUplink: true, statsInboundDownlink: true,
                          statsOutboundUplink: true, statsOutboundDownlink: true }
              },
              inbounds: [{
                listen: "0.0.0.0", port: ($port|tonumber), protocol: "vless",
                settings: {
                  clients: ($db[0].users
                    | map(select((.disabled // false) != true))
                    | map({ id: .uuid, flow: "xtls-rprx-vision", email: .name })),
                  decryption: "none"
                },
                streamSettings: ({
                  network: "tcp", security: "reality",
                  realitySettings: {
                    show: false, dest: ($sni+":443"), xver: 0,
                    serverNames: [$sni], privateKey: $pk,
                    shortIds: (["", ($db[0].users | map(.shortId))] | flatten | unique)
                  }
                } + (if $accept_proxy == "1"
                     then { tcpSettings: { acceptProxyProtocol: true } }
                     else {} end)),
                sniffing: { enabled: true, destOverride: ["http","tls","quic"] }
              }] | (if $stats_port > 0 then . + [{
                listen: "127.0.0.1", port: $stats_port,
                protocol: "dokodemo-door",
                settings: { address: "127.0.0.1" }, tag: "api"
              }] else . end),
              outbounds: [
                { protocol: "freedom", tag: "direct" },
                { protocol: "blackhole", tag: "block" }
              ],
              routing: { domainStrategy: "AsIs",
                rules: ([{
                  type: "field",
                  ip: ["10.0.0.0/8","172.16.0.0/12","192.168.0.0/16",
                       "127.0.0.0/8","169.254.0.0/16","::1/128","fc00::/7","fe80::/10"],
                  outboundTag: "block"
                }] | (if $stats_port > 0
                  then [{ type: "field", inboundTag: ["api"], outboundTag: "api" }] + .
                  else . end))
              }
            }
            ' > "$tmp"
    fi

    local out rc
    out="$("$XRAY_BIN" run -test -config "$tmp" 2>&1)"; rc=$?
    if [ "$rc" -ne 0 ] && printf '%s' "$out" | grep -qiE 'unknown (command|flag)|flag provided but not defined|unrecognized'; then
        out="$("$XRAY_BIN" test -config "$tmp" 2>&1)"; rc=$?
    fi
    if [ "$rc" -ne 0 ]; then
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

    # Reality-specific params — always use the Reality port/SNI/key for the primary link.
    local port="${SETALINK_REALITY_PORT:-8443}"
    local sni="${SETALINK_REALITY_SNI:-www.microsoft.com}"
    local pbk="${SETALINK_REALITY_PUBLIC_KEY:-$SETALINK_PUBLIC_KEY}"

    local frag
    frag="$(printf '%s' "$name" | jq -sRr @uri)"
    printf 'vless://%s@%s:%s?security=reality&type=tcp&flow=xtls-rprx-vision&sni=%s&fp=chrome&pbk=%s&sid=%s&spx=%%2F#%s\n' \
        "$uuid" "$SETALINK_HOST" "$port" "$sni" "$pbk" "$sid" "$frag"
}

# ---------------------------------------------------------------------------
# Multi-transport VLESS URL builders
# All read from $SETALINK_ENV. Name used as the link remark/fragment.
# ---------------------------------------------------------------------------

# EDGE-WS: WebSocket over nginx TLS (baseline)
build_vless_url_ws() {
    local uuid="$1" name="$2"
    . "$SETALINK_ENV"
    local host="${SETALINK_EDGE_HOST:-$SETALINK_HOST}"
    local port="${SETALINK_NGINX_PORT:-443}"
    local path="${SETALINK_WS_PATH:-/ws}"
    local enc_path frag
    enc_path="$(printf '%s' "$path" | jq -sRr @uri)"
    frag="$(printf '%s' "${name}-WS" | jq -sRr @uri)"
    printf 'vless://%s@%s:%s?security=tls&type=ws&path=%s&host=%s&sni=%s#%s\n' \
        "$uuid" "$host" "$port" "$enc_path" "$host" "$host" "$frag"
}

# EDGE-CHROME: WebSocket with Chrome fingerprint + forced h1.1 ALPN
build_vless_url_chrome() {
    local uuid="$1" name="$2"
    . "$SETALINK_ENV"
    local host="${SETALINK_EDGE_HOST:-$SETALINK_HOST}"
    local port="${SETALINK_NGINX_PORT:-443}"
    local path="${SETALINK_WS_PATH:-/ws}"
    local enc_path frag
    enc_path="$(printf '%s' "$path" | jq -sRr @uri)"
    frag="$(printf '%s' "${name}-CHROME" | jq -sRr @uri)"
    printf 'vless://%s@%s:%s?security=tls&type=ws&path=%s&host=%s&sni=%s&fp=chrome&alpn=http%%2F1.1#%s\n' \
        "$uuid" "$host" "$port" "$enc_path" "$host" "$host" "$frag"
}

# EDGE-XHTTP: XHTTP/SplitHTTP over nginx TLS
build_vless_url_xhttp() {
    local uuid="$1" name="$2"
    . "$SETALINK_ENV"
    local host="${SETALINK_EDGE_HOST:-$SETALINK_HOST}"
    local port="${SETALINK_NGINX_PORT:-443}"
    local path="${SETALINK_XHTTP_PATH:-/xhttp}"
    local enc_path frag
    enc_path="$(printf '%s' "$path" | jq -sRr @uri)"
    frag="$(printf '%s' "${name}-XHTTP" | jq -sRr @uri)"
    printf 'vless://%s@%s:%s?security=tls&type=xhttp&path=%s&host=%s&sni=%s&fp=chrome#%s\n' \
        "$uuid" "$host" "$port" "$enc_path" "$host" "$host" "$frag"
}

# EDGE-HTTPUP: HTTPUpgrade over nginx TLS
build_vless_url_httpup() {
    local uuid="$1" name="$2"
    . "$SETALINK_ENV"
    local host="${SETALINK_EDGE_HOST:-$SETALINK_HOST}"
    local port="${SETALINK_NGINX_PORT:-443}"
    local path="${SETALINK_HTTPUP_PATH:-/httpup}"
    local enc_path frag
    enc_path="$(printf '%s' "$path" | jq -sRr @uri)"
    frag="$(printf '%s' "${name}-HTTPUP" | jq -sRr @uri)"
    printf 'vless://%s@%s:%s?security=tls&type=httpupgrade&path=%s&host=%s&sni=%s&alpn=http%%2F1.1#%s\n' \
        "$uuid" "$host" "$port" "$enc_path" "$host" "$host" "$frag"
}

# EDGE-REALITY: Direct Reality, per-user shortId
build_vless_url_reality() {
    local uuid="$1" sid="$2" name="$3"
    . "$SETALINK_ENV"
    local host="${SETALINK_EDGE_HOST:-$SETALINK_HOST}"
    local port="${SETALINK_REALITY_PORT:-8443}"
    local sni="${SETALINK_REALITY_SNI:-www.microsoft.com}"
    local pbk="${SETALINK_REALITY_PUBLIC_KEY:-$SETALINK_PUBLIC_KEY}"
    local frag
    frag="$(printf '%s' "${name}-REALITY" | jq -sRr @uri)"
    printf 'vless://%s@%s:%s?security=reality&type=tcp&flow=xtls-rprx-vision&sni=%s&fp=chrome&pbk=%s&sid=%s&spx=%%2F#%s\n' \
        "$uuid" "$host" "$port" "$sni" "$pbk" "$sid" "$frag"
}
