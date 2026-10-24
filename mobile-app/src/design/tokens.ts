// RealGram Design System — V1, retuned to Gold After Dark (approved 2026-10-23,
// docs/design/GOLD_AFTER_DARK.md in Real-Gram/Realgram): ink/charcoal surfaces,
// champagne gold actions, warm off-white text. Values only — every screen
// picks the new palette up through these tokens, no layout changes.

export const Colors = {
  // Backgrounds
  bg: {
    void:    '#060709',   // deepest black
    base:    '#090A0E',   // primary background — Gold After Dark ink
    surface: '#19191E',   // card background — charcoal
    elevated:'#222228',   // elevated card — raised charcoal
    glass:   'rgba(25, 25, 30, 0.72)', // glassmorphism
    overlay: 'rgba(6, 7, 9, 0.85)',
  },

  // Borders
  border: {
    subtle:  'rgba(255, 255, 255, 0.05)',
    default: 'rgba(255, 255, 255, 0.08)',
    // Were emerald-based; champagne gold under Gold After Dark.
    glow:    'rgba(231, 199, 120, 0.25)',
    active:  'rgba(231, 199, 120, 0.5)',
    // Gold-based — use on gold-themed screens (theme pkg's `line.default`).
    goldGlow:   'rgba(231, 199, 120, 0.14)',
    goldActive: 'rgba(231, 199, 120, 0.5)',
  },

  // Brand: Emerald Green — legacy key kept so the 114 existing call sites
  // still compile, but under Gold After Dark the primary accent is champagne
  // gold. Connected/presence status uses `status.connected` (mint), not this.
  emerald: {
    50:  '#FFF8E6',
    100: '#FFEFC7',
    200: '#FFE6A1',
    300: '#F0D58E',
    400: '#E7C778',  // primary accent — champagne gold
    500: '#D9B465',
    600: '#C49349',
    700: '#8F6A30',
    800: '#5E451E',
    900: '#2F220E',
  },

  // Brand: Gold — RealGram's new hero color (theme pkg 2026-07-23).
  // The one rule: GOLD = owned / connected / just tapped / just converted.
  // SILVER (below) = locked / disconnected / not yet earned. Ramp anchored
  // so 400/600/100 land exactly on the spec's mid/lo/hi values — every
  // existing `Colors.gold[xxx]` call site (21 files, previously scoped to
  // "premium accent") shifts to these values automatically; that's the
  // intended first wave of the rebrand, not a bug.
  gold: {
    50:  '#FFF8E6',
    100: '#FFE6A1',  // hi — Gold After Dark button top stop
    200: '#F6DA94',
    300: '#EED086',
    400: '#E7C778',  // mid / primary — Gold After Dark champagne gold
    500: '#E4BD6E',  // button middle stop
    600: '#C49349',  // lo — button bottom stop
    700: '#8F6A30',  // coinGold gradient's dark stop
    800: '#5E451E',
    900: '#2F220E',
  },

  // Brand: Silver — the other half of the gold/silver mechanic.
  // locked / disconnected / pre-conversion.
  silver: {
    100: '#E8ECF1',  // hi
    300: '#B7C0CC',  // mid / primary
    500: '#8991A0',
    600: '#5B6472',  // lo
  },

  // Combo / energy / XP / epic rarity.
  violet: {
    400: '#B49AFF',  // Gold After Dark lilac (avatar rings, secondary links)
    600: '#8F74E8',
  },

  // Forge heat / streak / progress warmth.
  ember: {
    400: '#FF8A3D',
  },

  // Starlink / data / network / rare rarity — distinct from `blue`.
  cyan: {
    300: '#7FE3FF',
    400: '#33D3FF',
  },

  // Success / connected-status / REAL-positive / active-VPN — kept as its
  // own semantic color per the theme spec (gold is the *brand* hero, this
  // green is a status indicator, e.g. a small "connected" dot/pill).
  green: {
    400: '#73DFBC',  // Gold After Dark mint
  },

  // Disconnect warning / spend / rival / mythic rarity.
  red: {
    400: '#FF5A5A',
  },

  rarity: {
    common:    '#AEB6C6',
    rare:      '#7FE3FF',
    epic:      '#C9BFFF',
    legendary: '#E7C778',
    mythic:    '#FF9E9E',
  },

  // Brand: Electric Blue (secondary)
  blue: {
    300: '#66B8FF',
    400: '#3399FF',
    500: '#0077FF',
    600: '#005ACC',
  },

  // Semantic
  status: {
    connected:    '#73DFBC',  // Gold After Dark mint (presence / connected)
    connecting:   '#E7C778',
    disconnected: '#FF5A5A',  // matches RealCoin's hold-to-disconnect ring exactly
    idle:         '#6E6D78',
  },

  // Text
  text: {
    primary:   '#F5F1E8',  // Gold After Dark warm off-white
    secondary: '#AAA9B4',
    muted:     '#77767F',  // inactive but still legible on ink
    inverse:   '#21170B',  // dark text on gold
    accent:    '#E7C778',
  },

  // Gradients (as stops — use with LinearGradient)
  gradient: {
    emerald:    ['#FFE6A1', '#E4BD6E', '#C49349'],  // legacy key → gold button
    emeraldGlow:['#E7C778', '#8F6A30', 'transparent'],
    night:      ['#090A0E', '#19191E'],
    surface:    ['rgba(25,25,30,0.9)', 'rgba(9,10,14,0.9)'],
    glass:      ['rgba(255,255,255,0.07)', 'rgba(255,255,255,0.02)'],
    danger:     ['#FF6B6B', '#CC0000'],
    premium:    ['#FFE6A1', '#C49349'],

    // Gold/silver theme (theme pkg tokens.json `gradient`). coinGold/
    // coinSilver are 3-stop radial gradients (RealCoin's fill) — use with
    // react-native-svg's <RadialGradient>, not <LinearGradient>.
    coinGold:   ['#FFE6A1', '#E4BD6E', '#8F6A30'],
    coinSilver: ['#E8ECF1', '#B7C0CC', '#4B525D'],
    goldButton: ['#FFE6A1', '#E4BD6E', '#C49349'],
    starlink:   ['#33D3FF', '#7FE3FF'],
    energy:     ['#8F74E8', '#B49AFF', '#E7C778', '#FF8A3D'],
    // Carved-stone card effect (theme pkg §5): layer these as two thin
    // LinearGradient overlays inside a card — RN has no inset box-shadow,
    // so the "top highlight / bottom depth" look is faked with overlays
    // rather than a shadow token. Pair with `Shadow.goldGlow` for the drop.
    carvedTop:    ['rgba(255,255,255,0.06)', 'transparent'],
    carvedBottom: ['transparent', 'rgba(0,0,0,0.35)'],
  },
};

