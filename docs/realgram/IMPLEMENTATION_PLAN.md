# RealGram — Implementation Plan

**Status: planning only. No implementation is authorized past the technical
spike without explicit user sign-off on the spike's findings.** See
`DECISIONS.md` for what has and hasn't been approved.

## Recommendation — what to build first

1. **Path B0 (no build at all)** — document and test "connect ReaLink, then
   open official Telegram" with real users. This is a documentation/
   onboarding change to the existing app, not new code. It answers the
   single biggest open question cheaply: how much of the RealGram need is
   packaging/UX vs. a genuine gap (official Telegram itself being
   unreachable to install, not just to use). Do this before writing any
   RealGram code.
2. **The technical spike** (§Spike below), time-boxed, in parallel with #1.
3. **Everything else in this plan is gated on #1 and #2's findings**,
   including the go/no-go on building a full client at all.

This order exists because it's the cheapest way to de-risk the two biggest
unknowns — real user need, and real technical feasibility — before
committing to the largest and riskiest piece of the whole plan (§Phase 3).

## Staged roadmap

| Phase | Deliverable | Depends on | Risk |
|---|---|---|---|
| 0 | Path B0 validated with real users; spike complete and written up | Nothing — can start immediately | Low |
| 1 | Ecosystem Integration Plan §B (Shahnameh promotion banner) + §C2 (TrustAI trust scoring) shipped | Nothing — already scoped in `mobile-app/docs/ECOSYSTEM_INTEGRATION_PLAN.md`, no token custody risk | Low |
| 2 | REAL redemption ledger (Ecosystem Plan §A) shipped behind a remote-config flag | Phase 1 | Medium — new money-like ledger, needs the same rigor as `docs/PREMIUM-REAL-PAYMENTS.md`'s idempotency/verification design |
| 3 | RealGram Path A (Telegram Mini App), reusing Shahnameh's live AdsGram engine + TON Connect | Phase 2 (redemption ledger) for the earn→spend loop to mean anything | Low–Medium |
| 4 | RealGram Path B (independent client) — real build begins | Spike (§0) findings + explicit go/no-go approval | High — see `docs/realgram/README.md`'s cross-referenced risk register in the assessment artifact, and `APP_STORE_COMPLIANCE.md` |

Phases 3 and 4 are not sequentially dependent on each other beyond sharing
backend systems — Path A can ship and run while Path B is still being
evaluated.

## Spike — the eight questions to answer before any full build

Time-boxed. Recommend 1–2 weeks, explicitly bounded — if it's taking
materially longer, that itself is a finding (write it up and stop, don't
quietly extend).

1. **Can the existing ReaLink app open official Telegram reliably for
   blocked users today?** (Path B0 validation — real users, real filtering
   conditions, not a lab test.)
2. **Can TDLib connect through the existing ReaLink/Xray local SOCKS5
   endpoint** (`127.0.0.1:10808`, per `ARCHITECTURE.md` §2)**?** Bare-bones
   proof: TDLib configured with the SOCKS5 proxy, successfully authenticates
   and holds a session under real Iranian DPI conditions, not just on an
   unrestricted network.
3. **Can an existing mobile shell be reused, or must RealGram be a separate
   native project?** Resolves the Option 1 vs Option 2 question in
   `ARCHITECTURE.md` §3.
4. **What is the smallest Telegram-compatible client baseline that's
   legally and technically maintainable?** Not "smallest possible feature
   set" in the abstract — smallest set that (a) satisfies TDLib's own
   integration requirements and (b) doesn't trip the app-store risks in
   `APP_STORE_COMPLIANCE.md`.
5. **How much additional release size does TDLib + the ReaLink transport
   wiring introduce?** Feeds directly into `BUILD_SIZE_BUDGET.md` §3 — this
   is the one number in that document that's currently unmeasured and
   blocking.
6. **Can Shahnameh and reward features stay remote/on-demand** in this
   architecture, or does TDLib's integration model force something to be
   bundled that wasn't expected?
7. **What store permissions are truly required?** Given §2's local-SOCKS5
   approach, RealGram may need *no* VPN/network-extension permission at all
   — confirm this holds in practice, not just in the architecture doc.
8. **Which features can be implemented without adding a full-device VPN
   service?** Cross-check against `ARCHITECTURE.md` §7's "explicitly out of
   scope" list — confirm the spike didn't quietly require something that
   list rules out.

**Output required:** a written spike report (add it to this folder as
`SPIKE_REPORT.md` when complete) and updates to `ARCHITECTURE.md`,
`BUILD_SIZE_BUDGET.md`, and `DECISIONS.md` reflecting what was actually
found — not just "spike done," but the specific answers to all eight
questions above.

**Do not proceed to Phase 4 (full client build) until the spike report
exists and the user has explicitly reviewed and approved it.**

## Effort — honest ranges, not fabricated precision

- **Phase 0 (Path B0 + spike):** small, bounded, days to ~2 weeks.
- **Phase 1 (Ecosystem Plan §B + §C2):** already scoped elsewhere in this
  repo; effort estimate belongs in that plan, not duplicated here.
- **Phase 2 (redemption ledger):** comparable in scope to
  `docs/PREMIUM-REAL-PAYMENTS.md`'s existing backend/admin build — that
  document is the closest real reference point for effort, since it's the
  same team building a structurally similar ledger+verification system.
- **Phase 3 (RealGram Path A):** weeks, on infrastructure already running.
- **Phase 4 (RealGram Path B):** an ongoing product commitment, not a fixed
  project — comparable to standing up and maintaining a small messaging-
  client team's workload, not a sprint. Do not commit a fixed timeline to
  this phase before the spike report exists; any number given before that
  is a guess, not an estimate.

## What must not happen during this plan

- No production rollout of new routing/nodes without explicit approval
  (`docs/CLAUDE_REALINK_RULES.md` Rule 7 — applies to RealGram's transport
  work identically to any other ReaLink network change).
- No full client implementation before the spike report exists and is
  approved.
- No changes to the live `/var/www/setalink` checkout on the production VPS
  — all work happens in this repo/branch, in a worktree if working
  alongside a live checkout.
