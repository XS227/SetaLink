#!/usr/bin/env bash
# Print the current SetaLink user roster.
#
# Usage:
#   ./list-users.sh           # table
#   ./list-users.sh --json    # raw users.json contents
#   ./list-users.sh <name>    # detail (incl. UUID + vless link) for one user

set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
. "$SCRIPT_DIR/lib.sh"

require_root "$@"

[ -r "$SETALINK_USERS_DB" ] || die "missing $SETALINK_USERS_DB — run install.sh first"
require_cmd jq

# --json: dump verbatim.
if [ "${1:-}" = "--json" ]; then
    cat "$SETALINK_USERS_DB"
    exit 0
fi

# Per-user detail view.
if [ $# -eq 1 ] && [ "${1:0:2}" != "--" ]; then
    NAME="$1"
    validate_username "$NAME"
    USER_JSON="$(jq -e --arg n "$NAME" '.users[] | select(.name == $n)' "$SETALINK_USERS_DB" 2>/dev/null || true)"
    [ -n "$USER_JSON" ] || die "user '$NAME' not found"

    UUID="$(   printf '%s' "$USER_JSON" | jq -r .uuid)"
    SID="$(    printf '%s' "$USER_JSON" | jq -r .shortId)"
    CREATED="$(printf '%s' "$USER_JSON" | jq -r .created)"
    LINK_FILE="${SETALINK_USERS_DIR}/${NAME}/link.txt"
    QR_FILE="${SETALINK_USERS_DIR}/${NAME}/qr.png"

    cat <<EOF
  name     : $NAME
  uuid     : $UUID
  shortId  : $SID
  created  : $CREATED
  link.txt : $LINK_FILE $( [ -f "$LINK_FILE" ] || printf "(missing)" )
  qr.png   : $QR_FILE   $( [ -f "$QR_FILE"   ] || printf "(missing)" )

EOF
    if [ -f "$LINK_FILE" ]; then
        printf '  vless URL:\n'
        sed 's/^/    /' "$LINK_FILE"
    fi
    exit 0
fi

# Table view.
COUNT="$(jq '.users | length' "$SETALINK_USERS_DB")"
printf "SetaLink users — %d / %d\n\n" "$COUNT" "$MAX_USERS"
if [ "$COUNT" -eq 0 ]; then
    echo "  (no users — add one with: $SCRIPT_DIR/add-user.sh <name>)"
    exit 0
fi

# Aligned table: name, shortId, created, uuid (last because longest).
{
    printf "NAME\tSHORTID\tCREATED\tUUID\n"
    jq -r '.users[] | [.name, .shortId, .created, .uuid] | @tsv' "$SETALINK_USERS_DB"
} | column -t -s "$(printf '\t')"
