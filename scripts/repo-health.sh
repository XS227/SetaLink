#!/usr/bin/env bash
# scripts/repo-health.sh — repository and release pipeline health checks
#
# Usage: ./scripts/repo-health.sh
# Exit code 0 = all checks pass, 1 = warnings found

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APP_DIR="$REPO_ROOT/mobile-app"
RELEASES_DIR="$REPO_ROOT/public/releases"
VERSION_JSON="$REPO_ROOT/public/download/version.json"

WARNINGS=0

warn() { echo "  WARN: $*"; WARNINGS=$(( WARNINGS + 1 )); }
ok()   { echo "  OK:   $*"; }
info() { echo "  INFO: $*"; }

echo "=== SetaLink Repo Health Check ==="
echo ""

# ── 1. Git state ──────────────────────────────────────────────────────────────
echo "[ Git State ]"
cd "$REPO_ROOT"

if [[ -f .git/MERGE_HEAD ]]; then  warn "Unfinished merge (MERGE_HEAD present)"; else ok "No pending merge"; fi
if [[ -f .git/REBASE_HEAD ]]; then warn "Stale REBASE_HEAD — run: rm .git/REBASE_HEAD"; else ok "No stale REBASE_HEAD"; fi

DIRTY=$(git status --porcelain 2>/dev/null | wc -l)
if [[ $DIRTY -gt 0 ]]; then
  warn "Working tree dirty ($DIRTY changed/untracked files)"
  git status --short | head -10
else
  ok "Working tree clean"
fi

# ── 2. Ownership ──────────────────────────────────────────────────────────────
echo ""
echo "[ Ownership ]"
ROOT_OWNED=$(find "$REPO_ROOT" -not -user ubuntu -not -path "*/.git/*" -not -path "*/node_modules/*" \
  -not -path "*/.gradle/*" -not -path "*/build/*" 2>/dev/null | wc -l)
if [[ $ROOT_OWNED -gt 0 ]]; then
  warn "$ROOT_OWNED file(s) not owned by ubuntu"
  find "$REPO_ROOT" -not -user ubuntu -not -path "*/.git/*" -not -path "*/node_modules/*" 2>/dev/null | head -5
else
  ok "All files owned by ubuntu"
fi

# ── 3. Large tracked files ────────────────────────────────────────────────────
echo ""
echo "[ Large Tracked Files ]"
LARGE_TRACKED=$(git -C "$REPO_ROOT" ls-files | while read f; do
  [[ -f "$REPO_ROOT/$f" ]] && SIZE=$(stat -c%s "$REPO_ROOT/$f" 2>/dev/null || echo 0)
  [[ ${SIZE:-0} -gt 5242880 ]] && echo "$f ($SIZE bytes)"
done)
if [[ -n "$LARGE_TRACKED" ]]; then
  warn "Large files tracked in git (>5MB):"
  echo "$LARGE_TRACKED" | head -10
else
  ok "No large files tracked in git"
fi

# ── 4. Tracked generated files ────────────────────────────────────────────────
echo ""
echo "[ Tracked Generated Files ]"
GENERATED=$(git -C "$REPO_ROOT" ls-files | grep -E "\.cxx/|\.gradle/|app/build/|node_modules/" | head -5)
if [[ -n "$GENERATED" ]]; then
  warn "Generated files still tracked in git:"
  echo "$GENERATED"
else
  ok "No generated files tracked in git"
fi

# ── 5. APK structure ─────────────────────────────────────────────────────────
echo ""
echo "[ Release APK Structure ]"
for channel in stable beta hotfix; do
  dir="$RELEASES_DIR/$channel"
  latest="$dir/setalink-latest.apk"
  if [[ -d "$dir" ]]; then
    count=$(find "$dir" -name "*.apk" -not -type l 2>/dev/null | wc -l)
    if [[ -L "$latest" ]] && [[ -f "$latest" ]]; then
      target=$(readlink "$latest")
      ok "$channel: $count APK(s), latest → $target"
    elif [[ $count -eq 0 ]]; then
      info "$channel: empty (no APK yet)"
    else
      warn "$channel: $count APK(s) but missing/broken setalink-latest.apk symlink"
    fi
  else
    warn "$channel: releases/$channel/ directory missing"
  fi
done

# ── 6. Download symlink ───────────────────────────────────────────────────────
echo ""
echo "[ Download Symlink ]"
LATEST_LINK="$REPO_ROOT/public/download/setalink-latest.apk"
if [[ -L "$LATEST_LINK" ]] && [[ -f "$LATEST_LINK" ]]; then
  ok "public/download/setalink-latest.apk → $(readlink "$LATEST_LINK")"
else
  warn "public/download/setalink-latest.apk is broken or missing"
fi

# ── 7. Version consistency ────────────────────────────────────────────────────
echo ""
echo "[ Version Consistency ]"
PKG_VER=$(node -pe "require('$APP_DIR/package.json').version" 2>/dev/null || echo "?")
GRADLE_VER=$(grep -oP 'versionName\s+"?\K[^"]+' "$APP_DIR/android/app/build.gradle" 2>/dev/null || echo "?")
JSON_VER=$(python3 -c "import json; print(json.load(open('$VERSION_JSON'))['version'])" 2>/dev/null || echo "?")

info "package.json:   $PKG_VER"
info "build.gradle:   $GRADLE_VER"
info "version.json:   $JSON_VER"

if [[ "$PKG_VER" == "$GRADLE_VER" ]] && [[ "$PKG_VER" == "$JSON_VER" ]]; then
  ok "All version references consistent ($PKG_VER)"
else
  warn "Version mismatch — package.json=$PKG_VER build.gradle=$GRADLE_VER version.json=$JSON_VER"
fi

# ── 8. Broken symlinks ────────────────────────────────────────────────────────
echo ""
echo "[ Broken Symlinks ]"
BROKEN=$(find "$REPO_ROOT/public" -type l -not -path "*/node_modules/*" 2>/dev/null | while read l; do
  [[ -e "$l" ]] || echo "broken: $l → $(readlink "$l")"
done)
if [[ -n "$BROKEN" ]]; then
  warn "Broken symlinks found:"
  echo "$BROKEN"
else
  ok "No broken symlinks in public/"
fi

# ── 9. APK tracked in git ────────────────────────────────────────────────────
echo ""
echo "[ APKs In Git ]"
APK_TRACKED=$(git -C "$REPO_ROOT" ls-files "*.apk" 2>/dev/null)
if [[ -n "$APK_TRACKED" ]]; then
  warn "APK files tracked in git (should be on disk only):"
  echo "$APK_TRACKED"
else
  ok "No APK files tracked in git"
fi

# ── Summary ───────────────────────────────────────────────────────────────────
echo ""
echo "================================="
if [[ $WARNINGS -gt 0 ]]; then
  echo "RESULT: $WARNINGS warning(s) found"
  exit 1
else
  echo "RESULT: All checks passed"
  exit 0
fi
