# RealGram — Product Vision

**Decided 2026-07-17 by Khabat — see `DECISIONS.md` 2026-07-17 entry.**
This supersedes the 2026-07-10 assessment's framing below the "Official
direction" section. Old **Path A** (Telegram Mini App) and old **Path B**
(TDLib client mirroring the user's real Telegram account/chats) are both
**REJECTED**. See § "Rejected directions" for what they were and why they're
gone — kept for history, not as live options.

## Official direction: RealGram Native Messaging

**"Telegram is a door in. RealGram is where you actually live."**

RealGram has **its own native messaging system** — its own identity, its
own chats, its own clans. Telegram is **an entry point and identity
provider**, never the messaging platform itself:

- Telegram is a **door in and identity provider**, not the message store.
  A user can arrive via the Telegram bot (invite link, deeplink) or
  directly through the RealGram app.
- RealGram ships **its own native chat system** — DMs, clan chats, group
  chats — built and hosted by RealGram, not proxied from Telegram.
- A user **may** log in with Telegram if they want to (convenience,
  identity verification), but this is optional, not the only path in —
  RealGram must work fully for a user who never touches Telegram.
- Shahnameh, VPN (ReaLink), REAL, clans, and community **all share one
  RealGram profile** — see `ADMIN_NOC_ROADMAP.md` § 6.1 for the unified
  identity model.
- The Telegram bot may **send** invitations, notifications, and deeplinks
  *into* RealGram. It must **never** copy or mirror private Telegram
  conversations into RealGram — nothing a user said in real Telegram ever
  becomes RealGram data.

**Why this and not a Telegram mirror:** a client that just shows your real
Telegram chats gives a user no reason to prefer RealGram over Telegram
itself once Telegram is reachable — it's a worse Telegram, forever chasing
API/TDLib parity. A native messaging system tied to VPN identity, Shahnameh
progress, REAL economy, and clans gives users something Telegram itself
cannot: a reason to *stay* installed. This is the product's actual moat.

## Design ratio

**90% familiar messaging behaviour, 10% distinctive RealGram experience.**
A modern-messenger-literate user must immediately understand the app (see
`ADMIN_NOC_ROADMAP.md` § 6.2–6.3 for the concrete screen spec). The 10% is:
unified VPN/Shahnameh/clan identity, a gold-accented reward layer tied to
REAL/Shahnameh/ReaLink, data-quota transfer between users, and a referral
loop — never a redesign of how messaging itself behaves.

## Non-goals (explicit)

- RealGram is **not** a Telegram clone marketed as, or implying it is, an
  official Telegram product. No Telegram logo, no "official" language. See
  `APP_STORE_COMPLIANCE.md` (note: that doc's TDLib-specific risk analysis
  is now moot under this direction — needs a pass to reflect that, not yet
  done as of this decision).
- RealGram does **not** mirror, store, or display a user's private Telegram
  message history. Telegram linking is identity/notification-only — see
  `ADMIN_NOC_ROADMAP.md` § 6.7.
- RealGram is **not** a full-device VPN by default. See `ARCHITECTURE.md` —
  the transport goal is to reuse ReaLink's existing Xray-core as a local
  SOCKS5 endpoint for RealGram's own traffic, not to bundle a second
  `VpnService`/TUN stack. (This part of `ARCHITECTURE.md` is unaffected by
  the Path A/B decision — it was about transport, not messaging.)
- RealGram does **not** build a new advertising network. It reuses AdsGram
  (already integrated and paying out in Shahnameh) — see
  `MONETIZATION_AND_REWARDS.md`.
- RealGram does **not** rebuild Shahnameh. Shahnameh is reused as-is as
  RealGram's Play/Earn surface, now additionally surfaced through the
  Community tab described in `ADMIN_NOC_ROADMAP.md` § 6.4 — see
  `INTEGRATION_MAP.md` §Shahnameh.
- RealGram does **not** build a new referral platform. It adapts TrustAI's
  existing attribution model — see `INTEGRATION_MAP.md` §TrustAI.
- RealGram must **not** claim end-to-end encryption, "secure," or "private"
  as a technical property of its native messaging until the encryption
  model is actually documented and implemented — see
  `ADMIN_NOC_ROADMAP.md` § 6.10.

## The loop this is building toward

```
Telegram bot / deeplink / direct app install (how someone gets in)
    → RealGram native profile created (VPN + Shahnameh + REAL + clan, one ID)
    → RealGram daily use: chats, clan, DMs, resilient VPN connectivity
    → Shahnameh Play/Earn (existing game, reused, not rebuilt)
    → REAL / rewards / data-quota transfer between users
    → ReaLink connectivity value (REAL or ads redeem for data/priority)
    → user returns to RealGram — for the chats and clan, not just the VPN
```

This extends the loop already scoped in
`mobile-app/docs/ECOSYSTEM_INTEGRATION_PLAN.md` §A ("Shahnameh activity →
REAL balance → redeem → SetaLink quota top-up") by giving RealGram its own
retention hook (native messaging + clan) instead of depending on Telegram
usage as the habit driver.

## Rejected directions (kept for history — not live options)

Both evaluated 2026-06/07-10, both **rejected 2026-07-17**:

- **Old Path A — Mini App / bot inside official Telegram.** Rejected:
  cannot make Telegram itself reachable if Telegram is blocked (depends on
  Telegram being reachable to load), and gives RealGram no independent
  identity or retention hook of its own.
- **Old Path B — independent client (TDLib-based) mirroring the user's real
  Telegram account.** Rejected: this is the "worse Telegram forever" trap
  described above — no moat, ongoing TDLib maintenance burden, and real
  app-store distribution risk for functionality that doesn't differentiate
  RealGram from just using Telegram directly.
- **Path B0 — "connect ReaLink, then open official Telegram," no new
  client.** Not rejected outright, but superseded as the primary direction:
  it's still true and still cheap, but it doesn't build toward native
  messaging, so it's no longer the gating validation step for Path B. See
  `PATH_B0_ONBOARDING.md` — treat as historical context, not the active plan.

The TDLib technical spike (`IMPLEMENTATION_PLAN.md` §Spike,
`SPIKE_REPORT.md`) is **moot** — nothing in the new direction depends on
TDLib. `IMPLEMENTATION_PLAN.md` needs a pass to replace its staged roadmap
with `ADMIN_NOC_ROADMAP.md` § 6's phases; flagged there, not yet done as of
this decision.

## Where the real spec lives now

The concrete, task-tracked specification for this direction is
`ADMIN_NOC_ROADMAP.md` § 6 ("REALGRAM COMMUNITY & MESSAGING") — identity
model, screens, DM/clan/group behavior, data-quota transfer, Telegram
interplay, navigation, design, security/moderation, delivery phases, and
done-criteria. This file states the *why*; that file states the *what* and
tracks the *is it actually live*. Data model, user-ID merge plan, migration
plan, and wireframes (§ 6.12's pre-coding gate) live in
`REALGRAM_NATIVE_MESSAGING_DESIGN.md`.
