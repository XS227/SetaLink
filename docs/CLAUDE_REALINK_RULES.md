# Claude Code — Realink Permanent Rules

These rules override default Claude Code behavior for all Realink VPN/network work.
They apply to every conversation in this repository and must be re-read if any VPN,
protocol, node, or network decision is being made.

---

## Rule 1 — Check Iran Filtering Before Every Network/Protocol Release

Before any major Realink VPN/network release, check current Iran filtering and
circumvention developments from the approved watchlist in
`docs/iran-filtering-intelligence.md`.

**Do not rely on old assumptions.** Iran DPI capabilities change monthly.
If there are new blocking patterns, protocol changes, Xray/sing-box updates,
or GitHub reports relevant to Iran, summarize them in the event log and decide
whether Realink needs a config, telemetry, node, or protocol change.

Approved watchlist sources:
- `github.com/net4people/bbs` — weekly Iran threads
- Xray-core and sing-box release notes — every release
- OONI Iran: `ooni.org/country/ir`
- Cloudflare Radar Iran: `radar.cloudflare.com/ir`
- Telegram: `@SetaLink3` user connection failure reports
- GitHub searches: "iran internet filtering", "Reality iran", "DPI iran", "xray iran blocked"

Log every significant finding in `docs/iran-filtering-intelligence.md` Part C
using the event log format specified there.

---

## Rule 2 — Connected ≠ Working Unless Internet Traffic Is Verified

**Never claim a VPN fix is solved until verified by real device traffic.**

A "Connected" status means the tunnel is up. It does NOT mean:
- Internet traffic flows through the tunnel
- DNS is resolving through the tunnel
- Exit IP is the VPN server IP
- Iranian ISP DPI is not silently routing traffic elsewhere

Connected status must mean: internet traffic verified via the probe (HTTP/HTTPS
data received, not just TCP). Tunnel-only success (TCP connected, no internet)
is a **failure**. Log it as `internet_fail`, not `connect_ok`.

---

## Rule 3 — Every New Network Feature Needs Diagnostics and Admin Visibility

Never ship a new VPN/network/protocol feature without:
1. An admin dashboard panel showing its status and success rate
2. A telemetry event that uploads connect result, latency, and internet_ok flag
3. A failure path that is logged and surfaced to the admin

If you cannot add admin visibility in the same PR, block the feature from public
rollout until it is added. Hidden features cannot be debugged under Iranian filtering.

---

## Rule 4 — Prefer Backend-Controlled Configuration Over Hardcoded Client Config

Never hardcode Iran-specific behavior in the binary if it can be controlled by
remote config. Prefer:
- `rc_iran_sni_order` (settings table) over compiled SNI lists
- `emergency_profiles` (push via admin) over static fallbacks
- `node_health.json` + telemetry scores over static server rankings
- `altProfiles[]` from `/v1/servers/{id}/config` over client-side alt arrays

Adaptive configuration lets us respond to new blocking within minutes by pushing
a config change, without requiring a new APK or TestFlight build.

---

## Rule 5 — All Iran-Specific Changes Must Be Documented

Every change made in response to Iran filtering, censorship, or DPI must be
logged in `docs/iran-filtering-intelligence.md` Part C with:
- Date
- Source link or internal reference
- What changed in the environment
- Risk level (Low / Medium / High / Urgent)
- What action was taken
- Status (Pending / Applied / Monitoring)
- Version or commit where it was applied

This ensures the team can reconstruct blocking history and avoid re-introducing
burned SNIs, protocols, or IPs.

---

## Rule 6 — Never Trust Config Files on One Box as Ground Truth for Another

If the VPN server and the admin panel run on different machines (they do):
- Do NOT read `xray config.json` on the panel box and claim it reflects what the
  live VPN node is running.
- DO verify by testing a live Xray client connection to the production node.
- The Reality credentials, UUID, public key, and SNI on the live VPN box are the
  ground truth. The panel's settings table mirrors them for display; if they drift,
  the panel is wrong.

---

## Rule 7 — No Production Rollout of Multi-Node or Protocol Changes Without Explicit Approval

Any change that routes real user traffic to a new node, new protocol, or new
credential set requires explicit user approval before deployment.

"Planned" and "implemented" are different states. Code can be merged; routing
changes require a deliberate decision with user sign-off.

---

## Rule 8 — No Unrequested Tasks

Do not start or resume any task the user did not explicitly request in the
current conversation. When resuming after a context reset, identify the most
recent in-progress task by artifacts/commits and ask which task is meant
before proceeding.

---

## Appendix — Quick Reference

| Check | How |
|-------|-----|
| Current node status | Admin → Dashboard → Node Health |
| Iran success rate | Admin → Iran Debug → Iran Compatibility Score |
| Connect telemetry | Admin → Network Intel → Node Health Table |
| SNI burn status | `docs/iran-filtering-intelligence.md` Part F |
| Active filtering events | `docs/iran-filtering-intelligence.md` Part C |
| Emergency SNI push | Admin → Config → rc_iran_sni_order |
| Emergency profile push | Admin → Devices → push-emergency-profiles |
