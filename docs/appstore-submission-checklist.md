# App Store Submission Checklist

## Before you submit

### App metadata (App Store Connect → App Information)

- [ ] **Name**: "Realink" (max 30 chars)
- [ ] **Subtitle**: e.g. "Fast & Private VPN" (max 30 chars)
- [ ] **Primary category**: Utilities
- [ ] **Secondary category**: (optional) Productivity
- [ ] **Privacy Policy URL**: must be a live, publicly accessible URL
      (e.g. `https://setalink.no/privacy`)
- [ ] **Age rating**: complete the questionnaire — a VPN with no mature content rates 4+
- [ ] **Copyright**: "© 2026 Realink"

### App Store listing (per locale: EN, FA recommended)

- [ ] **Description**: 4000 chars max; describe VPN features, no mention of
      circumvention of national restrictions (App Store guideline 5.2.1)
- [ ] **Keywords**: comma-separated, 100 chars max; include: VPN, proxy, privacy,
      secure, internet (no competitor names, no misleading terms)
- [ ] **Promotional text**: 170 chars; appears above description; can be updated
      without a new submission

### Screenshots (required)

Each device size must have at least 1 screenshot. Maximum 10 per size.

| Size | Label | Pixels |
|------|-------|--------|
| 6.7" | iPhone 16 Plus / 15 Plus | 1320 × 2868 or 1290 × 2796 |
| 6.1" | iPhone 16 / 15 | 1179 × 2556 or 1170 × 2532 |
| 5.5" | iPhone 8 Plus (optional) | 1242 × 2208 |
| iPad Pro 13" | required if iPad supported | 2064 × 2752 |

- [ ] Screenshots captured on a physical device or Xcode Simulator
- [ ] No placeholder text or lorem ipsum visible
- [ ] Status bar shows clean time (9:41 AM) — use SimulatorStatusMagic or Xcode override
- [ ] No Apple hardware required in screenshots (guideline 3.2)

### App icon

- [ ] 1024 × 1024 PNG, no alpha channel, no rounded corners (App Store adds them)
- [ ] Matches the icon in the Xcode asset catalog
- [ ] Check: `ios/SetaLink/Assets.xcassets/AppIcon.appiconset/`

### Privacy nutrition label (App Store Connect → Privacy)

VPNs must declare data practices accurately:

- [ ] **Data Not Collected** (if you collect nothing linked to identity) OR
- [ ] **Usage Data**: app version, crash data (if Crashlytics enabled)
- [ ] **Device ID**: if stored server-side (Realink stores `device_id` — declare it)
- [ ] **User content** if messages / DMs feature is enabled
- [ ] Do NOT declare data you don't actually collect

### Export compliance

- [ ] Answer "Does your app use encryption?" → **Yes** (it uses TLS/VLESS/Reality)
- [ ] "Is it exempt?" → Usually **No** for a VPN app
- [ ] You may need to submit an annual self-classification report (BIS ENC):
      file at `https://bis.doc.gov` or attach the CCATS number in iTunes Connect

### Network Extension entitlement

- [ ] `NEVPNEnabled = true` in `Info.plist` ✓ (already set)
- [ ] App Groups entitlement matches: `group.no.setalink.realink` ✓
- [ ] PacketTunnel extension bundle ID: `no.setalink.realink.tunnel` ✓
- [ ] Network Extension entitlement requires App Review approval letter in some regions —
      check if Apple prompts for additional documentation during review

## Submission

- [ ] All builds passing TestFlight internal testing
- [ ] Version number is higher than any previously approved version
- [ ] Select the IPA build in "Prepare for Submission" tab
- [ ] Add what's new text (release notes) for this version
- [ ] Answer all App Review questions honestly
- [ ] Submit for review

## After approval

- [ ] "Release this version" → automatic or manual
- [ ] Update `version.json` with App Store version info (iOS doesn't use it, but good record-keeping)
- [ ] Announce to users via admin in-app message broadcast
- [ ] Monitor crash rates and session data in admin for 48 h post-launch

## Known risks

| Risk | Mitigation |
|------|-----------|
| App rejected for VPN guideline (4.1) | Ensure the app has a clear legitimate use; be transparent about proxy/VPN nature |
| Missing privacy policy | Host at setalink.no/privacy before submitting |
| Export compliance hold | File ENC paperwork proactively |
| Network Extension rejected | Apple may require additional review for NEPacketTunnelProvider — allow 7–14 days |
