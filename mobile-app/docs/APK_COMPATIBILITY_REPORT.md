# APK Compatibility Report — 2026-06-11

Triggered by: Iranian tester unable to install the APK on a **Samsung Galaxy J8
(SM-J810)** — download OK, install starts, ends with *"App not installed"*.
No previous SetaLink installation on the device.

## Root cause

**The released APK contained only `arm64-v8a` native code; the Galaxy J8 runs a
32-bit OS and can only install `armeabi-v7a` APKs.**

- `android/app/build.gradle` had `splits.abi.include 'arm64-v8a'` with
  `universalApk false` — every release since v0.9.x shipped 64-bit only
  (confirmed by inspecting `setalink-v0.9.27.apk`: only `lib/arm64-v8a/`).
- The Galaxy J8 uses a Snapdragon 450. The chip is 64-bit capable, but Samsung
  shipped the entire J series (and many A series) with **32-bit firmware** —
  `Build.SUPPORTED_ABIS = [armeabi-v7a, armeabi]`, no arm64.
- Installing an APK with no matching ABI fails at the very end of the install
  with `INSTALL_FAILED_NO_MATCHING_ABIS`, which the Android UI shows as the
  generic **"App not installed"** — exactly the reported symptom.

This affects every 32-bit Android device, which is a meaningful share of the
budget Samsung/Huawei/Xiaomi devices common in Iran.

## 1. SDK versions (unchanged — they were not the problem)

| Setting | Value | Meaning |
|---|---|---|
| `minSdkVersion` | **24** | Android 7.0+ can install |
| `targetSdkVersion` | **34** | Android 14 behaviour profile |
| `compileSdkVersion` | 34 | |

## 2. ABI support

| | Before (≤ v0.9.27) | After (v0.9.28) |
|---|---|---|
| arm64-v8a | ✅ | ✅ `setalink-vX.Y.Z.apk` (default, ~53 MB) |
| armeabi-v7a | ❌ ← bug | ✅ `setalink-vX.Y.Z-arm32.apk` (~49 MB) |
| universal (both) | ❌ | ✅ `setalink-vX.Y.Z-universal.apk` (~85 MB) |
| x86 / x86_64 | ❌ | ❌ intentionally excluded (`ndk.abiFilters`) — libxray/libtun2socks ship no x86 builds, so an x86 APK would install but never connect |

32-bit native binaries added at
`android/app/src/main/jniLibs/armeabi-v7a/`:

| Binary | Source | Verification |
|---|---|---|
| `libxray.so` | Official `Xray-linux-arm32-v7a.zip` v26.3.27 (XTLS/Xray-core releases) | SHA-256 verified against the published `.dgst`; ELF 32-bit ARM, statically linked |
| `libtun2socks.so` | Official `tun2socks-linux-armv7.zip` **v2.6.0** (same version as the arm64 build in use) | ELF 32-bit ARM, statically linked |

Both are *statically linked* pure-Go binaries — no bionic/libc dependency, so
they execute on any Android version from `nativeLibraryDir`. Note one
behavioural difference vs. the arm64 binary (an Android-NDK build): the static
build cannot use the platform DNS resolver. This does not affect SetaLink
because profiles dial servers **by IP** and the DNS profiles use
**DoH over IP literals** (1.1.1.1 / 8.8.8.8). The `localhost` DNS mode is
degraded on 32-bit builds (xray-internal lookups only; tunneled app DNS
packets are unaffected).

## 3. Android 9 / Android 10 compatibility (Galaxy J8 ships 8.1–10)

| Check | Android 9 (API 28) | Android 10 (API 29) |
|---|---|---|
| minSdk 24 ≤ device API | ✅ | ✅ |
| APK signature scheme v2 (required ≥ 11, supported 7+) | ✅ | ✅ |
| `useLegacyPackaging true` (libs extracted to `nativeLibraryDir`) | ✅ | ✅ |
| W^X exec restriction (API 29+: no exec from app data dir) | n/a | ✅ binaries exec from `nativeLibraryDir`, which is exempt |
| VpnService / foreground service usage | ✅ | ✅ |

**The J8's Android version was never the problem — only its ABI.**

