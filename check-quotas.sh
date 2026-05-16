#!/usr/bin/env bash
# Poll xray traffic stats AND auto-disable any user whose used_bytes has
# crossed their quota. Designed to run frequently from cron.
#
#   1. Run poll-traffic.sh — accumulates xray's stats counters into
#      users.json (used_bytes, last_seen_at).
#   2. Find users where quota_bytes > 0 (i.e. NOT unlimited) AND
#      used_bytes >= quota_bytes AND not already disabled.
#   3. For each, call disable-user.sh — which regenerates the xray config
#      (filtering them out of clients[]) and restarts xray.
#
# Unlimited users (quota_bytes == 0) are NEVER auto-disabled here.
#
# Usage: sudo ./check-quotas.sh

set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
. "$SCRIPT_DIR/lib.sh"

require_root "$@"
require_cmd jq

# Step 1 — poll traffic. Failures here shouldn't block enforcement;
# we still want to act on whatever's already in users.json. But warn loudly.
if ! "$SCRIPT_DIR/poll-traffic.sh"; then
    warn "poll-traffic.sh failed; checking quotas against last-known used_bytes"
fi

# Step 1b — update last_seen_at from the access log (catches active sessions
# with sub-threshold traffic that poll-traffic.sh would miss).
"$SCRIPT_DIR/parse-last-seen.sh" || warn "parse-last-seen.sh failed; last_seen_at may be stale"

# Step 2a — list usernames expired by time.
NOW="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
mapfile -t EXPIRED < <(jq -r --arg now "$NOW" '
    .users[]
    | select((.disabled // false) != true)
    | select(.expires_at != null and .expires_at <= $now)
    | .name
' "$SETALINK_USERS_DB")

for u in "${EXPIRED[@]}"; do
    warn "user '$u' subscription expired; disabling"
    if "$SCRIPT_DIR/disable-user.sh" "$u"; then
        # Tag disable reason so the dashboard can show "expired" status.
        TMP="$(mktemp /tmp/setalink-users.XXXXXX.json)"
        jq --arg n "$u" '.users |= map(if .name == $n then .disabled_reason = "expired" else . end)' \
            "$SETALINK_USERS_DB" > "$TMP"
        install -m 0600 -o root -g root "$TMP" "$SETALINK_USERS_DB"
        rm -f "$TMP"
        ok "auto-disabled expired user '$u'"
    else
        err "failed to disable expired user '$u' — will retry next run"
    fi
done

# Step 2b — list usernames over data quota and not yet disabled.
mapfile -t OVER_QUOTA < <(jq -r '
    .users[]
    | select((.disabled // false) != true)
    | select((.quota_bytes // 0) > 0)
    | select((.used_bytes // 0) >= (.quota_bytes // 0))
    | .name
' "$SETALINK_USERS_DB")

if [ "${#OVER_QUOTA[@]}" -eq 0 ] && [ "${#EXPIRED[@]}" -eq 0 ]; then
    log "no users over quota or expired"
    exit 0
fi

if [ "${#OVER_QUOTA[@]}" -eq 0 ]; then
    exit 0
fi

# Step 3 — disable each over-quota user.
log "auto-disabling ${#OVER_QUOTA[@]} user(s) over quota: ${OVER_QUOTA[*]}"
for u in "${OVER_QUOTA[@]}"; do
    if "$SCRIPT_DIR/disable-user.sh" "$u"; then
        ok "auto-disabled '$u'"
    else
        err "failed to auto-disable '$u' — will retry next run"
    fi
done
