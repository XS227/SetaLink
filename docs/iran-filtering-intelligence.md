# Iran Filtering Intelligence — Watchlist & Event Log

Maintained by: ReaLink team. Reviewed before every major VPN/network release.
See also: `docs/CLAUDE_REALINK_RULES.md` for the standing protocol rule.

---

## Part A — Sources to Monitor

### Primary: GitHub Discussions & Issues

| Source | URL | Review cadence | What to watch |
|--------|-----|----------------|---------------|
| **net4people/bbs** | `github.com/net4people/bbs` | Weekly | Iran threads; new blocking patterns; SNI/TLS fingerprint changes; Reality bypasses |
| **Xray-core releases** | `github.com/XTLS/Xray-core/releases` | Every release | Reality protocol changes; VLESS upgrades; splice mode; new fingerprint support |
| **sing-box releases** | `github.com/SagerNet/sing-box/releases` | Every release | hysteria2; QUIC/Tuic updates; multiplex changes; Iran-specific workarounds |
| **v2ray-core** | `github.com/v2ray/v2ray-core/releases` | Monthly | Protocol compatibility; VMess/VLESS specification changes |
| **XTLS/RealiTLScanner** | `github.com/XTLS/RealiTLScanner` | On new release | Reality detection tools — if they advance, DPI gets easier |
| **v2fly/domain-list-community** | `github.com/v2fly/domain-list-community` | Monthly | Which SNIs are being blocked in Iran; known-good/bad domain lists |
| **XTLS/Xray-examples** | `github.com/XTLS/Xray-examples` | Monthly | Best-practice Reality/VLESS configs; fallback changes |
| **SagerNet/badvpn** | Related tun2socks forks | Occasionally | Tunnel routing changes relevant to iOS/Android clients |

### GitHub Search Terms (Run Weekly)

Run these searches on GitHub with filter: **updated in the last 7 days**

```
iran internet filtering
iran VPN blocking
Reality iran
xray iran blocked
VLESS Reality iran
DPI iran fingerprint
SNI filtering iran
iran mobile ISP filtering
iran MTN irancell 3G blocking
iran TCI filtering 2025 2026
iran Hamrah Aval VPN
iran cloudflare SNI block
xray tls fingerprint detection iran
reality vision flow iran block
```

### Iran-Focused Projects & Research

| Project | URL | What it tracks |
|---------|-----|----------------|
| **OONI Iran** | `ooni.org/country/ir` | Censorship measurement; blocked protocols; blocked sites |
| **IODA** | `ioda.live` | Internet disruption detection; throttling events; outage timing |
| **Cloudflare Radar — Iran** | `radar.cloudflare.com/ir` | Traffic anomalies; protocol adoption; outage detection |
| **RIPE Atlas — Iran** | `atlas.ripe.net` | BGP routing changes; ISP-level disruptions |
| **Censored Planet** | `censoredplanet.org` | Automated blocking detection; SNI/TLS/DNS measurements |
| **Lantern** | `github.com/getlantern/lantern` | Active countermeasures against Iran DPI; dials/transport changes |
| **Psiphon research** | `psiphon.ca/research` | Protocol survival data; Iran-specific reports |
| **GreatFire.org** | `en.greatfire.org` | Blocked domains; SNI allowlists from ISPs |
| **AccessNow** | `accessnow.org/keepiton` | Shutdown reports; throttling documentation |
| **Iran Human Rights** | `iranhr.net/en/articles` | Shutdown event documentation with dates |

### Telegram Channels / Communities (Monitor Passively)

- `@v2rayng_official` — V2RayNG user reports; new blocks announced in comments
- `@Sefilter` — Iran filtering news (Farsi)
- `@mahsaiv` — Mahsa Amini era / ongoing filtering developments
- `@irandpi` — Deep Packet Inspection reports for Iran
- Our own support: `@SetaLink3` — user reports of connection failures; first signal of new blocking

---

## Part B — Event Log Format

When a filtering event or risk is identified, log it here using the template below.

```
### [DATE] — [SHORT TITLE]
- **Source**: [URL or channel]
- **What changed**: [Specific protocol, SNI, ISP, port, or behavior that changed]
- **Risk to ReaLink**: [Low / Medium / High / Urgent] — [Why it matters for our users]
- **Suggested action**: [Config change / protocol add / SNI update / node addition / monitoring only]
- **Status**: [Pending / In progress / Applied / Monitoring / N/A]
- **Applied in**: [version/commit if action was taken]
```

---

## Part C — Filtering Event Log

Events are newest-first. Prefix status with ✅ (resolved), ⚠️ (active), 🔍 (monitoring), 📋 (documented).

---

### [2026-06-16] — SNI acceptance fix: cloudflare.com-first

- **Source**: Internal investigation (`project_sni_acceptance_truth.md`)
- **What changed**: Discovered nodes only accept `www.cloudflare.com` as SNI; app was trying microsoft.com and others first — failing before reaching cloudflare.com
- **Risk to ReaLink**: **High** — users unable to connect unless they happened to try cloudflare.com SNI
- **Suggested action**: Reorder iran_sni_order to put `www.cloudflare.com` first
- **Status**: ✅ Applied in commit `1a8dd57` / rc_iran_sni_order config key
- **Applied in**: v0.9.40+

---

### [2026-06-10] — OTA false-update loop (SNI-unrelated but was active issue)

- **Source**: Internal audit (`project_audit_2026_06_10.md`)
- **What changed**: App fetched version.json, saw higher version number, triggered endless "Update available" loop
- **Risk to ReaLink**: **Medium** — users couldn't suppress update prompt; caused crashes and confusion
- **Suggested action**: Fix OTA version check logic, add build-number dedup
- **Status**: ✅ Applied in v0.9.30+

