# RealGram — Product Vision

## The promise

**"Open RealGram. Your Telegram works."**

RealGram is an independent Telegram-compatible client. A user logs in with
their existing Telegram account and sees their existing chats, contacts,
groups, channels, media, and identity — inside RealGram. When direct Telegram
access is blocked or unstable, RealGram uses ReaLink connectivity so it keeps
working. The user should feel: *"Telegram is inside RealGram, but RealGram
connects more reliably and gives me additional rewards and experiences."*

## Design ratio

**90% familiar messaging behaviour, 10% distinctive RealGram experience.**
Existing Telegram users must immediately understand the app. The 10% is:
resilient connectivity that "just works," a gold-accented reward layer tied to
REAL/Shahnameh/ReaLink, and a referral loop — never a redesign of how
messaging itself behaves.

## Non-goals (explicit)

- RealGram is **not** a Telegram clone marketed as, or implying it is, an
  official Telegram product. No Telegram logo, no "official" language. See
  `APP_STORE_COMPLIANCE.md`.
- RealGram is **not** a full-device VPN by default. See `ARCHITECTURE.md` —
  the transport goal is to reuse ReaLink's existing Xray-core as a local
  SOCKS5 endpoint for RealGram's own traffic, not to bundle a second
  `VpnService`/TUN stack.
- RealGram does **not** build a new advertising network. It reuses AdsGram
  (already integrated and paying out in Shahnameh) — see
  `MONETIZATION_AND_REWARDS.md`.
- RealGram does **not** rebuild Shahnameh. Shahnameh is reused as-is as
  RealGram's Play/Earn surface — see `INTEGRATION_MAP.md` §Shahnameh.
- RealGram does **not** build a new referral platform. It adapts TrustAI's
  existing attribution model — see `INTEGRATION_MAP.md` §TrustAI.
- RealGram must **not** silently alter, store, or forward anything into
  Telegram's own message history or protocol that Telegram itself didn't
  send. Sponsored content, RealGram-specific reactions, and reward UI are
  local-only or RealGram-backend-only — never injected into Telegram data.
  See `MONETIZATION_AND_REWARDS.md` §Ad placement.

## The loop this is building toward

```
Telegram utility (why someone opens the app)
    → RealGram daily use (resilient connection is the retention hook)
    → Shahnameh Play/Earn (existing game, reused, not rebuilt)
    → REAL / rewards (existing token + reward ledger)
    → ReaLink connectivity value (REAL or ads redeem for data/priority)
    → user returns to RealGram
```

This loop is not new — it is the exact flow already scoped in
`mobile-app/docs/ECOSYSTEM_INTEGRATION_PLAN.md` §A ("Shahnameh activity → REAL
balance → redeem → SetaLink quota top-up"). RealGram is the client surface
that makes that loop visible and habitual, instead of a background account
link.

## Two products under one name — resolve this before scoping further

"RealGram" can mean two materially different things. Both are covered in
`ARCHITECTURE.md`, but the product vision must be explicit about which one
is being built, because they have different cost, risk, and what they can
honestly promise:

- **Path A — Mini App / bot.** Runs inside official Telegram. Cannot make
  Telegram itself reachable if Telegram is blocked (it depends on Telegram
  being reachable to load). Fast, low-risk, reuses Shahnameh's live AdsGram
  integration directly.
- **Path B — independent client (TDLib-based).** Can honestly deliver "your
  Telegram works" even when official Telegram can't be reached or installed.
  Higher cost, carries real app-store distribution risk (see
  `APP_STORE_COMPLIANCE.md`), and is an ongoing maintenance commitment, not a
  one-time build.
- **Path B0 — no new client at all.** ReaLink's existing mobile app is
  already a full-system VPN. "Connect ReaLink, then open official Telegram"
  already delivers most of the promise today, for zero new engineering. This
  should be validated with real users before Path B is built — it tells you
  how much of the RealGram need is a UX-packaging problem vs. a genuine gap
  (e.g. official Telegram itself being unreachable to *install*, not just to
  use).

**Decision on record** (see `DECISIONS.md`): Path B is wanted, scoped in
parallel with Path A, not deferred indefinitely — but full implementation of
Path B is gated on a technical spike (`IMPLEMENTATION_PLAN.md` §Spike) and
explicit user approval after reviewing it.
