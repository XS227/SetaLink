#!/usr/bin/env bash
# create-hev-stub.sh
#
# Pre-build script for the RealinkTunnel extension target.
# Creates a stub HevSocks5Tunnel.xcframework so local Xcode builds succeed
# without the real hev-socks5-tunnel (which is only built in CI by build-apple.sh).
#
# CI fast-path: the real xcframework is placed at $SRCROOT/HevSocks5Tunnel.xcframework
# by the "Build HevSocks5Tunnel.xcframework" CI step — this script exits immediately.
#
# Layout mirrors a library-style xcframework: each slice holds libHevSocks5Tunnel.a
# plus Headers/HevSocks5Tunnel/hev-main.h and a module.modulemap.
set -euo pipefail

XCFW="$SRCROOT/HevSocks5Tunnel.xcframework"
STAMP="${DERIVED_FILE_DIR}/hev_stub.stamp"

if [ -f "$XCFW/Info.plist" ]; then
    mkdir -p "$(dirname "$STAMP")"; touch "$STAMP"; exit 0
fi

echo "note: HevSocks5Tunnel.xcframework not found — generating build stub at $XCFW"

IOS_SDK=$(xcrun --sdk iphoneos        --show-sdk-path 2>/dev/null || true)
SIM_SDK=$(xcrun --sdk iphonesimulator --show-sdk-path 2>/dev/null || true)
if [ -z "$IOS_SDK" ]; then
    echo "warning: iphoneos SDK not found; skipping stub" >&2
    mkdir -p "$(dirname "$STAMP")"; touch "$STAMP"; exit 0
fi

HEADER='#ifndef HEV_MAIN_H
#define HEV_MAIN_H
#include <stddef.h>
int  hev_socks5_tunnel_main(const char *config_path, int tun_fd);
int  hev_socks5_tunnel_main_from_str(const unsigned char *config_str, unsigned int config_len, int tun_fd);
void hev_socks5_tunnel_quit(void);
void hev_socks5_tunnel_stats(size_t *tx_packets, size_t *tx_bytes, size_t *rx_packets, size_t *rx_bytes);
#endif'

STUB_C=$(mktemp /tmp/hev_stub_XXXXX.c)
cat > "$STUB_C" <<'C'
#include <stddef.h>
int  hev_socks5_tunnel_main(const char *p, int fd) { (void)p; (void)fd; return -1; }
int  hev_socks5_tunnel_main_from_str(const unsigned char *s, unsigned int l, int fd) { (void)s; (void)l; (void)fd; return -1; }
void hev_socks5_tunnel_quit(void) {}
void hev_socks5_tunnel_stats(size_t *a, size_t *b, size_t *c, size_t *d) { (void)a; (void)b; (void)c; (void)d; }
C

write_headers() {
    local DIR="$1"
    mkdir -p "$DIR/HevSocks5Tunnel"
    printf '%s\n' "$HEADER" > "$DIR/HevSocks5Tunnel/hev-main.h"
    cat > "$DIR/module.modulemap" <<'MM'
module HevSocks5Tunnel {
    header "HevSocks5Tunnel/hev-main.h"
    export *
}
MM
}

build_slice() {  # <slice-id> <clang-target> <sdk>
    local SLICE="$1" TARGET="$2" SDK="$3"
    local DIR="$XCFW/$SLICE"
    mkdir -p "$DIR"
    local OBJ; OBJ=$(mktemp /tmp/hev_o_XXXXX.o)
    if clang -target "$TARGET" -isysroot "$SDK" -c "$STUB_C" -o "$OBJ" 2>/dev/null; then
        ar rcs "$DIR/libHevSocks5Tunnel.a" "$OBJ"; rm -f "$OBJ"
        write_headers "$DIR/Headers"
        echo "  created slice: $SLICE"; return 0
    fi
    rm -f "$OBJ"; rm -rf "$DIR"; return 1
}

HAVE_DEV=0; HAVE_SIM=0
build_slice "ios-arm64" "arm64-apple-ios15.0" "$IOS_SDK" && HAVE_DEV=1 || true
if [ -n "$SIM_SDK" ]; then
    build_slice "ios-arm64_x86_64-simulator" "arm64-apple-ios15.0-simulator" "$SIM_SDK" && HAVE_SIM=1 || true
fi

slice_plist() {  # <id> <archs-xml> <variant-xml>
    printf '    <dict>\n'
    printf '      <key>LibraryIdentifier</key><string>%s</string>\n' "$1"
    printf '      <key>LibraryPath</key><string>libHevSocks5Tunnel.a</string>\n'
    printf '      <key>HeadersPath</key><string>Headers</string>\n'
    printf '      <key>SupportedArchitectures</key><array>%s</array>\n' "$2"
    printf '      <key>SupportedPlatform</key><string>ios</string>\n'
    printf '%s' "$3"
    printf '    </dict>\n'
}

{
printf '<?xml version="1.0" encoding="UTF-8"?>\n'
printf '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n'
printf '<plist version="1.0"><dict>\n'
printf '  <key>AvailableLibraries</key><array>\n'
[ "$HAVE_DEV" = 1 ] && slice_plist "ios-arm64" "<string>arm64</string>" ""
[ "$HAVE_SIM" = 1 ] && slice_plist "ios-arm64_x86_64-simulator" "<string>arm64</string><string>x86_64</string>" "      <key>SupportedPlatformVariant</key><string>simulator</string>
"
printf '  </array>\n'
printf '  <key>CFBundlePackageType</key><string>XFWK</string>\n'
printf '  <key>XCFrameworkFormatVersion</key><string>1.0</string>\n'
printf '</dict></plist>\n'
} > "$XCFW/Info.plist"

rm -f "$STUB_C"
mkdir -p "$(dirname "$STAMP")"; touch "$STAMP"
echo "note: HevSocks5Tunnel stub ready (device=$HAVE_DEV simulator=$HAVE_SIM)"
