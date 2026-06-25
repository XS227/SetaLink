#!/usr/bin/env bash
# create-libxray-stub.sh
#
# Pre-build script for the RealinkTunnel extension target.
# Creates a minimal stub LibXray.xcframework so local Xcode builds succeed
# without the real libXray (which is only built in CI).
#
# CI fast-path: the real xcframework is placed at $SRCROOT/LibXray.xcframework
# by the "Build LibXray.xcframework" CI step — this script exits immediately.
#
# Local dev: generates arm64 device + arm64/x86_64 simulator slices using the
# Xcode-provided clang toolchain.  The stub satisfies the linker; actual xray
# code is only reachable when LIBXRAY_AVAILABLE is set (CI only).
set -euo pipefail

XCFW="$SRCROOT/LibXray.xcframework"

# Fast-path: real (or previously generated stub) xcframework is present.
if [ -f "$XCFW/Info.plist" ]; then
    touch "${DERIVED_FILE_DIR}/libxray_stub.stamp"
    exit 0
fi

echo "note: LibXray.xcframework not found — generating build stub at $XCFW"

IOS_SDK=$(xcrun --sdk iphoneos        --show-sdk-path 2>/dev/null || true)
SIM_SDK=$(xcrun --sdk iphonesimulator --show-sdk-path 2>/dev/null || true)

if [ -z "$IOS_SDK" ]; then
    echo "warning: iphoneos SDK not found; is Xcode installed?" >&2
    touch "${DERIVED_FILE_DIR}/libxray_stub.stamp"
    exit 0  # Soft-fail — don't break CI if SDK is unavailable
fi

# Minimal ObjC stub source — implements the two LibXray entry points as no-ops.
# These are never called in local dev (LIBXRAY_AVAILABLE is not set), but the
# linker needs the symbols to exist in the linked framework.
STUB_C=$(mktemp /tmp/libxray_stub_XXXXX.c)
cat > "$STUB_C" <<'C'
#include <stddef.h>
const void* LibXrayRunXray(const void* c) { return NULL; }
void        LibXrayStopXray(void)         {}
C

# Minimal ObjC header matching the declarations in the bridging header.
HEADER_CONTENT='#import <Foundation/Foundation.h>
NSString * _Nonnull LibXrayRunXray(NSString * _Nonnull config);
void LibXrayStopXray(void);'

# Info.plist template for each framework slice.
slice_info_plist() {
    cat <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>CFBundleIdentifier</key>    <string>com.libxray.stub</string>
  <key>CFBundleName</key>          <string>LibXray</string>
  <key>CFBundlePackageType</key>   <string>FMWK</string>
  <key>CFBundleShortVersionString</key><string>0.0.0-stub</string>
  <key>CFBundleVersion</key>       <string>0</string>
  <key>MinimumOSVersion</key>      <string>15.1</string>
</dict></plist>
PLIST
}

build_slice() {
    local TARGET="$1" SDK="$2" SLICE_ID="$3"
    local SLICE_DIR="$XCFW/$SLICE_ID/LibXray.framework"
    mkdir -p "$SLICE_DIR/Headers"
    printf '%s\n' "$HEADER_CONTENT" > "$SLICE_DIR/Headers/LibXray.h"
    local OBJ; OBJ=$(mktemp /tmp/libxray_o_XXXXX.o)
    if clang -target "$TARGET" -isysroot "$SDK" -c "$STUB_C" -o "$OBJ" 2>/dev/null; then
        ar rcs "$SLICE_DIR/LibXray" "$OBJ"
        rm -f "$OBJ"
        slice_info_plist > "$SLICE_DIR/Info.plist"
        echo "  created slice: $SLICE_ID"
        return 0
    else
        rm -f "$OBJ"
        rm -rf "$XCFW/$SLICE_ID"
        echo "  skipped slice: $SLICE_ID (clang failed — SDK may be missing)"
        return 1
    fi
}

HAVE_DEVICE=0
HAVE_SIMULATOR=0

build_slice "arm64-apple-ios15.1" "$IOS_SDK" "ios-arm64" \
    && HAVE_DEVICE=1 || true

