#!/usr/bin/env bash
# Deploy the ReaLink VPS Helper backend on the web/ops host. Idempotent.
#
#   * copies the engine (provision.sh + nodes.env) to /opt/realink/vps-helper,
#     OFF the webroot and owned by the operator user that holds the node SSH key
#     (never web-readable);
#   * ensures the audit log dir;
#   * installs a per-minute cron running the worker as that operator user.
#
# Run as the operator user (the one with ~/.ssh access to the ReaLink nodes),
# with sudo available. Usage:  bash scripts/setup-vps-helper.sh
set -euo pipefail

REPO="$(cd "$(dirname "$0")/.." && pwd)"
OP_USER="${SUDO_USER:-$(id -un)}"
ENGINE=/opt/realink/vps-helper
LOGDIR=/var/log/realink
CRON=/etc/cron.d/realink-vps-helper

echo "[setup] operator user = $OP_USER (must hold the node SSH key)"

sudo mkdir -p "$ENGINE" "$LOGDIR"
sudo cp "$REPO/vps-helper/provision.sh" "$REPO/vps-helper/nodes.env" \
        "$REPO/vps-helper/realink-vps-helper.sh" "$ENGINE/"
sudo chown -R "$OP_USER":"$OP_USER" "$ENGINE"
sudo chmod 700 "$ENGINE"; sudo chmod 700 "$ENGINE"/*.sh; sudo chmod 600 "$ENGINE/nodes.env"
sudo chown "$OP_USER":"$OP_USER" "$LOGDIR"; sudo chmod 750 "$LOGDIR"

# public installer (no secrets) served from the webroot download dir
if [ -d /var/www/setalink/public/download ]; then
  sudo cp "$REPO/vps-helper/realink-vps-helper.sh" /var/www/setalink/public/download/vps-helper
  sudo chmod 644 /var/www/setalink/public/download/vps-helper
  echo "[setup] installer published at https://setalink.no/download/vps-helper"
fi

# worker cron (runs as the operator user so it can reach node SSH; the web tier
# never does). Every minute; lockfile prevents overlap.
sudo tee "$CRON" >/dev/null <<EOF
# ReaLink VPS Helper provisioning worker — drains the vps_helpers queue.
* * * * * $OP_USER /usr/bin/php /var/www/setalink/scripts/vps-helper-worker.php >/dev/null 2>&1
EOF
sudo chmod 644 "$CRON"
echo "[setup] cron installed at $CRON"
echo "[setup] done. Worker: php /var/www/setalink/scripts/vps-helper-worker.php --once --verbose"
