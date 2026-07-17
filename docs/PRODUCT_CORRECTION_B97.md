# URGENT PRODUCT CORRECTION — b97 (Khabat, 2026-07-17)

Khabat's verbatim direction, received by Agent A ~07:30 UTC. This is an
**urgent product correction, not a design proposal**. Agent B drives the app
work (established split); Agent A has already shipped the server side (§ "API
contract" below, live on prod). Nothing here waits for the Windows ICS work.

**Release rules (§8 of the order):**
- Android first. Marketing version stays **0.9.67**; increment versionCode
  (next free: 97). Publish to **Beta/Experimental only**; stable untouched.
- Do NOT: add unfinished Clan functionality, change Instagram routing, or
  regress any merged VPN/split-tunnel/Node Intelligence/telemetry fix.
- Keep APK size controlled — no large media packs.
- Before publishing, Khabat requires: screenshots (Home, Servers, Game,
  Messaging), proof Game tab opens the authenticated game (not the website),
  proof an eligible device sees the Starlink card/node, APK filename,
  versionCode, sha256, direct beta URL, short **Persian** tester changelog.

## 1. Header redesign — HIGHEST UI PRIORITY

Current header is cluttered/inconsistent (mixed icon sizes, uneven spacing,
unexplained grey circle next to the greeting, power/messages/crown/settings
competing). Replace with an intentional header:

- Persian-first RTL; one icon size + stroke weight everywhere
- max 3 primary actions visible; clear VPN status; clear profile/reward entry
- settings/messages grouped cleanly (e.g. one overflow/sheet), remove or
  redesign the grey circle; no dead-looking empty controls
- must work on small Android screens
- Style: fun, mysterious, motivational, premium, Gen Z, Persian fantasy +
  modern glass UI, subtle gold glow, REAL/Shahnameh symbols — NOT a generic
  VPN dashboard.

## 2. Starlink must be visible and motivational

- Prominent **Starlink Premium card/banner on Home**: premium users get
  access; others unlock by inviting **11 verified friends**; show progress
  ("4 / 11 invited"); CTA "Invite friends"; benefit copy (high-speed,
  resilient satellite exit); distinctive satellite visual identity.
- In the server list for eligible devices: STARLINK label, satellite badge,
  availability + session limit, exit health when available.
- **Maintenance must not erase the feature**: keep the promo/unlock card;
  show "Temporarily unavailable — returns automatically" only on the
  connect option itself.
- Server side for all of this is LIVE (see API contract below).

## 3. Game tab opens the GAME, not the website

Strategic decision: **SHAHNAMEH RUNS THROUGH REALINK/REALGRAM — Telegram is
no longer the primary game platform.**

- No marketing homepage, no "Play Now" landing, no Telegram dependency or
  login, no external-browser feel.
- Open directly into the authenticated experience: player profile, chapters/
  story, heroes, quests, questions/learning, rewards (REAL/Zar/Farr/Gems/XP),
  invite progress, game navigation.
- Auth: ReaLink account/device session (the A-10/B-8 RS256 SSO already
  shipped for exactly this) linked to the existing Shahnameh player account.
- Embedded authenticated web experience is fine if it feels native: loading
  skeleton + keep the app bottom navigation visible.

## 4. Remove outdated Shahnameh promo banners on Home

Remove the Shahnameh/Telegram promo banner, all "join Telegram to play"
wording, and duplicated play-Shahnameh ads on the VPN home. The game has its
own tab. Repurpose the promo space, in order: (1) Starlink unlock progress,
(2) rewarded video/data opportunity, (3) referral progress where useful.

## 5. Messaging becomes RealGram (v1 of the real product)

Redesign the utility/support inbox into the beginning of RealGram: modern
conversation list, large avatars/identity symbols, unread indicators,
online/delivery/read states, glassy bubbles, Persian-first RTL,
voice-note-ready layout, image/file placeholders, reactions, reply
gesture/layout, modern composer, support chat clearly separated from
personal messages, REAL/Shahnameh custom emoji/badges, smooth empty state
with invite/message CTA. Do NOT copy Telegram visually — distinct identity.

## 6. Home must feel alive

Clear active/inactive VPN states, subtle motion around connect, feedback
after connect, motivational microcopy, reward/progress feedback, better
cards/hierarchy, cleaner Persian typography + RTL, consistent iconography.
Premium/mysterious/energetic — not childish.

## 7. Server list cleanup

Understandable names; recommended/fastest/Starlink badges; drop "CUSTOM"
labels that carry no user value; differentiate node types (Standard, Secure
Edge, Starlink, Premium); make the recommended server obvious; preserve
adaptive routing + telemetry behavior exactly.

---

## API contract (Agent A — LIVE on prod since 2026-07-17 ~07:45)

All verified end-to-end against production with real device bearers.

**`GET /v1/servers`** — Starlink node entries now ALWAYS appear for eligible
devices (premium / test_mode / >= 11 verified invites), including while the
node is down or in maintenance, with new meta fields:

```
nodeType:    "STARLINK"            (existing)
available:   true|false            (NEW — false = do not offer connect)
status:      "online"|"maintenance"|"offline"   (NEW)
statusNote:  "auto_returns_when_healthy"        (NEW, only when unavailable)
maxSessions: 1                                  (NEW)
```

Unavailable nodes are excluded from adaptive-routing ranking and appended
last in ranked responses. `/v1/servers/{id}/config` still refuses with 503
while unavailable — the client must render the option disabled, NOT hide it.

**`GET /v1/starlink/unlock-status`** (NEW) — powers the Home card for every
user (locked or unlocked):

```json
{ "unlock": { "unlocked": true, "reason": "premium|test_mode|invites",
              "invitesVerified": 4, "invitesRequired": 11 },
  "node":   { "id": "starlink-no-01", "available": false,
              "status": "maintenance",
              "statusNote": "auto_returns_when_healthy",
              "maxSessions": 1, "country": "Norway" } }
```

"Verified invite" = api.php bootstrap definition (referral credited/approved
AND invitee device active in the last 7 days) — same number the Community
rank card already shows, one economy.

## Split

- **A (done):** everything under "API contract"; prod deploy + verification
  of the b97 APK when B hands it off (same flow as b96, §25/§26).
- **B (drives):** items 1–7 in the app, screenshots + proofs, Persian
  changelog, tag + CI build v0.9.67-b97.

---

# HOTFIX ADDENDUM — MAKE STARLINK THE HERO (Khabat, 2026-07-17 ~09:00)

Context from Khabat: "We finally achieved something extraordinary. A user in
Iran can connect to Starlink through ReaLink. The UI does not communicate
this at all. This must become the emotional highlight of the product."
This addendum EXTENDS items 2 and 4 above and adds splash/branding work.
The Starlink exit is LIVE (exit verified from fi-hel, node open,
handoff §29) — this is real, not aspirational copy.

## Home — Starlink replaces the Shahnameh promotion

Large premium card in the old promo slot:

```
🛰️ STARLINK ACCESS
Internet without terrestrial infrastructure.
⭐ Premium        — or —        🔥 Unlock by inviting 11 verified friends
██████░░░░  6 / 11
[ Invite friends ]
```

- Unlocked: button becomes **Connect via Starlink**.
- Maintenance: "Starlink is temporarily unavailable. Automatically returns
  when healthy." — **keep the card visible. Never hide the product.**
- All states are already served by `GET /v1/starlink/unlock-status`
  (unlocked/reason/invitesVerified/invitesRequired + node
  status/available/statusNote/maxSessions).

## Server list — Starlink must never look like another VPN server

```
🛰️ NORWAY
STARLINK          Premium · Satellite
```

Completely distinct visual style: gold accents, satellite icon, glowing
border, maybe animated stars, maybe NEW / LIMITED. Make users curious.
Server side now sends `hero: true` and `badges: ["NEW","LIMITED"]` on the
Starlink meta (LIVE) — render badges from the server so they can be
changed without an app rebuild.

## After connection — celebrate it

Not just "Connected":

```
🛰️ Connected through Starlink     — or —     ⭐ Satellite route active
```

Tiny animation, glow, optional success sound. Client detects via the
selected node's `nodeType === "STARLINK"`.

## Splash/intro — plant the RealGram seed

Keep the animations. Replace the branding: REAL logo, below it
**REALGRAM — Connected Intelligence**, then **Powered by ReaLink**.
Not dominant — just planting the seed. The first seconds should already
communicate the future scope (communication, games, learning, AI,
satellite, freedom, identity, reward, community), not "VPN".

## Overall design direction (applies to all b97 screens)

Mysterious, premium, Persian fantasy, modern, Gen Z, emotional, rewarding.
Less "VPN dashboard", more "next-generation platform".
