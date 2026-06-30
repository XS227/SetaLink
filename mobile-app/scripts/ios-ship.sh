#!/usr/bin/env bash
# ios-ship.sh — runs on macOS only.
# Usage: cd mobile-app && bash scripts/ios-ship.sh
# Runs pod install → archive → export IPA → upload to TestFlight.
#
# Prerequisites:
#   1. Xcode 15+ installed
#   2. Apple Distribution certificate in Keychain
#   3. App Store provisioning profile installed
#   4. App Store Connect API key at ~/.appstoreconnect/private_keys/AuthKey_KEYID.p8
#
# Set these four values before running:
TEAM_ID=""                        # 10-char Apple Team ID, e.g. AB12CD34EF
PROFILE_NAME=""                   # Exact provisioning profile name, e.g. "Realink AppStore"
ASC_KEY_ID=""                     # App Store Connect API Key ID
ASC_ISSUER_ID=""                  # App Store Connect Issuer ID

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT="$SCRIPT_DIR/.."
IOS_DIR="$ROOT/ios"
ARCHIVE_PATH="$TMPDIR/Realink.xcarchive"
EXPORT_DIR="$TMPDIR/Realink-ipa"

# ── Validation ────────────────────────────────────────────────────────────────
[[ -z "$TEAM_ID" ]]       && { echo "ERROR: Set TEAM_ID at the top of this script.";       exit 1; }
[[ -z "$PROFILE_NAME" ]]  && { echo "ERROR: Set PROFILE_NAME at the top of this script.";  exit 1; }
[[ -z "$ASC_KEY_ID" ]]    && { echo "ERROR: Set ASC_KEY_ID at the top of this script.";    exit 1; }
[[ -z "$ASC_ISSUER_ID" ]] && { echo "ERROR: Set ASC_ISSUER_ID at the top of this script."; exit 1; }

KEY_FILE="$HOME/.appstoreconnect/private_keys/AuthKey_${ASC_KEY_ID}.p8"
[[ ! -f "$KEY_FILE" ]] && { echo "ERROR: API key not found at $KEY_FILE"; exit 1; }

# ── Step 1: JS dependencies ───────────────────────────────────────────────────
echo ""
echo "▶ Step 1/5 — Installing JS dependencies"
cd "$ROOT"
npm install --prefer-offline

# ── Step 2: pod install ───────────────────────────────────────────────────────
echo ""
echo "▶ Step 2/5 — pod install"
cd "$IOS_DIR"
pod install --repo-update
cd "$ROOT"

# ── Step 3: Archive ───────────────────────────────────────────────────────────
echo ""
echo "▶ Step 3/5 — Archiving (Release)"
BUILD_NUMBER=$(date +%Y%m%d%H%M)

xcodebuild archive \
  -workspace ios/Realink.xcworkspace \
  -scheme Realink \
  -configuration Release \
  -archivePath "$ARCHIVE_PATH" \
  CURRENT_PROJECT_VERSION="$BUILD_NUMBER" \
  MARKETING_VERSION=0.9.50 \
  DEVELOPMENT_TEAM="$TEAM_ID" \
  PROVISIONING_PROFILE_SPECIFIER="$PROFILE_NAME" \
  CODE_SIGN_STYLE=Manual \
  | grep -E "error:|warning:|Archive|Build"

echo "Archive written to $ARCHIVE_PATH"

# ── Step 4: Export IPA ────────────────────────────────────────────────────────
echo ""
echo "▶ Step 4/5 — Exporting IPA"
EXPORT_OPTIONS="$TMPDIR/ExportOptions.plist"

cat > "$EXPORT_OPTIONS" << PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>method</key>
  <string>app-store</string>
  <key>teamID</key>
  <string>${TEAM_ID}</string>
  <key>uploadBitcode</key>
  <false/>
  <key>uploadSymbols</key>
  <true/>
  <key>signingStyle</key>
  <string>manual</string>
  <key>provisioningProfiles</key>
  <dict>
    <key>no.setalink.realink</key>
    <string>${PROFILE_NAME}</string>
  </dict>
</dict>
</plist>
PLIST

rm -rf "$EXPORT_DIR"
xcodebuild -exportArchive \
  -archivePath "$ARCHIVE_PATH" \
  -exportPath "$EXPORT_DIR" \
  -exportOptionsPlist "$EXPORT_OPTIONS"

IPA="$EXPORT_DIR/Realink.ipa"
[[ ! -f "$IPA" ]] && { echo "ERROR: IPA not found at $IPA"; exit 1; }
echo "IPA: $IPA  ($(du -h "$IPA" | cut -f1))"

# ── Step 5: Upload to TestFlight ──────────────────────────────────────────────
echo ""
echo "▶ Step 5/5 — Uploading to TestFlight"
xcrun altool --upload-app \
  --type ios \
  --file "$IPA" \
  --apiKey "$ASC_KEY_ID" \
  --apiIssuer "$ASC_ISSUER_ID" \
  --verbose

echo ""
echo "✓ Done. Build $BUILD_NUMBER is processing in TestFlight."
echo "  appstoreconnect.apple.com → Your App → TestFlight"
