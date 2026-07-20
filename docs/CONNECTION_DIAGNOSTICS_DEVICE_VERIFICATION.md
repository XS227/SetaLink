# Connection Diagnostics — real-device verification checklist

**Status: NOT YET RUN.** This session (Claude, dev-box shell) has no
physical Android/iOS device and no real Starlink/Wi-Fi/5G connectivity to
test from — everything in `feat/starlink-node-phase1` for this feature is
code-reviewed and `php -l`/manual-TS-reviewed only, never executed against a
real network. **Per Khabat's explicit instruction, PR #15 does not merge
until this checklist is run and passes on real hardware.** Whoever runs it
(Khabat, a tester, or Agent A) should fill in the ✅/❌ + notes columns below
and paste results back into this file (same async doc-driven pattern as
`STARLINK_WINDOWS_HANDOFF.md`) before requesting merge.

Prerequisite: an internal build with this branch's mobile-app changes,
installed on real test devices (see `CONNECTION_DIAGNOSTICS_ROLLOUT.md`
§2 Stage 0 for how to get there).

---

## 0. Before you start

- [ ] Backend deployed and smoke-tested (`CONNECTION_DIAGNOSTICS_ROLLOUT.md`
      §1 — the two `curl` checks and the empty admin page load).
- [ ] Test devices confirmed on the new build (Settings → About shows the
      new build number).
- [ ] `admin/index.php?page=diagnostics` open in a browser tab, `days=1`,
      ready to refresh after each test below.

## 1. Per-network-type test matrix

Run this full sequence — connect, wait ~10s past connect (long enough for
the async diagnostics probe, `DIAGNOSTICS_DELAY_MS=4000`, plus the probe
itself to finish), then check the admin page — **once per row**:

| # | Platform | Network | Node | Connect OK? | Diagnostics row appeared? | jitter_ms sane? | packet_loss_pct sane? | throughput measured? (Wi-Fi only) | Notes |
|---|---|---|---|---|---|---|---|---|---|
| 1 | Android | Wi-Fi | Starlink (`starlink-no-01`) | ☐ | ☐ | ☐ | ☐ | ☐ | |
| 2 | Android | Wi-Fi | fi-hel | ☐ | ☐ | ☐ | ☐ | ☐ | |
| 3 | Android | Cellular (note generation shown) | Starlink | ☐ | ☐ | ☐ | ☐ | n/a — must be skipped, see §2 | |
| 4 | Android | Cellular | fi-hel/primary | ☐ | ☐ | ☐ | ☐ | n/a — must be skipped | |
| 5 | iOS | Wi-Fi | Starlink | ☐ | ☐ | ☐ | ☐ | ☐ | |
| 6 | iOS | Wi-Fi | fi-hel | ☐ | ☐ | ☐ | ☐ | ☐ | |
| 7 | iOS | Cellular (note generation shown) | Starlink | ☐ | ☐ | ☐ | ☐ | n/a — must be skipped | |
| 8 | iOS | Cellular | fi-hel/primary | ☐ | ☐ | ☐ | ☐ | n/a — must be skipped | |

"Sane" for jitter/packet-loss means: jitter under ~2000ms and not `NaN`;
packet loss between 0-100 and not consistently 100% (100% every time would
mean the probe endpoint itself is unreachable, not real loss — check
`/speedtest/download` directly with `curl` from the SAME network if so).

## 2. Data-usage guardrail check (must pass before anything else matters)

- [ ] Rows 3, 4, 7, 8 above: confirm via the admin page that
      `throughput_down_kbps`/`throughput_up_kbps` were **NOT** measured on
      cellular (`n_throughput_down_kbps` should not increase for cellular
      connects). If it did fire on cellular, this is a real bug in
      `shouldRunThroughputTest()` / `connectionType.type` detection —
      **do not ship** until fixed, per the explicit "Iran cellular users pay
      per MB" reasoning in the architecture doc.
- [ ] Confirm the jitter/packet-loss probe (small, ~1.3 KB total) DOES still
      run on cellular — it's supposed to, only the heavier throughput leg is
      Wi-Fi-gated.

## 3. Node comparison sanity check (the actual original question)

- [ ] With rows 1, 2, 5, 6 filled in, open
      `admin/index.php?page=diagnostics`, "By Node" table. Confirm
      `starlink-no-01` and `fi-hel` both show real (`n > 0`) averages for
      RTT, jitter, packet loss, and throughput.
- [ ] Compare the two nodes' numbers. This is the number that answers the
      ORIGINAL complaint ("Starlink feels slow") — record what it actually
      shows here:
      - Starlink avg throughput down/up: `_______` / `_______` kbps (n=`__`)
      - fi-hel avg throughput down/up: `_______` / `_______` kbps (n=`__`)
      - Starlink avg jitter / packet loss: `_______` ms / `_______`%
      - fi-hel avg jitter / packet loss: `_______` ms / `_______`%

## 4. Failure-mode checks

- [ ] Turn on airplane mode mid-probe (or otherwise kill connectivity) —
      confirm the app does NOT crash or hang; the diagnostics report should
      simply never arrive (silent, per the `try {} catch {}` wrapping in
      `scheduleConnectionDiagnostics()`).
- [ ] Confirm no UI-visible change at all during the probe — no spinner,
      no visible network activity indicator specific to this feature. It
      must be fully invisible to the user (design constraint, architecture
      doc §"Design constraints").
- [ ] Reconnect several times in a row (5+) — confirm
      `admin/index.php?page=diagnostics` doesn't show runaway row counts (the
      6/min/IP rate limit on `/speedtest/*` should silently drop excess
      requests, not error visibly to the user).

## 5. Sign-off

- [ ] All of §1-§4 checked, notes filled in above.
- [ ] Any ❌ documented as a follow-up item (link an issue or a new
      `STARLINK_WINDOWS_HANDOFF.md` section) rather than silently ignored.
- [ ] Signed off by: `_______________` on `_______________` (date) —
      once this line is filled in, PR #15 can move from draft to ready for
      merge review.
