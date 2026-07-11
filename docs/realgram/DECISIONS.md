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
