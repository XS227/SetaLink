#!/usr/bin/env bash
# Parse xray access.log and update last_seen_at per user in users.json.
# Reads the full access log each run (safe for typical VPN scale). Only
# advances last_seen_at — never sets it backwards.
#
# Designed to run frequently from cron (every 1-5 min). Idempotent.
# Log format: YYYY/MM/DD HH:MM:SS.ffffff from IP:PORT accepted ... email: USERNAME
#
# Usage: sudo ./parse-last-seen.sh

set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
. "$SCRIPT_DIR/lib.sh"

require_root "$@"

LOG_FILE="${XRAY_LOG_DIR}/access.log"
[ -r "$LOG_FILE" ] || { log "access log not readable: $LOG_FILE"; exit 0; }
[ -r "$SETALINK_USERS_DB" ] || die "missing $SETALINK_USERS_DB"

# Extract the most-recent accepted connection time per user.
# Since lines are chronological, the last occurrence of each email wins.
# Output: one JSON object {"username": "YYYY-MM-DDTHH:MM:SSZ", ...}
SEEN_JSON="$(awk '
    /email: / {
        date = $1          # "YYYY/MM/DD"
        time = $2          # "HH:MM:SS.ffffff"
        user = $NF         # username is the very last token on the line
        sub(/\.[0-9]+$/, "", time)   # strip sub-second precision
        gsub("/", "-", date)          # YYYY/MM/DD -> YYYY-MM-DD
        last_seen[user] = date "T" time "Z"
    }
    END {
        printf "{"
        sep = ""
        for (u in last_seen) {
            # Escape username for JSON (names are validated alnum+._-, safe)
            printf "%s\"%s\":\"%s\"", sep, u, last_seen[u]
            sep = ","
        }
        printf "}"
    }
' "$LOG_FILE")"

[ "$SEEN_JSON" = "{}" ] && { log "no email entries in access log"; exit 0; }

# Merge: only advance last_seen_at (never regress).
TMP="$(mktemp /tmp/setalink-users.XXXXXX.json)"
jq --argjson seen "$SEEN_JSON" '
    .users |= map(
        .name as $n |
        if ($seen[$n] // null) != null
             and ($seen[$n] > (.last_seen_at // ""))
        then .last_seen_at = $seen[$n]
        else . end
    )
' "$SETALINK_USERS_DB" > "$TMP"

NEW_COUNT="$(jq '.users | length' "$TMP")"
OLD_COUNT="$(jq '.users | length' "$SETALINK_USERS_DB")"
if [ "$NEW_COUNT" != "$OLD_COUNT" ]; then
    rm -f "$TMP"
    die "user count changed during parse-last-seen ($OLD_COUNT -> $NEW_COUNT); aborted"
fi

install -m 0600 -o root -g root "$TMP" "$SETALINK_USERS_DB"
rm -f "$TMP"

UPDATED="$(printf '%s' "$SEEN_JSON" | jq 'length')"
log "updated last_seen_at for $UPDATED user(s) from access log"
