# /realgram — Theme & Screens (logo excluded for now)

Logo is intentionally NOT in this package — we're still iterating on the mark.
Everything here is what Claude Code needs to theme the pages.

```
docs/
  01-DESIGN-IDENTITY.md   visual language, gold/silver mechanic, motion, ads, nav
  02-CLAUDE-CODE-BRIEF.md what to build, in what order
  03-NAMING.md            Shahnameh / ancient-Persia naming
  04-PAGE-THEMES.md    <- START HERE: exact classes to use on each screen
tokens/
  tokens.json             machine-readable design tokens
  realgram-theme.css      the theme: variables + page-level component classes
  real-coin.js            <real-coin> web component (gold/silver, tap, hold-3s)
screens/
  01-home … 10-starlink-banner   working HTML references (the visual spec)
```

## Quick start
```js
import '/tokens/realgram-theme.css';
import '/tokens/real-coin.js';
```
Then follow `docs/04-PAGE-THEMES.md` screen by screen.

## The one rule
Gold = owned / connected / earned. Silver = locked / disconnected / not-yet-converted.
