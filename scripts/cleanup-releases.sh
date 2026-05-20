#!/usr/bin/env bash
# scripts/cleanup-releases.sh — remove old APK releases, keep N most recent per channel
#
# Usage:
#   ./scripts/cleanup-releases.sh [--keep N] [--dry-run]
#
# Default: keep 2 most recent APKs per channel

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RELEASES_DIR="$REPO_ROOT/public/releases"
ASSETS_DIR="$REPO_ROOT/public/assets"

KEEP=2
DRY_RUN=false

while [[ $# -gt 0 ]]; do
  case "$1" in
    --keep)    KEEP="$2"; shift 2 ;;
    --dry-run) DRY_RUN=true; shift ;;
    *)         echo "Unknown arg: $1"; exit 1 ;;
  esac
done

echo "==> Cleanup releases (keep=$KEEP, dry_run=$DRY_RUN)"

cleanup_channel() {
  local channel="$1"
  local dir="$RELEASES_DIR/$channel"
  [[ -d "$dir" ]] || return

  # List all versioned APKs sorted by modification time (oldest first), skip latest symlink
  local files
  mapfile -t files < <(find "$dir" -name "setalink-v*.apk" -not -type l | sort -t- -k2 -V)

  local count=${#files[@]}
  local remove_count=$(( count - KEEP ))

  if [[ $remove_count -le 0 ]]; then
    echo "    $channel: $count APK(s) — nothing to remove"
    return
  fi

  for (( i=0; i<remove_count; i++ )); do
    local f="${files[$i]}"
    if $DRY_RUN; then
      echo "    [dry-run] would remove: $f"
    else
      echo "    removing: $f"
      rm -f "$f"
    fi
  done
  echo "    $channel: kept $KEEP of $count APK(s)"
}

for channel in stable beta hotfix; do
  cleanup_channel "$channel"
done

# Also clean up old APKs in public/assets/ (compatibility directory)
echo "==> Cleaning public/assets/"
mapfile -t asset_apks < <(find "$ASSETS_DIR" -name "*.apk" -not -type l | sort -t- -k2 -V 2>/dev/null)
local_count=${#asset_apks[@]}
local_remove=$(( local_count - KEEP ))
if [[ $local_remove -gt 0 ]]; then
  for (( i=0; i<local_remove; i++ )); do
    local f="${asset_apks[$i]}"
    if $DRY_RUN; then
      echo "    [dry-run] would remove: $f"
    else
      echo "    removing: $f"
      rm -f "$f"
    fi
  done
fi
echo "    assets/: kept $KEEP of $local_count APK(s)"

echo ""
echo "✓ Cleanup complete"
