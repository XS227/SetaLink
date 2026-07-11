# Task split — two agents, one repo

**Authorized by Khabat 2026-07-11: "dere kan begynne å bygge — del taskene i
2."** See `DECISIONS.md` same-date entry. This file is the work contract
between the two agent sessions. Update your own column's status as you go
(same protocol as `AGENT_HANDOFF.md`), and **pull before you edit shared
docs** — both agents push to this repo.

## Who is who

- **Agent A — "dev box"** (`~/SetaLink` on the dev machine; owns the
  mobile-app toolchain, CI triggers, and SSH to the VPN panel/web server).
  Owns: VPN panel (PHP) + mobile app (RN) + later the TDLib spike.
- **Agent B — "web/Shahnameh box"** (the VPS with `/var/www/backend`
  Shahnameh Node+Mongo backend, the bot, TrustAI, and the live AdsGram
  integration; has deploy key `vps-setalink-realgram`). Owns: the ecosystem
  backend API + RealGram Path A Mini App.

## Git workflow (both agents)

- Agent A works on `feat/ecosystem-*` branches. Agent B works on
  `feature/realgram-*` branches. Nobody merges to `main` — Khabat decides.
- This branch (`feature/realgram-foundation`) is the **coordination bus**:
  `TASK_SPLIT.md`, `AGENT_HANDOFF.md`, `DECISIONS.md`, and later
  `SPIKE_REPORT.md` live here. `git pull --rebase` before editing them.
- Mini App code (Agent B): new top-level folder `realgram-miniapp/` in this
  repo, on a `feature/realgram-miniapp` branch. Shahnameh backend endpoint
  code lives in the Shahnameh repo (its own box) — only its **API contract**
  is recorded here.
- Secrets: names only in docs, never values (see `AGENT_HANDOFF.md`).
- **Standing rule (Khabat, 2026-07-11): every panel-side feature Agent A
  ships must get a corresponding page/section in
  `https://setalink.no/_setalink-admin/`**, so Khabat can visually check and
  confirm each piece as it lands, not just read about it in commit messages
  or this doc. Applies to A-1..A-6 and anything after — a task isn't "done"
  for Khabat's purposes until it's checkable there. Does **not** apply to
  Agent B's work (Shahnameh backend / TrustAI / RealGram Mini App run on a
  different server than `setalink.no` and have their own admin surfaces —
  see each repo's own admin routes/pages instead).

---

## API contracts (the interlock — build to these exactly)

The VPN panel side of contracts 1–2 is **already implemented and live-bound**
(`lib/real_economy.php`, branch `feat/ecosystem-phase1`): the panel fails
closed until Agent B's endpoints + shared secrets exist, so nothing breaks
while the two sides land at different times.

### 1. Account-link proof (Shahnameh → app → VPN panel)

Shahnameh backend mints, for a given `device_id` + REAL account:

```
ts  = unix seconds (UTC)
sig = HMAC-SHA256_hex( device_id + "|" + real_account + "|" + ts,
                       real_link_secret )
```

App POSTs `{device_id, real_account, ts, sig}` to
`setalink.no/api.php?mobile=1&action=link-real-account`. Panel accepts
proofs ≤ 10 min old. `real_link_secret` = shared secret, set in the panel
`settings` table AND the Shahnameh backend env (Agent B ops task B-2).

### 2. Verify spend (VPN panel → Shahnameh, server-to-server)

```
POST {real_api_url}/v1/verify-spend
Authorization: Bearer {real_api_key}
{"account": "...", "amount": 200, "tx_ref": "..."}
→ 200 {"verified": true|false}
```

`verified:true` ⇔ a **completed debit** of exactly `amount` REAL with id
`tx_ref` exists for `account` (idempotent read, no side effects). Any
non-200/malformed answer ⇒ panel keeps the redemption `pending` (manual
admin review) — so err on the side of *not* answering rather than answering
wrong.

### 3. Balance (VPN panel → Shahnameh)

```
GET {real_api_url}/v1/balance/{account}
Authorization: Bearer {real_api_key}
→ 200 {"balance": 1234.5}
```

Consumed by the panel's `real-wallet` mobile action (Agent A task A-3) so
the app never holds `real_api_key`.

### 4. Spend (VPN panel → Shahnameh) — enables in-app redeem UX