if [ -n "$SIM_SDK" ]; then
    # Try arm64 simulator (Apple Silicon Mac)
    ARM_OBJ=$(mktemp /tmp/libxray_sim_arm_XXXXX.o)
    X86_OBJ=$(mktemp /tmp/libxray_sim_x86_XXXXX.o)
    ARM_OK=0; X86_OK=0
    clang -target "arm64-apple-ios15.1-simulator"  -isysroot "$SIM_SDK" \
          -c "$STUB_C" -o "$ARM_OBJ" 2>/dev/null && ARM_OK=1 || true
    clang -target "x86_64-apple-ios15.1-simulator" -isysroot "$SIM_SDK" \
          -c "$STUB_C" -o "$X86_OBJ" 2>/dev/null && X86_OK=1 || true

    if [ "$ARM_OK" = 1 ] || [ "$X86_OK" = 1 ]; then
        SIM_DIR="$XCFW/ios-arm64_x86_64-simulator/LibXray.framework"
        mkdir -p "$SIM_DIR/Headers"
        printf '%s\n' "$HEADER_CONTENT" > "$SIM_DIR/Headers/LibXray.h"
        FAT=$(mktemp /tmp/libxray_fat_XXXXX.o)
        LIPO_ARGS=""
        [ "$ARM_OK" = 1 ] && LIPO_ARGS="$LIPO_ARGS $ARM_OBJ"
        [ "$X86_OK" = 1 ] && LIPO_ARGS="$LIPO_ARGS $X86_OBJ"
        # shellcheck disable=SC2086
        lipo $LIPO_ARGS -create -output "$FAT" 2>/dev/null \
            || cp "$ARM_OBJ" "$FAT" 2>/dev/null \
            || cp "$X86_OBJ" "$FAT" 2>/dev/null
        ar rcs "$SIM_DIR/LibXray" "$FAT"
        slice_info_plist > "$SIM_DIR/Info.plist"
        HAVE_SIMULATOR=1
        rm -f "$FAT"
        echo "  created slice: ios-arm64_x86_64-simulator"
    fi
    rm -f "$ARM_OBJ" "$X86_OBJ"
fi

rm -f "$STUB_C"

if [ "$HAVE_DEVICE" = 0 ] && [ "$HAVE_SIMULATOR" = 0 ]; then
    echo "warning: could not create any LibXray slices; build may fail" >&2
    touch "${DERIVED_FILE_DIR}/libxray_stub.stamp"
    exit 0
fi

# Root xcframework Info.plist — lists only the slices we actually created.
{
printf '<?xml version="1.0" encoding="UTF-8"?>\n'
printf '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n'
printf '<plist version="1.0"><dict>\n'
printf '  <key>AvailableLibraries</key><array>\n'
if [ "$HAVE_DEVICE" = 1 ]; then
printf '    <dict>\n'
printf '      <key>LibraryIdentifier</key>     <string>ios-arm64</string>\n'
printf '      <key>LibraryPath</key>            <string>LibXray.framework</string>\n'
printf '      <key>SupportedArchitectures</key> <array><string>arm64</string></array>\n'
printf '      <key>SupportedPlatform</key>      <string>ios</string>\n'
printf '    </dict>\n'
fi
if [ "$HAVE_SIMULATOR" = 1 ]; then
printf '    <dict>\n'
printf '      <key>LibraryIdentifier</key>     <string>ios-arm64_x86_64-simulator</string>\n'
printf '      <key>LibraryPath</key>            <string>LibXray.framework</string>\n'
printf '      <key>SupportedArchitectures</key> <array><string>arm64</string><string>x86_64</string></array>\n'
printf '      <key>SupportedPlatform</key>      <string>ios</string>\n'
printf '      <key>SupportedPlatformVariant</key><string>simulator</string>\n'
printf '    </dict>\n'
fi
printf '  </array>\n'
printf '  <key>CFBundlePackageType</key>    <string>XFWK</string>\n'
printf '  <key>XCFrameworkFormatVersion</key><string>1.0</string>\n'
printf '</dict></plist>\n'
} > "$XCFW/Info.plist"

touch "${DERIVED_FILE_DIR}/libxray_stub.stamp"
echo "note: LibXray stub xcframework ready (device=$HAVE_DEVICE simulator=$HAVE_SIMULATOR)"
