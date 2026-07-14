# RealGram — documentation index

RealGram is a proposed independent Telegram-compatible client built on top of
ReaLink's existing connectivity transport, Shahnameh's existing REAL reward
economy, and TrustAI's existing referral pattern. This folder is the durable,
in-repo record of the assessment, decisions, and plan — written so a fresh
agent (any Claude Code session, any account) can pick up the work from the
repository alone, with no access to the conversation that produced it.

**Status as of 2026-07-10: assessment and planning only. No RealGram code
exists yet. Full implementation is explicitly not authorized — see
`DECISIONS.md`.**

## Read in this order

1. **`../../PROJECT_STATUS.md`** (repo root) — current branch, commit, what's
   live vs. planned, what must not be touched.
2. **`AGENT_HANDOFF.md`** — the living handoff. Exact next action, quick-start
   commands, push status. If you read only one file, read this one.
3. **`PRODUCT_VISION.md`** — what RealGram is, the product promise, non-goals.
4. **`ARCHITECTURE.md`** — technical design, including the transport
   architecture recommendation (local SOCKS5, not a second VPN stack) and the
   spike plan.
5. **`INTEGRATION_MAP.md`** — exactly what exists today in Shahnameh, ReaLink,
   and TrustAI, and how RealGram reuses each, file-by-file where known.
6. **`APP_STORE_COMPLIANCE.md`** — store risk, staged release strategy,
   compliance checklist.
7. **`MONETIZATION_AND_REWARDS.md`** — AdsGram integration/compliance,
   rewarded connectivity, economics.
8. **`UI_DESIGN_SYSTEM.md`** — four-locale design system, gold semantic
   accent, Shahnameh/REAL reaction pack plan.
9. **`BUILD_SIZE_BUDGET.md`** — current app size baseline, budget, CI check.
10. **`IMPLEMENTATION_PLAN.md`** — staged roadmap, the TDLib spike, effort and
    risk, recommendation on what to build first.
11. **`DECISIONS.md`** — a dated log of decisions actually made, with
    rationale. Append-only; don't rewrite history here.
12. **`OPEN_QUESTIONS.md`** — unresolved questions, each with who needs to
    answer it and what's blocked on it.

## Relationship to existing docs in this repo

RealGram is **not** a rewrite of the existing plans — it's the client-side
extension of work already scoped in:

- `docs/PREMIUM-REAL-PAYMENTS.md`
- `docs/REWARDED-ADS-RECOVERY.md`
- `docs/MULTINODE_API_v1.md`
- `docs/CLAUDE_REALINK_RULES.md`
- `mobile-app/docs/ECOSYSTEM_INTEGRATION_PLAN.md`
- `mobile-app/docs/ARCHITECTURE.md`
- `mobile-app/DESIGN_SYSTEM.md`

Every file in this folder cross-references the specific existing doc it
builds on instead of restating it. If something here seems to duplicate one
of those files, that's a bug in this handoff — flag it in `OPEN_QUESTIONS.md`.
