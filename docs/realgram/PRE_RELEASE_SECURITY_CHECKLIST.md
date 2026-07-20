# Pre-release security checklist — Monetization / AdMob OAuth / AdsGram

Created 2026-07-20, Khabat. Run through this **in full, in order** before merging
`feat/monetization-admin` (or any branch touching AdMob OAuth / AdsGram
callbacks) to `main` and releasing. Every item needs an explicit check, not an
assumption — tick nothing you haven't actually verified.

Context: development used a temporary AdMob OAuth client
(`admob_reporting_oauth_client_id`/`admob_reporting_oauth_client_secret`,
staged in the shared `/coord` credential vault — never git, see §2) to
complete and verify the Reporting API integration
(`docs/realgram/MONETIZATION_REPORTING.md` §5). None of that is production-safe
as-is — this checklist exists so rotating it before release doesn't get
forgotten in the noise of everything else that shipped tonight.

## 1. Rotate every temporary/dev secret

- [ ] **AdMob OAuth Client Secret** — the dev OAuth client used to complete
      and verify the Reporting API integration is temporary. In Google Cloud
      Console: create a **new** OAuth 2.0 Client ID for production (or
      rotate the secret on the existing one), update
      `/etc/setalink/admob-oauth-client.json` (root-only, 0600) on the
      SetaLink box with the new `client_id`/`client_secret`.
- [ ] **`ADSGRAM_CALLBACK_SECRET`** — compromised (committed in plaintext to
      `TASK_SPLIT.md`'s git history, `A→B(20)`). Generate a new value, set it
      in Shahnameh backend's `.env` (`ADSGRAM_CALLBACK_SECRET=...`), restart
      the `khabat` pm2 process.
- [ ] **AdsGram Reward URL** — update block `35738`'s Reward URL in the
      AdsGram dashboard (`app.adsgram.ai`) to use the *new* `secret=` value
      from the item above. Same `blockId=35738` param, same URL shape, only
      the secret changes.
- [ ] **AdMob refresh token** — re-run the one-time OAuth consent
      (RealGram Admin → Monetization → Configuration → AdMob → **Connect
      AdMob**) against the *new* client so `data/admob-oauth.json` holds a
      token tied to the production client, not the dev one.

## 2. Confirm nothing leaked

- [ ] **Git history** — `git log -p --all -S'<old-secret-value>'` (both repos:
      `SetaLink`, `shahnameh-backend`) to confirm the search only finds the
      *old*, now-rotated value, and that the new one was never committed
      anywhere, ever (not even in a WIP commit later squashed/amended).
- [ ] **`TASK_SPLIT.md` / coordination docs** — re-read the relevant sections
      (`A→B(20)`, the OAuth client-id/secret exchange tonight) to confirm only
      *names/pointers* were ever written there, never raw values. If a raw
      value is found, treat it as compromised regardless of whether it's
      already scheduled for rotation above.
- [ ] **Logs** — `grep` `scripts/*.log`, `push_adsgram_*.log`,
      `admob_last_error`/`adsgram_last_error` (settings), and any PHP/Node
      error logs for the literal secret strings. A stack trace or debug print
      is an easy accidental leak path.
- [ ] **`/coord` vault** — after production values are confirmed working
      (§4), delete the temporary `admob_reporting_oauth_client_id`/
      `admob_reporting_oauth_client_secret` entries from the vault
      (`DELETE /coord/secrets/:name` or direct DB removal) — it did its job
      getting the dev value from Khabat to whoever configured the box without
      a git round-trip; it shouldn't keep holding it indefinitely after that.
- [ ] **`.env` files are not committed** — `git status`/`git ls-files` on
      both repos confirms no `.env`, `.env.*`, or
      `admob-oauth-client.json`-shaped file is tracked. Check `.gitignore`
      actually covers them (don't just trust that it always has).

## 3. Confirm old secrets are actually dead

- [ ] Attempt an AdMob Reporting API call using the **old** dev
      client_id/secret — must fail (invalid_client or similar), not silently
      still work.
- [ ] Hit the AdsGram Reward URL with the **old** `secret=` value — must be
      rejected (`reason: 'unauthorized'` in `handleCallback()`'s response),
      confirmed via `GET /season2/admin/ad-events` showing no new `credited`
      row for that attempt.

## 4. Re-verify functionality after rotation

- [ ] **OAuth works with the new Client Secret** — full consent flow
      end-to-end (Connect AdMob → Google consent screen → redirect →
      `data/admob-oauth.json` populated), not just "the button didn't error."
- [ ] **AdMob Reporting API still works post-rotation** — Configuration tab →
      "Sync now" → `admob_last_error` stays empty, `am_daily_metric_upsert()`
      writes real `PROVIDER_API`-tagged rows for today.
- [ ] **AdsGram callback works post-rotation** — a real (or deliberately
      triggered test-mode) ad watch produces a `credited` row in
      `GET /season2/admin/ad-events` *and* a matching `PROVIDER_CALLBACK` row
      in the Monetization admin's Reward Events tab, with the new secret.

## 5. Full production validation of Monetization Admin

- [ ] Every tab loads with no PHP errors: Overview, AdMob, AdsGram, Reward
      Events, Reconciliation, Configuration, Logs.
- [ ] **Android, iOS, AdsGram, and AdMob show consistent numbers** — cross-
      check one real event end-to-end (e.g. one AdsGram watch, one AdMob
      rewarded view) against `GET /season2/admin/ad-events` (Shahnameh side)
      and the Monetization Reward Events tab (SetaLink side) — same event,
      same counts, no double-counting or silent drop on either side.
- [ ] **Every provider-data badge is correct** — spot-check at least one row
      of each: `verified` (`PROVIDER_API`), `provider_reported`
      (`PROVIDER_CALLBACK`), `local` (`LOCAL_SDK_EVENT`), `manual`
      (`MANUAL_IMPORT`), `estimated` (`ESTIMATE`) — per
      `MONETIZATION_REPORTING.md` §3's `AM_SOURCE_PRIORITY` table. No number
      anywhere renders as bare/unlabeled.
- [ ] Reconciliation tab: at least one real `(date, provider, app, platform,
      ad_unit_id)` row shows `difference: 0` or an explained non-zero (not an
      error or a blank).
- [ ] `php scripts/test-monetization.php` — full pass, re-run *after*
      rotation (not just once during development).

## 6. Final sign-off

- [ ] Re-run every backend test suite touched tonight one more time from a
      clean checkout of the release branch: `test-monetization.php`,
      `test-quota-economy.php` (note: this file has a pre-existing,
      unrelated `Transfers:` crash, `A→B(57)`/`B→A(61)` — confirm it's *still
      only* that one pre-existing failure, nothing new), `test-ads-recovery.php`,
      `test-bugfixes.php`.
- [ ] Security review of the actual diff going to `main` (not just the
      feature as a whole) — `/code-review` or equivalent, focused on the
      OAuth/secret-handling paths touched by this checklist.
- [ ] Confirm `docs/realgram/MONETIZATION_REPORTING.md` §7 (Environment /
      files table) reflects the *production* file locations/permissions
      actually in place, not the dev setup.
- [ ] Get Khabat's explicit go before merging to `main` — this checklist
      being complete is necessary, not sufficient; he makes the release call.

---

**Do not merge to `main` with any box in this list unchecked.** If a step
can't be completed (e.g. no access to rotate something), that's a blocker to
flag in `TASK_SPLIT.md`, not a reason to skip the box.
