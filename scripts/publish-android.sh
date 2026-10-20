#!/usr/bin/env bash
# Publish the tested, signed APKs behind the website's permanent download URL.
set -euo pipefail
repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
apk_dir="${1:?Pass the directory containing the three release APKs}"
build_tools="${ANDROID_BUILD_TOOLS:?Pass the Android build-tools directory}"
export GH_REPO="${GH_REPO:-XS227/SetaLink}"
source_sha="${GITHUB_SHA:-$(git -C "$repo_root" rev-parse HEAD)}"
version="$(node -p "require('$repo_root/mobile-app/package.json').version")"
code="$(sed -nE 's/^[[:space:]]*versionCode[[:space:]]+([0-9]+).*$/\1/p' "$repo_root/mobile-app/android/app/build.gradle")"
expected_signer="99705649466148dbcc57457ea5afcd4592ab8198db439aa851bb1042fb7209a0"
output="$(mktemp -d)"
trap 'rm -rf "$output"' EXIT

sources=(app-arm64-v8a-release.apk app-armeabi-v7a-release.apk app-universal-release.apk)
names=(RealGram-latest.apk RealGram-arm32.apk RealGram-universal.apk)
for i in 0 1 2; do
  source="$apk_dir/${sources[$i]}"
  verification="$(java -jar "$build_tools/lib/apksigner.jar" verify --print-certs "$source")"
  signer="$(printf '%s\n' "$verification" | sed -n 's/^Signer #1 certificate SHA-256 digest: //p')"
  [[ "$signer" == "$expected_signer" ]] || { echo 'Unexpected Android signing certificate' >&2; exit 1; }
  metadata="$("$build_tools/aapt" dump badging "$source")"
  printf '%s\n' "$metadata" | grep -F "package: name='com.setalink'" | grep -F "versionCode='$code'" | grep -F "versionName='$version'"
  cp "$source" "$output/${names[$i]}"
done
(
  cd "$output"
  sha256sum RealGram-*.apk > SHA256SUMS
)
VERSION="$version" VERSION_CODE="$code" SOURCE_SHA="$source_sha" python3 - "$output/release.json" <<'PY'
import json, os, pathlib, sys
pathlib.Path(sys.argv[1]).write_text(json.dumps({
    'version': os.environ['VERSION'], 'versionCode': int(os.environ['VERSION_CODE']),
    'sourceCommit': os.environ['SOURCE_SHA'],
    'apkUrl': 'https://github.com/XS227/SetaLink/releases/latest/download/RealGram-latest.apk',
    'apkUrlArm32': 'https://github.com/XS227/SetaLink/releases/latest/download/RealGram-arm32.apk',
    'apkUrlUniversal': 'https://github.com/XS227/SetaLink/releases/latest/download/RealGram-universal.apk',
}, indent=2) + '\n')
PY
gh release create "android-v$version" --target "$source_sha" --title "RealGram $version" \
  --latest --generate-notes "$output/RealGram-latest.apk" "$output/RealGram-arm32.apk" \
  "$output/RealGram-universal.apk" "$output/SHA256SUMS" "$output/release.json"
