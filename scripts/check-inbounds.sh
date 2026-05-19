#!/usr/bin/env bash
# SetaLink inbound health check
# Usage: sudo bash /var/www/setalink/scripts/check-inbounds.sh

EDGE_HOST="edge.setalink.no"
REALITY_PORT=8443
WS_PATH="/ws"
XHTTP_PATH="/xhttp"
XRAY_LOG_ERROR="/var/log/xray/error.log"
XRAY_LOG_ACCESS="/var/log/xray/access.log"

C_OK="\033[0;32m"; C_FAIL="\033[0;31m"; C_WARN="\033[0;33m"; C_BOLD="\033[1m"; C_RESET="\033[0m"
ok()   { echo -e "  ${C_OK}✓${C_RESET} $*"; }
fail() { echo -e "  ${C_FAIL}✗${C_RESET} $*"; }
warn() { echo -e "  ${C_WARN}!${C_RESET} $*"; }
hdr()  { echo -e "\n${C_BOLD}═══ $* ═══${C_RESET}"; }

hdr "Xray Service"
if systemctl is-active --quiet xray; then
    ok "xray.service active — PID $(systemctl show xray -p MainPID | cut -d= -f2)"
else
    fail "xray.service NOT running"
fi

hdr "Listening Ports"
ss -tulpn 2>/dev/null | grep -E ":8443|:10000|:10001|:10002|:8344" | sed 's/^/    /'

ss -tulpn 2>/dev/null | grep -q ":8443"  && ok "port 8443 (Reality)"   || fail "port 8443 NOT listening"
ss -tulpn 2>/dev/null | grep -q ":10000" && ok "port 10000 (WS)"       || fail "port 10000 NOT listening"
ss -tulpn 2>/dev/null | grep -q ":10001" && ok "port 10001 (XHTTP)"    || fail "port 10001 NOT listening"
ss -tulpn 2>/dev/null | grep -q ":10002" && ok "port 10002 (HTTPUp)"   || fail "port 10002 NOT listening"

hdr "Nginx Config"
nginx -t 2>&1 | grep -q "successful" && ok "nginx config OK" || { fail "nginx config ERROR"; nginx -t 2>&1; }

hdr "Nginx Route Check (HTTPS → edge.setalink.no)"
WS_CODE=$(curl -sk -o /dev/null -w "%{http_code}" --max-time 5 "https://${EDGE_HOST}${WS_PATH}" 2>/dev/null || echo "000")
XHTTP_CODE=$(curl -sk -o /dev/null -w "%{http_code}" --max-time 5 "https://${EDGE_HOST}${XHTTP_PATH}" 2>/dev/null || echo "000")

[[ "$WS_CODE"   == "101" || "$WS_CODE"   == "400" ]] && ok "/ws    → HTTP ${WS_CODE}    (Xray reachable via nginx)" || fail "/ws    → HTTP ${WS_CODE} (routing broken)"
[[ "$XHTTP_CODE" == "404" || "$XHTTP_CODE" == "200" ]] && ok "/xhttp → HTTP ${XHTTP_CODE} (Xray reachable via nginx)" || fail "/xhttp → HTTP ${XHTTP_CODE} (routing broken)"

hdr "Reality Port 8443 TCP"
timeout 4 bash -c "echo > /dev/tcp/${EDGE_HOST}/${REALITY_PORT}" 2>/dev/null \
    && ok "port 8443 TCP open on ${EDGE_HOST}" \
    || fail "port 8443 NOT reachable — check UFW"

hdr "Xray Config UUIDs"
python3 -c "
import json
cfg = json.load(open('/usr/local/etc/xray/config.json'))
for ib in cfg.get('inbounds',[]):
    tag = ib.get('tag','?'); port = ib.get('port','?')
    for c in ib.get('settings',{}).get('clients',[]):
        print(f'  [{tag}:{port}] {c[\"id\"]}  ({c.get(\"email\",\"\")})')
" 2>/dev/null

hdr "Last 20 Xray Errors"
[[ -r "$XRAY_LOG_ERROR" ]] && tail -20 "$XRAY_LOG_ERROR" | sed 's/^/    /' || warn "log not readable"

hdr "Recent nginx transport hits (last 30)"
[[ -r /var/log/nginx/access.log ]] \
    && grep -E "/(ws|xhttp|httpup)" /var/log/nginx/access.log | tail -30 | sed 's/^/    /' \
    || warn "nginx log not readable"

hdr "UUID rejections in last 24h"
REJECT_COUNT=$(grep "invalid request user id" "$XRAY_LOG_ACCESS" 2>/dev/null | wc -l)
echo "  Total rejected (wrong UUID): $REJECT_COUNT"
[[ "$REJECT_COUNT" -gt 0 ]] && grep -oP 'user id: \K[^ ]+' "$XRAY_LOG_ACCESS" 2>/dev/null | sort | uniq -c | sort -rn | head -5 | sed 's/^/    /'

hdr "Successful external sessions"
ACCEPT_COUNT=$(grep "accepted" "$XRAY_LOG_ACCESS" 2>/dev/null | grep -v "127.0.0.1" | wc -l)
echo "  Accepted external sessions: $ACCEPT_COUNT"
[[ "$ACCEPT_COUNT" -gt 0 ]] && grep "accepted" "$XRAY_LOG_ACCESS" 2>/dev/null | grep -v "127.0.0.1" | tail -10 | sed 's/^/    /'

echo -e "\n${C_BOLD}Done.${C_RESET}"
