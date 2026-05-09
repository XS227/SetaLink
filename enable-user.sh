#!/usr/bin/env bash
# Enable a previously-disabled SetaLink user. Sets .disabled = false in
# users.json, regenerates the Xray config, and restarts xray. The same
# UUID/shortId/link/QR are reactivated unchanged.
#
# Usage: ./enable-user.sh <username>

set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
. "$SCRIPT_DIR/lib.sh"

require_root "$@"

if [ $# -ne 1 ]; then
    die "usage: $0 <username>"
fi

NAME="$1"
validate_username "$NAME"

[ -r "$SETALINK_ENV" ]      || die "setalink not installed — run install.sh first"
[ -r "$SETALINK_USERS_DB" ] || die "missing $SETALINK_USERS_DB"
require_cmd jq

if ! jq -e --arg n "$NAME" '.users[] | select(.name == $n)' "$SETALINK_USERS_DB" >/dev/null; then
    die "user '$NAME' not found"
fi

if jq -e --arg n "$NAME" '.users[] | select(.name == $n and (.disabled // false) != true)' \
        "$SETALINK_USERS_DB" >/dev/null; then
    log "user '$NAME' already enabled — re-syncing xray"
fi

BACKUP="$(mktemp /tmp/setalink-users.bak.XXXXXX.json)"
cp -p "$SETALINK_USERS_DB" "$BACKUP"

TMP="$(mktemp /tmp/setalink-users.XXXXXX.json)"
jq --arg n "$NAME" \
    '.users |= map(if .name == $n then .disabled = false else . end)' \
    "$SETALINK_USERS_DB" > "$TMP"
install -m 0600 -o root -g root "$TMP" "$SETALINK_USERS_DB"
rm -f "$TMP"

log "regenerating xray config"
if ! regenerate_xray_config; then
    err "config validation failed — restoring users.json"
    install -m 0600 -o root -g root "$BACKUP" "$SETALINK_USERS_DB"
    rm -f "$BACKUP"
    die "user not enabled"
fi
rm -f "$BACKUP"

restart_xray

ok "enabled user '$NAME'"
