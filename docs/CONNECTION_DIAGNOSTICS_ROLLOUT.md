# Connection Diagnostics — Android/iOS rollout plan

Companion to `docs/CONNECTION_DIAGNOSTICS.md` (architecture) and
`docs/CONNECTION_DIAGNOSTICS_API.md` (field reference). This is the plan for
how the new measurements actually start reaching real users — nothing here
is built/deployed yet (code changes only, per this VPS's rules), so this is
a plan to execute, not a status report.

**Gate:** per `docs/PR #15`, this does not merge to `main` or ship to any
build until §2 (device verification) below has passed — that checklist lives
in `docs/CONNECTION_DIAGNOSTICS_DEVICE_VERIFICATION.md`.

---

## 1. Backend must go first, independent of any app build

The server side (`lib/node_intel.php`, `public/v1.php`, `admin/`) has no
dependency on a new app build — it only *adds* fields an older client never
sends. Deploy order:

1. Deploy the backend changes to whichever box actually runs
   `api.setalink.no` / the SetaLink control plane (Copenhagen,
   `5.249.252.221`, per `docs/MULTINODE_API_v1.md` §5 — this PR does not
   change that target).
2. Verify old client builds still work unchanged (§3 of the API doc —
   nothing renamed/removed, only additive columns and two new routes).
3. Manually smoke-test the new routes before any app build depends on them:
   ```bash
   curl -s "https://api.setalink.no/v1/speedtest/download?bytes=1024" | wc -c   # expect 1024
   curl -s -X POST --data-binary "@/dev/zero" -H "Content-Length: 1024" \
     "https://api.setalink.no/v1/speedtest/upload"                             # expect {"ok":true,"bytes_received":1024}
   ```
4. Confirm `admin/index.php?page=diagnostics` loads (empty tables are fine —
   no client sends the new fields yet at this point).

## 2. App-side rollout — staged, following the existing test-allowlist pattern

This codebase already has a proven mechanism for "ship a new capability to a
small group before everyone" — the Helsinki test-node allowlist
(`node_allowlist` table, `docs/MULTINODE_API_v1.md` §6-7) and the Starlink
`test_mode` device flag (`STARLINK_WINDOWS_HANDOFF.md` §23/§29). Connection
Diagnostics should follow the same shape rather than a new mechanism:

### Stage 0 — internal/dev build
- [ ] Bump build number, ship an internal build (TestFlight internal group /
      direct APK) to the existing known test devices (the ones already in
      `devices` with `test_mode=1` — e.g. the tester referenced in
      `STARLINK_WINDOWS_HANDOFF.md` §33, `sl-f877790f`).
- [ ] Confirm in `admin/index.php?page=diagnostics` that rows actually
      appear for those devices within a few minutes of connecting — this is
      the first real signal the whole pipe works end-to-end.
- [ ] Run the device verification checklist (§ below / the dedicated doc)
      on at least one Android and one iOS device on this build.

### Stage 1 — small percentage / next TestFlight+internal-track Android build
- [ ] Once Stage 0 is clean for at least 48h with no elevated crash/ANR rate
      attributable to the new code paths (`connectionDiagnostics.ts`,
      `getNetworkInfo()` native calls), include it in the next regular
      release train — no separate feature flag needed since every new field
      is additive/optional and every probe is wrapped in try/catch
      (fails silently, never surfaces to the user — see architecture doc §2).
- [ ] Explicitly verify Iran-market cellular users are NOT seeing the
      automatic throughput test fire on cellular (`shouldRunThroughputTest`
      must gate on `network_type === 'wifi'` — check real telemetry rows,
      not just code review: query `avg_throughput_down_kbps` grouped by
      `network_type`, confirm cellular rows have `n_throughput_down_kbps
      ≈ 0`).

### Stage 2 — full rollout
- [ ] Ship in the next scheduled Android + iOS release once Stage 1 has a
      week of clean data.
- [ ] Announce the new admin page to whoever owns Ads/Revenue and Node
      Health work (it complements, doesn't replace, `Network Intel`) so it
      doesn't get rediscovered from scratch next time — link this doc from
      `PROJECT_STATUS.md` or `docs/realgram/COORDINATION_HUB.md` if this
      lands during active RealGram coordination.

## 3. What does NOT block rollout

- `tcp_connect_ms`/`handshake_ms` staying unpopulated (documented gap,
  §4.1 of the architecture doc) — the rest of the metrics are independently
  useful without it, and shipping now is how real device data eventually
  motivates the native timing work.
- `network_generation` reading "unknown" on most/all Android devices
  (no `READ_PHONE_STATE` permission declared, deliberately not added this
  round — see architecture doc §4.2). iOS generation data should be real
  immediately.

## 4. Rollback

Every change here is additive (new columns, new optional fields, new
routes, new admin page). Rollback is: stop serving the new app build (normal
release rollback process, unrelated to this feature) — the backend can stay
deployed indefinitely even with zero clients sending the new fields, since
nothing reads those fields as required.
