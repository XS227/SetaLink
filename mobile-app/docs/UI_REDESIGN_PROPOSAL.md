# SetaLink UI Redesign Proposal

Status: **proposal — mockups before implementation** · Date: 2026-06-10
Targets: more modern, more minimal, larger REAL logo, gold connected
state, intro screen branding, consistent branding across the app.

Existing tokens this builds on (`src/design/tokens.ts`):
`gold.400 #D4AF37` (Lion & Sun), `gold.300 #F0D060`, base `#070D18`,
current connected green `#00E87A`.

---

## 1. Design direction

**From** "utility VPN with green status colors"
**To** "premium ecosystem app — dark navy canvas, gold as the single
hero color, everything else recedes."

Principles:

- One accent at a time. Gold owns "connected" and rewards; green is
  retired from the connect surface (kept only for small OK ticks in
  diagnostics).
- Fewer borders, more space. Cards lose 1px borders, gain 4dp more
  padding and larger radius (16 → 20).
- The REAL identity is the brand. The connect button *is* the REAL
  logo ring — not a generic power icon.

## 2. Connected state — gold

State mapping (replaces `status.connected = #00E87A`):

| State | Ring / glyph | Background halo |
|---|---|---|
| Disconnected | `slate 500` ring, dim REAL logo | none |
| Connecting | animated `gold.300` arc sweep | faint gold pulse |
| **Connected** | solid `gold.400` ring + gold REAL logo | radial gold glow (8% opacity) |
| Error | `#FF4444` ring | none |

```
        DISCONNECTED                       CONNECTED
   ┌─────────────────────┐          ┌─────────────────────┐
   │                     │          │      ░░ gold ░░     │
   │      ╭───────╮      │          │    ╭═════════╮      │
   │      │ REAL  │      │          │   ║   REAL    ║     │  ← ring #D4AF37
   │      │ (dim) │      │          │   ║  (gold)   ║     │     glow radial
   │      ╰───────╯      │          │    ╰═════════╯      │
   │                     │          │                     │
   │    Tap to connect   │          │  Connected · Oslo   │
   │                     │          │  00:42:13 · 1.2 GB  │
   └─────────────────────┘          └─────────────────────┘
```

Connected text + timer also switch to `gold.300`. Quota bar fills gold
when connected, slate when idle.

## 3. Larger REAL logo

- Connect ring grows from current ~160dp to **220dp** (56% of screen
  width); the REAL logo inside renders at 96dp (was ~48dp).
- Splash/intro logo: 128dp, centered, on `#070D18`.
- Header wordmark "SetaLink" gets the Lion & Sun mark at 20dp to its
  left on every screen (today only Home has it).

## 4. Intro screen branding

New first-launch sequence (replaces plain WelcomeScreen):

```
  Screen 1 — Brand            Screen 2 — Promise        Screen 3 — Ecosystem
┌──────────────────┐       ┌──────────────────┐       ┌──────────────────┐
│                  │       │                  │       │   REAL  ◈        │
│       ◈          │       │   ░ map motif ░  │       │  ┌────┐ ┌─────┐  │
│     REAL         │       │                  │       │  │VPN │ │Shah-│  │
│   (gold, 128dp)  │       │  "Open internet. │       │  │    │ │nameh│  │
│                  │       │   Anywhere."     │       │  └────┘ └─────┘  │
│    SetaLink      │       │                  │       │  earn ↔ redeem   │
│                  │       │   [Continue]     │       │  [Get started]   │
└──────────────────┘       └──────────────────┘       └──────────────────┘
```

- Screen 3 introduces REAL/Shahnameh (ties into
  ECOSYSTEM_INTEGRATION_PLAN.md §B) — skippable.
- Gold progress dots; 1 GB starter quota toast lands *after* intro, not
  during.

## 5. Minimalism pass (per screen)

- **Home**: remove protocol chip row from the default view (move behind
  a "details" tap on the status line). Keep: ring, server row, quota
  bar, one stat line.
- **Servers**: collapse flag + city + protocol into a single row; latency
  as small right-aligned number, no badges.
- **Profile**: 3 groups max (Account & quota · Ecosystem · About). PIN
  lock and language move under Account.
- **Diagnostics**: unchanged functionally, but inherits the no-border
  card style.
- Bottom tab bar: 4 items, active item gold, inactive slate, no labels
  on Home (icon only) — labels appear on press.

## 6. Consistent branding checklist

- [ ] One `BrandLogo` component (sizes: 20/48/96/128) used by header,
      connect ring, splash, intro — no duplicated image assets.
- [ ] Gold only from `gold.300/400` tokens — no hex literals in screens.
- [ ] Persian + English wordmark lockups exported at same metrics.
- [ ] Notification icon + Android adaptive icon re-cut from the same
      Lion & Sun source.
- [ ] Store screenshots regenerated after redesign (gold connected shot
      first).

## 7. Token changes (implementation sketch, later)

```ts
// tokens.ts
status: {
  connected:  Colors.gold[400],   // was #00E87A
  connecting: Colors.gold[300],   // arc sweep
  disconnected: '#5A6B85',
  error: '#FF4444',
},
radius: { card: 20 /* was 16 */ },
```

## 8. Deliverables & order

1. HTML mockups in `mobile-app/mockups/` (extend existing set):
   `08-home-gold.html`, `09-intro.html`, `10-ecosystem.html` — for
   review **before any RN code**.
2. After sign-off: tokens change → `BrandLogo` component → Home ring →
   intro screens → minimalism pass per screen (one PR each).
3. Screenshot diff set (before/after) for the store listing.
