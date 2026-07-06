#!/usr/bin/env bash
# SetaLink multi-node health check (v0.9.35).
#
# Runs on the control box (5.249.252.221) and remotely probes each VPN node —
# the boxes themselves can't be reached with systemctl from here, so this checks
# what users actually depend on: the Reality TCP endpoint and the edge TLS vhost.
#
# Writes data/node_health.json, which public/v1.php reads to (a) annotate ping,
# and (b) auto-hide a non-primary node that is DOWN so users aren't routed to it.
#
# Schedule: cron every 2 minutes (see crontab). Idempotent; safe to run by hand.

set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT="$REPO_ROOT/data/node_health.json"
TMP="$(mktemp)"

# Nodes to probe:  id | reality_address | reality_port | edge_host
# Keep in sync with public/v1.php (primary = live prod target, fi-hel = Helsinki).
NODES=(
  "primary|65.109.183.7|443|edge.setalink.no"
  "de-nbg|91.107.158.53|443|edge.setalink.no"
  "fi-hel|65.109.183.7|443|fi.setalink.no"
)

now() { date -u '+%Y-%m-%dT%H:%M:%SZ'; }

# TCP connect with millisecond RTT. Echoes "ms" on success, empty on failure.
tcp_rtt_ms() {
  local host="$1" port="$2"
  local start end
  start=$(date +%s%N)
  if timeout 5 bash -c "exec 3<>/dev/tcp/${host}/${port}" 2>/dev/null; then
    end=$(date +%s%N)
    echo $(( (end - start) / 1000000 ))
    return 0
  fi
  return 1
}

# TLS handshake on the edge host (returns 0 if the cert negotiates).
tls_ok() {
  local host="$1"
  curl -sS -o /dev/null --max-time 8 "https://${host}/" >/dev/null 2>&1
  # A 4xx/5xx still means TLS succeeded; only a connection/handshake failure is !=0.
  local code=$?
  [[ $code -eq 0 || $code -eq 22 || $code -eq 28 ]] && return 0 || return 1
}

entries=""
for spec in "${NODES[@]}"; do
  IFS='|' read -r id addr port edge <<< "$spec"
  rtt="$(tcp_rtt_ms "$addr" "$port")"; tcp_up=$?
  tls="false"; if tls_ok "$edge"; then tls="true"; fi

  if [[ $tcp_up -eq 0 && "$tls" == "true" ]]; then status="up"
  elif [[ $tcp_up -eq 0 ]]; then status="degraded"
  else status="down"; rtt="null"; fi
  [[ -z "$rtt" ]] && rtt="null"

  entries+="    \"${id}\": {\"status\":\"${status}\",\"rtt_ms\":${rtt},\"tls\":${tls},\"address\":\"${addr}:${port}\",\"edge\":\"${edge}\",\"checked_at\":\"$(now)\"},\n"
done
entries="${entries%,\\n}"   # strip trailing comma+newline

{
  echo "{"
  echo "  \"updated_at\": \"$(now)\","
  echo "  \"nodes\": {"
  echo -e "$entries"
  echo "  }"
  echo "}"
} > "$TMP"

# Validate before publishing so v1.php never reads a half-written file.
if python3 -c "import json,sys; json.load(open('$TMP'))" 2>/dev/null; then
  mv "$TMP" "$OUT"
  chmod 644 "$OUT"
else
  echo "node-health: produced invalid JSON, keeping previous $OUT" >&2
  rm -f "$TMP"
  exit 1
fi
