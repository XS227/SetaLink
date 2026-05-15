# SetaLink Mobile App — Design System v1

## Brand DNA

SetaLink is not a VPN app. It is an **AI-powered connectivity platform**.
The design must communicate: *calm intelligence, trusted infrastructure, premium technology*.

Inspirations: Apple Maps Night Mode × NordVPN × Linear.app × Nothing Phone

---

## Color System

### Core Palette

| Token               | Hex         | Usage                              |
|---------------------|-------------|------------------------------------|
| `bg.void`           | `#030609`   | Splash / deepest background        |
| `bg.base`           | `#070D18`   | Primary screen background          |
| `bg.surface`        | `#0D1828`   | Cards, inputs                      |
| `bg.elevated`       | `#111F35`   | Elevated cards, dropdowns          |
| `emerald.400`       | `#00E87A`   | **Primary accent** — CTAs, active  |
| `blue.400`          | `#3399FF`   | Secondary accent — info, links     |
| `text.primary`      | `#F0F6FF`   | Body text                          |
| `text.secondary`    | `#7A9BC0`   | Secondary text                     |
| `text.muted`        | `#3D5570`   | Labels, placeholders               |

### Status Colors

| State        | Color     |
|--------------|-----------|
| Connected    | `#00E87A` |
| Connecting   | `#FFB800` |
| Disconnected | `#FF4444` |
| Idle         | `#556680` |

### Glassmorphism Recipe

```
backgroundColor: rgba(13, 24, 40, 0.72)
borderColor:     rgba(255, 255, 255, 0.08)
backdropFilter:  blur(20px) saturate(180%)
```

---

## Typography

Font stack: **Inter** (primary) + **JetBrains Mono** (code/metrics)

| Role      | Family           | Size   | Weight    | Tracking |
|-----------|------------------|--------|-----------|----------|
| Hero      | Inter Thin       | 64sp   | 100       | -1.5     |
| H1        | Inter SemiBold   | 36sp   | 600       | -0.5     |
| H2        | Inter SemiBold   | 28sp   | 600       | -0.5     |
| H3        | Inter SemiBold   | 22sp   | 600       | -0.5     |
| Body      | Inter Regular    | 14sp   | 400       | 0        |
| Label     | Inter Medium     | 12sp   | 500       | +1.5     |
| Mono      | JetBrains Mono   | 12–14sp| 400       | 0        |
| Micro     | Inter Medium     | 10sp   | 500       | +1.5     |

Labels are always `UPPERCASE` with `letterSpacing: 1.5`.
Mono is used for: ping, IPs, protocol names, traffic values, timestamps.

---

## Spacing Scale

Based on 4px grid:

```
1 = 4px    2 = 8px    3 = 12px   4 = 16px
5 = 20px   6 = 24px   8 = 32px   10 = 40px
12 = 48px  16 = 64px
```

Screen horizontal padding: **20px**
Card internal padding: **16px**
Gap between cards: **16px**

---

## Border Radius

```
sm:   8px    md:  12px    lg:  16px
xl:  20px    2xl: 24px    3xl: 32px
full: 9999px (pills, avatars, dots)
```

---

## Shadow System

### Emerald Glow (active / connected state)
```
shadowColor:   #00E87A
shadowOffset:  { width: 0, height: 0 }
shadowOpacity: 0.35
shadowRadius:  24
```

### Card Shadow
```
shadowColor:   #000000
shadowOffset:  { width: 0, height: 8 }
shadowOpacity: 0.4
shadowRadius:  24
```

---

## Animation Principles

**Philosophy**: Purposeful, never decorative. Every animation conveys state change.

### Timing

| Name      | Duration | Usage                              |
|-----------|----------|------------------------------------|
| instant   | 80ms     | Touch feedback                     |
| fast      | 150ms    | Tab switches, small toggles        |
| normal    | 250ms    | Card transitions, reveals          |
| slow      | 400ms    | Screen transitions, modal open     |
| verySlow  | 700ms    | Complex state changes              |
| cinematic | 1200ms   | Splash exit, major screen changes  |

### Spring Configs (React Native Reanimated)

```ts
gentle:  { damping: 20, stiffness: 200 }  // most UI elements
bouncy:  { damping: 12, stiffness: 300 }  // buttons, selection
stiff:   { damping: 25, stiffness: 400 }  // drawers
```

### Key Animations

**ConnectButton:**
- Press: scale 1 → 0.93 → spring back (80ms + spring)
- Connected state: 3 concentric pulse rings, staggered by 400ms each
- Background glow fade-in on connect

**StatusBadge dot:**
- Connecting: opacity pulse loop (600ms per cycle)

**AI Orb:**
- Slow rotation orbit ring (8s loop)
- Dual breathing rings when active
- Color transitions between modes

**Screen transitions:**
- Fade + slight upward translate (translateY: 20 → 0)
- Duration: 500ms, spring damping 20

---

## Component Hierarchy

