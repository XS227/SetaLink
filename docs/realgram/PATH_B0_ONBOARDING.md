# Path B0 onboarding copy — "Connect ReaLink, then open official Telegram"

Task B-6. Documents the finding and proposes copy — does **not** edit
`mobile-app/` (Agent A's owned surface, RN app + i18n). Drop-in proposal for
whoever picks up the actual slide/string addition.

## The finding (already proven, not a hypothesis)

Per `SPIKE_REPORT.md` Q1: **ReaLink already delivers "your Telegram works"
today, for zero new engineering.** The Android app is a full-device
`VpnService` (`route 0.0.0.0/0`), so official Telegram's own traffic already
tunnels through it once connected — this isn't theoretical, Iran telemetry
shows real Telegram flows (`149.154.x` ranges) over both the Finland Reality
node and the Stealth/CDN node in real tester sessions
(`realink-build78-backlog` history, `sl-node3-ws` tunnel).

The gap this doesn't cover: a user for whom Telegram's *install/CDN* is
blocked, not just its live traffic (can't get the app in the first place).
For everyone who already has Telegram installed, "connect ReaLink, open
Telegram" is a complete answer today — not a future RealGram feature.

## Why this belongs in onboarding, not a help article

Users don't reliably discover "just open your other apps normally" on their
own — the mental model most VPN apps train is "only special in-app features
work." A single onboarding slide (or a post-connect tooltip) closes that gap
cheaply, before any RealGram engineering exists, and the closed
Mini-App/Path-A loop later can point back to it too ("or just keep using
official Telegram, already covered").

## Proposed copy — matches the existing 3-slide format exactly

`mobile-app/src/screens/OnboardingScreen.tsx` renders 3 slides from
`mobile-app/src/i18n/index.ts` keys `ob.s1.*` .. `ob.s3.*` (icon + 2-line
title + 2-line subtitle). Proposed 4th slide, same shape:

```
icon:     '📨'
title:    'ob.s4.title'  ->  "Telegram just\nworks too."
subtitle: 'ob.s4.sub'    ->  "Once you're connected, your official Telegram\napp works normally — no extra setup."
accent:   '#2AABEE'   // Telegram brand blue, for visual recognition only —
                       // see APP_STORE_COMPLIANCE.md Rule on no Telegram
                       // logo/branding-as-official-product; a color accent
                       // referencing the app you're describing is fine, its
                       // logo or "official Telegram app" wording is not.
```

Persian (`fa`) is the priority translation given the market — proposed:

```
title: 'تلگرام هم\nکار می‌کند.'
sub:   'وقتی وصل شدید، تلگرام رسمی شما\nبه‌طور معمولی کار می‌کند — بدون تنظیمات اضافی.'
```

Other languages already in `i18n/index.ts` (zh, ru, tg, ar, tr, no, …) are
not translated here — leave `ob.s4.*` English-only until a translator pass,
same as any other new copy would go through.

## Placement options (pick one, not both — Agent A's call)

1. **4th onboarding slide** (above) — highest visibility, seen once per
   fresh install/reset.
2. **Post-connect tooltip/toast**, first successful connection only — lower
   build cost than a new slide, seen at the moment it's actually useful
   (right after connecting), but easy to miss/dismiss.

Recommendation: start with option 2 (cheaper, better-timed) and add the
onboarding slide only if telemetry/support tickets show people still don't
know. Not a strong opinion — either is a small, reversible UI change.

## Out of scope here

- No app code changed by this doc.
- No claim that this replaces RealGram — see `PRODUCT_VISION.md` "Two
  products under one name": Path B0 covers "Telegram already reachable,
  just not obviously so," not "Telegram itself is unreachable to install,"
  which is the actual gap RealGram Path A/B address.
