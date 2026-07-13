# REAL ecosystem — brand identity v1 (B-15, final for this round)

**Status: B-15 closed, v1.** Agent A drafted the mark language + usage
rules (2026-07-13, `e2528a8`); Agent B (me) reviewed, adopted the marks
as-is, added wordmarks + footer-ready lockups, and made the calls Agent A
left open. Extends `mobile-app/DESIGN_SYSTEM.md` and
`docs/realgram/UI_DESIGN_SYSTEM.md` — read those first, this only covers
what's new for the four-app identity system.

Note for whoever picks this up next: an earlier, separate pass at this same
task (mine, before I saw Agent A had also started) lives on branch
`feat/realgram-brand-identity` under `realgram-miniapp/brand/` — a
monogram-badge system. **Superseded by this file.** Agent A's stroke-icon
marks match the app's actual icon language (24×24, 2px stroke, round caps,
`currentColor`, same weight as the TopBar power icon); the monogram attempt
didn't know that convention existed yet. Don't merge that branch; this
folder (`brand/`, top-level) is canonical.

## 1. The four marks — decided

| Brand | Mark | Accent | Role in the blend |
|---|---|---|---|
| Realink | `realink.svg` — interlocking link | emerald `#00E87A` | connect · free |
| Shahnameh | `shahnameh.svg` — crown | gold `#D4AF37` (light `#F0D060`) | game · earn |
| TrustAI | `trustai.svg` — shield + check | blue `#3399FF` | learn · trust |
| RealGram | `realgram.svg` — chat bubble + spark | purple `#C77DFF` | connect · earn |

**RealGram purple `#C77DFF` — approved as final**, not just a placeholder.
It's already live in `EcosystemFooter.tsx` today; no reason to invalidate
what's shipped. All four colors are existing app tokens
(`Colors.emerald[400]`, `Colors.gold[400]`, `Colors.blue[400]`) or the
already-shipped RealGram constant — nothing new introduced.

**Construction:** 24×24 viewBox, 2px stroke, round caps/joins, `fill="none"`,
`stroke="currentColor"` — tint by setting `color` (web/CSS) or the `stroke`/
`tintColor` prop (React Native `react-native-svg`, already a dependency —
confirmed in `mobile-app/package.json`). One mark, reused everywhere, never
recolored outside its accent (a 5th ad-hoc color breaks the "one package"
read Khabat asked for).

**Minimum size:** 12px rendered mark; below 16px, drop the wordmark and show
the mark alone. Don't fill the strokes, don't add gradients/shadows, don't
place a mark on a background close to its own accent (use a neutral chip
behind it instead).

## 2. Wordmarks (`wordmark-*.svg`)

Inter SemiBold (600, weight 700 on the capitalized second half of compound
names — `Trust`**`AI`**, `Real`**`Gram`**), letter-spacing `0.5`,
`fill="currentColor"` — same tint contract as the marks. Matches
`Typography.family.heading` (`Inter-SemiBold`) already defined in
`mobile-app/src/design/tokens.ts`.

## 3. Lockups (`lockup-*.svg`) — the footer deliverable

Mark + wordmark, horizontal, 28px tall, pre-colored per brand (these are
finished drop-in assets, not tintable templates — footer chips don't need
runtime recoloring). This is the direct replacement for
`EcosystemFooter.tsx`'s typographic chips:

```tsx
// current (per that file's own comment, build 92):
<View style={[styles.chip, { borderColor: b.color + '55' }]}>
  <Text style={[styles.chipText, { color: b.color }]}>{b.name}</Text>
</View>

// replace with (react-native-svg already installed, no new dependency):
import LockupRealink from '../../brand/lockup-realink.svg';   // via SVG transformer,
// or inline the path data as a component — either works with the existing toolchain.
<LockupRealink width={100} height={22} />
```

Not wired into the component here — `EcosystemFooter.tsx` is inside
`mobile-app/`, which is Agent A's surface per the standing role split
(`COORDINATION_HUB.md`, 2026-07-12). Assets are finished and footer-ready;
only the render call needs to change, at Agent A's pace/next build. Same
lockups are usable as-is (plain `<svg>` embed, no build step) on the
Shahnameh web game and any future RealGram Mini App footer — those aren't
React Native, so the raw files work directly there.

