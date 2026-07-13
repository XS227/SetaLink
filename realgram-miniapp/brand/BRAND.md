# REAL ecosystem — brand identity (B-15)

Owner: Agent B (shahnameh-backend box). Task: `docs/realgram/TASK_SPLIT.md`
B-15, requested by Khabat 2026-07-13. This is v1 — a working, consistent
system built to unblock `EcosystemFooter.tsx` and the other placeholder
call-sites now; it's meant to be refined, not treated as final art.

## 1. The four marks

One shared construction, one accent color each — so the four apps read as
siblings, not a random collection of logos.

| App | Accent | Hex | Monogram |
|---|---|---|---|
| Realink | emerald | `#00E87A` | RE |
| Shahnameh | gold | `#D4AF37` | SH |
| TrustAI | blue | `#3399FF` | TR |
| RealGram | purple | `#C77DFF` | RG |

Colors are pulled directly from `mobile-app/src/design/tokens.ts`
(`Colors.emerald[400]`, `Colors.gold[400]`, `Colors.blue[400]`) plus the
`#C77DFF` RealGram placeholder already live in `EcosystemFooter.tsx` — not
reinvented, just formalized. TASK_SPLIT.md's suggested emerald
`#22C55E`-ish was a placeholder guess; the app's actual emerald (`#00E87A`)
is more saturated and is what ships today, so the marks use that instead.

**Construction (`mark-*.svg`, 64×64 viewBox):**
- Circle badge, radius 30, centered, solid accent fill.
- Two-letter monogram, Inter SemiBold/Bold (weight 700), size 22,
  letter-spacing -0.5, centered.
- Ink is **one shared dark color, `#0C1116`, on all four marks** — not
  white. Every accent above is light-to-mid brightness; dark ink is what
  actually holds AA contrast at small sizes on all four, and using the same
  ink everywhere (instead of white on some, dark on others) is what makes
  the four badges read as one family instead of four unrelated logos.

**Line variant (`mark-*-line.svg`):** same monogram, but the circle is a
2px stroke instead of a fill and both stroke + text are the accent color,
transparent background. Use this where the mark sits on its own dark chip
or needs to be less visually heavy than a solid badge (e.g. inline in a
sentence, a settings row icon).

## 2. Wordmarks (`wordmark-*.svg`)

Inter SemiBold (600), size 30, letter-spacing -0.5, accent-colored, on
transparent. `TrustAI` and `RealGram` bold the capitalized second word
(`Trust**AI**`, `Real**Gram**`) to keep the compound name legible as two
words at a glance — matches how both names are already written everywhere
else in copy (commit messages, this doc, the app).

## 3. Lockups (`lockup-*.svg`) — the footer deliverable

Mark (26px circle) + wordmark (16px), horizontal, 28px tall. This is the
literal drop-in replacement for the typographic chip in
`mobile-app/src/components/EcosystemFooter.tsx`:

```tsx
// current (placeholder, per that file's own comment):
<View style={[styles.chip, { borderColor: b.color + '55' }]}>
  <Text style={[styles.chipText, { color: b.color }]}>{b.name}</Text>
</View>

// swap to (once react-native-svg or an Image-from-asset pipeline is wired):
<LockupRealink width={90} height={21} />  // one per brand, from these SVGs
```

Not wired into the component myself — that's an app-side (Agent A) change
inside `mobile-app/`, per the existing role split (I own `realgram-miniapp/`
and the backend, not `mobile-app/` screens/components). The assets are
ready to consume; only the render call in `EcosystemFooter.tsx` needs to
change, at Agent A's pace/next build.

## 4. Spacing & min sizes

- **Clear space:** minimum 25% of the mark's diameter on all sides (e.g.
  15px around a 60px-wide render of the 64×64 mark) — nothing else (text,
  edges, other marks) inside that margin.
- **Minimum size:** mark alone, 20px diameter (below that the two-letter
  monogram stops being legible — drop to a single accent dot instead, don't
  shrink the letters further). Lockup, 20px tall minimum (matches current
  footer chip height).
- **Footer row:** the four lockups keep the existing footer's `gap: 6`,
  `flexWrap: wrap`, centered — no changes to `EcosystemFooter`'s layout,
  only its chip contents.

## 5. Do / don't

- **Do** keep all four marks visually equal weight (same radius, same font
  size, same ink) — no app gets a "bigger" or "more special" treatment.
- **Do** use the line variant on busy/dark backgrounds where a solid badge
  would compete with other UI; use the solid badge as the default/primary
  form everywhere else (app icons, share cards, about screens).
- **Don't** recolor a mark to anything outside its accent — the four-color
  system *is* the identity; a fifth ad-hoc color breaks the "one shared
  package" read Khabat asked for.
- **Don't** stretch/skew the circle or letterform — scale uniformly only.
- **Don't** put a mark on a background color close to its own accent (e.g.
  the emerald mark on an emerald button) — use the line variant or add a
  contrasting chip behind it instead.

## 6. Unified button/coin language

