# RealGram — Design Identity

> One cinematic, gold-forged world. A VPN, a tap-to-earn economy, a messenger,
> and the Shahnameh epic — stitched into a single coherent app.

---

## 1. The core idea

RealGram fuses three things most apps keep separate:

1. **Connectivity** — a VPN ("Freedom"), with a flagship **Starlink** node.
2. **Economy** — tap-to-forge **Zar**, convert to **REAL** (a TON token), earn via ads, quizzes, heroes, referrals; spend in the **Ganj Bazaar**.
3. **Story** — the **Shahnameh** (Ferdowsi's Persian epic) as a living game: chapters, quizzes, a family tree, a world map, a collectible card album.

The visual identity has to make these feel like *one place*, not three bolted together. The unifying metaphor is **the forge**: dark night, distant mountains, rising embers, and gold that is *earned* — metal pulled from silver ore into glowing gold.

---

## 2. The signature mechanic: Gold vs Silver

**This is the single most important brand rule.**

The coin mark (﷼) exists in two states:

| State  | When | Meaning |
|--------|------|---------|
| **GOLD**   | owned · connected · just tapped · just converted | value realised |
| **SILVER** | locked · disconnected · not yet earned/converted  | potential, not yet claimed |

Apply this everywhere the mark appears: the tap coin on Home (gold when VPN connected, silver when disconnected), locked vs unlocked album cards, the favicon/app icon (ship gold as the default brand icon), unearned currency chips, etc. The moment a user *acquires* something, it flips silver → gold. This teaches the whole economy without words.

The tap coin additionally supports **hold-3-seconds-to-disconnect**: a red ring fills over 3000 ms while held; a quick tap forges Zar instead.

---

## 3. Colour

Dark navy-black base. Gold is the hero. Every other colour has one job.

- **Gold** `#FFB627` (mid) `#FFF3C4` (hi) `#B8790F` (lo) — primary, currency, owned, connected.
- **Silver** `#B7C0CC` — locked / disconnected / pre-conversion.
- **Violet** `#7B5CFA` — combo, energy, XP, epic.
- **Ember** `#FF8A3D` — forge heat, streak, progress warmth.
- **Cyan** `#33D3FF` — **Starlink**, data, network, rare.
- **Green** `#33FFB2` — success, connected status, positive REAL, active VPN.
- **Red** `#FF5A5A` — disconnect warning, spend, rival, mythic.

Rarity ramp (for cards/lineage): Common grey → Rare cyan → Epic violet → Legendary gold → Mythic red.

Full values live in `tokens/tokens.json` and `tokens/realgram-theme.css`.

---

## 4. Typography

- **Space Grotesk** — display, headings, UI. Geometric, young, reads well small.
- **JetBrains Mono** — all numbers (balances, Zar counters, ping, timers). Gives a "trading terminal" precision that trains future traders.
- **Vazirmatn / Noto Sans Arabic** — Persian text and the ﷼ glyph. Respect RTL for Persian: `direction:rtl; unicode-bidi:plaintext;` in chat bubbles and previews.

---

## 5. Surface & depth ("carved stone")

Cards are not flat. Each card carries a faint top light-line and a deeper bottom shadow so it reads like carved stone / minted metal:

```
box-shadow: inset 0 1px 0 rgba(255,255,255,.06),   /* top highlight */
            inset 0 -20px 40px rgba(0,0,0,.35),      /* bottom depth  */
            0 12px 30px rgba(0,0,0,.4);              /* drop          */
```

The app background is layered radial glows (ember + violet + cyan) over near-black, plus an optional faint mountain silhouette and rising embers on hero screens.

---

## 6. Motion — calm, cinematic, one hero per screen

Gen-Z polish comes from *smoothness*, not busyness.

- **Reveal-in**: content fades up with a small stagger on screen entry (`fadeInUp .55s`, 0.04–0.06 s per element).
- **Coin breathe**: the coin's inner glow pulses gently at rest (3.2 s).
- **Ambient space**: satellites orbit *slowly* (22–28 s), planets drift almost imperceptibly (14 s). Never fast.
- **Embers** rise continuously but sparse.
- **CTA shine**: a light sweep crosses primary buttons every ~3 s.
- **Numbers count up** on load (balance, earnings) and **charts grow in** — this is where we visually teach trading.

Rule: **one dominant motion per screen.** Everything else is subtle.

---

## 7. Advertising (AdMob + Adsgram)

Ads must feel native and never break flow.

- **Banner (AdMob 320×50)**: placed *between* content sections, above the nav — never mid-tap, never inside an open conversation. Dashed neutral border + small "Ad" tag so users learn to distinguish ad from real nodes/content.
- **In Freedom**: a native-styled ad card sits *between* RealLink and the country nodes, in the same row rhythm as the list.
- **In Wallet**: a native ad sits at a natural pause in the money-flow story.
- **In Chats**: a thin native banner may sit between the last message and the input bar, or a rare interstitial when switching threads — never inside an active conversation.
- **Rewarded (Adsgram / AdMob rewarded)**: reframed as **economy actions** — "Watch & Earn → +REAL" and "Refill via ad → energy". The ad becomes part of the game loop, not an interruption.

---

## 8. Navigation architecture

**RealGram shell** owns the bottom tab bar:
`Home · Chats · Freedom · Wallet · Clan · Profile`

**Inside the Shahnameh game** there is **no bottom bar**. Instead:
- `←` top-left → back to RealGram Home
- `☰` top-right → the game drawer (grouped: **Play** / **World** / **Events**), with a "Back to RealGram" exit at the bottom.

This avoids two competing nav systems on screen and frees vertical space for the map, the lineage tree, and card grids. See `03-NAMING.md` for the full page map.

---

## 9. What "done right" looks like

- The coin is gold the instant you connect; silver the instant you drop.
- A new user understands the money flow from the Wallet page alone (balance → where REAL came from → where Zar came from → where to spend).
- Starlink always feels like a *reward / VIP unlock*, not a menu item.
- The Shahnameh never feels like a mini-game bolted on — it shares the same gold, the same embers, the same fonts, and its lore threads (Iran vs Turan, Pars, Rostam) surface in clan wars and easter eggs.
- Nothing on screen animates faster than it needs to.