---

### [2026-05-15] — oracle.com SNI blocked in Iran

- **Source**: Internal investigation (`project_iran_investigation.md`)
- **What changed**: `oracle.com` SNI started being DPI-blocked by at least Irancell / MTN; connections using oracle SNI dropped to ~0% success
- **Risk to ReaLink**: **Urgent** — main SNI profile at time was oracle-based
- **Suggested action**: Switch SNI to `www.microsoft.com`; implemented AI optimizer for SNI ranking
- **Status**: ✅ Applied in AI optimizer / config change
- **Applied in**: v0.9.24+

---

## Part D — Node Health Quick Reference

Current VPN nodes:

| Node | IP | Provider | Status | Notes |
|------|-----|----------|--------|-------|
| Main (DE) | 178.104.77.231 | Hetzner | ✅ Healthy | Primary Reality node; 3x-ui on port 443 |
| Helsinki (FI) | 65.109.183.7 | Hetzner | 🔍 Test-only | `fi.setalink.no`; NOT in user routing |

Desired additions (priority order):
1. **NL/Amsterdam** — Cloudflare AS13335 or Leaseweb — low latency to Iran, AS diversity
2. **SE/Stockholm** — Bahnhof or Tele2 — good Iran routing via TeliaNet
3. **TR/Istanbul** — low ping from Iran; caution: Turkish DPI is also active
4. **AE/Dubai** — very low ping from Iran; DU Telecom or Zain have good Iran links

---

## Part E — Protocol Risk Assessment (Current)

| Protocol | Iran success rate | Risk | Notes |
|----------|-----------------|------|-------|
| VLESS + Reality + cloudflare.com | ~85% (when SNI is right) | Medium | SNI burns happen; need SNI rotation |
| VLESS + Reality + microsoft.com | ~70% | Medium | Was primary; now backup |
| VLESS + XHTTP (edge.setalink.no) | ~40% | High | Edge server SNI visible; nginx fingerprint recognizable |
| VLESS + WebSocket | ~35% | High | WebSocket upgrade headers are a DPI signal |
| VLESS + HTTPUpgrade | ~30% | High | HTTPUpgrade is well-documented, DPI-known |
| Shadowsocks | N/A | — | Not implemented; obfuscation-based; consider for fallback |
| Hysteria2 | N/A | — | QUIC-based; hard to block; consider for severe blocks |
| Reality + Vision flow | ~80% | Medium | Vision splice mode is strong; requires TLS 1.3 capable endpoint |

---

## Part F — SNI Burn Tracking

Track which SNIs have been observed failing in Iran with dates. Remove from priority when confirmed burned.

| SNI | Status | First seen blocked | Confirmed by | Notes |
|-----|--------|-------------------|--------------|-------|
| `www.oracle.com` | 🔴 Burned | 2026-05 | Internal test | Blocked by Irancell at minimum |
| `www.speedtest.net` | 🟡 Degraded | 2026-06 | User reports | Works sometimes; Irancell intermittent |
| `www.cloudflare.com` | 🟢 Working | — | Internal + user test | Primary; monitor closely |
| `www.microsoft.com` | 🟢 Working | — | Internal + user test | Backup |
| `www.bing.com` | 🟢 Working | — | Internal test | Backup |
| `www.apple.com` | 🟢 Working | — | Internal test | Use Safari fingerprint |
| `www.samsung.com` | 🟢 Working | — | Internal test | Galaxy fingerprint |
| `alt.setalink.no` | 🔴 Never worked | — | Internal | Fake domain; removed in e3e857b |

---

## Part G — Recommended Monitoring Routine

**Weekly (takes ~15 minutes):**
1. Check net4people/bbs for new Iran threads (search: "iran" in discussions)
2. Scan Xray-core and sing-box releases for anything Iran-relevant
3. Check our Telegram `@SetaLink3` for user connection reports — look for spikes
4. Run admin `Iran Debug` page → check if success rate dropped > 5% week-over-week
5. Run admin `Node Health` tab → confirm main node is `healthy`

**Before every TestFlight / APK release:**
1. Check for new Xray-core release — upgrade if meaningful (Reality fixes, fingerprint updates)
2. Check OONI Iran latest measurements — any new protocol blocks?
3. Verify iran_sni_order remote config still matches working SNIs in `Part F`
4. Review any user-reported failures since last release

**Monthly:**
1. Full search sweep using terms from Part A
2. Update `Part F` SNI burn tracking
3. Review node health scores — add new node if main node's Iran success < 60%
4. Check Cloudflare Radar Iran for traffic pattern anomalies
5. Update this document with any new intelligence

---

## Part H — Action Templates

**If a new SNI is burned:**
```
1. admin → Config → rc_iran_sni_order → remove burned SNI, add replacement
2. Log event in Part C above
3. Notify team
4. Monitor success rate for 48h after change
```

**If Reality is blocked at protocol level:**
```
1. admin → Config → push emergency_profiles with WebSocket/XHTTP credentials
2. Set kill_switches = ["VLESS + Reality"] to skip Reality probes
3. Set up new node with Shadowsocks / Hysteria2 (requires new APK release)
4. Log event in Part C
5. Priority: Urgent
```

**If main node IP is blocked:**
```
1. Spin up new Hetzner node (Helsinki node fi.setalink.no is standby)
2. Update bootstrap credentials in api.php hardcoded_bootstrap()
3. Push new node via admin remote config → emergency_profiles
4. Log event in Part C
5. Priority: Urgent
```
