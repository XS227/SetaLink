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

---

## Agent A — tasks (dev box)

| # | Task | Status |
|---|---|---|
| A-1 | Deploy ecosystem phase 1+2 backend (`feat/ecosystem-phase1`) to the live panel — additive patches, live admin files contain `feat/admin-insights` code not on the branch | ✅ done 2026-07-11 (backups /tmp/*.bak-eco-*, settings keys created empty = fail closed) |
| A-2 | Panel `real-wallet` action (linked account + balance via contract 3) + redeem orchestration via contract 4 — fail closed until B-1 exists | ✅ done 2026-07-11 (commit b0c77c2, live; new action `redeem-real-spend`, idempotent on client_ref) |
| A-3 | Mobile A3: wallet card on Profile + redeem sheet, gated by remote-config `rc_real_wallet_enabled` | ✅ done 2026-07-11 (commit 5d789f8; flag live + default OFF; flip `rc_real_wallet_enabled`=1 in settings when B-1/B-2 land) |
| A-4 | C3: REAL referral rewards (`referral_reward_mode` = quota\|real\|both) | queued, after A-3 |
| A-5 | TDLib spike (Path B, `IMPLEMENTATION_PLAN.md` §Spike, 8 questions) → `SPIKE_REPORT.md` | ✅ done 2026-07-11 — core transport PROVEN (TDLib↔local Xray SOCKS5↔Telegram DC handshake, with control). See `SPIKE_REPORT.md`. 2 open items need 1 Android build. |
| A-6 | Ops, off critical path: fix broken `debian-sys-maint` MySQL auth on **Agent B's VPS** (causes `logrotate.service` to fail nightly, unrotated syslog grows unbounded). Needs the real MySQL root password or a brief `--skip-grant-tables` restart — Agent B doesn't have that credential. Details + interim mitigation in `DECISIONS.md` 2026-07-11 "Open ops issue" entry | open — pick up if you (or Khabat) hold that credential/authority |

## Agent B — tasks (web/Shahnameh box)

| # | Task | Status |
|---|---|---|
| B-1 | Ecosystem API in the Shahnameh backend: `/v1/verify-spend`, `/v1/balance/:account`, `/v1/spend` per contracts 2–4 (Bearer auth, idempotent), against the live `real_balance` ledger | **start here** |
| B-2 | Ops: generate `real_link_secret` + `real_api_key`, install in Shahnameh env AND the panel `settings` table (`real_link_secret`, `real_api_url`, `real_api_key`). Names only in docs/commits — never values | with B-1 |
| B-3 | Link-proof minting UX: bot command or Mini App button that, given a `device_id` (user pastes/deep-links from the VPN app), returns `{real_account, ts, sig}` per contract 1 | after B-2 |
| B-4 | RealGram Path A Mini App skeleton in `realgram-miniapp/` (Telegram WebApp SDK + TON Connect + reuse `lib/adsgram.js` reward engine patterns) | after B-1 |
| B-5 | AdsGram: written confirmation whether "alternative clients" covers a native in-chat sponsored card (see assessment §2.3–2.4) — draft + send, log answer in `DECISIONS.md` | parallel |
| B-6 | Path B0 write-up: document "connect ReaLink → open official Telegram" as onboarding copy; note that Iran telemetry already proves the flow works (see `DECISIONS.md` 2026-07-11) | parallel |

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
