#!/usr/bin/env bash
# Disable a SetaLink user. Sets .disabled = true in users.json, regenerates
# the Xray config (which filters disabled users out of clients[]), and
# restarts xray. The user's UUID, shortId, link.txt, and qr.png are kept
# in place so enable-user.sh can restore the same identity instantly.
#
# Usage: ./disable-user.sh <username>

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

# No-op if already disabled (still re-runs regen for idempotency).
if jq -e --arg n "$NAME" '.users[] | select(.name == $n and (.disabled // false) == true)' \
        "$SETALINK_USERS_DB" >/dev/null; then
    log "user '$NAME' already disabled — re-syncing xray"
fi

BACKUP="$(mktemp /tmp/setalink-users.bak.XXXXXX.json)"
cp -p "$SETALINK_USERS_DB" "$BACKUP"

TMP="$(mktemp /tmp/setalink-users.XXXXXX.json)"
jq --arg n "$NAME" \
    '.users |= map(if .name == $n then .disabled = true else . end)' \
    "$SETALINK_USERS_DB" > "$TMP"
install -m 0600 -o root -g root "$TMP" "$SETALINK_USERS_DB"
rm -f "$TMP"

log "regenerating xray config"
if ! regenerate_xray_config; then
    err "config validation failed — restoring users.json"
    install -m 0600 -o root -g root "$BACKUP" "$SETALINK_USERS_DB"
    rm -f "$BACKUP"
    die "user not disabled"
fi
rm -f "$BACKUP"

restart_xray

ok "disabled user '$NAME' (record + per-user files preserved; re-enable with enable-user.sh)"