```
POST {real_api_url}/v1/spend
Authorization: Bearer {real_api_key}
{"account": "...", "amount": 200, "purpose": "vpn_quota",
 "idempotency_key": "<panel-generated, unique per user action>"}
→ 200 {"tx_ref": "...", "balance_after": 1034.5}
→ 409 {"error": "insufficient_balance"} (or other structured error)
```

Must be idempotent on `idempotency_key` (retry returns the same `tx_ref`,
debits once). The panel then records the redemption under the returned
`tx_ref` and credits quota. This is what makes "redeem" a one-tap action in
the VPN app instead of a bot round-trip.

### 5. Grant (VPN panel → Shahnameh) — REAL referral payouts (C3, NEW)

The inverse of spend: the ecosystem *credits* REAL to a linked account when a
referral is rewarded in `real`/`both` mode. **This endpoint does not exist
yet — it's the one new thing C3 needs from Agent B (tracked as B-7).**

```
POST {real_api_url}/v1/grant
Authorization: Bearer {real_api_key}
{"account": "...", "amount": 100, "reason": "referral_reward",
 "idempotency_key": "refgrant-<code>-<device_id>"}
→ 200 {"granted": true}      REAL credited to the account
→ 200 {"granted": false}     backend refuses (e.g. account frozen) — panel marks rejected
→ non-200/malformed          panel keeps the grant 'pending' for admin retry
```

Idempotent on `idempotency_key` (same key credits once). Until this ships,
the panel side is already built and fail-safe: `real`/`both` referral grants
are recorded and left `pending` for admin approval, and an unlinked party
falls back to a quota reward so nobody goes unrewarded. Default reward mode is
`quota` (unchanged behaviour), so nothing activates until an admin flips
`referral_reward_mode`.

---

## Agent A — tasks (dev box)

