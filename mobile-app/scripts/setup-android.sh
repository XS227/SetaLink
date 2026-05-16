#!/usr/bin/env bash
# setup-android.sh — one-time local dev setup for Android builds
# Run from the mobile-app/ directory: ./scripts/setup-android.sh
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
APP_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
ANDROID_DIR="$APP_DIR/android"

echo "SetaLink Android — local build setup"
echo "====================================="

# ── 1. Node modules ──────────────────────────────────────────────────────────
echo "Installing JS dependencies..."
cd "$APP_DIR"
npm install

# ── 2. Gradle wrapper ────────────────────────────────────────────────────────
echo "Generating Gradle wrapper..."
cd "$ANDROID_DIR"
gradle wrapper --gradle-version 8.6 --distribution-type all
chmod +x gradlew
echo "  Wrapper generated: android/gradlew"

# ── 3. Debug keystore ────────────────────────────────────────────────────────
KEYSTORE="$ANDROID_DIR/app/debug.keystore"
if [ ! -f "$KEYSTORE" ]; then
    echo "Generating debug keystore..."
    keytool -genkey -v \
        -keystore "$KEYSTORE" \
        -storepass android \
        -alias androiddebugkey \
        -keypass android \
        -keyalg RSA \
        -keysize 2048 \
        -validity 10000 \
        -dname "CN=Android Debug,O=Android,C=US" \
        2>/dev/null
    echo "  Keystore created: android/app/debug.keystore"
else
    echo "  Keystore already exists, skipping."
fi

# ── 4. Done ──────────────────────────────────────────────────────────────────
echo ""
echo "Setup complete. To build the debug APK:"
echo "  cd android && ./gradlew assembleDebug"
echo ""
echo "APK output: android/app/build/outputs/apk/debug/app-debug.apk"
