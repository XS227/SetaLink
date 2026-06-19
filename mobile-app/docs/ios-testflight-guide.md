# Realink iOS — TestFlight Distribution Guide

## Prerequisites checklist

- [ ] Apple Developer account (paid, $99/year) — developer.apple.com
- [ ] App Store Connect access — appstoreconnect.apple.com
- [ ] macOS machine with Xcode 15+ installed
- [ ] Homebrew, Node 20, CocoaPods (`sudo gem install cocoapods`)

---

## 1. Register Bundle ID

1. Go to **developer.apple.com → Certificates, IDs & Profiles → Identifiers**
2. Click **+** → **App IDs** → **App**
3. Set:
   - Description: `Realink`
   - Bundle ID (Explicit): `no.setalink.realink`
4. Enable these **Capabilities**:
   - **Network Extensions** (required for VPN/Packet Tunnel)
   - **Keychain Sharing**
5. Click **Register**

---

## 2. Create App Store Connect App

1. Go to **appstoreconnect.apple.com → My Apps → +**
2. Fill in:
   - Platform: iOS
   - Name: `Realink`
   - Primary Language: English (UK)
   - Bundle ID: `no.setalink.realink` (from step 1)
   - SKU: `realink-ios`
3. Save

---

## 3. Provisioning Profiles

### Distribution certificate (if you don't have one)
1. **Keychain Access → Certificate Assistant → Request from CA** → save `.certSigningRequest`
2. **developer.apple.com → Certificates → +** → **Apple Distribution**
3. Upload `.certSigningRequest`, download `.cer`, double-click to install
4. Export as `.p12` from Keychain (right-click the cert) — save password

### App Store provisioning profile
1. **developer.apple.com → Profiles → +** → **App Store**
2. Select bundle ID: `no.setalink.realink`
3. Select your distribution certificate
4. Name it: `Realink AppStore`
5. Download `Realink_AppStore.mobileprovision`

---

## 4. First macOS build (one-time setup)

```bash
# 1. Install dependencies
cd mobile-app
npm install

# 2. Install pods (generates Realink.xcworkspace)
cd ios
pod install
cd ..

# 3. Open in Xcode
open ios/Realink.xcworkspace
```

### In Xcode:
1. Select the **Realink** target → **Signing & Capabilities**
2. Under **Release** config:
   - Team: your Apple team
   - Signing: **Manual**
   - Provisioning Profile: `Realink AppStore`
3. Click **Product → Archive**
4. In the Organizer, click **Distribute App → App Store Connect → Upload**

---

## 5. GitHub Actions CI (automated)

### Required secrets (Settings → Secrets → Actions):

| Secret | Value |
|--------|-------|
| `IOS_CERTIFICATE_BASE64` | `base64 -i YourCertificate.p12` |
| `IOS_CERTIFICATE_PASSWORD` | Your `.p12` export password |
| `IOS_PROVISIONING_PROFILE_BASE64` | `base64 -i Realink_AppStore.mobileprovision` |
| `IOS_PROVISIONING_PROFILE_NAME` | `Realink AppStore` |
| `APPLE_TEAM_ID` | Your 10-char team ID (e.g. `AB12CD34EF`) |
| `ASC_KEY_ID` | App Store Connect API key ID |
| `ASC_ISSUER_ID` | App Store Connect issuer ID |
| `ASC_PRIVATE_KEY` | Contents of `.p8` API key file |

### Generate App Store Connect API key:
1. **appstoreconnect.apple.com → Users and Access → Keys → +**
2. Name: `Realink CI`, Access: **App Manager**
3. Download `.p8` file (save — only downloadable once)
4. Note the **Key ID** and **Issuer ID** from the keys page

### Trigger a build:
```bash
# Push a tag to trigger automatically
git tag v0.9.47-ios
git push origin v0.9.47-ios

# Or trigger manually from GitHub Actions UI
```

---

## 6. TestFlight setup

### Internal testing (immediate):
1. App Store Connect → Your App → **TestFlight**
2. Your build appears after processing (~10-15 min)
3. Add yourself and team members as **Internal Testers**
4. Tap the link in the TestFlight email

### External beta group (for Iran testers):
1. TestFlight → **External Groups → +**
2. Name: `Beta Testers — Iran`
3. Add the processed build
4. Submit for **Beta App Review** (Apple reviews once, ~1-2 days)
5. After approval, create a **Public Link** — share this with testers

---

## 7. Instructions for beta testers

Share this with Iranian testers:

---

**نصب Realink روی iPhone:**

1. از App Store برنامه **TestFlight** را نصب کنید
2. روی لینک زیر ضربه بزنید (لینک بتا): `[public TestFlight link here]`
3. در TestFlight روی **Install** ضربه بزنید
4. برنامه Realink نصب می‌شود
5. برای ارسال بازخورد، در TestFlight روی **Send Feedback** ضربه بزنید

**Beta tester instructions (English):**

1. Install **TestFlight** from the App Store
2. Tap the beta link: `[public TestFlight link here]`
3. Tap **Install** in TestFlight
4. Open Realink — it works immediately, no device registration needed
5. Tap **Send Feedback** in TestFlight to report issues or screenshots

---

## 8. Apple requirements and entitlements

### Required entitlements (already in `Realink.entitlements`):
- `com.apple.developer.networking.networkextension` — for VLESS/Xray packet tunneling
- `keychain-access-groups` — for secure token storage

### Network Extension note:
The current `XrayModule.swift` uses **NEVPNManager** as a stub. For a real
Packet Tunnel Provider (which runs Xray-core):

1. Add a **Network Extension** target in Xcode:
   - File → New Target → Network Extension → Packet Tunnel Provider
2. Add `libXray.xcframework` to that extension target
3. Implement `NEPacketTunnelProvider` with `packetFlow` to forward traffic
4. Replace the stub `XrayModule.swift` with IPC to the extension

For TestFlight MVP, the current stub connects via the system VPN manager —
adequate for testing the UI and Apple Safe Mode flows.

### Apple Safe Mode (iOS):
On iOS, "Apple Safe Mode" refers to bypassing with SNI mimicry (cloudflare.com).
The existing `rc_iran_sni_order` remote config drives this — no iOS-specific
code change needed. The VPN extension will use the same VLESS+Reality config.

---

## 9. App Store Review notes (for when you submit for production)

Apple will require:
- **Privacy Policy URL** — update in App Store Connect before submission
- **VPN justification** — use the NSVPNUsageDescription in Info.plist (already set)
- **Export compliance** — answer "Yes, uses encryption" → select "Exempt" (standard HTTPS)
- **App category**: Utilities → VPN & Proxy

Network Extension / VPN apps are reviewed more carefully. Expect 3-5 day review.
Mention "privacy tool for users in regions with internet restrictions" in review notes.

---

## File map

| File | Purpose |
|------|---------|
| `ios/Realink.xcodeproj/project.pbxproj` | Xcode project (bundle ID, build settings) |
| `ios/SetaLink/AppDelegate.swift` | App entry — `moduleName = "Realink"` |
| `ios/SetaLink/Info.plist` | Bundle metadata, URL scheme, permissions |
| `ios/SetaLink/Realink.entitlements` | Network Extension + keychain entitlements |
| `ios/SetaLink/LaunchScreen.storyboard` | Splash screen |
| `ios/SetaLink/Images.xcassets/` | App icon (add 1024×1024 PNG here) |
| `ios/Podfile` | CocoaPods target = Realink |
| `ios/.xcode.env` | NODE_BINARY path for Metro bundler |
| `.github/workflows/ios-testflight.yml` | CI → archive → TestFlight upload |
