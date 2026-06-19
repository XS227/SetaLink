# Rewarded Ads + Recovery — Activation Checklist

Step-by-step to go from "built but inert" to "live", **after** the mobile round.
Nothing here has been deployed. Companion to `docs/REWARDED-ADS-RECOVERY.md`.

> Golden rule: the backend is **inert until configured**. With no AdMob unit, no
> SSV, and no recovery node, `ads/reward/confirm` grants nothing and
> `recovery/enter` refuses. `dev_allow_client_confirm` is `0` by default — keep it 0.

Config is edited on **Admin → Ads & Revenue → Config** (writes the `settings`
table via `save-ads-config`). All keys are also listed in `lib/ads_recovery.php :: ar_defaults()`.

---

## OPERATOR STEPS (do these in order)

### A. Get your AdMob IDs
1. Go to **https://apps.admob.com** → **Apps** → select (or create) the Realink Android app.
2. **App ID**: *App settings* → top of page, format `ca-app-pub-XXXXXXXXXXXXXXXX~YYYYYYYYYY`
   (note the **`~`**). Copy it.
3. **Rewarded Ad Unit ID**: left menu *Ad units* → **Add ad unit** → format **Rewarded**
   → name it e.g. `realink-rewarded` → Create. Copy the unit id
   `ca-app-pub-XXXXXXXXXXXXXXXX/ZZZZZZZZZZ` (note the **`/`**).

### B. Enable SSV + paste the callback
4. Still in that **Rewarded ad unit** → scroll to **Server-side verification (SSV)**.
5. **Callback URL** → paste exactly:
   ```
   https://setalink.no/ssv.php
   ```
6. Save. (Custom data `user_id={deviceId}` is set by the app later — mobile round.)

### C. Fill the fields in Realink admin
7. Open **Admin → Ads & Revenue → Config** and set:
   - `admob_app_id`            = the `~` value from step 2
   - `admob_rewarded_unit_id`  = the `/` value from step 3
   - leave `admob_ssv_enabled` = `0` **for now** (turn on in step F)
   - leave `ssv_keys_url` default
8. Click **Save config**.

### D. Recovery node — values I need from the server
Run these **on the recovery exit node** (default Helsinki `65.109.183.7`) and send me / paste into admin:
```bash
xray uuid                       # → recovery_exit_uuid
xray x25519                     # → "Private key" = server side, "Public key" = recovery_exit_pbk
openssl rand -hex 8             # → recovery_exit_sid  (short id)
```
9. In **Admin → Ads & Revenue → Config** set:
   - `recovery_exit_host`  = `65.109.183.7` (or chosen node)
   - `recovery_exit_port`  = `8444`
   - `recovery_exit_uuid`  = from `xray uuid`
   - `recovery_exit_pbk`   = the **Public key** from `xray x25519`
   - `recovery_exit_sid`   = from `openssl rand -hex 8`
   - `recovery_exit_sni`   = `www.cloudflare.com`
   - (leave throttle 512 / session 1200)
   - **Save config**.
   > The matching xray inbound is generated with `scripts/gen-recovery-xray.php`
   > (uses the **Private** key) and deployed per §5 — do that step separately, not now.

### E. Safe SSV test (1 MB, throwaway device — zero real-GB risk)
10. In Config set `ad_reward_bytes` = `1048576` (1 MB) → **Save**.
11. Trigger a test SSV from AdMob (ad unit SSV section → *Send test*), using a throwaway
    `user_id=SSVTEST` and any unique `transaction_id`.
12. Check **Admin → Ads & Revenue**: event count rises; `SSVTEST` got 1 MB.
13. Replay the same test callback → no extra GB (idempotent).
14. **Reset**: reverse the `SSVTEST` grant (admin device tools), then set
    `ad_reward_bytes` back to `262144000` (250 MB) → **Save**.

