#!/usr/bin/env bash
# scripts/release.sh — build and publish a new SetaLink Android release
#
# Usage:
#   ./scripts/release.sh [--channel stable|beta|hotfix] [--version X.Y.Z]
#
# Examples:
#   ./scripts/release.sh                          # bump patch, stable channel
#   ./scripts/release.sh --version 0.9.11         # explicit version
#   ./scripts/release.sh --channel beta            # beta channel
#   ./scripts/release.sh --channel hotfix --version 0.9.10.1

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APP_DIR="$REPO_ROOT/mobile-app"
PACKAGE_JSON="$APP_DIR/package.json"
BUILD_GRADLE="$APP_DIR/android/app/build.gradle"
RELEASES_DIR="$REPO_ROOT/public/releases"
DOWNLOAD_DIR="$REPO_ROOT/public/download"
VERSION_JSON="$DOWNLOAD_DIR/version.json"

CHANNEL="stable"
EXPLICIT_VERSION=""

# ── Parse args ────────────────────────────────────────────────────────────────
while [[ $# -gt 0 ]]; do
  case "$1" in
    --channel)  CHANNEL="$2";           shift 2 ;;
    --version)  EXPLICIT_VERSION="$2";  shift 2 ;;
    *)          echo "Unknown arg: $1"; exit 1   ;;
  esac
done

if [[ ! "$CHANNEL" =~ ^(stable|beta|hotfix)$ ]]; then
  echo "ERROR: --channel must be stable, beta, or hotfix"
  exit 1
fi

# ── Determine version ─────────────────────────────────────────────────────────
CURRENT_VERSION=$(node -pe "require('$PACKAGE_JSON').version" 2>/dev/null)

if [[ -n "$EXPLICIT_VERSION" ]]; then
  NEW_VERSION="$EXPLICIT_VERSION"
else
  # Auto-bump patch component
  IFS='.' read -r MAJOR MINOR PATCH <<< "${CURRENT_VERSION//-*/}"
  PATCH=$((PATCH + 1))
  NEW_VERSION="$MAJOR.$MINOR.$PATCH"
fi

# Bump versionCode: read current, increment by 1
CURRENT_CODE=$(grep -oP 'versionCode\s+\K\d+' "$BUILD_GRADLE")
NEW_CODE=$((CURRENT_CODE + 1))

echo "==> Release: $CURRENT_VERSION → $NEW_VERSION (versionCode $NEW_CODE) [$CHANNEL]"

# ── Update version files ──────────────────────────────────────────────────────
# package.json
cd "$APP_DIR" && npm version "$NEW_VERSION" --no-git-tag-version --allow-same-version
echo "    package.json updated"

# build.gradle
sed -i "s/versionCode\s\+[0-9]\+/versionCode    $NEW_CODE/" "$BUILD_GRADLE"
sed -i "s/versionName\s\+\".*\"/versionName    \"$NEW_VERSION\"/" "$BUILD_GRADLE"
echo "    build.gradle updated"

# ── Build APK ─────────────────────────────────────────────────────────────────
echo "==> Building APK..."
cd "$APP_DIR/android"
./gradlew assembleRelease --no-daemon -q
echo "    Build complete"

# ── Copy to releases directory ────────────────────────────────────────────────
APK_SRC="$APP_DIR/android/app/build/outputs/apk/release/app-arm64-v8a-release.apk"
CHANNEL_DIR="$RELEASES_DIR/$CHANNEL"
APK_NAME="setalink-v${NEW_VERSION}.apk"
APK_DEST="$CHANNEL_DIR/$APK_NAME"

mkdir -p "$CHANNEL_DIR"
cp "$APK_SRC" "$APK_DEST"
ln -sf "$APK_NAME" "$CHANNEL_DIR/setalink-latest.apk"
echo "    APK → $APK_DEST"

# Also update assets/ compatibility path and latest symlink
cp "$APK_DEST" "$REPO_ROOT/public/assets/$APK_NAME"
ln -sf "../releases/$CHANNEL/$APK_NAME" "$DOWNLOAD_DIR/setalink-latest.apk"

# ── Generate version.json ─────────────────────────────────────────────────────
SHA=$(sha256sum "$APK_DEST" | awk '{print $1}')
SIZE=$(stat -c%s "$APK_DEST")
DATE=$(date +%Y-%m-%d)

# Read existing version.json for other channels
STABLE_VER=$(python3 -c "import json,sys; d=json.load(open('$VERSION_JSON')); print(d.get('channels',{}).get('stable',{}).get('version','$NEW_VERSION'))" 2>/dev/null || echo "$NEW_VERSION")
BETA_VER=$(python3 -c "import json,sys; d=json.load(open('$VERSION_JSON')); print(d.get('channels',{}).get('beta',{}).get('version','$NEW_VERSION'))" 2>/dev/null || echo "$NEW_VERSION")
HOTFIX_VER=$(python3 -c "import json,sys; d=json.load(open('$VERSION_JSON')); print(d.get('channels',{}).get('hotfix',{}).get('version','$NEW_VERSION'))" 2>/dev/null || echo "$NEW_VERSION")

# Override the updated channel
case "$CHANNEL" in
  stable)  STABLE_VER="$NEW_VERSION"  ;;
  beta)    BETA_VER="$NEW_VERSION"    ;;
  hotfix)  HOTFIX_VER="$NEW_VERSION"  ;;
esac

cat > "$VERSION_JSON" << EOF
{
  "version": "$NEW_VERSION",
  "versionCode": $NEW_CODE,
  "releaseDate": "$DATE",
  "rolloutChannel": "$CHANNEL",
  "minSupported": "0.9.7",
  "forceUpdate": false,
  "apkUrl": "https://setalink.no/releases/$CHANNEL/$APK_NAME",
  "apkUrlFallback": "https://setalink.no/download/setalink-latest.apk",
  "checksum": { "sha256": "$SHA", "algorithm": "sha256" },
  "size": $SIZE,
  "changelog": [],
  "channels": {
    "stable":  { "version": "$STABLE_VER",  "apkUrl": "https://setalink.no/releases/stable/setalink-v${STABLE_VER}.apk" },
    "beta":    { "version": "$BETA_VER",    "apkUrl": "https://setalink.no/releases/beta/setalink-v${BETA_VER}.apk" },
    "hotfix":  { "version": "$HOTFIX_VER",  "apkUrl": "https://setalink.no/releases/hotfix/setalink-v${HOTFIX_VER}.apk" }
  }
}
EOF
echo "    version.json updated"

# ── Git tag ───────────────────────────────────────────────────────────────────
cd "$REPO_ROOT"
git add mobile-app/package.json mobile-app/android/app/build.gradle public/download/version.json .gitignore mobile-app/.gitignore
git commit -m "release: v$NEW_VERSION [$CHANNEL]

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
git tag -a "v$NEW_VERSION" -m "SetaLink v$NEW_VERSION [$CHANNEL]"
echo "    Committed and tagged v$NEW_VERSION"

echo ""
echo "✓ Release v$NEW_VERSION complete!"
echo "  APK:      $APK_DEST"
echo "  Symlink:  $CHANNEL_DIR/setalink-latest.apk → $APK_NAME"
echo "  Download: $DOWNLOAD_DIR/setalink-latest.apk"
echo "  version.json: $VERSION_JSON"
echo ""
echo "  Push when ready:  git push && git push --tags"
