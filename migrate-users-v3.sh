#!/usr/bin/env bash
# One-shot, idempotent migration of /etc/setalink/users.json from Phase 2
# (no quota fields) to Phase 3 (package + traffic + disabled fields).
#
# Adds these fields, with defaults that preserve existing behaviour:
#   package_name : "unlimited"
#   quota_bytes  : 0       (0 == unlimited == never auto-disabled)
#   used_bytes   : 0
#   disabled     : false   (only sets if missing — already-disabled stays so)
#   last_seen_at : null    (filled in later by poll-traffic.sh)
#
# Existing fields (name, uuid, shortId, created) are NEVER modified. Re-running
# this script is a no-op on already-migrated entries.
#
# Usage: sudo ./migrate-users-v3.sh

set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
. "$SCRIPT_DIR/lib.sh"

require_root "$@"
[ -r "$SETALINK_USERS_DB" ] || die "missing $SETALINK_USERS_DB"
require_cmd jq

BACKUP="$(mktemp /tmp/setalink-users.bak.XXXXXX.json)"
cp -p "$SETALINK_USERS_DB" "$BACKUP"

TMP="$(mktemp /tmp/setalink-users.XXXXXX.json)"
jq '
    .users |= map(
        . + {
            package_name: (.package_name // "unlimited"),
            quota_bytes:  (.quota_bytes  // 0),
            used_bytes:   (.used_bytes   // 0),
            disabled:     (.disabled     // false),
            last_seen_at: (.last_seen_at // null)
        }
    )
' "$SETALINK_USERS_DB" > "$TMP"

# Sanity: count must be unchanged, and every user must have all required fields.
if ! jq -e '
    (.users | length) as $n
    | (.users | map(select(
        has("name") and has("uuid") and has("shortId") and has("created")
        and has("package_name") and has("quota_bytes") and has("used_bytes")
        and has("disabled") and has("last_seen_at")
      )) | length) == $n
' "$TMP" >/dev/null; then
    rm -f "$TMP"
    die "post-migration sanity check failed; users.json unchanged (backup at $BACKUP)"
fi

ORIG_COUNT="$(jq '.users | length' "$SETALINK_USERS_DB")"
NEW_COUNT="$(jq '.users | length' "$TMP")"
if [ "$ORIG_COUNT" != "$NEW_COUNT" ]; then
    rm -f "$TMP"
    die "user count changed during migration ($ORIG_COUNT -> $NEW_COUNT); aborting (backup at $BACKUP)"
fi

install -m 0600 -o root -g root "$TMP" "$SETALINK_USERS_DB"
rm -f "$TMP" "$BACKUP"

ok "migrated $NEW_COUNT user(s) to Phase 3 schema"
log "summary:"
jq -r '
    .users[] |
    "  \(.name)\tpackage=\(.package_name)\tquota=\(.quota_bytes)\tused=\(.used_bytes)\tdisabled=\(.disabled)"
' "$SETALINK_USERS_DB"
