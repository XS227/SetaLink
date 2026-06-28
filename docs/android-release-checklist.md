# Android Release Checklist

Run this before every Android APK release.

## 1 — Version bump

- [ ] Bump `versionName` and `versionCode` in `android/app/build.gradle`
- [ ] `versionCode` must be strictly greater than the previous release (monotonically increasing)
- [ ] Run `scripts/release.sh` — it auto-syncs `src/utils/version.ts` from `build.gradle`

## 2 — Build

- [ ] Build runs on GitHub Actions (NOT on the VPS — OOM risk)
- [ ] Trigger CI: push `v{VERSION}` tag or dispatch `android-build.yml`
- [ ] CI produces: `setalink-v{VERSION}.apk` (arm64), `setalink-v{VERSION}-arm32.apk`, `setalink-v{VERSION}-universal.apk`

## 3 — Test APKs before publishing

- [ ] Install arm64 APK on a modern device (arm64-v8a) — should install cleanly
- [ ] Install arm32 APK on a 32-bit device (armeabi-v7a, e.g. Samsung J8) — "App not installed" = wrong ABI
- [ ] `aapt dump badging setalink-v{VERSION}.apk | grep native` — confirm `arm64-v8a` only in arm64 build
- [ ] `aapt dump badging setalink-v{VERSION}-arm32.apk | grep native` — confirm `armeabi-v7a` in arm32 build
- [ ] SHA-256 checksums computed and ready for `version.json`

## 4 — OTA update (version.json)

- [ ] Update `public/download/version.json`:
  - `version`: new versionName
  - `versionCode`: new versionCode (MUST match build.gradle)
  - `releaseDate`: today
  - `apkUrl`: arm64 APK URL
  - `apkUrlArm32`: arm32 APK URL
  - `apkUrlUniversal`: universal APK URL
  - `checksum.sha256`: SHA-256 of arm64 APK
  - `size`: file size in bytes of arm64 APK
  - Update `channels.stable` to match
- [ ] Copy APK files to `public/releases/stable/` or CDN

## 5 — Smoke test OTA

- [ ] Existing device on previous version: sees update banner 4s after launch
- [ ] Tapping "Download" initiates install (requires "Install unknown apps" permission)
- [ ] After install: app reports new `versionCode` on next registration

## 6 — Admin verification

- [ ] Install Diagnostics page: app version table shows new version appearing
- [ ] ABI table: arm64 and arm32 devices each counted correctly

## 7 — Release notes

- [ ] Update `version.json` `changelog` array with 1–3 bullet points
- [ ] Update `CHANGELOG.md` (if maintained)
