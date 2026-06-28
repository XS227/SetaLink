# TestFlight Distribution Checklist

## Internal testing (immediate — no Apple review)

- [ ] Build uploaded and "Ready to Test" in App Store Connect
- [ ] Internal group members added in TestFlight → Internal Testing
- [ ] Each tester installs TestFlight app from App Store (one-time)
- [ ] Testers accept invite email → install build via TestFlight
- [ ] Tester can see correct version number in TestFlight app

## External testing (requires Apple review — 1–3 days)

- [ ] Build submitted for review: TestFlight → External Groups → Add Build
- [ ] Review notes provided (what to test, test account if needed)
- [ ] Status changes from "Waiting for Review" → "Testing" (Apple approved)
- [ ] External testers receive notification or install via public TestFlight link

## Build expiry

- [ ] TestFlight builds expire after **90 days** — plan new builds accordingly
- [ ] Users on expired builds see a "This beta has expired" error
- [ ] App Store submission resets the clock (App Store version never expires)

## Concurrent builds

- [ ] Only ONE build under external review at a time per app
- [ ] A new upload while one is "Waiting for Review" does NOT cancel the previous one —
      submit the new build to the external group only after the previous is approved or rejected

## Diagnostics after distribution

- [ ] Admin Devices page: filter 🍎 iOS → testers' devices appear with correct `app_version`
- [ ] Session table: after a tester connects VPN, `probe_result` populates
- [ ] Check for unexpected `last_failure_category` on iOS devices

## Crashlytics / crash reports

- [ ] If Firebase Crashlytics is integrated: check crash-free rate in Firebase Console
- [ ] Without Crashlytics: ask testers to share Settings → Privacy → Analytics on device,
      or use Xcode → Devices & Simulators → View Device Logs

## Common issues

| Symptom | Likely cause |
|---------|-------------|
| Build stuck "Processing" >30 min | altool upload failed silently; check CI logs |
| "Missing compliance" warning | Need to declare export compliance (set NSAllowsArbitraryLoads or answer iTunes Connect questions) |
| "This app requires iOS X.X" | Minimum deployment target too high for tester's device |
| Admin shows `platform=android` | Tester is on Build 30 or earlier (pre-Platform.OS fix); will self-correct on next launch with Build 31+ |
| No VPN sessions in admin | Tunnel may be failing silently; ask tester for PacketTunnel logs: Settings → Privacy → Analytics → Analytics Data → search "Realink" |
