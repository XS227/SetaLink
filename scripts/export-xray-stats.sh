#!/usr/bin/env bash
# Export aggregated xray access/error log stats to a www-data-readable JSON
# so the admin dashboard (PHP as www-data) can show real traffic counters
# without read access to the root-only logs in /var/log/xray/.
#
# Run as root from cron (every 2 min). Idempotent.
# Output: /var/www/setalink/data/xray-stats.json

set -euo pipefail

ACCESS=/var/log/xray/access.log
ERROR=/var/log/xray/error.log
OUT=/var/www/setalink/data/xray-stats.json

[ -r "$ACCESS" ] || exit 0

# Per-inbound accepted counts + last accept, from today's log.
# Real user lines look like: "... accepted tcp:host:port [inbound-ws >> direct] email: app-user"
# API self-polling ("[api -> api]") is excluded.
STATS_JSON="$(awk '
    /accepted/ && /email: / && !/\[api/ {
        total++
        if (match($0, /\[inbound-[a-z]+/)) {
            tag = substr($0, RSTART+1, RLENGTH-1)
            counts[tag]++
        }
        last_line = $1 " " $2
        sub(/\.[0-9]+$/, "", last_line)
    }
    /invalid request user id/ {
        rejects++
        if (match($0, /user id: [0-9a-f-]{36}/))
            bad[substr($0, RSTART+9, 36)]++
    }
    END {
        printf "{\"accepted_total\":%d,\"uuid_rejections\":%d,\"last_accept\":\"%s\",\"per_inbound\":{", total+0, rejects+0, last_line
        sep=""
        for (t in counts) { printf "%s\"%s\":%d", sep, t, counts[t]; sep="," }
        printf "},\"rejected_uuids\":["
        sep=""
        for (u in bad) { printf "%s\"%s\"", sep, u; sep="," }
        printf "]}"
    }
' "$ACCESS")"

# Traffic-by-app categories from destination hosts/IPs (today + yesterday).
# Global only: every client shares one xray user and nginx fronts all
# inbounds (source is always 127.0.0.1), so per-device attribution is
# impossible until clients get individual UUIDs.
TRAFFIC_JSON="$(cat "$ACCESS" "${ACCESS}.1" 2>/dev/null | awk '
    /accepted/ && /email: / && !/\[api/ {
        if (!match($0, /accepted (tcp|udp):[^ ]+/)) next
        dest = substr($0, RSTART+9, RLENGTH-9)
        sub(/:[0-9]+$/, "", dest)
        h = tolower(dest)
        if      (h ~ /instagram|cdninstagram/)                 c="Instagram"
        else if (h ~ /telegram|t\.me$|^149\.154\.|^91\.108\./) c="Telegram"
        else if (h ~ /whatsapp|wa\.me$/)                       c="WhatsApp"
        else if (h ~ /youtube|googlevideo|ytimg/)              c="YouTube"
        else if (h ~ /facebook|fbcdn|fbsbx/)                   c="Facebook"
        else if (h ~ /twitter|twimg|^x\.com$/)                 c="Twitter/X"
        else if (h ~ /tiktok|byteoversea|musical\.ly/)         c="TikTok"
        else if (h ~ /google|gstatic|gvt[12]/)                 c="Google"
        else if (h ~ /apple|icloud|mzstatic/)                  c="Apple"
        else if (h ~ /^(1\.1\.1\.1|1\.0\.0\.1|8\.8\.8\.8|8\.8\.4\.4)$|cloudflare-dns|dns\.google/) c="DNS"
        else                                                   c="Other"
        counts[c]++
    }
    END {
        printf "{"
        sep=""
        for (k in counts) { printf "%s\"%s\":%d", sep, k, counts[k]; sep="," }
        printf "}"
    }
')"
[ -n "$TRAFFIC_JSON" ] || TRAFFIC_JSON="{}"

# Recent non-Info error lines (excluding known self-inflicted probe noise).
ERRORS_JSON="[]"
if [ -r "$ERROR" ]; then
    ERRORS_JSON="$(tail -n 500 "$ERROR" \
        | { grep -v '\[Info\]' || true; } \
        | { grep -vi 'failed to read client hello' || true; } \
        | tail -n 8 \
        | jq -R . | jq -cs .)" || ERRORS_JSON="[]"
    [ -n "$ERRORS_JSON" ] || ERRORS_JSON="[]"
fi

TMP="$(mktemp /tmp/xray-stats.XXXXXX.json)"
jq -cn --argjson s "$STATS_JSON" --argjson e "$ERRORS_JSON" --argjson t "$TRAFFIC_JSON" \
    --arg now "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
    '$s + {recent_errors: $e, traffic_categories: $t, exported_at: $now}' > "$TMP"

install -m 0644 -o ubuntu -g www-data "$TMP" "$OUT"
rm -f "$TMP"
