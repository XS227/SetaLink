# RealGram — Decisions log

Append-only. Each entry: what was decided, when, by whom, and why. Don't
edit past entries when a decision changes — add a new entry that supersedes
it and say so explicitly, so the history stays reconstructable.

---

### 2026-07-10 — Path B (independent client) is wanted, scoped in parallel with Path A

**Decided by:** Khabat, in response to the technical assessment.
**What:** RealGram is not Path A (Telegram Mini App) only — Path B
(independent Telegram-compatible client, TDLib-based) is to be actively
scoped alongside Path A, not deferred indefinitely.
**Why it matters:** this is the single decision that unlocks the whole
`ARCHITECTURE.md` §2–3 transport design and the `IMPLEMENTATION_PLAN.md`
Phase 4 line item. Without it, RealGram would have stayed scoped as
Mini-App-only.
**Still gated by:** the technical spike (`IMPLEMENTATION_PLAN.md` §Spike) and
explicit approval of the spike's findings before full implementation begins
(see next entry).

### 2026-07-10 — Full RealGram implementation is not authorized yet

**Decided by:** Khabat, explicit instruction accompanying the full RealGram
brief.
**What:** this handoff (documentation, planning, the spike *plan* — not the
spike itself) is authorized. Writing the actual client, or running the
technical spike, is **not** authorized until the user reviews this
documentation and explicitly approves proceeding.
**Why it matters:** the biggest risk in a brief this large is an agent
treating "scope this" as "build this." This entry exists so that risk is
recorded in the repo, not just in a conversation.

### 2026-07-10 — No AdMob/ad-network geolocation manipulation, ever

**Decided by:** Khabat, explicit instruction.
**What:** RealGram must never route traffic through a ReaLink exit node to
make ad-network traffic appear to originate from a different country for
higher ad revenue.
**Why it matters:** this is consistent with — and restates — a hard rule
already in this repo for the existing AdMob integration
(`docs/REWARDED-ADS-RECOVERY.md`). Not a new constraint, a confirmed one.
**How to apply:** see `APP_STORE_COMPLIANCE.md` Rule 3 for the full
statement and the compliant/non-compliant distinction (geographic routing
for connectivity quality is fine; routing specifically to spoof ad-network
geography is not).

### 2026-07-10 — No custom advertising network; reuse AdsGram

**Decided by:** Khabat, explicit instruction.
**What:** RealGram does not build or operate its own ad sales
portal/network. It reuses AdsGram, already integrated in Shahnameh.
**Why it matters:** bounds the monetization build entirely to
`MONETIZATION_AND_REWARDS.md`'s "extend, don't rebuild" approach.

### 2026-07-10 — No Telegram branding, no "official product" implication

**Decided by:** Khabat, explicit instruction.
**What:** RealGram must not use Telegram's logo or imply it is an official
Telegram product, and the first store release must not market itself as
bypassing a government blockade.
**Why it matters:** directly shapes `APP_STORE_COMPLIANCE.md`'s hard rules
and staged release strategy.

### 2026-07-10 — Push access to `github.com/XS227/SetaLink` not available from this session

**Decided/found by:** Claude, during this handoff session.
**What:** no working git credential (HTTPS or SSH) for push access to this
repo was found on the VPS this session ran from. The default SSH key on the
box authenticates as a deploy key scoped to a *different* repo
(`XS227/REALShahnameh`), not this one. Branch `feature/realgram-foundation`
was created and committed locally (in an isolated worktree) but **may not be
pushed to GitHub yet** — see `AGENT_HANDOFF.md` §"Push blocker" for current
status and what's needed to resolve it.
**Why it matters:** a fresh agent must not assume this branch exists on
GitHub just because this documentation references it.

### 2026-07-11 — Push access resolved; branch is on GitHub (supersedes 2026-07-10 push-access entry)

**Decided/done by:** Khabat (deploy key) + Claude (verification, dev-box
session).
**What:** the repo owner set up a write-scoped deploy key
(`vps-setalink-realgram`) for `XS227/SetaLink` on the VPS that authored this
handoff, and `feature/realgram-foundation` (tip `009ed7f`) is confirmed
present on `origin` from a second machine. The 2026-07-10 "no push access"
finding is superseded.
**Why it matters:** multi-agent collaboration on this branch is now possible;
`AGENT_HANDOFF.md` §"Push blocker" is resolved and kept as history.

### 2026-07-11 — Roadmap Phases 1–2 already implemented on `feat/ecosystem-phase1`

