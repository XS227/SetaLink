# RealGram — Implementation Brief for Claude Code

You are implementing the RealGram visual redesign. This folder is a **design
handoff package**: reference mockups + identity docs + tokens + logo assets.
Your job is to move the existing app toward this direction, screen by screen.

---

## Read these first (in order)

1. `docs/01-DESIGN-IDENTITY.md` — the visual language, the gold/silver mechanic, motion, ads, nav architecture.
2. `docs/03-NAMING.md` — Shahnameh-inspired names for pages, currencies, tiers.
3. `tokens/tokens.json` — machine-readable design tokens (colours, type, motion, gradients).
4. `tokens/realgram-theme.css` — drop-in CSS variables + primitive classes.

The `screens/` folder holds **10 self-contained HTML mockups**. Each is a
working reference (open in a browser) showing the intended layout, motion, and
interactions. They are the source of truth for *look and behaviour*. They are
NOT production code — treat them as high-fidelity specs to translate into the
app's real stack.

---

## The 10 reference screens

| File | Screen | Key things to implement |
|------|--------|-------------------------|
| `screens/01-home.html` | **Home / The Anvil** | Gold/silver tap coin; tap = forge Zar; **hold 3s = toggle VPN** (red ring fills); vertical energy bar beside coin; Combo/Streak/Boost/Energy as 4 icon chips; **STARLINK hero banner** at top; merged **Refill-via-ad**; **AdMob 320×50** slot above nav; ambient embers + slow satellite. |
| `screens/02-chats.html` | **Chats (messenger)** | Node contacts (`SL-227-…`) use a 📡 network avatar, not a face; online story-strip; All/Clan/Direct/Unread tabs; gold FAB; RTL-correct Persian previews; unread=gold, read=dim. |
| `screens/03-thread.html` | **Chat thread** | Incoming = dark card bubble (RTL aware); outgoing = **gold gradient** bubble; blue double-ticks for read; anchored reaction tags; typing dots; ⏱ disappearing-message hint; `🔒 E2E via node` header. Native ad belongs between last message and input (see identity §7). |
| `screens/04-freedom.html` | **Freedom (VPN)** | Order: **Starlink VIP reward** (invite 3 to unlock, progress chain, "VIP" corner) → **RealLink** (Best) → **native ad card** → country nodes. Cyan = Starlink/network. |
| `screens/05-wallet.html` | **Ganj (Wallet)** | Money-flow *story* order: balance (+count-up +sparkline) → "where did REAL come from?" (convert ZAR→REAL, Tonkeeper import/export) → **native ad** → "where did ZAR come from?" (**weekly bar chart** + income-source grid) → earn-more quick links → "where to spend?" (Ganj Bazaar) → recent activity. Charts animate in — this teaches trading. |
| `screens/06-clan.html` | **Clan** | **TrustAI referral** with explicit note: the 10% comes **from RealGram, not from the invitee**; shared **Treasury** with goal bar; **OR-based quests** (50 warriors / 1M treasury / 10% past ch.30 / 10 veteran cards); **Clan Wars: Iran vs Turan** teaser (locked); warriors leaderboard. Shahnameh tiers ("Champions of Pars"). |
| `screens/07-profile.html` | **Profile** | Crowned portrait + REAL ID; economy grid (Real/Zar/Gohar/Farr/XP/Season); data-plan bar (cyan); streaks; achievements; **Shahnameh Chronicle** progress as the heaviest block; small clan link. |
| `screens/08-game-shell.html` | **Shahnameh game shell** | THE nav pattern: **no bottom bar** inside the game. `←` back to RealGram + `☰` drawer grouped **Play / World / Events** with "Back to RealGram" exit. Two frames: base page + drawer open. |
| `screens/09-coin-concept.html` | **Coin interaction concept** | Standalone demo of the tap coin: tap to heat silver→gold, combo rays, sparks, 3s-hold disconnect ring. Use for the exact tap/hold feel. |
| `screens/10-starlink-banner.html` | **Starlink banners** | Hero + compact variants of the Starlink banner (orbiting satellite, stat chips, RealGram coin mark). Reusable component. |

---

## Logo / icon assets (`logo/`)

- **Master vectors**: `realgram-mark-gold.svg`, `realgram-mark-silver.svg`.
- **Raster set** (PNG) at 16/32/48/64/96/128/180/192/256/512/1024 for both `gold` and `silver`.
- **App/PWA**: `realgram-maskable-512.png` (Android maskable), `realgram-gold-180.png` (iOS touch), `realgram-gold-192.png` + `realgram-gold-512.png` (web manifest), `favicon.ico`.
- **Transparent-disc** variants for overlaying on coloured surfaces.
- Regenerate any size with `logo/generate_pngs.py`.

**Rule:** ship **gold** as the default brand icon (favicon, app icon, splash).
Use **silver** only for the locked/disconnected/not-yet-earned states in-product.

### Suggested manifest / head
```html
<link rel="icon" href="/logo/favicon.ico" sizes="any">
<link rel="icon" type="image/png" sizes="192x192" href="/logo/realgram-gold-192.png">
<link rel="apple-touch-icon" sizes="180x180" href="/logo/realgram-gold-180.png">
<!-- manifest: 192 + 512 + maskable-512 -->
```

---

## Implementation order (recommended)

1. **Tokens first.** Wire `realgram-theme.css` (or port `tokens.json` into the
   app's theme/Tailwind config). Nothing else should hardcode colours.
2. **The coin component** (`09` + `01`): gold/silver state prop, tap→forge,
   hold-3s→disconnect. This is the brand centrepiece; get it right once, reuse.
3. **Home** (`01`).
4. **Freedom** (`04`) + Starlink banner component (`10`).
5. **Wallet** (`05`) with charts.
6. **Clan** (`06`), **Profile** (`07`).
7. **Chats + thread** (`02`, `03`).
8. **Game shell + drawer** (`08`), then port each Shahnameh sub-page (Chronicle,
   Living Persia map, Mythic Lineage tree, Discovery Album) into that shell.

---

## Non-negotiables (do not drift)

- Gold = owned/connected; silver = locked/disconnected. Everywhere.
- One dominant motion per screen; nothing loops fast. Respect `prefers-reduced-motion`.
- No bottom nav inside the Shahnameh game.
- Ads never interrupt tapping or an open conversation; rewarded ads are framed as earning.
- Numbers in JetBrains Mono; Persian in Vazirmatn with correct RTL.
- Keep currency names **Zar** and **REAL**; keep **Ganj** untranslated (localise its tagline only).