```
App
└── SafeAreaView
    └── AppNavigator
        ├── SplashScreen
        ├── AuthScreen
        └── MainTabs
            ├── HomeScreen
            │   ├── ConnectButton        ← centerpiece
            │   ├── StatusBadge
            │   ├── ServerPill
            │   ├── MetricPill ×3
            │   ├── NetworkQualityBar
            │   ├── AIOptimizeButton
            │   └── TrafficCard
            ├── ServersScreen
            │   ├── SearchBar
            │   ├── FilterTabs
            │   ├── SmartPicksCarousel
            │   └── ServerRow ×N
            ├── SmartAIScreen
            │   ├── AIOrb
            │   ├── ProtocolChain
            │   ├── ModeGrid
            │   ├── ToggleList
            │   └── LiveDecisionsLog
            ├── ActivityScreen
            │   ├── SummaryCards
            │   ├── BandwidthSparkline
            │   └── ConnectionTimeline
            └── ProfileScreen
                ├── UserCard
                ├── SubscriptionCard
                ├── DeviceList
                ├── ReferralCard
                └── SettingsLink
```

Pushed screens (stack):
- SettingsScreen
- DiagnosticsScreen

---

## Screen Specifications

### 1. Splash Screen
- Duration: ~3.5 seconds total
- Background: `bg.void` → faint radial glow emerges
- Logo: hexagon rotated 45°, emerald border, scale-in spring
- Wordmark: Inter Thin, fade in
- Tagline: UPPERCASE, widest tracking, fade in
- Exit: full screen fade to black, then to Auth

### 2. Auth Screen
- Background: `bg.void` with subtle vertical grid lines (5% opacity)
- Large headline: "Welcome\nback." (28sp, SemiBold)
- Tab switcher: Login / Register, glass pill style
- Inputs: glass style, emerald focus glow
- Primary CTA: solid emerald, full width
- Biometric, Google, Invite Code as secondary row

### 3. Home Screen
- Connect button: 188dp circle, center stage
- Server pill: tappable, navigates to Servers
- Metric row: 3 equal MetricPills
- Network quality bar: animated, color-coded
- AI button: subtle emerald border, pulse dot

### 4. Servers Screen
- Category tabs: horizontally scrollable pills
- AI picks: horizontal scroll cards (130dp wide)
- Server list: full width rows with flag, ping, load bar, protocol
- Sticky connect CTA at bottom (above nav)

### 5. Smart AI Screen
- Full-screen orb visualization (160dp)
- Mode grid: 2×3 card grid
- Protocol chain: horizontal pill chain
- Toggle list: 5 smart features with toggle switches
- Live decisions log: timestamped action feed

### 6. Activity Screen
- 3-column summary bar (data, sessions, time)
- 24-bar sparkline chart (hourly bandwidth)
- Timeline with color-coded status dots

### 7. Profile Screen
- Avatar with premium star badge
- Subscription card with bandwidth progress bar
- Device list (3 items)
- Referral code copyable
- Rewards placeholder

### 8. Settings Screen
- Grouped sections with section labels
- SelectRow for protocol / DNS / language (expandable)
- ToggleRow for boolean settings
- Diagnostics shortcut row

### 9. Diagnostics Screen
- LIVE badge with pulsing dot and session timer
- 2×2 metric grid: latency, packet loss, jitter, uptime
- Connection info table (key/value mono)
- Health checks: 6 rows with pulsing status dots
- Route trace: hop-by-hop timeline
- Throughput bars (up/down)
- Export button

---

## Production Upgrade Path

### Phase 2 additions
- React Navigation v7 (replace state machine)
- `react-native-reanimated` v3 worklets for 60fps animations
- `react-native-skia` for the globe visualization
- `react-native-svg` animated path for network graph
- WebSocket connection to Xray core for real metrics
- Subscription synced via SetaLink API
- `react-native-mmkv` for offline state persistence
- Haptic feedback on connect/disconnect
- Push notifications via FCM (Android) / APNs (iOS)
- Biometric auth via `react-native-biometrics`

### Folder structure for production
```
src/
  api/          ← SetaLink API client + types
  design/       ← tokens, themes (light mode future)
  components/   ← shared UI components
  screens/      ← one file per screen
  navigation/   ← React Navigation setup
  stores/       ← Zustand state (connection, user, servers)
  hooks/        ← useConnection, useServers, useMetrics
  utils/        ← formatters, validators
  services/     ← VPN core bridge, notification service
```

---

## Micro-interaction Checklist

- [ ] Connect button: scale press + ring pulse on connect
- [ ] Server row: subtle scale on press
- [ ] Tab switch: indicator slide (not instant jump)
- [ ] Toggle: thumb spring slides, background color transitions
- [ ] Status badge: dot breathing when connecting
- [ ] AI orb: orbit rotation, ring breathing
- [ ] Metric values: number roll animation on change
- [ ] Pull-to-refresh: custom emerald spinner
- [ ] Error states: card shake animation
- [ ] Success: brief green flash on card

---

*SetaLink Design System v1.0 · May 2026*