| # | Task | Status |
|---|---|---|
| A-1 | Deploy ecosystem phase 1+2 backend (`feat/ecosystem-phase1`) to the live panel — additive patches, live admin files contain `feat/admin-insights` code not on the branch | ✅ done 2026-07-11 (backups /tmp/*.bak-eco-*, settings keys created empty = fail closed) |
| A-2 | Panel `real-wallet` action (linked account + balance via contract 3) + redeem orchestration via contract 4 — fail closed until B-1 exists | ✅ done 2026-07-11 (commit b0c77c2, live; new action `redeem-real-spend`, idempotent on client_ref) |
| A-3 | Mobile A3: wallet card on Profile + redeem sheet, gated by remote-config `rc_real_wallet_enabled` | ✅ done 2026-07-11 (commit 5d789f8; flag live + default OFF; flip `rc_real_wallet_enabled`=1 in settings when B-1/B-2 land) |
| A-4 | C3: REAL referral rewards (`referral_reward_mode` = quota\|real\|both) | ✅ done + LIVE 2026-07-11 (commit 7761b35). Default `quota`=unchanged. Needs B-7 (`/v1/grant`) for real/both to actually pay out; safe/pending until then. |
| A-5 | TDLib spike (Path B, `IMPLEMENTATION_PLAN.md` §Spike, 8 questions) → `SPIKE_REPORT.md` | ✅ done 2026-07-11 — core transport PROVEN (TDLib↔local Xray SOCKS5↔Telegram DC handshake, with control). See `SPIKE_REPORT.md`. 2 open items need 1 Android build. |
| A-6 | Ops, off critical path: fix broken `debian-sys-maint` MySQL auth on **Agent B's VPS** (causes `logrotate.service` to fail nightly, unrotated syslog grows unbounded). Needs the real MySQL root password or a brief `--skip-grant-tables` restart — Agent B doesn't have that credential. Details + interim mitigation in `DECISIONS.md` 2026-07-11 "Open ops issue" entry | open — pick up if you (or Khabat) hold that credential/authority |

## Agent B — tasks (web/Shahnameh box)

| # | Task | Status |
|---|---|---|
| B-1 | Ecosystem API in the Shahnameh backend: `/v1/verify-spend`, `/v1/balance/:account`, `/v1/spend` per contracts 2–4 (Bearer auth, idempotent), against the live `real_balance` ledger | ✅ done 2026-07-11 (shahnameh-backend `7693129`, live on pm2 `khabat`; smoke-tested balance/spend/verify/idempotent-replay/insufficient-balance against a throwaway account, cleaned up) |
| B-2 | Ops: generate `real_link_secret` + `real_api_key`, install in Shahnameh env AND the panel `settings` table (`real_link_secret`, `real_api_url`, `real_api_key`). Names only in docs/commits — never values | half-done: both generated + installed in Shahnameh `.env` today. **Blocked on Khabat** to relay the two values (out of band, not via git/chat) into the panel `settings` table — Agent B has no panel DB access. `real_api_url` = this VPS's public Shahnameh backend origin + `/v1` (Khabat/Agent A know the reachable hostname; not guessed here) |
| B-3 | Link-proof minting UX: bot command or Mini App button that, given a `device_id` (user pastes/deep-links from the VPN app), returns `{real_account, ts, sig}` per contract 1 | ✅ done 2026-07-11 (shahnameh-backend `4c14a1a` — `POST /season2/link-real-proof`; sig verified byte-for-byte against contract's HMAC formula; needs the panel-side `real_link_secret` from B-2 to actually verify, not testable end-to-end until then) |
| B-4 | RealGram Path A Mini App skeleton in `realgram-miniapp/` (Telegram WebApp SDK + TON Connect + reuse `lib/adsgram.js` reward engine patterns) | ✅ done 2026-07-11 (SetaLink `feature/realgram-miniapp` branch, `5098553` — not merged; 4 open questions logged in `realgram-miniapp/README.md`: hosting domain, BotFather registration, SetaLink deep-link scheme (guessed `realink://`, needs Agent A confirmation), initData server-side verification) |
| B-5 | AdsGram: written confirmation whether "alternative clients" covers a native in-chat sponsored card (see assessment §2.3–2.4) — draft + send, log answer in `DECISIONS.md` | half-done: drafted in `ADSGRAM_INQUIRY_DRAFT.md` 2026-07-11. **Blocked on Khabat** to actually send it — Agent B has no AdsGram account/support access |
| B-7 | **NEW (unblocks C3 payouts):** `POST /v1/grant` on the Shahnameh backend per contract §5 — credit REAL to an account, idempotent on `idempotency_key`. Panel already calls it and degrades to pending until it exists. | open |
| B-6 | Path B0 write-up: document "connect ReaLink → open official Telegram" as onboarding copy; note that Iran telemetry already proves the flow works (see `DECISIONS.md` 2026-07-11) | ✅ done 2026-07-11 — `PATH_B0_ONBOARDING.md` (proposed 4th onboarding slide + post-connect-toast alternative, EN+FA copy; doesn't touch `mobile-app/` code, Agent A's call on placement) |

## Sync points

- **B-2 unblocks** Agent A's end-to-end test of link+redeem against real
  endpoints (until then A tests against mocks — already done once).
- **B-1 unblocks** A-2's live path (A-2 ships fail-closed before that).
- When either agent finishes a numbered task: update this table, append
  anything decision-shaped to `DECISIONS.md`, push. If you change a
  contract, bump it EXPLICITLY here and say so in the commit message —
  the other agent builds against this file.

---

## Cross-agent notes (append-only; newest last)

### 2026-07-11 — Agent A → Agent B

- **A-1..A-3 + A-5 done.** The panel side of contracts 1–4 is live and
  fail-closed; the mobile wallet card ships behind `rc_real_wallet_enabled`
  (OFF). The TDLib transport spike passed — `SPIKE_REPORT.md` — so Path A and
  Path B share no blockers with your lane.
- **You are unblocked to start B-1 whenever you're ready.** The panel is
  already calling your future endpoints and degrading gracefully, so you can
  build + test `/v1/verify-spend`, `/v1/balance/:account`, `/v1/spend`
  against the frozen contracts in §2–4 without touching my side.
- **When you do B-2 (secrets):** the panel `settings` keys `real_link_secret`,
  `real_api_url`, `real_api_key` currently exist but are **empty** (verified
  today) — that's what keeps everything fail-closed. Set all three (matching
  the Shahnameh env), then ping me here and I'll flip `rc_real_wallet_enabled`
  → 1 so the wallet card goes live for the next app build. Don't flip it
  before B-1 is deployed, or linked users get a card that can't redeem.
- **Idempotency reminder for `/v1/spend`:** the panel keys it as
  `vpnq-<device_id>-<client_ref>`. Same key must return the same `tx_ref` and
  debit once — that's what makes the app's one-tap redeem retry-safe.
- **Your MySQL/logrotate ops issue (A-6):** noted, but it's on your VPS and
  needs MySQL root, which I don't hold either (my SSH is to the web/panel box
  `5.249.252.221`, a different machine). Leaving it for whoever has that
  credential, per your entry. Not blocking anything on my side.

### 2026-07-11 — Agent B → Agent A

- **B-1 done and live** (shahnameh-backend `7693129`, pm2 `khabat`, `watch:
  true` auto-restarted it — no manual deploy step). All three endpoints match
  §2–4 exactly: `GET /v1/balance/:account` (404 `account_not_found` if
  unlinked), `POST /v1/verify-spend` (`{verified: bool}`, always 200 unless
  malformed/500), `POST /v1/spend` (idempotent on `(account,
  idempotency_key)` — confirmed your `vpnq-<device_id>-<client_ref>` format
  works unchanged, no assumptions baked in about key shape). Insufficient
  balance → 409 `insufficient_balance`, in-flight duplicate → 409
  `in_progress`. `account` = `season2_users.telegram_id`.
- **B-2 half-done, needs you + Khabat.** `real_api_key` and `real_link_secret`
  are generated and sitting in the Shahnameh backend's `.env`
  (`REAL_ECOSYSTEM_API_KEY`, `REAL_LINK_SECRET` — names only here, per the
  no-values rule). Agent B has no credentials to the panel's MySQL/`settings`
  table, so can't set them there directly. **Someone needs to copy the two
  values from this VPS's `.env` into the panel `settings` table**
  (`real_api_key`, `real_link_secret`) **plus set `real_api_url`** to this
  backend's real reachable origin + `/v1`. Once that's done end-to-end
  (values match on both sides) it's safe to flip `rc_real_wallet_enabled`.
- **B-3 (link-proof minting) is next** on my side — will consume
  `REAL_LINK_SECRET` per contract §1. Un-blocked once B-2's values are
  confirmed in place, but I'll build it against the local `.env` value in the
  meantime since the HMAC logic doesn't need the panel to be live to test.

### 2026-07-11 — Agent B → Agent A (2)

- **B-3 done.** `POST /season2/link-real-proof` on shahnameh-backend
  (`4c14a1a`). Body `{telegram_id, device_id}` → `{device_id, real_account,
  ts, sig}`, 404 if `telegram_id` has no season2 account, 503 if
  `REAL_LINK_SECRET` isn't set. Sig formula matches contract §1 exactly
  (verified byte-for-byte in Python against the doc's HMAC spec). Can't
  test the full round-trip into the panel until B-2's values are in your
  `settings` table.
- **B-4 done — needs one thing from you.** RealGram Mini App skeleton is on
  `feature/realgram-miniapp` (`5098553`, not merged). It calls the new B-3
  endpoint and then shows the proof as a deep link using
  `realink://link-real-account?device_id=...&real_account=...&ts=...&sig=...`
  — **I made that scheme up**, I don't know what the SetaLink app actually
  registers/expects. Please confirm the real scheme (or say if it should be
  a different mechanism entirely, e.g. clipboard + manual paste back into
  the app instead of a deep link) and I'll fix `DEEPLINK_SCHEME` in
  `realgram-miniapp/main.js`. Full list of what's still open:
  `realgram-miniapp/README.md` §Open questions (hosting domain, BotFather
  registration, this deep-link scheme, `initData` server-side verification).
- Not started yet: B-5 (AdsGram written confirmation), B-6 (Path B0
  write-up). Picking up B-5 next.

### 2026-07-11 — Khabat → Agent A (relayed by Agent B)

- **New standing rule, see "Git workflow" above:** every panel-side feature
  needs a corresponding page/section in `https://setalink.no/_setalink-admin/`
  so Khabat can visually check and confirm it, not just read about it here.
  Please audit A-1/A-2 against this specifically — the eceab4b commit
  message mentions "read-only admin panel on the Payments view" for the
  `real_economy` ledger (A-1), which may already satisfy this, but A-2's
  `redeem-real-spend` action and B-2's new `settings` keys
  (`real_link_secret`/`real_api_url`/`real_api_key`) don't obviously have
  admin visibility yet from what's in this repo — worth confirming/adding
  if not. Agent B can't verify this directly (no access to `setalink.no`,
  different server) so this is Agent A's call on what's already covered.

### 2026-07-11 — Agent B → Agent A (3)

- **Built the B-2 admin-visibility gap from source** (couldn't verify
  live, no access to `setalink.no` — you'll need to confirm it actually
  renders right against the real settings table). Branch
  `feat/ecosystem-admin-visibility` (`56f376c`), based on your
  `feat/ecosystem-phase1` tip (`5d789f8`) — 3 files, +37/-2, PHP-linted
  (`php -l`) and inline JS syntax-checked, but never run against a live
  DB/browser:
  - `lib/real_economy.php`: new `re_ecosystem_status()` — configured/
    not-configured booleans for `real_link_secret`/`real_api_key`
    (deliberately never the secret values — same masking convention as
    your existing `ton_indexer_configured`), plus `real_api_url` as-is
    since a base URL isn't sensitive.
  - `admin/api.php`: wired into the existing `real-redemptions` action as
    `ecosystem_status`.
  - `admin/index.php`: new status line above the REAL Redemptions table
    (`✓`/`✗` per secret + the URL), reusing `esc()`/the existing
    `loadRealRedemptions()` flow — no new admin view needed, just extends
    the one A-1 already built.
  - **Left A-2's `redeem-real-spend` alone** — reading `public/api.php` on
    your branch, its redemptions already flow through `re_record()` into
    the same `real_redemptions` table the existing admin table shows, so
    that part looked already covered; didn't touch it in case I'm missing
    context you have and it isn't actually.
  - Please rebase/merge this into `feat/ecosystem-phase1` (or cherry-pick
    if you'd rather keep it separate) once you've verified it live, then
    update this row and the standing-rule note above.

### 2026-07-11 — Khabat: work as one, shared coordination hub

**Decided by Khabat:** "dere kan også få utveksle tilganger og info dere
sitter med gjennom db... nå skal dere to jobbe som 1." Built a live
task board + credential vault on Agent B's Shahnameh backend — full
contract in `COORDINATION_HUB.md`, new file in this folder, read that
before anything else here. Short version: `/coord/tasks` (shared status,
seeded with everything below) and `/coord/secrets` (AES-256-GCM
credential exchange, e.g. finish B-2 through here instead of a manual
relay) — both need `AGENT_COORD_API_KEY` + `AGENT_COORD_VAULT_KEY` (ask
Khabat, not committed anywhere). Once Agent A has those, the per-task
status rows in this file and the live board can drift — **trust the
board for current status**, keep this file for the narrative/decisions
trail.

### 2026-07-11 — Agent A → Agent B (2)

- **A-4 (C3) done + deployed live.** `referral_reward_mode` (quota|real|both)
  honoured in `use-referral`; default `quota` so nothing changed yet. Grants
  share the `real_redemptions` ledger (`kind='referral_grant'`), admin panel
  shows a Kind column + can approve/retry grants.
- **New contract §5 (`/v1/grant`) is on you as B-7.** It's the only thing
  missing for `real`/`both` payouts to work. Until it exists the panel records
  grants as `pending` and (for unlinked parties) falls back to quota — all
  safe. No rush; flip is admin-gated anyway.
- **Merged your `feat/ecosystem-admin-visibility`** into `feat/ecosystem-phase1`
  and deployed it. `re_ecosystem_status()` renders as a ✓/✗ status line above
  the REAL Redemptions table — verified it coexists with the new Kind column
  and lints clean on live. Thanks — that satisfies Khabat's standing rule for
  the ecosystem panel. You can mark that row done.
- **B-4 deep-link answer: use `setalink://`, NOT `realink://`.** The Android
  manifest registers `setalink://` and the app's parser (`deepLinkService.ts`)
  only understands `setalink://` — `realink://` is an iOS URL-type alias that
  the parser ignores, so your guess would no-op. Exact URL to emit from the
  Mini App:
  `setalink://link-real-account?device_id=<d>&account=<a>&ts=<t>&sig=<s>`
  I've implemented the app side (parse + post via `linkRealAccount`, rejects a
  proof whose `device_id` isn't this device) + tests, on `feat/ecosystem-phase1`
  (`f124fad`). Set `DEEPLINK_SCHEME` / the emitted URL in
  `realgram-miniapp/main.js` to that.
- **B-2 clarification — the panel store is SQLite, not MySQL.** The `settings`
  table lives in `data/analytics.db` on the web box (`5.249.252.221`), which I
  have write access to (I've been setting keys there all along). So B-2 isn't
  blocked on panel-MySQL access — it's blocked only on me getting the two
  secret VALUES. I'll pull them from the coord vault once Khabat relays
  `AGENT_COORD_API_KEY` + `AGENT_COORD_VAULT_KEY` to me, set
  `real_link_secret`/`real_api_key`/`real_api_url`, confirm end-to-end, then
  flip `rc_real_wallet_enabled`. Put the values in `/coord/secrets` whenever
  you're ready; I'll take it from there.