## 4. Unified coin/button language — decided

Agent A's read of the actual mechanic (build 92) corrects an earlier
assumption: **the ReaLink connect-coin's tap reward is ZAR** (Shahnameh's
own currency, `+1 ZAR/tap` while connected, gold coin-burst per tap, 600ms
hold-to-disconnect) — **not a REAL payout.** ZAR→REAL conversion is a
separate, later backend step; don't imply an instant REAL credit anywhere
in copy or animation.

Shared control, both apps implement:

- **Shape:** circle, thin outer ring + inset inner ring, brand coin art
  centered (ReaLink: `lib/branding.ts` REAL/coin asset; Shahnameh: its own
  coin art — swappable placeholders on both sides today).
- **Press feedback:** scale to `0.93` on press-in (`Animation.duration.instant`,
  no easing yet), spring back to `1.0` on release (`Animation.spring.bouncy`)
  — taken directly from the shipped `ConnectButton.tsx`, not reinvented.
- **Earn feedback:** every successful tap/earn fires a gold coin-burst
  (`GoldBeatBurst.tsx`: 12 particles, radial with jitter, 2600ms life, 90ms
  stagger, heartbeat pulse while drifting out and fading, native-driver
  only). Earned amounts render in gold — the semantic-gold rule
  (`UI_DESIGN_SYSTEM.md` §2) doing its job automatically.
- **States:** resting (neutral ring, muted icon) / active-earning (emerald
  or gold glow + the existing 3-ring pulse, delays 0/400/800ms, opacity
  0.15/0.11/0.07) / cooldown-capped (muted, no burst — don't animate a
  reward that isn't happening).
- **For Shahnameh's tap button specifically:** converge toward this same
  press curve and burst shape rather than the reverse. Not hand-patched
  into `season2/app.js`/`chapter.js` here — that's compiled/bundled game
  code neither agent should edit blind without a visual QA loop; whoever
  wires it should port the four numbers above (`0.93`, instant press-in,
  bouncy release, `2600ms`/`90ms` burst) directly.

Reference diagram: `coin-button-spec.svg` on `feat/realgram-brand-identity`
(idle / pressed / connected+burst side by side) — illustrative only, not
re-copied here to avoid a second source of truth for the same three states
already described above in words.

## 5. RealGram's own voice — decided

RealGram is the messenger face of the package — chrome stays on the
existing emerald/blue/navy system (calm, free, connected, exactly like
ReaLink); **gold appears only when value moves** (rewards, streaks,
Shahnameh achievements surfacing in chat) — never decoratively; the purple
accent (`#C77DFF`) is reserved for RealGram-native identity moments
(handles, avatars, invites, the messenger chrome itself) so users learn
"purple = messaging" the same way "emerald = connected" already reads.
Explicitly not a Telegram/Instagram/WhatsApp visual clone — see
`UI_DESIGN_SYSTEM.md` §2–3 for the semantic-gold and locale rules, which
apply here unchanged.

## 6. What's still open (honest gaps)

- **PNG @1x/2x/3x exports** — no SVG rasterizer on this box
  (`rsvg-convert`/`imagemagick`/`cairosvg` all absent) and installing one
  unprompted isn't a call to make silently on a 1GB-RAM VPS running ~12
  production sites. SVG is the source of truth and covers every current
  consumer (React Native via `react-native-svg`, plain `<svg>` embeds on
  the web properties) without rasterizing at all — PNG is only needed if
  something later requires a raster format (app store listing art, etc.).
  `rsvg-convert -w 128 realink.svg -o realink@2x.png` (repeat per size)
  whenever that's actually needed.
- **`EcosystemFooter.tsx` render swap** — Agent A's side of `mobile-app/`,
  assets ready, not wired.
- **Shahnameh tap-button parameter alignment** — spec'd in §4, not patched
  into the live minified game code.
- **App-icon-scale marks / store listing art** — this system covers UI-scale
  usage (footer, in-app chrome); a v2 pass would adapt the same glyphs at
  app-icon proportions (more padding, no stroke-thinness issues at large
  size) if/when RealGram or the others need store icons distinct from
  in-app marks.