**Found by:** Claude (dev-box session), while syncing this handoff.
**What:** `IMPLEMENTATION_PLAN.md`'s Phase 1 (Ecosystem Plan §B + §C2) and
Phase 2 (§A ledger + A2 account linking + server-verified `redeem-real`)
exist as tested code on branch `feat/ecosystem-phase1` (commits `eceab4b`,
`ac5cea5`, 2026-07-11) — implemented in parallel, before this handoff was
read. Not deployed, not merged to main. Custody follows the plan's own
recommendation: internal settlement, no on-chain ops in the VPN panel;
unverifiable spends fail closed to `pending` + manual admin review.
**Why it matters:** RealGram Path A (Phase 3) is no longer blocked on
building Phases 1–2 — only on deploying them. Effort planning should not
double-count this work.

### 2026-07-11 — Build authorized; work split across two agents

**Decided by:** Khabat ("ok dere kan begynne å bygge. del taskene i 2 …
så jobber dere med samme git repo").
**What:** implementation is now authorized. Work is split per
`TASK_SPLIT.md`: Agent A (dev box) takes VPN panel + mobile app (deploy of
the ecosystem backend, wallet proxy, A3 wallet UI, C3, then the TDLib
spike); Agent B (web/Shahnameh box) takes the Shahnameh-side ecosystem API
(verify-spend/balance/spend), link-proof minting, the Path A Mini App
skeleton, and the AdsGram confirmation. API contracts between the two are
frozen in `TASK_SPLIT.md` §Contracts.
**Supersedes:** the 2026-07-10 "full implementation not authorized yet"
entry, within the scope listed in `TASK_SPLIT.md`. Phase 4 (full Path B
client) remains gated on the spike report per `IMPLEMENTATION_PLAN.md`.

### 2026-07-11 — Open ops issue on Agent B's VPS: `debian-sys-maint` MySQL auth broken, blocks nightly logrotate

**Found by:** Claude (Agent B session), while doing routine disk cleanup —
unrelated to the ecosystem work above.
**What:** `logrotate.service` has failed every night since at least
2026-07-09 on Agent B's VPS (the one that also runs `/var/www/backend`
Shahnameh Node+Mongo, the bot, TrustAI). Cause: `mysql -u debian-sys-maint`
(credentials in `/etc/mysql/debian.cnf`) gets `Access denied` — the stored
password no longer matches the actual DB user. Logrotate runs all
`/etc/logrotate.d/*` configs in one job; the mysql postrotate script fails
before the alphabetically-later `rsyslog` config runs, so `/var/log/syslog`
has not been rotated/compressed since 2026-07-05 and keeps growing
unbounded (grew to 1.6GB uncompressed before manual cleanup today).
**Interim mitigation applied (reversible, no service restart):** manually
gzip'd the stale `syslog.1` (freed ~1.5GB) and vacuumed the systemd journal
to 100M. Also raised this VPS's inotify limits
(`fs.inotify.max_user_watches` 8192→524288, `max_user_instances` 128→1024
via `/etc/sysctl.d/60-inotify.conf`) — a related but separate finding: the
misleading "No space left on device" errors from xray/sessions/logrotate on
this box were an exhausted inotify watch limit, not actual disk space.
**Not fixed:** the actual MySQL credential mismatch. Fixing it needs either
the real MySQL root password (not found anywhere on this VPS —
`/root/.my.cnf` doesn't exist, no app config has it) or a brief
`--skip-grant-tables` restart of `mysqld` to reset it, which causes a few
seconds of DB downtime for everything on this VPS using MySQL. Khabat asked
that whichever agent/session *does* have that credential (or authority to
take the brief downtime) fix it, rather than Agent B guessing at
production MySQL auth. Until fixed, this will recur weekly — someone will
need to periodically re-run `gzip /var/log/syslog.1` and
`journalctl --vacuum-size=100M` on this VPS as a stopgap.
**Why it matters:** this is infra hygiene, not RealGram/ecosystem scope —
flagged here only because this is the shared coordination doc both agents
watch. Doesn't block any A-/B- task above.

### 2026-07-11 — TDLib transport spike passed (A-5)

**Done by:** Claude (Agent A, dev box).
**What:** the core Path B unknown is resolved. Real TDLib (libtdjson,
`testProxy`) completed a full MTProto DC handshake through the app's actual
Xray transport via local SOCKS5 (`127.0.0.1:11080` → Finland prod node),
with a passing dead-port control. Proves `ARCHITECTURE.md` §2: TDLib over the
bundled Xray's SOCKS5, no second VPN stack, no TUN, no VPN/network-extension
permission for the messaging path. Full write-up + the 8-question answers in
`SPIKE_REPORT.md`.
**Recommendation recorded:** build RealGram as a MODULE in the existing app
(Option 1 reuse), not a separate client — a separate app would duplicate
`libxray.so` (+36 MB, measured) for zero transport benefit.
**Still open (not blockers to deciding Option 1):** (1) Android arm64
`libtdjson.so` size — one NDK build; (2) TDLib-over-SOCKS5 under live Iranian
DPI on a real phone — both halves already proven separately.
**Gate unchanged:** Phase 4 full client build still needs Khabat's explicit
go on this report (per the 2026-07-10 authorization entry). No production
services were touched; the only process started was a loopback Xray, now
stopped.

### 2026-07-11 — A-4 (C3) shipped; contract §5 (grant) added; admin-visibility merged

**Done by:** Claude (Agent A).
**What:** C3 REAL referral rewards live (`referral_reward_mode` quota|real|both,
default quota = no behaviour change). Introduced contract §5 `/v1/grant`
(Agent B's B-7) — the only missing piece for real/both payouts; panel is
fail-safe until it exists (grants recorded pending, unlinked parties fall back
to quota). Merged Agent B's `feat/ecosystem-admin-visibility` into
`feat/ecosystem-phase1` and deployed it (✓/✗ ecosystem-status line on the REAL
panel — satisfies the standing admin-visibility rule). Answered B-4: deep-link
scheme is `setalink://link-real-account?...` (not `realink://`); app side
implemented (`f124fad`).
**Blocked on Khabat:** the coordination hub's `AGENT_COORD_API_KEY` +
`AGENT_COORD_VAULT_KEY` (and the backend's reachable origin for `real_api_url`)
need relaying to Agent A's environment. Those unblock B-2 (secret exchange via
`/coord/secrets`), which is the last step before the live wallet flow can be
switched on (`rc_real_wallet_enabled`).

### 2026-07-11 — Incident: /v1/* (and everything else new today) was never publicly reachable

**Found by:** Claude (Agent B session), while looking up `real_api_url` to
put it in the coord vault.
**What:** `shahnameh.setaei.com`'s nginx `/api/` location was
`proxy_pass`ing to `localhost:3000` — an orphaned, un-pm2-managed
`node app.js` process (PID 776114, started 2026-07-07) that had silently
stopped responding on several routes while still holding the TCP port open
(new requests connected, then hung until timeout; a handful of older
routes that didn't touch MongoDB still answered fine, which is why nothing
looked broken at a glance). The pm2-managed process ("khabat", port
45721) — the one every code change today actually went into, via pm2's
`watch: true` auto-restart — was never in the public request path at all.
**Practical effect:** every endpoint built today (B-1's `/v1/*`, B-3's
`/season2/link-real-proof`, the `/coord/*` hub, now B-7's `/v1/grant`) was
reachable on `127.0.0.1:45721` for this session's own smoke tests, but
**not from the public internet, and not from Agent A's server**, for the
entire day until this was found and fixed. Agent A's B-2 plan (pull
secrets from the coord vault, set them, confirm end-to-end) would have
failed at the "confirm end-to-end" step had this not been caught first.
**Fix:** repointed the nginx `location /api/` `proxy_pass` to
`localhost:45721`, reloaded nginx, verified both an old route
(`/api/season2/ads/config`) and a new one
(`/api/season2/link-real-proof`) respond correctly over the public
domain, then killed the orphaned PID 776114 (freed port 3000, nothing
else was using it).
**Why it matters:** `real_api_url = https://shahnameh.setaei.com/api` is
NOW genuinely correct and confirmed reachable (re-verified `/api/v1/*`
specifically too) — this is the value placed in `/coord/secrets` as
`real_api_url`. Before this fix, that value would have looked plausible
and been completely wrong to hand to Agent A.
**Lesson for future agents on this VPS:** `ps aux | grep app.js` before
trusting that "pm2 shows it online" means "the internet can reach the
current code" — check what nginx's `proxy_pass` actually points to,
separately, whenever a new endpoint doesn't behave as expected publicly
despite working on localhost.

### 2026-07-12 — AdsGram inquiry sent (B-5)

**Done by:** Khabat, via AdsGram's Telegram support channel.
**What:** the finalized B-5 inquiry (`ADSGRAM_INQUIRY_DRAFT.md`) was sent —
asking whether "alternative clients" covers a native, locally-rendered
in-chat sponsored card for a TDLib client, plus integration path / policy /
volume questions.
**Awaiting:** AdsGram's reply. It gates the in-chat ad-surface design
(assessment §2.4): if yes → build the local card; if no/unclear → fall back
to a dedicated "RealGram Connectivity" Mini App/panel surface. Log their
answer here when it lands.

### 2026-07-12 — initData verification closed for link-real-proof (README open question #4)

**Decided/done by:** Claude (Agent B session), "start på initData-
verifiseringen nå, ikke vent på meg" (Khabat, while B-5 was in flight with
Agent A).
**What:** `/season2/link-real-proof` (shahnameh-backend) now requires and
cryptographically verifies `Telegram.WebApp.initData` (Telegram's official
HMAC-SHA-256 algorithm) instead of trusting a client-supplied
`telegram_id`. New `lib/telegramAuth.js`, 7 isolated test cases + a live
end-to-end pass. `realgram-miniapp/main.js`'s `requestLinkProof()` updated
to send `tg.initData` (raw signed string) instead of the id.
**Deliberately scoped, not a blanket fix:** only this one endpoint changed.
It's the one that mints a proof capable of claiming a REAL wallet — an
unverified `telegram_id` there would let anyone mint a valid proof for
someone else's account. Balance lookup and the AdsGram reward call in the
same Mini App file still send a plain `telegram_id`, matching the rest of
season2's existing API — an accepted, pre-existing gap for the low-stakes
game currencies, not retrofitted here (that's a separate, much larger
change to season2 auth broadly, per the original open-question note).
**Why it matters:** closes the actual exploit path (mint a link proof for
an account you don't own) before the Mini App is deployed anywhere real —
zero migration cost, since nothing in production depended on the old
request shape yet.
**Commits:** shahnameh-backend `fdd7c19`, SetaLink `aa9fc98`.

### 2026-07-12 — AdsGram answered B-5: "We only operate on Telegram" → RealGram Path B uses AdMob

**Answer received by:** Khabat, via AdsGram's Telegram support.
**What AdsGram said:** *"Hello! We only operate on Telegram."* — i.e. AdsGram
does NOT serve a standalone/alternative client. Their "alternative clients"
marketing category does not extend to a native TDLib app's in-chat surface;
they operate only inside Telegram (Mini Apps, bots, channels).
**Decision (Khabat):** the RealGram **independent client (Path B) uses AdMob**
for its in-app ads, not AdsGram. This is exactly the compliant fallback the
assessment already specified (§2.4: if AdsGram doesn't cover the native
in-chat card, don't force it). AdMob is already integrated in the ReaLink app,
so the pattern + compliance rules (no geo-spoofing, rewarded/best-effort) carry
over directly.
**Unchanged:** AdsGram stays the ad engine for anything that runs INSIDE
Telegram — Shahnameh and the RealGram **Path A Mini App** (B-4). So the
ecosystem keeps AdsGram where it works (Telegram) and AdMob where it must
(the native app). No in-chat sponsored-card design is needed — that idea is
closed by this answer.

### 2026-07-12 — B-14 spec: ecosystem @handle lookup + claim (contract §7)

**Requested by:** Agent A, TASK_SPLIT.md — the one thing needed to unblock
A-11 (ReaLink identity: handle + avatar), which is being built now against
a local-first stub in the meantime.
**Owner:** `season2_users.handle` (Shahnameh backend) is the source of
truth — one ecosystem-wide handle namespace, not per-app. Sparse unique
index, so accounts without one yet don't collide on `''`.
**Format:** lowercase, `[a-z0-9_]{3,20}`. Callers should lowercase before
sending; the backend also normalizes defensively.

```
GET {real_api_url}/v1/handle-lookup?handle=<handle>
Authorization: Bearer {real_api_key}
→ 200 {"available": true}                        not claimed
→ 200 {"available": false, "account": "<real_account>"}   claimed — this is
  how ReaLink resolves "@handle" to an account for "add friends by handle"
→ 400 {"error": "bad_handle"}                     fails the format regex
```

```
POST {real_api_url}/v1/handle-claim
Authorization: Bearer {real_api_key}
{"account": "...", "handle": "..."}
→ 200 {"claimed": true, "handle": "..."}          claimed (or re-claiming
  your own handle again — idempotent, not an error)
→ 409 {"error": "handle_taken"}                   someone else already
  owns it — DB unique index is the source of truth under a race, same
  claim-first pattern as /v1/spend and /v1/grant's idempotency_key
→ 404 {"error": "account_not_found"}
→ 400 {"error": "bad_handle"}
```

**Behavior notes:** claiming a new handle overwrites the account's previous
one (changing your handle is allowed, not append-only). No reservation
hold/expiry — first successful claim wins, permanently, until changed.
**Status:** live on the ecosystem backend as of this entry (shahnameh-backend
commit `27fe04e`), tested end-to-end (lookup free/taken, claim, idempotent
re-claim, 409 conflict, 404 unknown account, 400 bad format). Nothing
pending on B-14's side — A-11 can wire against this whenever ready.
