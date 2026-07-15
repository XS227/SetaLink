# RealGram — Build Size Budget

**Hard requirement, from the brief: RealGram must not become a huge APK/IPA
because it combines Telegram, ReaLink, Shahnameh, AdsGram, and referral
features.** This document records the *existing* ReaLink app's real baseline
(measured from this repo, not estimated) and sets a budget for RealGram
before any implementation starts.

No build was run to produce this baseline — per VPS operating rules, heavy
build commands are not run from an assessment session. Every number below is
either read from existing release documentation in this repo or explicitly
marked as needing a real build to measure.

## 1. Existing ReaLink app — current baseline (source: `mobile-app/docs/APK_COMPATIBILITY_REPORT.md`, 2026-06-11)

| Variant | Size | Note |
|---|---:|---|
| `arm64-v8a` (default release) | ~53 MB | Default distributed APK |
| `armeabi-v7a` (32-bit) | ~49 MB | Added after a real-world install failure on a Samsung Galaxy J8 — 32-bit-only devices are a meaningful share of the budget-device market in Iran |
| `universal` (both ABIs) | ~85 MB | Not the default distribution |
| x86 / x86_64 | Intentionally excluded | `libxray`/`libtun2socks` ship no x86 builds — an x86 APK would install but never connect |

Native binaries contributing to size: `libxray.so` (from official
`Xray-linux-arm*.zip` releases), `libtun2socks.so` (from official
`tun2socks-linux-arm*.zip` v2.6.0) — both statically linked, per-ABI.

**Current release config** (`mobile-app/android/app/build.gradle`,
read directly): `minSdkVersion 24`, `targetSdkVersion 34`,
`versionCode 83` / `versionName "0.9.56"`, ABI splits enabled
(`arm64-v8a`, `armeabi-v7a`).

**Quick win, unrelated to RealGram but flagged because it was found during
this assessment:** the release build config currently has
**`minifyEnabled false` and `shrinkResources false`.** Code/resource
shrinking is off on the existing app. Enabling it is a candidate low-risk
size reduction for the *base* ReaLink app, independent of anything RealGram
adds — worth doing regardless of the RealGram decision, but verify it
doesn't break the native Xray/tun2socks JNI loading path before shipping
(ProGuard/R8 can strip things it thinks are unused but are actually loaded
via JNI/reflection).

## 2. iOS baseline — not measured

`mobile-app/ios/Realink.xcodeproj` exists with a `PacketTunnelExtension`
target (bundle IDs `no.setalink.realink` / `no.setalink.realink.tunnel`).
**No current IPA/archive size figure was found in the repo.** A real Xcode
archive build is needed to establish this baseline — flagged as a TODO for
whichever agent has a macOS/Xcode build environment available.

## 3. What RealGram adds — unmeasured, needs the spike

Per `ARCHITECTURE.md` §2, the *recommended* architecture reuses the existing
Xray-core binary via local SOCKS5 rather than duplicating the VPN stack —
this specifically exists to avoid adding a second copy of `libxray.so`/
`libtun2socks.so`. What's genuinely new and unmeasured:

| Addition | Status |
|---|---|
| TDLib binary (per-ABI native library) | Size unknown — must be measured in the technical spike (`IMPLEMENTATION_PLAN.md` §Spike) |
| RealGram chat UI code (JS/RN bundle growth) | Unmeasured — depends on implementation |
| Gold/locale design system assets (fonts for 4 locales, icons) | Unmeasured — see §4 targets below |
| Shahnameh/REAL reaction pack (if built) | Should be ~0 MB in the base package — see rule below |

## 4. Budget targets for RealGram (proposed, confirm before implementation)

- No unexplained size increase larger than **5 MB per feature** added.
- **No duplicated Xray binary** — confirm the spike's chosen architecture
  (`ARCHITECTURE.md` §3, Option 1 vs 2) doesn't end up bundling a second
  copy of `libxray.so` per app if RealGram ships as a separate app.
- **No bundled Shahnameh media/game assets** — Shahnameh stays remote
  (WebView/Mini App) or on-demand, per `INTEGRATION_MAP.md` §1.
- **No unnecessary video/audio assets** shipped in the base package.
- **No duplicate font families** across the four locale profiles where a
  shared face can cover more than one script adequately — audit before
  adding a dedicated face per locale.
- **ABI-specific delivery** — continue the existing arm64/armeabi-v7a split
  pattern; do not default to universal APKs.
- Prefer **Android App Bundle (AAB)** split delivery over a monolithic
  universal APK where the distribution channel allows it — note this is in
  tension with the "sideload/direct-APK-first" distribution plan in
  `APP_STORE_COMPLIANCE.md`; AAB requires Play Store distribution to split
  correctly, so the sideload channel likely still needs per-ABI APKs
  regardless.
- Strip debug symbols from release builds; enable resource shrinking and
  code shrinking (see the "quick win" in §1 — extend the same fix to any new
  RealGram module).
- Use WebP/AVIF for raster images, vector formats (SVG-equivalent) for small
  UI icons.
- **Lazy-load or remotely fetch optional packs** — Shahnameh assets, any
  reaction pack, promotional media. Core messaging and connectivity must
  work fully without downloading any optional package.
- Cache downloaded on-demand assets with versioning and a size limit.
- Evaluate feature modules / on-demand delivery (Android Dynamic Feature
  Modules or equivalent) for genuinely optional surfaces once the app has
  more than a couple of "optional" features.
- Audit ProGuard/R8 rules when shrinking is enabled (see §1 caveat about
  JNI/reflection-loaded native code).
- Do not include development artifacts (debug builds, test certificates,
  unused locale/language packs bundled by a dependency by default) in
  release packages.

## 5. CI size check — to build, not built yet

A CI step is required, not optional, before RealGram ships past the spike
stage:

1. Build the release artifact.
2. Record its size (per ABI variant).
3. Compare against the previous accepted baseline (start with the numbers
   in §1 for the base app; establish a RealGram-specific baseline once the
   spike produces a first build).
4. Fail or warn when the agreed threshold (§4) is exceeded.
5. Document the exact size delta in the commit/PR that caused it — this is
   a process rule, not just a CI rule: every commit that changes bundled
   size should say by how much, in its message or PR description.

**Confirmed: this does not exist yet.** `mobile-app/.github/workflows/`
has three workflows — `ci.yml` (type-check/lint/test), `build-apk.yml`
(Android release APK build), `ios-testflight.yml` (iOS TestFlight deploy,
documents its own required secrets in a header comment: `ASC_KEY_ID`,
`ASC_ISSUER_ID`, `ASC_PRIVATE_KEY`, `APPLE_TEAM_ID`, optionally
`DISTRIBUTION_CERT_P12_BASE64` / `DISTRIBUTION_CERT_PASSWORD`). None of the
three records or gates on artifact size. Add the size-check as a new step in
`build-apk.yml` (and an iOS equivalent in `ios-testflight.yml`) rather than a
separate workflow, so it runs on every build that already produces the
artifact.