Reference: `mobile-app/src/components/ConnectButton.tsx` (the existing,
shipped 188px connect button) and `GoldBeatBurst.tsx` (the existing gold
REAL-coin celebration). **These already are the spec** — B-15 formalizes
them as the shared language rather than inventing a new one, so Shahnameh's
tap-button should converge toward this, not the other way around:

| State | Spec |
|---|---|
| Idle | Circular, `Colors.bg.elevated` fill, `Colors.border.default` stroke, muted icon (`rgba(200,210,218,0.9)`) |
| Press-in | Scale to `0.93`, `Animation.duration.instant` timing (no bounce yet) |
| Press-out / release | Spring back to `1.0`, `Animation.spring.bouncy` |
| Active/connected | Accent fill + accent stroke (emerald for Realink's case), inverse-color icon, ambient glow fading in over `Animation.duration.slow`, 3 staggered pulse rings (`AnimatedRing`, delays 0/400/800ms, opacity 0.15/0.11/0.07) |
| Reward burst | 12 small accent-colored coins (`GoldBeatBurst`: gold `#D4AF37` for the REAL-token context), radial directions with slight jitter, 2600ms life, 90ms stagger between coins, heartbeat pulse (lub-dub) while drifting outward and fading — native-driver only, self-unmounts |

**For Shahnameh's tap-to-earn button:** adopt the same press curve
(0.93 scale / instant press-in / bouncy spring release) and the same
burst shape (radial small-coin particles, ~2.6s life, staggered), just
recolor the burst particles to whatever Shahnameh's own reward currency
uses instead of REAL-gold, if that differs. I didn't hand-edit
`season2/app.js`/`chapter.js` for this — that's compiled/bundled game
code I don't want to patch blind without visually verifying the result;
recommend Agent A or Khabat wires the constants (`0.93`, `2600ms`,
`90ms` stagger) into the existing Shahnameh tap handler directly. Reference
diagram: `coin-button-spec.svg` in this folder (idle / pressed / connected
+ burst, side by side).

## 7. RealGram identity (the messenger surface itself)

RealGram is the ReaLink→RealGram conversion's end state (see A-11/A-12/
A-13 in `TASK_SPLIT.md`) — a messenger, not just a VPN app, expressing
**game · learn · earn · connect · free** simultaneously. Direction for
that surface, distinct from the other three (which are single-purpose:
Shahnameh = game, TrustAI = trust/verification, Realink = the VPN core
RealGram is building on top of):

- **Tone:** Gen-Z-adjacent but not try-hard — confident, terse copy, no
  emoji-stuffing. The existing app copy (e.g. the post-connect toast, "the
  free internet gets stronger") is a good register to keep.
- **Color hierarchy:** purple (`#C77DFF`) is RealGram's *identity* color
  (logo, nav accents, the messenger chrome) but should **not** replace
  emerald as the primary action color inside what's still fundamentally
  the ReaLink app shell — emerald stays "connect/on," gold stays
  "earn/reward," blue stays "trust," purple is reserved for RealGram-
  specific surfaces (identity/handle, inbox, contacts) so users learn
  "purple = messaging" the same way they already read "emerald = VPN on."
- **The blend, concretely:** on any RealGram screen, at most one non-
  purple accent should be visually dominant at a time (gold when a reward
  just fired, emerald when connection state is shown, blue when a
  trust/verification badge is relevant) — the surface itself stays
  purple-neutral so those signals don't compete with the base UI.
- **Not a clone:** explicitly avoid Telegram's blue-bubble/paper-plane
  visual grammar, Instagram's gradient-ring avatar convention, and
  WhatsApp's green — RealGram's identity has to be readable as "REAL
  ecosystem" first, "messenger" second. The circle-badge monogram system
  in this doc (rather than a chat-bubble icon) is a deliberate step away
  from generic messenger iconography.

## 8. What's not done yet (honest gaps)

- **PNG @1x/2x/3x exports:** this box has no SVG rasterizer installed
  (`rsvg-convert`/`imagemagick`/`cairosvg` all absent) and I didn't install
  one unprompted — this is a 1GB-RAM VPS running ~12 production sites, and
  adding a system package isn't a call to make silently for an asset
  export. The SVGs are the source of truth and scale losslessly; ask
  Khabat or run `rsvg-convert -w 128 mark-realink.svg -o mark-realink@2x.png`
  (etc.) locally whenever PNGs are actually needed for a store listing or
  a context that can't take SVG.
- **App-side wiring** (`EcosystemFooter.tsx` swap, any app-icon usage) is
  Agent A's side of `mobile-app/`, per the role split — assets are ready,
  not wired.
- **Shahnameh tap-button parameter alignment** — spec'd above (§6), not
  patched into the live (minified/bundled) game code blind.
- This is a **monogram** system, not full custom logotype art (no bespoke
  glyphs/iconography beyond the two-letter mark). Deliberate for v1:
  guaranteed to render correctly everywhere, cheap to maintain, and
  genuinely legible at footer scale (a bespoke chain-link/crown/shield/
  chat-bubble glyph set would look nicer but risks not reading at 20px
  without a real design tool + visual QA loop, neither of which this box
  has). Worth a v2 pass with an actual designer or an image-gen pass
  Khabat reviews visually, if the ecosystem wants more distinctive marks
  later.
