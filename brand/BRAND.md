# REAL ecosystem — brand identity v1 (B-15 draft)

**Status: v1 draft by Agent A, 2026-07-13.** Agent B owns B-15 and the final
word — refine or replace freely, but keep the constraints in §1 and the
consumer contract in §4 so the apps don't need code changes when assets
change. Khabat's direction: growing user base, the apps must read as ONE
unified package — **game · learn · earn · connect · free**.

## 1. Constraints (from the existing design system — don't reinvent)

Everything extends `mobile-app/DESIGN_SYSTEM.md` +
`docs/realgram/UI_DESIGN_SYSTEM.md`:

- Dark-first: marks must work on `bg.base #070D18` / `bg.void #030609`.
- Gold is **semantic** (value/rewards) — Shahnameh's brand gold is the one
  sanctioned exception, using the existing tokens `#D4AF37` / `#F0D060`,
  never new golds.
- Stroke language: 24×24 viewBox, 2px stroke, round caps/joins — matches the
  app's icon weight (TopBar, lucide-style power icon).

## 2. The family

One mark per brand, same grid and stroke weight, one accent each. SVGs in
this folder use `stroke="currentColor"` so consumers tint them — the accent
is data, not baked into the asset.

| Brand     | Mark               | Accent               | Role in the blend |
|-----------|--------------------|----------------------|-------------------|
| Realink   | `realink.svg` — link | emerald `#00E87A`  | **connect · free** |
| Shahnameh | `shahnameh.svg` — crown | gold `#D4AF37` (light `#F0D060`) | **game · earn** |
| TrustAI   | `trustai.svg` — shield-check | blue `#3399FF` | **learn · trust** |
| RealGram  | `realgram.svg` — bubble+spark | purple `#C77DFF` **(proposal — B decides)** | **connect · earn** |

RealGram's purple is the only new color in the system; it's currently
hard-coded as a placeholder in the app footer (see §4). If B picks a
different accent, update both this table and that constant — one place each.

Wordmarks v1 are typographic: brand name set in the app's heading family
(Inter, `Typography.family.heading`), letterspacing 0.5, in the accent
color. A drawn wordmark is a v2 concern.

## 3. Usage rules

- **Minimum size 12px** rendered; at <16px drop the wordmark and show the
  mark alone.
- Marks are tinted their accent on dark; a mono `text.muted` variant is
  allowed where color would fight the screen (e.g. inside a busy reward UI).
- Don't fill the strokes, don't add gradients or shadows to the marks, don't
  place gold marks on gold surfaces.
- The four marks appear **together** in ecosystem contexts (footer, about,
  cross-promo) — never pick-and-mix three of four; the row IS the message
  that this is one package.

## 4. Footer / copyright placement (already shipped, swap-ready)

Every ecosystem app shows the family under its © line. ReaLink ships this
since build 92: `mobile-app/src/components/EcosystemFooter.tsx` renders four
typographic chips + the tagline `game · learn · earn · connect · free`
(i18n'd en/fa/zh/ru as `eco.tagline`). The component is the single consumer:
replacing the text chips with these SVG marks (react-native-svg is already a
dependency) touches only that file. Same pattern goes for the Shahnameh web
game and the RealGram Mini App footer.

## 5. Unified coin button (ReaLink connect-coin ↔ Shahnameh tap-button)

Khabat wants these to feel like the SAME control across apps. As of ReaLink
b92 the big coin is: connect when idle → **tap-to-earn ZAR while connected**
(+1 ZAR/tap, gold coin-burst per tap, hold 600ms to disconnect; power toggle
in the TopBar). The shared identity both apps implement:

- **Shape:** circle, thin outer ring + inner ring inset, brand mark centered
  (ReaLink: REAL coin art per `lib/branding.ts`; Shahnameh: its coin art).
- **Feedback:** press = scale to 0.93 and spring back; every successful earn
  fires the gold coin burst (ReaLink: `GoldBeatBurst`). Earned amounts render
  in gold — that's the semantic-gold rule doing its job.
- **States:** resting (neutral ring) / active-earning (emerald or gold glow +
  pulse rings) / cooldown-capped (muted, no burst).
- **Currency:** taps earn **ZAR** (Shahnameh currency) in both apps; ZAR→REAL
  conversion is a later backend step — never imply an instant REAL payout.

## 6. RealGram's own voice (direction, B owns)

RealGram is the messenger face of the package: chrome stays on the
emerald/blue/navy system like ReaLink (calm, free, connected); gold appears
only when value moves (rewards, streaks, Shahnameh achievements surfacing in
chat); the purple accent marks RealGram-native identity moments (handles,
avatars, invites). Tone: Gen-Z messenger, not a Telegram clone — see
`UI_DESIGN_SYSTEM.md` §2–3 for the semantic-gold and locale rules that apply
unchanged.
