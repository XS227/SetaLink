#!/usr/bin/env bash
# Snapshot SetaLink state to a single tar.gz under /var/backups/setalink/.
# Captures: REALITY keys + env, users db, per-user links/QRs, Xray config.
#
# Usage: ./backup.sh [output-path.tar.gz]

set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
. "$SCRIPT_DIR/lib.sh"

require_root "$@"

[ -d "$SETALINK_DIR" ] || die "no $SETALINK_DIR — nothing to back up"

mkdir -p "$SETALINK_BACKUPS_DIR"
chmod 0700 "$SETALINK_BACKUPS_DIR"

STAMP="$(date -u +%Y%m%d-%H%M%SZ)"
OUT="${1:-${SETALINK_BACKUPS_DIR}/setalink-${STAMP}.tar.gz}"

# Build tar with restricted perms; archive itself is 0600 because it includes
# the REALITY private key + every client UUID.
TAR_PATHS=("etc/setalink")
if [ -f "$XRAY_CONFIG" ]; then
    TAR_PATHS+=("${XRAY_CONFIG#/}")
fi

umask 077
tar --warning=no-file-changed -czf "$OUT" -C / "${TAR_PATHS[@]}"

chmod 0600 "$OUT"
chown root:root "$OUT"

SIZE="$(du -h "$OUT" | awk '{print $1}')"
ok "backup written: $OUT ($SIZE)"
log "to restore on a new host: tar -xzf $(basename "$OUT") -C /  &&  systemctl restart xray"
