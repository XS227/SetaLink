# iOS Release Checklist

Run this before every iOS TestFlight or App Store release.

## 1 — Version bump

- [ ] Update `MARKETING_VERSION` in `ios/Realink.xcodeproj/project.pbxproj` (all 4 entries via replace_all)
- [ ] Update `APP_VERSION` hardcoded string in `.github/workflows/ios-testflight.yml` "Sync version.ts" step (line ~315)
- [ ] Confirm `APP_BUILD` / `APP_BUILD_CODE` in `version.ts` will be overwritten by CI `$BUILD_NUMBER`
- [ ] Confirm Android version in `build.gradle` is separate and not accidentally bumped here

## 2 — OTA guard

- [ ] Verify `AppNavigator.tsx` OTA useEffect has `if (Platform.OS !== 'android') return;` guard
- [ ] Verify `SettingsScreen.tsx` shows "via TestFlight" label on iOS, not APK download button

## 3 — Platform detection

- [ ] All `registerDevice()` calls pass `Platform.OS` (not a hardcoded string)
- [ ] Run `grep -rn "'android'" src/` — confirm no hardcoded platform string at call sites

## 4 — Build the IPA

- [ ] Push tag `v{VERSION}-ios` (triggers `ios-testflight.yml`) OR dispatch workflow manually
- [ ] CI: "Sync version.ts" step runs and stamps correct version + build number
- [ ] CI: xcodebuild archives without error (check Actions log)
- [ ] CI: IPA uploaded to TestFlight (altool exit 0)
- [ ] CI: Artifact `Realink-{BUILD_NUMBER}.ipa` available in Actions → Artifacts

## 5 — TestFlight verification

- [ ] Log in to App Store Connect → TestFlight
- [ ] New build appears in processing (usually 5–15 min after upload)
- [ ] Build transitions from "Processing" to "Ready to Test"
- [ ] Internal testing group can install the build
- [ ] Add build to external testing group if targeting external testers

## 6 — Smoke test on device

- [ ] App launches without crash
- [ ] `version` shown in Settings → About matches expected `v{VERSION} · Build {BUILD_NUMBER}`
- [ ] Registration completes (admin panel shows device with `platform=ios`, `app_version={VERSION}`)
- [ ] VPN connect → probe succeeds → admin shows session
- [ ] No APK update banner appears
- [ ] Settings → Updates shows "via TestFlight"

## 7 — Admin verification

- [ ] Admin Devices page: filter by 🍎 iOS → new device appears
- [ ] Device detail modal: Platform shows 🍎 iOS
- [ ] Device detail modal: App version shows correct version
- [ ] Session table: probe_result populated (ok/fail/unknown) after first VPN session

## 8 — CI secrets health

- [ ] `DISTRIBUTION_CERT_P12_BASE64` is set and not expired (cert valid 1 year from issue)
- [ ] `ASC_PRIVATE_KEY` (AuthKey_XXXXX.p8) is set (does not expire)
- [ ] Run date: Distribution cert expiry is `_______` (check Keychain / App Store Connect)