export const Typography = {
  // Font families
  family: {
    display: 'Inter-Thin',      // large hero text
    heading: 'Inter-SemiBold',
    body:    'Inter-Regular',
    // `Inter-*` above were never actually linked as real font files (the
    // app has always silently fallen back to the OS default) — left as-is,
    // zero risk, until each screen gets its own gold-theme reskin pass.
    // `mono` is the one exception: JetBrainsMono-Regular IS now a real
    // linked font (theme pkg, 2026-07-23) under this exact name, so every
    // existing `Typography.family.mono` call site upgrades for free.
    mono:    'JetBrainsMono-Regular',
    label:   'Inter-Medium',

    // Gold theme (net-new, opt-in — use explicitly on reskinned screens,
    // don't repoint `display`/`heading` above yet).
    displayGold: 'SpaceGrotesk-Regular',
    displayGoldBold: 'SpaceGrotesk-Bold',
    // Persian/RTL text and the RealCoin glyph (U+FDFC ﷼) — genuinely new,
    // nothing referenced this key before.
    persian: 'Vazirmatn-Regular',
  },

  // Scale (sp units)
  size: {
    xs:   10,
    sm:   12,
    base: 14,
    md:   16,
    lg:   18,
    xl:   22,
    '2xl': 28,
    '3xl': 36,
    '4xl': 48,
    hero:  64,
  },

  // Line heights
  leading: {
    tight:   1.1,
    snug:    1.25,
    normal:  1.5,
    relaxed: 1.75,
  },

  // Letter spacing
  tracking: {
    tightest: -1.5,
    tight:    -0.5,
    normal:   0,
    wide:     0.5,
    wider:    1.5,
    widest:   3.0,
  },
};

export const Spacing = {
  0:  0,
  1:  4,
  2:  8,
  3:  12,
  4:  16,
  5:  20,
  6:  24,
  7:  28,
  8:  32,
  10: 40,
  12: 48,
  16: 64,
  20: 80,
  24: 96,
};

export const Radius = {
  sm:   8,
  md:   12,
  lg:   16,
  xl:   20,
  '2xl':24,
  '3xl':32,
  full: 9999,
};

export const Shadow = {
  emerald: {
    shadowColor:   '#E7C778',
    shadowOffset:  { width: 0, height: 0 },
    shadowOpacity: 0.35,
    shadowRadius:  24,
    elevation:     12,
  },
  blue: {
    shadowColor:   '#0077FF',
    shadowOffset:  { width: 0, height: 0 },
    shadowOpacity: 0.3,
    shadowRadius:  20,
    elevation:     10,
  },
  gold: {
    shadowColor:   '#E7C778',
    shadowOffset:  { width: 0, height: 0 },
    shadowOpacity: 0.35,
    shadowRadius:  20,
    elevation:     10,
  },
  card: {
    shadowColor:   '#000000',
    shadowOffset:  { width: 0, height: 8 },
    shadowOpacity: 0.4,
    shadowRadius:  24,
    elevation:     8,
  },
  subtle: {
    shadowColor:   '#000000',
    shadowOffset:  { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius:  8,
    elevation:     4,
  },
  // Gold theme glows (theme pkg `shadow.goldGlow`/`starlinkGlow`).
  goldGlow: {
    shadowColor:   '#E7C778',
    shadowOffset:  { width: 0, height: 0 },
    shadowOpacity: 0.35,
    shadowRadius:  24,
    elevation:     12,
  },
  starlinkGlow: {
    shadowColor:   '#33D3FF',
    shadowOffset:  { width: 0, height: 0 },
    shadowOpacity: 0.18,
    shadowRadius:  28,
    elevation:     10,
  },
};

export const Animation = {
  // Durations (ms)
  duration: {
    instant:  80,
    fast:     150,
    normal:   250,
    slow:     400,
    verySlow: 700,
    cinematic:1200,
  },
  // Spring configs
  spring: {
    gentle:   { damping: 20, stiffness: 200 },
    bouncy:   { damping: 12, stiffness: 300 },
    stiff:    { damping: 25, stiffness: 400 },
    wobbly:   { damping: 10, stiffness: 180 },
  },
};

export const Layout = {
  screenPadding:    20,
  cardPadding:      16,
  bottomNavHeight:  80,
  statusBarHeight:  48,
  connectButtonSize:200,
  serverRowHeight:  68,
};