### F. Flip SSV on
15. In Config set `admob_ssv_enabled` = `1` → **Save**.
16. Confirm `dev_allow_client_confirm` = `0` (it is by default).

### G. How you know it's ready for the mobile round
17. Open **Admin → Ads & Revenue**: the **yellow warning banner is gone** (all of
    AdMob unit / SSV / recovery node now configured).
18. Quick endpoint sanity (anyone with shell):
    ```bash
    curl -s https://setalink.no/ssv.php        # expect: rejected: no signature
    ```
19. When the banner is gone and steps A–F are checked, **ping me to start the mobile round.**

> Still no deploy of the recovery inbound and no mobile/OTA until you say go.

---

## 1. AdMob fields to fill in

From the AdMob console (https://apps.admob.com):

| Setting key | Source in AdMob | Notes |
|---|---|---|
| `admob_app_id` | App settings → App ID (`ca-app-pub-XXXXXXXX~YYYYYYYY`) | also goes in the APK manifest (mobile round) |
| `admob_rewarded_unit_id` | Ad units → your Rewarded unit (`ca-app-pub-XXXXXXXX/ZZZZZZZZ`) | when empty, the admin banner warns and rewards stay inert |
| `admob_ssv_enabled` | — | set `1` only AFTER a successful SSV test (step 3) |
| `ssv_keys_url` | leave default | `https://www.gstatic.com/admob/reward/verifier-keys.json` |

The app must send custom data `user_id={DEVICE_ID}` at ad load (mobile round) so
SSV can map the reward to a device.

---

## 2. Where the SSV callback goes

In AdMob console → the Rewarded **ad unit** → **Server-side verification** →
**Callback URL**:

```
https://setalink.no/ssv.php
```

This path already executes (`public/ssv.php`, top-level PHP handler on the landing
vhost) and is **outside** the mobile-token gate — it authenticates by AdMob's
ECDSA signature instead. No nginx change needed. Confirm reachability:

```
curl -s "https://setalink.no/ssv.php"        # expect: "rejected: no signature" (HTTP 200)
```

That response proves the endpoint is live and correctly rejects unsigned calls.

---

## 3. How to test SSV WITHOUT granting wrong/real GB

Do this on a throwaway device id, with reward size shrunk so a mistake is harmless:

1. **Shrink the reward** temporarily: set `ad_reward_bytes = 1048576` (1 MB) in the
   Config panel. Keep `admob_ssv_enabled = 0` for now (the verifier still runs; this
   flag is only the app-side "require SSV" switch).
2. **Use a test device id** you control (e.g. `device-SSVTEST`). Never a real user's.
3. **Trigger AdMob's test SSV**: in the ad unit's SSV section use *“Send a test SSV
   callback”*, or run a test/staging build that loads a **test ad unit** with
   `user_id=SSVTEST` and `transaction_id=<unique>`.
4. **Verify the result** in Admin → Ads & Revenue: the event count rises and the
   device shows a confirmed `ad_reward` of 1 MB. `ssv.php` returns `ok granted`.
5. **Idempotency check**: replay the same callback URL → `ssv.php` returns
   `ok duplicate`, and GB does **not** increase (proves no double-grant).
6. **Bad-signature check**: tamper one query char → `ssv.php` returns
   `rejected: bad signature`, no grant.
7. **Clean up**: reverse the test grant (Admin device tools / a negative
   `admin_adjustment` ledger row for `device-SSVTEST`), delete the test device, and
   **restore `ad_reward_bytes = 262144000`** (250 MB).
8. Only now set `admob_ssv_enabled = 1`.

Why this is safe: tiny reward + throwaway device + idempotency + daily caps mean a
mistaken grant is ≤1 MB to a device nobody uses, and is trivially reversible.

---

## 4. Recovery `recovery_exit_*` values to fill

Pick the exit node (default Helsinki `65.109.183.7`, but any host works). On that
node generate a fresh Reality keypair for the recovery inbound, then set:

| Key | Value |
|---|---|
| `recovery_exit_host` | exit node IP/host (e.g. `65.109.183.7`) |
| `recovery_exit_port` | recovery inbound port (e.g. `8444`) |
| `recovery_exit_uuid` | the recovery inbound client UUID (**distinct** from the main tunnel) |
| `recovery_exit_pbk` | Reality **public** key the client uses |
| `recovery_exit_sid` | Reality short id |
| `recovery_exit_sni` | borrowed SNI (e.g. `www.cloudflare.com`) |
| `recovery_throttle_kbps` | `512` |
| `recovery_session_secs` | `1200` |

`recovery_enter` refuses until `recovery_exit_uuid` is set (admin banner warns).
The exit node is **never hardcoded** — it lives entirely in these settings.

---

## 5. Deploy the recovery inbound safely

1. Generate the config from the single-source allowlist:
   ```
   php scripts/gen-recovery-xray.php --port=8444 \
     --uuid=<RECOVERY_UUID> --pbk=<REALITY_PRIVATE_KEY> --sid=<SHORT_ID> \
     --sni=www.cloudflare.com --throttle-kbps=512 > /tmp/recovery-inbound.json
   ```
2. Review it. **Strip the `_comment` / `_throttle_note` keys** before loading.
3. On the **recovery node only** (not the paid prod box, to isolate bandwidth):
   merge the `inbounds[]` + `routing.rules[]` into that node's xray config.
4. **Validate before reload**: `xray run -test -config /etc/xray/config.json`.
5. Reload xray. Confirm the main/prod tunnel is untouched (separate node/port).
6. Enforce the throttle out-of-band: `tc`/HTB on the recovery NIC for that port (or
   a rate-limited nginx/HAProxy stream). xray-core has no native bandwidth cap.
7. **Smoke test** with a test device at 0 visible quota:
   - `recovery/enter` returns a token + profile.
   - An allowlisted domain (e.g. `t.me`, `google.com`) loads.
   - A non-allowlisted domain (e.g. `example.com`) is blocked.
   - `report-session` with `recovery=1` charges `recovery_used_bytes`, not visible.

---

## 6. Rollback plan

Everything is reversible without an APK update (config is server-side):

- **Disable ads instantly:** set `ad_daily_cap = 0` (or `ad_reward_bytes = 0`).
  No new rewards grant; existing balances untouched.
- **Disable SSV trust:** set `admob_ssv_enabled = 0`. `dev_allow_client_confirm`
  stays `0`, so no path grants from the client.
- **Disable recovery:** clear `recovery_exit_uuid` → `recovery/enter` refuses for
  everyone; existing sessions expire at TTL (≤20 min).
- **Pull the recovery inbound:** remove the inbound+rules from the recovery node's
  xray and reload — independent of prod, so no user on the main tunnel is affected.
- **Claw back a bad grant:** reverse via a negative `admin_adjustment` ledger row
  (admin device tools), per-device. The ledger invariant stays intact.
- **Full code rollback:** the feature is additive (new files + new endpoints +
  new columns/tables). Reverting commits `e25e90c..3eb573a` removes the surface;
  the added DB columns/tables are harmless if left (unused). OTA/version/update
  flow is never touched by this feature.

---

## 7. Pre-launch gate (all must be true)

- [ ] `admob_app_id` + `admob_rewarded_unit_id` set; admin banner clear
- [ ] SSV test passed (grant + duplicate + bad-signature) on a throwaway device
- [ ] `ad_reward_bytes` restored to 262144000 after testing
- [ ] `admob_ssv_enabled = 1`
- [ ] `dev_allow_client_confirm = 0`  ← **verify in prod**
- [ ] `recovery_exit_*` set; recovery inbound deployed on isolated node; throttle active
- [ ] recovery smoke test passed (allow/block/metering)
- [ ] mobile build (separate round) QA'd, then OTA
