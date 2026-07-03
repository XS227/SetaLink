# Smart Mode / Iran Bypass — design & rule delivery

## What ships in the app (implemented)

- Bundled, versioned rule list: `src/services/iranBypassRules.ts`
  (`BYPASS_RULES_VERSION = 1`). Admin-curated only.
- When Smart Mode is ON, `xrayConfigBuilder` inserts one `domain → direct`
  routing rule (`.ir` TLD + known Iranian services, banks, shaparak,
  my.gov.ir) after the dns-out rule and before the UDP/443 blackhole.
  Everything else keeps the exact pre-feature behavior; Smart Mode OFF
  produces a byte-identical config (unit-tested).
- Android additionally supports per-app bypass
  (`VpnService.addDisallowedApplication`), selected in Settings →
  Bypass Apps. **iOS does not and will not fake app-level split
  tunneling** — Apple only allows per-app VPN under MDM; iOS Smart Mode
  is domain-based only and the UI copy says so.

## Why geoip:ir / geosite:ir are OFF

The rule entries exist (`geoip-ir`, `geosite-ir`) but ship `enabled: false`:
neither `geoip.dat` nor `geosite.dat` is bundled with LibXray in this app,
and an Xray config referencing a missing geo asset **fails to load,
killing the whole tunnel**. Enabling them requires:

1. Bundling the dat-files (~15 MB geosite / ~5 MB geoip, or the slim
   `iran.dat` community build) into both the Android assets and the iOS
   PacketTunnel bundle, and pointing `XRAY_LOCATION_ASSET` at them.
2. Flipping the two rules to `enabled: true`.

Until then, IP-literal connections to Iranian servers (no SNI/hostname to
sniff) still go through the VPN. Domain sniffing covers the overwhelming
majority of app/browser traffic.

## Future: remote rule updates (designed, NOT implemented)

Goal: update the bypass list without an app release.

- Endpoint: `GET https://setalink.no/api.php?action=routing-rules&mobile=1`
  (same PHP surface as bootstrap; alternatively `/v1/routing-rules`).
- Response: `{ ok: true, version: <int>, rules: BypassRule[] }` — the exact
  `BypassRule` shape bundled in the app (`id`, `type`, `value`, `platform`,
  `enabled`, `note`).
- Client behavior: fetch via `remoteConfigService` alongside bootstrap,
  cache locally, use remote list only when `version >` bundled version.
  `getBypassDomains()` already validates every entry defensively — a
  malformed remote rule is skipped, an unparsable payload falls back to
  the bundled list, and the tunnel can never fail to start because of a
  bad rule (unit-tested).
- Admin flow: rules are edited in the admin panel (settings table, same
  pattern as `bootstrap_alt_profiles`) by admins only. **User-submitted
  rules must never go live automatically** — there is no client path that
  accepts rules from anywhere but the bundled list today, and the future
  remote source is the admin-controlled endpoint above.

## Test matrix (phase 6)

| # | Case | Where verified |
|---|------|----------------|
| 1 | instagram.com still through VPN | unit test (not in rule list) |
| 2 | .ir bypasses | unit test (`domain:ir` present) |
| 3 | digikala.com bypasses | unit test |
| 4 | Telegram still through VPN | unit test (no telegram rule) |
| 5 | Android bypass app skips VPN | needs on-device test (next build) |
| 6 | Smart Mode OFF = old behavior | unit test (byte-identical JSON) |
| 7 | Diagnostics show routing mode | code path in diagnosticsExport |
| 8 | No server-selection regression | unit test (proxy outbound unchanged) |
| 9 | Malformed rule list → no crash | unit test (defensive validation) |
