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

# Step 2 — list usernames over quota and not yet disabled.
mapfile -t OVER_QUOTA < <(jq -r '
    .users[]
    | select((.disabled // false) != true)
    | select((.quota_bytes // 0) > 0)
    | select((.used_bytes // 0) >= (.quota_bytes // 0))
    | .name
' "$SETALINK_USERS_DB")

if [ "${#OVER_QUOTA[@]}" -eq 0 ]; then
    log "no users over quota"
    exit 0
fi

# Step 3 — disable each over-quota user. disable-user.sh handles its own
# regen + xray restart. We loop, so multiple users get disabled in a single
# enforcement run, but each restart is sub-second.
log "auto-disabling ${#OVER_QUOTA[@]} user(s) over quota: ${OVER_QUOTA[*]}"
for u in "${OVER_QUOTA[@]}"; do
    if "$SCRIPT_DIR/disable-user.sh" "$u"; then
        ok "auto-disabled '$u'"
    else
        err "failed to auto-disable '$u' — will retry next run"
    fi
done
