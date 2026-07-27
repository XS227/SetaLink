// RealGram Design System — V1
// Scandinavian · Futuristic · Minimal · Cinematic

export const Colors = {
  // Backgrounds
  bg: {
    void:    '#030609',   // deepest black
    base:    '#070D18',   // primary background
    surface: '#0D1828',   // card background
    elevated:'#111F35',   // elevated card
    glass:   'rgba(13, 24, 40, 0.72)', // glassmorphism
    overlay: 'rgba(3, 6, 9, 0.85)',
  },

  // Borders
  border: {
    subtle:  'rgba(255, 255, 255, 0.05)',
    default: 'rgba(255, 255, 255, 0.08)',
    // Emerald-based — still used by every screen not yet on the gold theme.
    glow:    'rgba(0, 232, 122, 0.25)',
    active:  'rgba(0, 232, 122, 0.5)',
    // Gold-based — use on gold-themed screens (theme pkg's `line.default`).
    goldGlow:   'rgba(255, 196, 120, 0.14)',
    goldActive: 'rgba(255, 182, 39, 0.5)',
  },

  // Brand: Emerald Green
  emerald: {
    50:  '#EDFFF6',
    100: '#C5FFE3',
    200: '#8BFFC9',
    300: '#45FFAA',
    400: '#00E87A',  // primary accent
    500: '#00C966',
    600: '#00A050',
    700: '#007A3D',
    800: '#005429',
    900: '#002E16',
  },

  // Brand: Gold — RealGram's new hero color (theme pkg 2026-07-23).
  // The one rule: GOLD = owned / connected / just tapped / just converted.
  // SILVER (below) = locked / disconnected / not yet earned. Ramp anchored
  // so 400/600/100 land exactly on the spec's mid/lo/hi values — every
  // existing `Colors.gold[xxx]` call site (21 files, previously scoped to
  // "premium accent") shifts to these values automatically; that's the
  // intended first wave of the rebrand, not a bug.
  gold: {
    50:  '#FFFBF0',
    100: '#FFF3C4',  // hi
    200: '#FFE49A',
    300: '#FFD670',
    400: '#FFB627',  // mid / primary — matches theme pkg tokens.json color.gold.1
    500: '#E09A1C',
    600: '#B8790F',  // lo — matches theme pkg tokens.json color.gold.0
    700: '#8A5A00',  // coinGold gradient's dark stop (real-coin.js)
    800: '#5C3C00',
    900: '#2E1E00',
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
    400: '#7B5CFA',
    600: '#5B4FE0',
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
    400: '#33FFB2',
  },

  // Disconnect warning / spend / rival / mythic rarity.
  red: {
    400: '#FF5A5A',
  },

  rarity: {
    common:    '#AEB6C6',
    rare:      '#7FE3FF',
    epic:      '#C9BFFF',
    legendary: '#FFB627',
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
    connected:    '#33FFB2',  // was emerald #00E87A — now the theme pkg's status green
    connecting:   '#FFB800',
    disconnected: '#FF5A5A',  // matches RealCoin's hold-to-disconnect ring exactly
    idle:         '#556680',
  },

  // Text
  text: {
    primary:   '#F0F6FF',
    secondary: '#7A9BC0',
    muted:     '#3D5570',
    inverse:   '#030609',
    accent:    '#00E87A',
  },

  // Gradients (as stops — use with LinearGradient)
  gradient: {
    emerald:    ['#00E87A', '#00A050'],
    emeraldGlow:['#00E87A', '#007A3D', 'transparent'],
    night:      ['#070D18', '#0D1828'],
    surface:    ['rgba(13,24,40,0.9)', 'rgba(7,13,24,0.9)'],
    glass:      ['rgba(255,255,255,0.07)', 'rgba(255,255,255,0.02)'],
    danger:     ['#FF6B6B', '#CC0000'],
    premium:    ['#FFB800', '#FF8C00'],

    // Gold/silver theme (theme pkg tokens.json `gradient`). coinGold/
    // coinSilver are 3-stop radial gradients (RealCoin's fill) — use with
    // react-native-svg's <RadialGradient>, not <LinearGradient>.
    coinGold:   ['#FFF3C4', '#FFB627', '#8A5A00'],
    coinSilver: ['#E8ECF1', '#B7C0CC', '#4B525D'],
    goldButton: ['#FFF3C4', '#FFB627'],
    starlink:   ['#33D3FF', '#7FE3FF'],
    energy:     ['#5B4FE0', '#7B5CFA', '#FFB627', '#FF8A3D'],
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
    shadowColor:   '#00E87A',
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
    shadowColor:   '#D4AF37',
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
    shadowColor:   '#FFB627',
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
