# RealGram — UI Design System

Extends `mobile-app/DESIGN_SYSTEM.md` (the existing ReaLink mobile app design
system) rather than replacing it. Read that file first — this document only
covers what's new or different for RealGram: locale adaptation, the gold
semantic accent, and the Shahnameh/REAL reaction pack.

## 1. Existing foundation to reuse (already built, don't recreate)

From `mobile-app/DESIGN_SYSTEM.md`:

- Base palette: `bg.void #030609`, `bg.base #070D18`, `bg.surface #0D1828`,
  `bg.elevated #111F35`, primary accent `emerald.400 #00E87A`, secondary
  `blue.400 #3399FF`, text tones `#F0F6FF` / `#7A9BC0` / `#3D5570`.
- Glassmorphism recipe: `rgba(13,24,40,0.72)` background,
  `rgba(255,255,255,0.08)` border, `blur(20px) saturate(180%)`.
- Typography: Inter (primary) + JetBrains Mono (metrics/IDs/timestamps),
  existing type scale and 4px spacing grid.
- **A gold variant already exists as a prototype** —
  `mobile-app/mockups/08-home-gold.html` uses `#D4AF37` (metallic gold) and
  `#F0D060` (light/champagne gold) over the same base palette. **Use these
  exact values for RealGram's gold accent — don't invent new gold tokens.**
  There is also `mobile-app/mockups/10-ecosystem.html`, a mockup already
  exploring ecosystem (Shahnameh/REAL/TrustAI) UI — review it before
  designing RealGram's Play/Earn or reward screens.

## 2. Gold — semantic, not decorative

The brief is explicit and correct: **gold communicates value, and must not
be used everywhere.** Reserve `#D4AF37`/`#F0D060` strictly for:

- Valuable rewards (ad-earned data, referral rewards).
- REAL status / balance display.
- Shahnameh achievements surfaced inside RealGram.
- Referral milestones (see `INTEGRATION_MAP.md` §3's 3/5/8/13/21 ladder).
- Premium/priority connectivity state (the "priority" tiered inbound from
  `ARCHITECTURE.md` §5).
- Earned profile identity/badges.

Everything else — default UI chrome, standard messaging, non-reward
states — stays on the existing emerald/blue/navy palette. If gold appears on
a screen with no value being communicated, that's a design bug, not a style
choice.

## 3. Four-locale design system — one system, locale-aware tokens

**Do not build four separate UI implementations.** Locale differences are
expressed as data (tokens, layout rules) consumed by shared components, the
same way color/spacing tokens already work in the base design system.

### Locale token additions

| Token | Purpose |
|---|---|
| `writingDirection` | `ltr` \| `rtl` — drives layout mirroring |
| `numeralSystem` | `latin` \| `persian` — drives digit rendering (timestamps, counters, data amounts) |
| `fontStack.body` | per-locale font family/fallback chain |
| `textDensity` | `normal` \| `dense` — CJK and Cyrillic need different line-height/wrapping defaults than Latin |
| `dateTimeFormat` | locale-specific formatting rules |

### Persian / Farsi

- True RTL layout — not a mirrored LTR skin. Message bubbles, reply/quote
  indicators, and reaction placement must all follow RTL reading order, not
  just text alignment.
- Persian numerals (۰–۹) where locale-appropriate — timestamps, data
  counters, REAL balances. Confirm with native speakers whether Persian or
  Latin numerals read as more natural for currency/data amounts specifically
  (conventions vary) rather than assuming one answer — track as an open item
  if unresolved before implementation.
- Font stack must support Persian shaping correctly (glyph joining) — do not
  rely on Inter alone; it lacks proper Perso-Arabic script support. Needs a
  Persian-appropriate typeface evaluated during implementation.
- Spacing: Persian text runs visually differently than Latin at the same
  point size — do not assume the existing 4px/Latin-tuned spacing scale
  transfers unchanged; validate with real Persian content, including mixed
  Persian/emoji lines (common in chat).

### Russian

- Cyrillic-optimized typography — verify Inter's Cyrillic glyph coverage and
  weight rendering (some typefaces render Cyrillic noticeably heavier/lighter
  than Latin at the same declared weight).
- Russian text runs longer than English for equivalent content — verify
  wrapping/truncation rules at existing component widths, particularly
  button labels and the UPPERCASE label style already used for micro-labels.
- Local date/time formatting (`dateTimeFormat` token).

### Simplified Chinese

- CJK-compatible typography — Inter does not cover CJK; needs a system CJK
  fallback or a paired CJK typeface, evaluated during implementation.
- Correct line-height/spacing for CJK — Latin-tuned line-height generally
  reads as too loose for CJK; needs its own value via `textDensity: dense`.
- Chinese date/time and punctuation conventions (full-width punctuation,
  different date ordering).
- Layouts must stay readable with dense short text — CJK strings are often
  shorter in character count but visually denser; don't assume Latin
  truncation thresholds transfer.

### English

- The existing LTR baseline design already documented in
  `mobile-app/DESIGN_SYSTEM.md` — no new work beyond confirming it becomes
  one profile among four, not the implicit default everything else is
  patched onto.

## 4. Shahnameh / REAL icon & reaction pack

Original assets inspired by Shahnameh, REAL, Simorgh, Farr, heroic
achievement, and freedom/connectivity themes — evaluated for addition, not
committed yet. Two hard technical rules:

1. **If Telegram supports the reaction natively, map it to Telegram's real
   reaction behaviour.** Don't create a look-alike that behaves differently
   from what the icon implies.
2. **If a reaction is RealGram-specific (no Telegram equivalent), it must be
   explicitly classified as one of:**
   - Local-only UI metadata (never leaves the device, never synced).
   - Backend-synchronized RealGram metadata (stored in RealGram's own
     backend, not Telegram's).
   - Visible only to RealGram users (i.e., a non-RealGram Telegram client
     on the other end sees nothing, or sees a graceful fallback — never a
     broken/garbled representation).

**Never let a RealGram-specific reaction appear to Telegram, or to a
non-RealGram participant, as if Telegram itself received or transmitted
it.** This is the same boundary as the ad-placement rule in
`MONETIZATION_AND_REWARDS.md` §3 — RealGram-only UI must never masquerade as
Telegram protocol activity.

**Asset budget constraint:** original assets must not make the app package
unnecessarily large — see `BUILD_SIZE_BUDGET.md`. Prefer vector formats for
icons; if any reaction pack includes animated/raster assets, evaluate
on-demand delivery the same way Shahnameh's own assets are handled
(`INTEGRATION_MAP.md` §1).

## 5. Message surface improvements (from the brief)

Modern message cards, cleaner replies/quoted messages, improved voice
message presentation, modern image/video/link cards, improved reaction
display, better group-chat readability — all evaluated as visual refinements
on top of the existing glassmorphism system (§1), not a new visual language.
Keep the 90/10 familiar/distinctive ratio from `PRODUCT_VISION.md`: a
Telegram user should recognize every one of these as "a nicer version of
what I already know," not as an unfamiliar interaction pattern.
