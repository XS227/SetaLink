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
  (same trust model the existing Shahnameh frontend uses — **not**
  cryptographically verified server-side yet; see Open questions below).
- Shows `real_balance` via `GET /api/season2/user/me`.
- Lets the player watch an AdsGram rewarded ad and credits REAL via
  `POST /api/season2/ads/verify-reward` — this is a direct reuse of the
  exact pattern in `/var/www/shahnameh/season2/adsgram.js`, not a
  reimplementation.
- Lets the player paste (or auto-fill via `startapp` deep-link param) a
  SetaLink device ID and get a signed link proof from
  `POST /api/season2/link-real-proof`, then shows it as a `realink://`
  deep link to hand back to the SetaLink app.

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
3. **SetaLink deep-link scheme.** `main.js` uses `realink://link-real-account`
   as a placeholder. Agent A needs to confirm the SetaLink app's actual
   scheme/host for consuming a `{device_id, real_account, ts, sig}` proof —
   logged as a cross-agent note in `TASK_SPLIT.md`.
4. **`initData` verification.** Like the rest of the season2 API today, this
   trusts the client-supplied `telegram_id` rather than verifying Telegram's
   `initData` HMAC server-side. Fine for the existing low-stakes game
   currencies; worth revisiting before this flow touches real money-like
   REAL balances at scale — not fixed here since it would mean changing
   season2 auth broadly, not just RealGram.
