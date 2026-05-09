#!/usr/bin/env bash
# Remove a SetaLink user. Deletes from users.json, regenerates Xray config,
# restarts xray, and wipes the per-user output dir.
#
# Usage: ./remove-user.sh <username>

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

# Snapshot for potential rollback.
BACKUP="$(mktemp /tmp/setalink-users.bak.XXXXXX.json)"
cp -p "$SETALINK_USERS_DB" "$BACKUP"

TMP="$(mktemp /tmp/setalink-users.XXXXXX.json)"
jq --arg n "$NAME" '.users |= map(select(.name != $n))' "$SETALINK_USERS_DB" > "$TMP"
install -m 0600 -o root -g root "$TMP" "$SETALINK_USERS_DB"
rm -f "$TMP"

log "regenerating xray config"
if ! regenerate_xray_config; then
    err "config validation failed — restoring users.json"
    install -m 0600 -o root -g root "$BACKUP" "$SETALINK_USERS_DB"
    rm -f "$BACKUP"
    die "user not removed"
fi
rm -f "$BACKUP"

restart_xray

# Wipe per-user files. Bounded path; not user-controlled beyond the
# already-validated NAME, so rm -rf is safe here.
USER_DIR="${SETALINK_USERS_DIR}/${NAME}"
if [ -d "$USER_DIR" ]; then
    rm -rf -- "$USER_DIR"
fi

REMAINING="$(jq '.users | length' "$SETALINK_USERS_DB")"
ok "removed user '$NAME' ($REMAINING / $MAX_USERS remaining)"
