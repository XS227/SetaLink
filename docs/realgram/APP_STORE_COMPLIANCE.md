# RealGram — App Store / Play Store Compliance

## Why this document exists

Verified during the assessment session: the unofficial Telegram client
**"Telega" was removed from Apple's App Store in April 2026.** This is not a
hypothetical risk — it's a recent, direct precedent for exactly this category
of app. Plan distribution and store positioning around that fact from day
one, not as a contingency.

## Hard rules

1. **Never use Telegram's logo, name-as-brand, or any implication that
   RealGram is an official Telegram product.** "Telegram-compatible" is
   accurate and safe; "Telegram" as the app's own branding, or Telegram's
   icon, is not.
2. **Never market the first store build as bypassing a government blockade,
   censorship, or a named country's restrictions.** This is both an app-store
   policy risk and, in ReaLink's own market, an operational-safety
   consideration already tracked via `docs/CLAUDE_REALINK_RULES.md` Rule 1
   (the Iran filtering watchlist). Use truthful, non-targeting language:
   *"Independent Telegram-compatible client with resilient and secure
   connectivity."*
3. **Never manipulate ad geolocation** (e.g. routing traffic through a
   ReaLink exit node to make ad-network traffic appear to originate from a
   different country for higher CPM). This is already a hard rule for
   ReaLink's existing AdMob integration (`docs/REWARDED-ADS-RECOVERY.md`) and
   applies identically to RealGram/AdsGram. Compliant geographic routing for
   *connectivity* (choosing the best-performing ReaLink node) is fine;
   deliberately spoofing geography *to* an ad network is not.
4. **Do not silently alter, store, or transmit anything into Telegram's
   protocol/message history that Telegram itself didn't send or receive.**
   Sponsored cards, RealGram-specific reactions, and reward UI must be
   clearly local-only or RealGram-backend-only. See
   `MONETIZATION_AND_REWARDS.md` §Ad placement for the exact constraints.

## Staged release strategy

Do not ship v1 as an overloaded combination of Telegram-compatible client +
VPN + crypto wallet + game + ad platform + referral platform. That
combination is the single biggest reviewable-rejection surface a store team
could point to.

**First store-safe release scope:**

- Independent RealGram identity (name, icon, listing copy — none referencing
  Telegram as a brand).
- Telegram-compatible login and messaging (the TDLib core functionality).
- Resilient "Smart Connection" (the ReaLink transport from `ARCHITECTURE.md`
  §2, described in the listing as connectivity resilience, not circumvention).
- Clear privacy disclosures (what RealGram can and cannot see — TDLib/
  Telegram's own encryption model applies; RealGram's own reward/referral
  data collection must be disclosed separately and accurately).
- Minimal referral/reward functionality (enough to prove the loop, not the
  full milestone ladder from `INTEGRATION_MAP.md` §3).
- Optional Shahnameh entry point (one card/tab, not deeply integrated yet).
- Voluntary rewarded advertising in a **clearly separated surface** (a
  Rewards/Connectivity screen — not woven into the chat feed, per
  `MONETIZATION_AND_REWARDS.md` §Ad placement's compliant fallback).

Everything beyond this — deeper Shahnameh integration, the full referral
milestone ladder, in-chat sponsored cards if AdsGram confirms support — comes
in later releases, once the first release has store history and the risk
profile is better understood.

## Distribution channel plan

- **Primary, from day one: direct APK / sideload.** Do not budget a launch
  date on store approval for a Telegram-compatible client, per the Telega
  precedent above.
- **Google Play and Apple's App Store are evaluated separately, not as one
  "app store" bucket.** The two platforms have historically enforced against
  Telegram-protocol-adjacent clients at different times and rates, and that
  can change without notice — track both independently, don't assume a Play
  Store approval predicts an App Store one or vice versa.
- If a store listing is pursued, keep it strictly to the "first store-safe
  release scope" above — do not submit the full-featured version.

## Pre-implementation compliance checklist

- [ ] App name and icon do not reference Telegram as a brand.
- [ ] Store listing copy reviewed against Rule 2 above (no
      censorship/blockade-bypass framing).
- [ ] Privacy policy drafted, covering: what TDLib/Telegram data RealGram can
      access, what RealGram's own backend stores (referral, reward, quota
      ledger data), and what it does not.
- [ ] AdsGram placement confirmed compliant (see
      `MONETIZATION_AND_REWARDS.md` §Ad placement) before any in-chat ad UI
      is built.
- [ ] No AdMob/ad-network geolocation manipulation anywhere in the codebase
      (confirmed by code review, not just by policy statement).
- [ ] First release feature scope matches the "staged release strategy"
      list above — nothing extra smuggled in.
- [ ] Direct-APK distribution path tested end-to-end (download, install on a
      representative low-end/older Android device — see
      `mobile-app/docs/APK_COMPATIBILITY_REPORT.md` for the exact class of
      device that has broken installs before).
- [ ] Legal/compliance review of REAL-token language in RealGram's own UI —
      reuse the existing hard rule from `docs/PREMIUM-REAL-PAYMENTS.md`
      ("utility/payment token... never present REAL as an asset that
      appreciates") verbatim; do not re-derive this independently.

## Open item

Store policy is not static. Before each release, re-check current App
Store/Play Store policy on VPN-adjacent and Telegram-protocol-adjacent apps
— do not rely on this document's snapshot indefinitely. Log findings in
`docs/iran-filtering-intelligence.md` if they affect connectivity behaviour,
or in this file's revision history if they affect store strategy.
