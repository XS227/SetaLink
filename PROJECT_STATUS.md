# Project Status

> Root-level status file. If you are a fresh agent picking this up, read this
> file first, then `docs/realgram/AGENT_HANDOFF.md`, then
> `docs/realgram/IMPLEMENTATION_PLAN.md`. Everything you need is in the repo —
> you should not need any conversation history to continue.

## ⚠️ If you are picking up the Starlink Windows-gateway work, stop and read this first

**`docs/STARLINK_WINDOWS_HANDOFF.md`** — **RESOLVED 2026-07-16, see its §13.**
The §0 production audit is complete and clean (`test0` removed from
`5.249.252.221`), the fi-hel SSH mystery is solved (the debug key was simply
never authorized there; Agent A's established node key works), and the root
cause is proven by controlled experiment: **One.com drops external inbound
UDP at the hypervisor layer, on both One.com boxes** — it was never
Starlink/Windows/keys. A verified-reachable WireGuard listener now runs on
fi-hel (`65.109.183.7:51820`); the one remaining step is user-at-the-Surface:
update `Endpoint` AND `[Peer] PublicKey` (fresh server key, see §13.4) and
restart the tunnel. Design consequence: the WG rendezvous must live on
Hetzner, not One.com. This is unrelated to the RealGram work below —
different subsystem, different branch state, read it independently.

Last updated: **2026-07-11** (RealGram section below), by Claude (dev-box
session: confirmed push resolution, recorded parallel ecosystem
implementation; original handoff 2026-07-10 by the assessment session).
Starlink section above updated separately, 2026-07-16.

---

## 1. What this repository is

**SetaLink / ReaLink** — a VPN + connectivity product built on Xray-core
(VLESS + REALITY), targeting users under network filtering (primary market:
Iran). It ships as:

- A **CLI/admin product** (repo root: `add-user.sh`, `admin/`, `lib.sh`, …) —
  named users, capped at 50, individually provisioned. Small-scale, operator-run.
- A **mobile app product** (`mobile-app/`) — React Native (Android + iOS),
  anonymous device IDs, server-side quota ledger, the thing most users
  actually install. This is the one relevant to RealGram.

Read `README.md` (root) for the CLI/admin product and `mobile-app/README.md` +
`mobile-app/docs/ARCHITECTURE.md` for the mobile app.

## 2. Branch / commit state

- Default branch: `main`. Latest commit at the time this doc was written:
  `ae78ab0` — "blog: Persian SEO blog with 3 filtershekan articles" (2026-07-10).
- This handoff was authored on a **new branch**, `feature/realgram-foundation`,
  branched from `origin/main` at the commit above, in an **isolated git
  worktree** (`git worktree add`) — the live checkout at
  `/var/www/setalink` on the production VPS was never modified.
- **Push status: RESOLVED 2026-07-11** — the branch is on GitHub (deploy key
  `vps-setalink-realgram` added by the repo owner; verified from a second
  machine). History in `docs/realgram/AGENT_HANDOFF.md` §"Push blocker".
- **Parallel work to know about:** the ecosystem reward loop this plan's
  Phases 1–2 describe is already implemented (not deployed) on branch
  `feat/ecosystem-phase1` — see `docs/realgram/DECISIONS.md` 2026-07-11
  entries and `docs/realgram/AGENT_HANDOFF.md` §"Roadmap overlap". A
  b84–86-merged owner test build (87/0.9.60) of that line exists at
  `download/build87/` (no OTA).

## 3. What's live vs. designed vs. new — one-line map

Full detail in `docs/realgram/INTEGRATION_MAP.md`. Summary:

| System | State |
|---|---|
| ReaLink VPN core (Xray/REALITY, mobile app) | **Live** |
| Shahnameh REAL economy + AdsGram rewards | **Live** (separate repo, separate VPS project — see `docs/realgram/INTEGRATION_MAP.md`) |
| TrustAI referrals → +1GB quota | **Live**, in this repo, since v0.9.16 |
| REAL/USDT premium payments (`docs/PREMIUM-REAL-PAYMENTS.md`) | Designed + backend built. **Not shipped to mobile.** |
| Rewarded-ads quota recovery via AdMob (`docs/REWARDED-ADS-RECOVERY.md`) | Designed + backend built. AdMob IDs are placeholders — **nothing pays out yet.** |
| Multi-node API (`docs/MULTINODE_API_v1.md`) | Server built, **not public**. 2 nodes exist today (1 prod, 1 gated test). |
| Ecosystem Integration Plan (`mobile-app/docs/ECOSYSTEM_INTEGRATION_PLAN.md`) | **Planning only**, dated 2026-06-10. This is the master doc RealGram extends. |
| **RealGram** (independent Telegram-compatible client) | **New. Nothing built. This handoff is the starting point.** |

## 4. What must not be changed

- Do **not** touch `/var/www/setalink` on the production VPS directly — it is
  a live checkout serving production traffic (panel/admin). All RealGram work
  happens in this repo on `feature/realgram-foundation` (or a worktree of it),
  never on `main`, never on the production checkout.
- Do **not** enable the multi-node API for public rollout, and do **not** route
  real user traffic to a new node or protocol, without explicit human
  approval — this is `docs/CLAUDE_REALINK_RULES.md` Rule 7, and it applies to
  RealGram's transport work too.
- Do **not** touch AdMob/Google ad signals, Advertising ID, device identity,
  or location to influence ad targeting or payout — hard rule, already in
  `docs/REWARDED-ADS-RECOVERY.md`, restated for RealGram in
  `docs/realgram/APP_STORE_COMPLIANCE.md`.
- Do **not** begin full RealGram implementation (a real TDLib client build)
  without explicit user sign-off on the technical spike results — see
  `docs/realgram/IMPLEMENTATION_PLAN.md`.

## 5. Next agent — start here

1. Read `docs/realgram/AGENT_HANDOFF.md` fully — it has the exact next action.
2. Confirm whether `feature/realgram-foundation` is pushed to GitHub yet
   (`git log origin/feature/realgram-foundation` — if that fails, it isn't).
3. Do not start the TDLib spike (`docs/realgram/IMPLEMENTATION_PLAN.md` §Spike)
   without the user's explicit go-ahead — it was **not** authorized as of this
   handoff, only planned.

## 6. Quick start

See `docs/realgram/AGENT_HANDOFF.md` §"Quick start for next agent" for exact,
copy-pasteable commands (clone, branch, install, test, build).
