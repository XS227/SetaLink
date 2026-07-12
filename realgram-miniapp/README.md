# RealGram Mini App — skeleton (task B-4)

Path A per `docs/realgram/PRODUCT_VISION.md`: a Telegram Mini App (runs
inside official Telegram), reusing Shahnameh's live season2 backend as the
earn engine and the new `/season2/link-real-proof` endpoint (task B-3) to
link a SetaLink VPN device to the player's REAL account.

Vanilla HTML/CSS/JS, no build step — matches how Shahnameh's own frontend
(`/var/www/shahnameh/season2/`) is built, and keeps this loadable as a plain
static WebView per `BUILD_SIZE_BUDGET.md`'s "don't bundle assets" rule.

## Files

| File | Purpose |
|---|---|
| `index.html` | Mini App shell — balance card, earn card, link card |
| `style.css` | Telegram theme-aware styling (`--tg-theme-*` CSS vars) |
| `main.js` | All logic — Telegram WebApp init, balance fetch, AdsGram earn flow, link-proof flow, TON Connect init |
| `tonconnect-manifest.json` | TON Connect manifest stub — placeholder URLs, needs the real domain |

## What this does today

- Reads the caller's Telegram user via `Telegram.WebApp.initDataUnsafe.user`
  for display purposes (balance lookup, ads reward) — same trust model the
  existing Shahnameh frontend uses, **not** cryptographically verified
  server-side. Accepted gap for those two calls (see Open questions #4,
  resolved-but-scoped).
- Shows `real_balance` via `GET /api/season2/user/me`.
- Lets the player watch an AdsGram rewarded ad and credits REAL via
  `POST /api/season2/ads/verify-reward` — this is a direct reuse of the
  exact pattern in `/var/www/shahnameh/season2/adsgram.js`, not a
  reimplementation.
- Lets the player paste (or auto-fill via `startapp` deep-link param) a
  SetaLink device ID and get a signed link proof from
  `POST /api/season2/link-real-proof`, then shows it as a
  `setalink://link-real-account` deep link to hand back to the SetaLink
  app. **This call, unlike the two above, sends `Telegram.WebApp.initData`
  (the raw signed string) and the backend verifies it cryptographically**
  (`lib/telegramAuth.js`, shahnameh-backend) — see Open questions #4.

## What this does NOT do yet (deliberately out of scope for a skeleton)

- No spend/redeem UI — that already lives in the SetaLink mobile app
  (task A-3, wallet card + redeem sheet), which calls the panel, which calls
  `/v1/spend` (task B-1) directly. RealGram doesn't need to duplicate it.
- TON Connect is wired to *display/connect* a wallet only. REAL redemption
  is an off-chain, `telegram_id`-keyed ledger (see `DECISIONS.md` "internal
  settlement, no on-chain ops in the VPN panel") — there is currently no
  on-chain action for this Mini App to perform. Included because
  `TASK_SPLIT.md` names TON Connect explicitly; don't build more on-chain
  logic here until a real use case is decided.
- No offline/error-state polish, no i18n (Shahnameh's frontend has 6
  languages — this skeleton has none yet).

## Open questions (needs Khabat/Agent A input, not guessed here)

1. **Hosting domain.** `API_BASE = '/api'` in `main.js` assumes this is
   served behind the same reverse-proxy prefix Shahnameh's site uses. If
   RealGram gets its own domain, that constant needs a fully-qualified
   backend URL, and the new origin needs adding to `app.js`'s CORS list on
   the Shahnameh backend.
2. **BotFather registration.** Needs `/newapp` against whichever bot this
   should live under — a new dedicated bot, or attached to the existing
   Shahnameh/Hakim bot? Product decision, not made here.
3. ~~**SetaLink deep-link scheme.**~~ **Resolved 2026-07-11.** Agent A
   confirmed `setalink://link-real-account`, param `account` (not
   `real_account`) — `main.js` uses this now.
4. ~~**`initData` verification.**~~ **Resolved 2026-07-12, scoped.**
   `/season2/link-real-proof` now requires and verifies real
   `Telegram.WebApp.initData` server-side (`lib/telegramAuth.js`,
   shahnameh-backend — Telegram's official HMAC-SHA-256 algorithm,
   `secret_key = HMAC(bot_token, key="WebAppData")` then
   `hash = HMAC(data_check_string, key=secret_key)`, plus a 24h freshness
   check on `auth_date`). Deliberately scoped to just this one endpoint —
   it's the one that mints a proof that can claim a REAL wallet, so an
   unverified `telegram_id` there would let anyone mint a valid proof for
   someone else's account. The rest of season2's API (balance lookup, ads
   reward, and everything outside RealGram) still trusts a client-supplied
   `telegram_id` — an accepted gap for the existing low-stakes game
   currencies, not retrofitted here since that's a much larger, separate
   change to season2 auth broadly. Test coverage: 7 cases (valid signed
   data, tampered field, wrong bot token, expired auth_date, missing hash,
   empty input, realistic multi-field order) — see commit history on
   `lib/telegramAuth.js` in the shahnameh-backend repo.