## 4. Samsung J8 package limitations

- **APK size**: 48.5 MB (arm32) — no Android or Samsung package-size limit
  applies (limits exist only for Play Store bundles, not sideloading).
- **Storage**: J8 ships with 32/64 GB; install needs ~160 MB free
  (APK + extracted libs + dex). Only a nearly-full device would fail, and that
  produces a different error message.
- **Signature conflict**: ruled out — no previous installation existed.
- **WhatsApp transfer**: APKs are sent as documents (no transcoding); the
  download completing and the install *starting* proves the file was parsed
  fine. A corrupt file fails earlier with "There was a problem parsing the
  package."

## 5. What changed in v0.9.28

1. `splits.abi` now includes `armeabi-v7a`; `universalApk true`.
2. `ndk.abiFilters 'arm64-v8a','armeabi-v7a'` keeps the universal APK ARM-only.
3. `doNotStrip` extended to the armeabi-v7a xray/tun2socks binaries.
4. `scripts/release.sh` publishes three artifacts per release + symlinks:
   - `releases/stable/setalink-latest.apk` (arm64, default — OTA unchanged)
   - `releases/stable/setalink-latest-arm32.apk` (**send this to the J8 tester**)
   - `releases/stable/setalink-latest-universal.apk`
   - `version.json` gains `apkUrlArm32` / `apkUrlUniversal` (additive; old
     clients ignore them).
5. Device registration now stores `manufacturer`, `model`, `sdk_version`,
   `android_version` (the app already sent these — the server dropped them)
   plus new `abi` from `Build.SUPPORTED_ABIS`.
6. OTA install outcome reporting: tapping "update" persists a marker; on next
   boot the app compares the running versionCode against the target and
   reports `install_success` / `install_failure` to the backend.
7. New admin page **Install Diag**: app-version / Android-version / ABI
   distributions, device models with 32-bit flags, and install-failure events.

## 6. Verification performed — and its limits

- ✅ `aapt dump badging`: all three APKs — minSdk 24, targetSdk 34, correct
  `native-code` sets.
- ✅ `apksigner verify`: all signed with the production SetaLink release key.
- ✅ 32-bit binaries: official artifacts, SHA-256 checked, correct ELF class,
  full size inside the APK (not stripped).
- ⚠️ **Not executed on a physical 32-bit device** — this server is x86-64 with
  no qemu. The arm32 APK installs/parses correctly by static analysis, but the
  J8 tester must confirm install **and** a successful VPN connection before
  this is called fixed (see `feedback_verify_on_live_server`).

## 7. Released artifacts — v0.9.28 verification matrix

All verified with `aapt dump badging` + `apksigner verify` on 2026-06-11.
Common: `com.setalink`, versionCode **38**, versionName **0.9.28**,
minSdk **24**, targetSdk **34**, signature **valid** (production key).

| Artifact | native-code | Size | SHA-256 |
|---|---|---|---|
| `setalink-v0.9.28.apk` (default / `setalink-latest.apk`) | arm64-v8a | 53,382,500 B (51 MB) | `832768aa35ca06131954894b86dee77532cade9c47b9e98b33f8072653e18e8c` |
| `setalink-v0.9.28-arm32.apk` (`setalink-latest-arm32.apk`) | armeabi-v7a | 48,586,108 B (47 MB) | `bb6eb9440fd0925e37dcd259a13caac8b245ba322eb608b5d7fff53adbe252a1` |
| `setalink-v0.9.28-universal.apk` (`setalink-latest-universal.apk`) | arm64-v8a + armeabi-v7a | 74,074,694 B (71 MB) | `a154889a2c19fd0b42711ecf47bfbc8e5ea617f3d003f1141d331a8b01e32303` |

`setalink-latest.apk` (default download + OTA) still points to the **arm64**
build — the same ABI users already run — so nothing was replaced blindly.
The compat/universal APKs are opt-in links on the download page until a
32-bit device confirms them in the field.

## 8. Action for the tester

Send the J8 tester: `https://setalink.no/releases/stable/setalink-latest-arm32.apk`
(or the universal APK if in doubt about the device). Ask for: install result,
connect result, and a screenshot of Settings → About if anything fails.
