#!/usr/bin/env bash
# SetaLink production watchdog — auto-restarts unhealthy services.
# Run as: sudo bash /var/www/setalink/scripts/watchdog.sh
# Deployed as: systemd service setalink-watchdog.timer (every 60s)

LOG=/var/log/setalink/watchdog.log
EDGE_HOST="edge.setalink.no"

mkdir -p /var/log/setalink

ts() { date '+%Y-%m-%d %H:%M:%S'; }
log() { echo "[$(ts)] $*" | tee -a "$LOG"; }

RESTARTED=""

# ── Xray service ──────────────────────────────────────────────────────────────
if ! systemctl is-active --quiet xray; then
    log "FAIL xray service not running — restarting"
    systemctl restart xray
    sleep 3
    if systemctl is-active --quiet xray; then
        log "OK   xray restarted successfully"
        RESTARTED="$RESTARTED xray"
    else
        log "CRIT xray restart failed — check: journalctl -u xray -n 30"
    fi
else
    log "OK   xray running (PID $(systemctl show xray -p MainPID | cut -d= -f2))"
fi

# ── Nginx service ─────────────────────────────────────────────────────────────
if ! systemctl is-active --quiet nginx; then
    log "FAIL nginx not running — restarting"
    systemctl restart nginx
    sleep 2
    systemctl is-active --quiet nginx && { log "OK   nginx restarted"; RESTARTED="$RESTARTED nginx"; } \
        || log "CRIT nginx restart failed"
else
    log "OK   nginx running"
fi

# ── PHP-FPM ───────────────────────────────────────────────────────────────────
if ! systemctl is-active --quiet php8.3-fpm 2>/dev/null; then
    log "FAIL php8.3-fpm not running — restarting"
    systemctl restart php8.3-fpm 2>/dev/null || true
    RESTARTED="$RESTARTED php-fpm"
else
    log "OK   php8.3-fpm running"
fi

# ── Xray listening ports ──────────────────────────────────────────────────────
for PORT in 8443 10000 10001 10002; do
    if ss -tulpn 2>/dev/null | grep -q ":${PORT}"; then
        log "OK   port ${PORT} listening"
    else
        log "WARN port ${PORT} NOT listening — restarting xray"
        systemctl restart xray
        sleep 2
        RESTARTED="$RESTARTED xray-port${PORT}"
        break
    fi
done

# ── Reality TCP reachability ──────────────────────────────────────────────────
if timeout 4 bash -c "echo > /dev/tcp/${EDGE_HOST}/8443" 2>/dev/null; then
    log "OK   port 8443 TCP reachable from server"
else
    log "WARN port 8443 not reachable (may be external firewall — check ufw)"
fi

# ── Nginx WS route ────────────────────────────────────────────────────────────
WS_CODE=$(curl -sk -o /dev/null -w "%{http_code}" --max-time 5 "https://${EDGE_HOST}/ws" 2>/dev/null || echo "000")
if [[ "$WS_CODE" == "400" || "$WS_CODE" == "101" ]]; then
    log "OK   /ws route → HTTP ${WS_CODE} (xray reachable)"
elif [[ "$WS_CODE" == "502" ]]; then
    log "FAIL /ws → 502 (xray WS inbound unreachable) — restarting xray"
    systemctl restart xray
    RESTARTED="$RESTARTED xray-ws502"
else
    log "WARN /ws → HTTP ${WS_CODE}"
fi

# ── Nginx XHTTP route ─────────────────────────────────────────────────────────
XHTTP_CODE=$(curl -sk -o /dev/null -w "%{http_code}" --max-time 5 "https://${EDGE_HOST}/xhttp" 2>/dev/null || echo "000")
if [[ "$XHTTP_CODE" == "404" || "$XHTTP_CODE" == "200" ]]; then
    log "OK   /xhttp route → HTTP ${XHTTP_CODE} (xray reachable)"
elif [[ "$XHTTP_CODE" == "502" ]]; then
    log "FAIL /xhttp → 502 — restarting xray"
    systemctl restart xray
    RESTARTED="$RESTARTED xray-xhttp502"
else
    log "WARN /xhttp → HTTP ${XHTTP_CODE}"
fi

# ── Summary ───────────────────────────────────────────────────────────────────
if [[ -n "$RESTARTED" ]]; then
    log "SUMMARY restarted:$RESTARTED"
else
    log "SUMMARY all checks passed — no restarts needed"
fi

# Rotate log if >5MB
LOG_SIZE=$(stat -c%s "$LOG" 2>/dev/null || echo 0)
if [[ "$LOG_SIZE" -gt 5242880 ]]; then
    mv "$LOG" "${LOG}.1"
    log "LOG rotated (was ${LOG_SIZE} bytes)"
fi
