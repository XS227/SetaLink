#!/usr/bin/env bash
# Poll xray's stats API, atomically read+zero each per-user counter (xray's
# --reset returns the current value AND zeros it), and accumulate the deltas
# into /etc/setalink/users.json (used_bytes, last_seen_at).
#
# Designed to run frequently (e.g. every 5 min via cron). Idempotent and
# safe to invoke manually.
#
# What we count:
#   used_bytes += uplink_delta + downlink_delta   (both directions)
#
# Caveats:
#   - On xray restart, in-memory counters reset; any traffic accumulated
#     since the last poll-traffic.sh run is lost. Worst case = poll interval.
#   - Anonymous REALITY-fallback traffic (failed auth → cloudflare proxy)
#     is NOT counted against any user, by design.
#
# Usage: sudo ./poll-traffic.sh

set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
. "$SCRIPT_DIR/lib.sh"

require_root "$@"
require_cmd jq
require_cmd xray
[ -r "$SETALINK_USERS_DB" ] || die "missing $SETALINK_USERS_DB"

API_PORT="${SETALINK_STATS_PORT:-8344}"
API_ADDR="127.0.0.1:${API_PORT}"
NOW="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

# Sanity: api endpoint must be listening.
if ! ss -tlnH "sport = :$API_PORT" 2>/dev/null | grep -q .; then
    die "xray stats API not listening on $API_ADDR (is xray restarted with the Phase 3 config?)"
fi

# Query + reset, restricted to per-user counters. Output is JSON like:
#   { "stat": [ {"name":"user>>>khabat>>>traffic>>>uplink", "value": 12345}, ... ] }
# `value` is omitted by xray when it's 0 — handle that with "// 0".
RAW="$(xray api statsquery --server="$API_ADDR" --reset --pattern "user>>>" 2>/dev/null || true)"
[ -n "$RAW" ] || RAW='{}'

# Build delta map {"username": total_bytes_since_last_poll, ...}
DELTAS="$(printf '%s' "$RAW" | jq -c '
    [(.stat // [])[]
        | select((.name // "") | startswith("user>>>"))
        | { name: (.name | split(">>>")[1]),
            value: ((.value // 0) | tonumber) }
    ]
    | group_by(.name)
    | map({ key: .[0].name, value: (map(.value) | add) })
    | from_entries
' 2>/dev/null || echo '{}')"
[ -n "$DELTAS" ] || DELTAS='{}'

# Total just for the log line
TOTAL_DELTA="$(printf '%s' "$DELTAS" | jq '[.[]] | add // 0')"
USER_COUNT="$(printf '%s' "$DELTAS" | jq 'length')"

if [ "$DELTAS" = "{}" ] || [ "$TOTAL_DELTA" = "0" ]; then
    log "no per-user traffic since last poll"
    exit 0
fi

# Atomically merge into users.json.
TMP="$(mktemp /tmp/setalink-users.XXXXXX.json)"
jq --argjson d "$DELTAS" --arg now "$NOW" '
    .users |= map(
        (.name) as $n
        | if ($d[$n] // 0) > 0
          then .
               | .used_bytes   = ((.used_bytes // 0) + ($d[$n] // 0))
               | .last_seen_at = $now
          else . end
    )
' "$SETALINK_USERS_DB" > "$TMP"

# Sanity: count must be unchanged
NEW_COUNT="$(jq '.users | length' "$TMP")"
OLD_COUNT="$(jq '.users | length' "$SETALINK_USERS_DB")"
if [ "$NEW_COUNT" != "$OLD_COUNT" ]; then
    rm -f "$TMP"
    die "user count changed during poll ($OLD_COUNT -> $NEW_COUNT); aborted"
fi

install -m 0600 -o root -g root "$TMP" "$SETALINK_USERS_DB"
rm -f "$TMP"

log "recorded $USER_COUNT user(s), total $TOTAL_DELTA bytes:"
printf '%s' "$DELTAS" | jq -r 'to_entries[] | "  \(.key): +\(.value) bytes"'
