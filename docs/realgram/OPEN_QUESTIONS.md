# RealGram — Open questions

Each entry: the question, who needs to answer it, and what's blocked on it.
Move an entry to `DECISIONS.md` (with a dated entry) once it's resolved —
don't just delete it here.

---

### Q1 — REAL custody model

**Question:** does RealGram's backend (or ReaLink's panel) hold a REAL hot
wallet, or does settlement happen internally against the existing ledger
first?
**Who answers:** Khabat.
**Blocked on this:** any implementation of the redemption ledger
(`IMPLEMENTATION_PLAN.md` Phase 2).
**Existing guidance:** `mobile-app/docs/ECOSYSTEM_INTEGRATION_PLAN.md` §A
already recommends "internal settlement first, no on-chain ops inside the
VPN panel" — treat this as the default answer unless explicitly overridden.

### Q2 — Who contacts AdsGram about native in-chat placement support

**Question:** does Khabat contact AdsGram directly, or should an agent draft
the question for AdsGram's support/docs team?
**Status (2026-07-11):** drafted, not sent — see `ADSGRAM_INQUIRY_DRAFT.md`.
Agent B has no AdsGram account/support channel access, so the draft is as
far as this can go without Khabat. Send it (as-is or edited), then log the
answer in `DECISIONS.md` and close this out.
**Who answers:** Khabat.
**Blocked on this:** `MONETIZATION_AND_REWARDS.md` §3's in-chat "Sponsored"
card — must not be designed or built until this is confirmed. The compliant
fallback (dedicated Rewards/Connectivity screen) can proceed without waiting
on this.

### Q3 — RealGram app structure: extend the existing app, or a separate app?

**Question:** `ARCHITECTURE.md` §3 recommends Option 2 (separate app/repo,
sharing backend + Xray-core, not sharing the app shell) for store-risk
isolation — but this is a recommendation, not a decision.
**Who answers:** Khabat, informed by the spike's findings (§6 of the eight
spike questions specifically touches this).
**Blocked on this:** any actual repo/project setup for RealGram's client
code — nothing should be scaffolded until this is settled, to avoid
throwaway structure.

### Q4 — Qualified referral activation definition

**Question:** which of the five candidate definitions in
`INTEGRATION_MAP.md` §3 (install / Telegram login / active N days / real
activity / watched a rewarded ad) counts as "qualified" for the referral
reward?
**Who answers:** Khabat.
**Blocked on this:** the referral reward implementation in
`IMPLEMENTATION_PLAN.md` — must be defined precisely before any reward
logic is written, per the brief's own instruction.
**Existing guidance:** the live SetaLink referral system already rewards on
first VPN connect (a real usage signal, not registration) — this precedent
suggests the team's bias, but it is not a decision for RealGram until
confirmed.

### Q5 — Persian numerals: Persian or Latin digits for currency/data amounts?

**Question:** `UI_DESIGN_SYSTEM.md` §3 flags that conventions vary for
whether REAL balances and data amounts should render in Persian (۰–۹) or
Latin digits within an otherwise-Persian UI.
**Who answers:** needs native-speaker/UX input, not an engineering guess.
**Blocked on this:** finalizing the Persian locale token profile — not
blocking for other locales or for backend work.

### Q6 — iOS build size baseline

**Question:** what is the current ReaLink iOS app's IPA/archive size?
**Who answers:** whichever agent/session has a macOS + Xcode build
environment available — not answerable from this (Linux VPS) session.
**Blocked on this:** completing `BUILD_SIZE_BUDGET.md` §2 — currently marked
unmeasured.

### Q7 — GitHub push access for `feature/realgram-foundation`

**Question:** how should this branch actually get onto GitHub — a deploy
key added to the repo, a personal access token provided to the agent
environment, or should the maintainer push it from their own machine using
the prepared local branch?
**Who answers:** Khabat.
**Blocked on this:** nothing else in this plan is blocked by this — the
documentation exists in the local branch/worktree regardless — but no other
agent or collaborator can pull this work until it's resolved. See
`AGENT_HANDOFF.md` §"Push blocker" for exact current state.
