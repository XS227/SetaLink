#!/usr/bin/env bash
set -Eeuo pipefail

# Deploy the repo-managed vpn.setalink.no nginx edge vhost safely.
# This script intentionally does NOT modify /etc/nginx/nginx.conf or Xray config.
# Expected existing stream{} mapping:
#   vpn.setalink.no -> 127.0.0.1:4434
# Expected Xray loopback inbounds:
#   10000 WS, 10001 XHTTP, 10002 HTTPUpgrade

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SOURCE="$REPO_ROOT/infra/nginx/vpn-setalink.conf"
TARGET="/etc/nginx/sites-available/vpn-setalink"
ENABLED="/etc/nginx/sites-enabled/vpn-setalink"
CERT_DIR="/etc/letsencrypt/live/vpn.setalink.no"
STAMP="$(date -u +%Y%m%d-%H%M%S)"
BACKUP="${TARGET}.bak-${STAMP}"

if [[ ${EUID} -ne 0 ]]; then
  echo "ERROR: run with sudo: sudo $0" >&2
  exit 1
fi

require_listener() {
  local port="$1"
  if ! ss -lnt | grep -Eq "127\\.0\\.0\\.1:${port}\\b"; then
    echo "ERROR: required loopback listener 127.0.0.1:${port} is missing" >&2
    exit 1
  fi
}

[[ -f "$SOURCE" ]] || { echo "ERROR: missing $SOURCE" >&2; exit 1; }
[[ -f "$CERT_DIR/fullchain.pem" ]] || { echo "ERROR: missing TLS certificate $CERT_DIR/fullchain.pem" >&2; exit 1; }
[[ -f "$CERT_DIR/privkey.pem" ]] || { echo "ERROR: missing TLS key $CERT_DIR/privkey.pem" >&2; exit 1; }

# Refuse to deploy if the public stream router is not pointed at this dedicated edge.
if ! nginx -T 2>/dev/null | grep -Eq 'vpn\.setalink\.no[[:space:]]+127\.0\.0\.1:4434;'; then
  echo "ERROR: nginx stream{} does not map vpn.setalink.no to 127.0.0.1:4434" >&2
  exit 1
fi

require_listener 10000
require_listener 10001
require_listener 10002

if [[ -f "$TARGET" ]]; then
  cp -a "$TARGET" "$BACKUP"
  echo "Backup: $BACKUP"
fi

install -o root -g root -m 0644 "$SOURCE" "$TARGET"
ln -sfn "$TARGET" "$ENABLED"

rollback() {
  local rc=$?
  if [[ $rc -ne 0 ]]; then
    echo "Deployment failed; attempting rollback..." >&2
    if [[ -f "$BACKUP" ]]; then
      cp -a "$BACKUP" "$TARGET"
      nginx -t >/dev/null 2>&1 && systemctl reload nginx || true
    fi
  fi
  exit "$rc"
}
trap rollback ERR

nginx -t
systemctl reload nginx
sleep 1

if ! ss -lnt | grep -Eq '127\.0\.0\.1:4434\b'; then
  echo "ERROR: nginx reloaded but 127.0.0.1:4434 is not listening" >&2
  false
fi

# Validate local TLS termination without depending on public DNS/routing.
health="$(curl --silent --show-error --fail --resolve vpn.setalink.no:4434:127.0.0.1 \
  https://vpn.setalink.no:4434/healthz)"
if [[ "$health" != "vpn-edge-ok" ]]; then
  echo "ERROR: unexpected edge health response: $health" >&2
  false
fi

trap - ERR

echo "OK: vpn.setalink.no edge listener restored on 127.0.0.1:4434"
echo "OK: /ws -> 10000, /xhttp/ -> 10001, /httpup -> 10002"
echo "Next: test RealGram from the previously failing network before changing app code."
