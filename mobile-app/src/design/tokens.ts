// SetaLink Design System — V1
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
    glow:    'rgba(0, 232, 122, 0.25)',
    active:  'rgba(0, 232, 122, 0.5)',
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

  // Brand: Gold (Lion & Sun accent — premium, referral, rewards)
  gold: {
    300: '#F0D060',
    400: '#D4AF37',
    500: '#C9982A',
    600: '#B8860B',
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
    connected:    '#00E87A',
    connecting:   '#FFB800',
    disconnected: '#FF4444',
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
  },
};

export const Typography = {
  // Font families
  family: {
    display: 'Inter-Thin',      // large hero text
    heading: 'Inter-SemiBold',
    body:    'Inter-Regular',
    mono:    'JetBrainsMono-Regular',
    label:   'Inter-Medium',
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
