# Page Themes — which classes to use on each screen

Import once at app root:

```js
import '/tokens/realgram-theme.css';
import '/tokens/real-coin.js';   // registers <real-coin>
```

Every screen wraps in the same shell:

```html
<div class="rg-screen">
  <div class="rg-screen__atmos">
    <div class="rg-mountains"></div>   <!-- hero screens only -->
    <!-- inject ~10-14 <span class="rg-ember"> with random left/duration/--drift -->
  </div>
  <div class="rg-screen__body"> … page content … </div>
  <nav class="rg-nav"> … </nav>        <!-- RealGram shell only, NOT in the game -->
</div>
```

Stagger entrance: add `rg-reveal` to each top-level block with
`style="animation-delay:.04s"` increasing by ~0.04–0.06 s per block.

---

## 01 · Home (The Anvil)
| Element | Classes |
|---|---|
| Balance / Zar-hr / REAL pills | `.rg-topbar` › `.rg-pill` + `__label` `__value` |
| Starlink hero banner | `.rg-starlink` + `__badge` (`.rg-beat`) + `__word` + `.rg-btn--starlink .rg-btn--shine`; satellite gets `.rg-orbit` |
| Anvil card | `.rg-card .rg-card--carved` |
| The coin | `<real-coin connected size="140">` — listen for `forge` and `toggle-connection` |
| Vertical energy bar | `.rg-track` rotated, fill `.rg-track__fill--energy` |
| Combo/Streak/Boost/Energy | `.rg-chiprow` › `.rg-chip--combo/--streak/--boost/--energy` |
| Refill via ad | `.rg-ad-rewarded` |
| Banner slot above nav | `.rg-ad-banner` |

Hint text "Hold 3s to disconnect" sits directly under the card title.

## 02 · Chats
| Element | Classes |
|---|---|
| Chat rows | `.rg-row` + `__icon` `__mid` `__title` `__sub`, `.rg-divider` between |
| Node contacts (SL-227-…) | `.rg-row__icon.rg-avatar--node` with 📡 |
| Online dot | `.rg-presence--on` / `--off` |
| Unread | title full `--rg-ink`, time in `--rg-gold-1`, badge on gold |
| FAB | `.rg-btn--gold` circular, add `.rg-breathe` |
| Persian previews | keep `direction:rtl; unicode-bidi:plaintext` |

## 03 · Thread
| Element | Classes |
|---|---|
| Incoming bubble | `.rg-bubble.rg-bubble--in` |
| Outgoing bubble | `.rg-bubble.rg-bubble--out` (gold) |
| Timestamp / ticks | `.rg-bubble__time`, read ticks `.rg-check--read` |
| Ad | `.rg-ad-native` between last message and input — **never mid-conversation** |

## 04 · Freedom
Order matters: **Starlink VIP → RealLink → ad → country nodes.**

| Element | Classes |
|---|---|
| Starlink locked reward | `.rg-starlink.rg-vip` + `.rg-vip__corner` ("VIP") |
| Invite progress 1/3 | `.rg-slot` / `.rg-slot--filled` chain |
| CTA | `.rg-btn--gold .rg-btn--shine` → "Invite Friends" (not "Connect") |
| RealLink row | `.rg-row` with green accent + "Best" tag |
| Ad card | `.rg-ad-native` |
| Country nodes | `.rg-row`, ping colour: green fast / gold mid |

## 05 · Wallet (Ganj)
Story order: balance → where REAL came from → ad → where ZAR came from → earn more → spend.

| Element | Classes |
|---|---|
| Balance hero | `.rg-card` + count-up number in `.rg-num`, inline sparkline SVG |
| Send / Receive | `.rg-btn--gold`, `.rg-btn--ghost` |
| Convert ZAR→REAL | `.rg-card`, swap CTA `.rg-btn--gold` |
| Tonkeeper / Import / Export | `.rg-chiprow` › `.rg-chip` |
| Ad | `.rg-ad-native` |
| Weekly bar chart | bars use `--rg-gold-1` / `--rg-violet-1` / `--rg-green` / `--rg-cyan-1` / `--rg-ember` per source; grow height on mount |
| Income grid | `.rg-card`, equal min-height so it never looks lopsided |
| Activity feed | `.rg-row` + `__value--pos/--neg/--neu` |

## 06 · Clan
| Element | Classes |
|---|---|
| TrustAI 10% card | `.rg-card`; the "paid by RealGram, not your friend" note in a green-tinted inset |
| Treasury goal | `.rg-track__fill--treasury` |
| Tier quests (OR-logic) | `.rg-card` each + `.rg-track`; label "Fullfør **én** av disse" |
| Clan Wars teaser | `.rg-card` with red-tinted border, lock icon |
| Warriors | `.rg-row` leaderboard |

## 07 · Profile
| Element | Classes |
|---|---|
| Economy grid | `.rg-card` cells, values in `.rg-num` |
| Data plan | `.rg-track__fill--data` (cyan) |
| Streaks / achievements | `.rg-chiprow` |
| Chronicle progress | `.rg-track__fill--chronicle`, heaviest block on the page |
| Clan link | `.rg-row` |

## 08 · Shahnameh game shell
**No `.rg-nav` inside the game.**

```html
<header class="rg-gameheader">
  <button class="rg-gameheader__btn">←</button>
  <div>…title…</div>
  <button class="rg-gameheader__btn rg-gameheader__burger">☰</button>
</header>
```
Drawer: `.rg-drawer__scrim` + `.rg-drawer`, grouped with `.rg-drawer__section`
(**Play / World / Events**), items `.rg-drawer__item(--active)`, and
`.rg-drawer__exit` = "Tilbake til RealGram".

Sub-pages (Chronicle, Living Persia, Mythic Lineage, Discovery Album) reuse the
same header + drawer; only the body changes. Album cards use `.rg-rarity--*`.

---

## Rules that override everything
1. **Gold = owned/connected. Silver = locked/disconnected.** Coin flips state; nothing else signals it.
2. Ads never interrupt tapping or an open conversation. Rewarded ads are framed as earning.
3. One dominant motion per screen; honour `prefers-reduced-motion` (already handled in the CSS).
4. Numbers in `--rg-font-mono`. Persian in `--rg-font-fa` with correct RTL.
5. No bottom nav inside the game.
