#!/usr/bin/env bash
# Add a SetaLink user. Generates UUID + per-user shortId, regenerates Xray
# config, restarts xray, and writes <user>/link.txt + <user>/qr.png.
#
# Usage: ./add-user.sh <username> [--package=NAME]
#   --package=NAME   one of: 5GB, 10GB, 15GB, unlimited (default: unlimited)

set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
. "$SCRIPT_DIR/lib.sh"

require_root "$@"

NAME=""
PACKAGE="unlimited"
for arg in "$@"; do
    case "$arg" in
        --package=*)  PACKAGE="${arg#--package=}" ;;
        --*)          die "unknown flag: $arg" ;;
        *)            [ -z "$NAME" ] || die "usage: $0 <username> [--package=NAME]"
                      NAME="$arg" ;;
    esac
done
[ -n "$NAME" ] || die "usage: $0 <username> [--package=NAME]"

validate_username "$NAME"
validate_package_name "$PACKAGE"
QUOTA_BYTES="$(package_to_bytes "$PACKAGE")"

[ -r "$SETALINK_ENV" ]      || die "setalink not installed (missing $SETALINK_ENV) — run install.sh first"
[ -r "$SETALINK_USERS_DB" ] || die "missing $SETALINK_USERS_DB — run install.sh first"
require_cmd jq
require_cmd qrencode
require_cmd uuidgen

# Reject duplicate name up front.
if jq -e --arg n "$NAME" '.users[] | select(.name == $n)' "$SETALINK_USERS_DB" >/dev/null; then
    die "user '$NAME' already exists (remove with remove-user.sh first)"
fi

# Enforce max-users cap.
COUNT="$(jq '.users | length' "$SETALINK_USERS_DB")"
if [ "$COUNT" -ge "$MAX_USERS" ]; then
    die "user limit reached ($COUNT / $MAX_USERS)"
fi

UUID="$(uuidgen)"
# 8-byte (16 hex char) shortId — well within REALITY's 0–16 byte range.
SHORTID="$(openssl rand -hex 8)"
CREATED="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

# Compute expiry date for time-based packages (7days/30days).
EXPIRY_DAYS="$(package_to_expiry_days "$PACKAGE")"
if [ "$EXPIRY_DAYS" -gt 0 ]; then
    EXPIRES_AT="$(date -u -d "+${EXPIRY_DAYS} days" +%Y-%m-%dT%H:%M:%SZ)"
    EXPIRES_ARG="$EXPIRES_AT"
else
    EXPIRES_ARG="null"
fi

# Append to users.json atomically.
TMP="$(mktemp /tmp/setalink-users.XXXXXX.json)"
jq --arg n "$NAME" --arg u "$UUID" --arg s "$SHORTID" --arg c "$CREATED" \
   --arg p "$PACKAGE" --argjson q "$QUOTA_BYTES" \
   --argjson expires "$([ "$EXPIRES_ARG" = "null" ] && echo 'null' || printf '"%s"' "$EXPIRES_ARG")" \
    '.users += [{
        name:         $n,
        uuid:         $u,
        shortId:      $s,
        created:      $c,
        package_name: $p,
        quota_bytes:  $q,
        used_bytes:   0,
        disabled:     false,
        last_seen_at: null,
        expires_at:   $expires
     }]' \
    "$SETALINK_USERS_DB" > "$TMP"
install -m 0600 -o root -g root "$TMP" "$SETALINK_USERS_DB"
rm -f "$TMP"

log "regenerating xray config"
if ! regenerate_xray_config; then
    # Roll back the users.json change so state stays consistent.
    err "rolling back users.json"
    TMP="$(mktemp /tmp/setalink-users.XXXXXX.json)"
    jq --arg n "$NAME" '.users |= map(select(.name != $n))' "$SETALINK_USERS_DB" > "$TMP"
    install -m 0600 -o root -g root "$TMP" "$SETALINK_USERS_DB"
    rm -f "$TMP"
    die "xray config validation failed; user not added"
fi

restart_xray

# Per-user output files.
USER_DIR="${SETALINK_USERS_DIR}/${NAME}"
mkdir -p "$USER_DIR"
chmod 0700 "$USER_DIR"

VLESS_URL="$(build_vless_url "$UUID" "$SHORTID" "$NAME")"
printf '%s\n' "$VLESS_URL" > "$USER_DIR/link.txt"
chmod 0600 "$USER_DIR/link.txt"

qrencode -o "$USER_DIR/qr.png" -s 8 -m 2 "$VLESS_URL"
chmod 0600 "$USER_DIR/qr.png"

ok "added user '$NAME' ($((COUNT + 1)) / $MAX_USERS)"
cat <<EOF

  uuid     : $UUID
  shortId  : $SHORTID
  package  : $PACKAGE$( [ "$QUOTA_BYTES" -gt 0 ] && printf " (quota %s bytes)" "$QUOTA_BYTES" )
  link.txt : $USER_DIR/link.txt
  qr.png   : $USER_DIR/qr.png

  vless URL:
$VLESS_URL

EOF

# Terminal QR (handy when you're SSHed in and want to scan from a phone).
if [ -t 1 ]; then
    log "scan with your client (Ctrl-C closes):"
    qrencode -t ansiutf8 -m 1 "$VLESS_URL"
fi
