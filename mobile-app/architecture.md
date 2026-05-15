# SetaLink Mobile — Architecture Document

**Version:** 1.0  
**Date:** 2026-05-15  
**Status:** Pre-Implementation Planning  
**Platform:** iOS 16+ · Android 10+ (API 29+)

---

## 1. Executive Summary

SetaLink is architected as a **bare React Native application** with a strict separation between the JavaScript UI layer and the native VPN core. The design philosophy is performance-by-default: every animation runs on the UI thread via Reanimated worklets, every storage access is synchronous via MMKV, and the Xray native bridge is wrapped behind a typed async interface that the rest of the app never reaches past. State is colocated by domain (six Zustand stores), never shared globally, which keeps re-render scope narrow and predictable. The app is built to run well on mid-range Android from 2021 — blur effects, particle systems, and animation count are all gated behind a device capability flag that degrades gracefully without touching the core logic.

---

## 2. Project Setup

### Bare React Native with Expo Modules (not Expo Managed)

The project uses **bare React Native** initialized via `npx react-native init`, with the Expo Modules package (`expo-modules-core`) grafted in using `npx install-expo-modules`. This is not an Expo managed workflow project.

**Why bare and not Expo managed:**

Xray-core is a compiled Go binary. Integrating it requires:

1. A custom **native module** (`NativeXrayBridge`) that bridges the Go shared library (`.so` on Android, `.framework` on iOS) to JS.
2. Custom Gradle build configuration to bundle the `.so` files per ABI.
3. Custom iOS `Podfile` entries for the Xray framework target.
4. A foreground service on Android with a custom notification channel that cannot be declared via Expo config plugins without forking them.

Expo managed workflow prohibits custom native code without ejecting. Ejecting gives you the same bare workflow with extra migration debt. We start bare.

**Why Expo modules still apply:**

Despite using bare workflow, we install individual Expo packages where they outperform community alternatives:

| Package | Value over alternative |
|---|---|
| `expo-blur` | Better performance than `@react-native-community/blur` on iOS. Backed by Expo's native team. |
| `expo-secure-store` | Keychain/Keystore wrapper with a consistent API. Cleaner than `react-native-keychain` for our token storage needs. |
| `expo-dev-client` | Custom dev build with our native modules included. Required because Expo Go cannot load custom native modules. |
| `expo-font` | Handles Inter + JetBrains Mono asset loading with `useFonts` hook. No manual platform linking. |

---

## 3. Recommended Stack

| Library | Version | Purpose | Why Not Alternative |
|---|---|---|---|
| `react-native` | 0.75.4 | Core framework | — |
| `@react-navigation/native` | 7.x | Navigation container, deep linking | React Navigation 7 ships Fabric-compatible screens and static type inference for routes. React Navigation 5/6 do not support static config. |
| `@react-navigation/bottom-tabs` | 7.x | Bottom tab navigator | Ships with the native-stack peer dependency that enables hardware-accelerated screen transitions. |
| `@react-navigation/native-stack` | 7.x | Stack screens within each tab | Native stack uses UINavigationController / FragmentManager — zero JS-thread cost on transitions. |
| `react-native-reanimated` | 3.15.x | All animations | **Worklets run on the UI thread.** Animated API runs on JS thread. GSAP, Lottie, and CSS animations do not have access to gesture responder state. This is non-negotiable for the ConnectButton press → VPN connect transition. |
| `react-native-gesture-handler` | 2.x | Tap, pan, long-press gestures | Required by Reanimated 3 for `useAnimatedGestureHandler`. RN's built-in PanResponder runs on JS thread. |
| `zustand` | 5.x | Client-side state | Zero boilerplate, no context providers, slices pattern composes cleanly. Redux Toolkit: 10× boilerplate, DevTools overkill for 6 stores. MobX: implicit reactivity hides update causes — bad for debugging VPN state machine. |
| `@mmkv/react-native` | 3.x | Persistent encrypted storage | **Synchronous reads**. AsyncStorage blocks the render cycle during hydration. MMKV uses mmap — reads are sub-microsecond. Encrypts with AES-256 using device keychain key. |
| `react-native-svg` | 15.x | SVG icons, diagnostic charts | Fabric-compatible. `react-native-vector-icons` bundles font files per icon set which inflates the binary. Raw SVG gives us animated paths for the DiagnosticsChart. |
| `@tanstack/react-query` | 5.x | Server state (API calls, caching) | Handles loading/error/stale states, background refetch, and offline queuing automatically. SWR is viable but lacks the mutation pipeline we need for server ping cache invalidation. |
| `axios` | 1.x | HTTP client underlying React Query | Interceptors for JWT refresh, request signing, and error normalization in one place. `fetch` has no interceptor layer. |
| `expo-blur` | 14.x | Glassmorphism blur on cards | Better performance than `@react-native-community/blur` on iOS 16+ (uses `UIBlurEffect` directly). |
| `expo-secure-store` | 14.x | JWT + VPN credentials storage | Keychain (iOS) / Keystore (Android) backed. No plaintext credentials on disk. |
| `react-native-fs` | 2.x | Log file export from Diagnostics screen | Access to the app's Documents directory for writing `.log` files. No viable Expo alternative for arbitrary file writes. |
| `react-native-safe-area-context` | 5.x | Safe area insets | Required by React Navigation. `useSafeAreaInsets()` used in BottomNav to pad correctly on iPhone 14 Pro and newer Android notch devices. |
| `expo-font` | 13.x | Custom font loading | Asset pipeline with `useFonts`. Works in bare workflow. |
| `expo-dev-client` | 4.x | Development builds with native modules | Required to develop locally — Expo Go cannot load XrayBridge. |

---

## 4. Folder Structure

```
mobile-app/
├── src/
│   │
│   ├── screens/                         # One folder per screen
│   │   ├── splash/
│   │   │   ├── SplashScreen.tsx         # Screen component (JSX only, no logic)
│   │   │   ├── SplashScreen.styles.ts   # StyleSheet.create() for this screen
│   │   │   └── SplashScreen.hooks.ts    # useEffect for animation sequence, navigation trigger
│   │   ├── auth/
│   │   │   ├── AuthScreen.tsx
│   │   │   ├── AuthScreen.styles.ts
│   │   │   └── AuthScreen.hooks.ts      # useAuthForm, login/register mutation handlers
│   │   ├── home/
│   │   │   ├── HomeScreen.tsx
│   │   │   ├── HomeScreen.styles.ts
│   │   │   └── HomeScreen.hooks.ts      # useConnectionCycle, useSessionTimer
│   │   ├── smart-ai/
│   │   │   ├── SmartAIScreen.tsx
│   │   │   ├── SmartAIScreen.styles.ts
│   │   │   └── SmartAIScreen.hooks.ts   # useAIDecisionStream, useModeSelection
│   │   ├── servers/
│   │   │   ├── ServersScreen.tsx
│   │   │   ├── ServersScreen.styles.ts
│   │   │   └── ServersScreen.hooks.ts   # useServerList, usePingPoller, useServerFilter
│   │   ├── diagnostics/
│   │   │   ├── DiagnosticsScreen.tsx
│   │   │   ├── DiagnosticsScreen.styles.ts
│   │   │   └── DiagnosticsScreen.hooks.ts # useMetricPoller, useHopTrace, useLogExport
│   │   ├── profile/
│   │   │   ├── ProfileScreen.tsx
│   │   │   ├── ProfileScreen.styles.ts
│   │   │   └── ProfileScreen.hooks.ts   # useSubscriptionInfo, useLogout
│   │   └── settings/
│   │       ├── SettingsScreen.tsx
│   │       ├── SettingsScreen.styles.ts
│   │       └── SettingsScreen.hooks.ts  # useSettingsMutations
│   │
│   ├── components/
│   │   ├── atoms/                       # Smallest indivisible UI units. No state, no logic.
│   │   │   ├── AnimatedRing.tsx         # Single pulsing SVG ring (used in AIOrb)
│   │   │   ├── GlowDot.tsx              # Colored dot with optional glow box-shadow
│   │   │   ├── PingDot.tsx              # Color-coded latency dot (green/amber/red)
│   │   │   ├── MonoText.tsx             # JetBrains Mono <Text> wrapper with pre-set sizes
│   │   │   ├── StatusDot.tsx            # Animated blinking dot for connection state
│   │   │   ├── Toggle.tsx               # Controlled switch with spring animation
│   │   │   ├── Tag.tsx                  # Pill-shaped label (protocol names, feature tags)
│   │   │   └── PowerIcon.tsx            # SVG power icon, color-animates with connection state
│   │   │
│   │   ├── molecules/                   # 2-5 atoms composed into a named unit. Minimal state.
│   │   │   ├── GlassCard.tsx            # Glassmorphism container with blur + border
│   │   │   ├── StatusPill.tsx           # GlowDot + text pill with colored border
│   │   │   ├── MetricPill.tsx           # Single stat card (value + label, no icon)
│   │   │   ├── MetricRow.tsx            # Label + value + optional delta inline row
│   │   │   ├── ServerRow.tsx            # Flag + name + ping + load bar row item
│   │   │   ├── ProtocolChain.tsx        # Horizontal list of Tag atoms showing active protocols
│   │   │   ├── AIBadge.tsx              # Emerald badge showing active AI mode name
│   │   │   └── DiagnosticsMetric.tsx    # Icon + name + value + health indicator row
│   │   │
│   │   └── organisms/                   # Complex, self-contained UI sections. May hold local state.
│   │       ├── ConnectButton.tsx        # Main VPN connect/disconnect button with ring animations
│   │       ├── AIOrb.tsx                # AI center orb: core + orbit ring + breathing rings
│   │       ├── BottomNav.tsx            # 5-tab nav bar with center AI button elevated
│   │       ├── GlowButton.tsx           # Full-width action button with glow shadow
│   │       ├── DiagnosticsChart.tsx     # SVG time-series chart for latency/jitter
│   │       ├── ServerList.tsx           # FlatList wrapper with pull-to-refresh + filters
│   │       ├── ModeGrid.tsx             # 2×3 grid of AI mode selection cards
│   │       └── NetworkQualityCard.tsx   # Composite card: quality score + metric rows
│   │
│   ├── animations/                      # Reanimated hooks only. No JSX in this directory.
│   │   ├── useBreathing.ts              # Shared value breathing loop (scale + opacity)
│   │   ├── usePulseRings.ts             # Staggered outward ring pulse sequence
│   │   ├── useOrbit.ts                  # Continuous rotation shared value (orbit ring)
│   │   ├── useSectionReveal.ts          # translateY+opacity entrance when section enters viewport
│   │   ├── useSpring.ts                 # Configurable spring (mass, damping, stiffness factory)
│   │   ├── useConnectTransition.ts      # Multi-step animated sequence for VPN connect state change
│   │   └── timings.ts                   # All duration/easing constants (see §6)
│   │
│   ├── hooks/                           # Non-animation business logic hooks
│   │   ├── useDeviceCapability.ts       # Detects RAM/GPU tier; sets capability flag
│   │   ├── useAppState.ts               # AppState listener (active/background/inactive)
│   │   ├── useNetworkInfo.ts            # Network type, reachability, bandwidth estimate
│   │   ├── useSessionTimer.ts           # Increments elapsed time every second while connected
│   │   ├── useDeepLink.ts               # Handle vpn:// deep links (server share links)
│   │   └── useTheme.ts                  # Returns current theme tokens object
│   │
│   ├── services/
│   │   ├── api/
│   │   │   ├── client.ts                # Axios instance with base URL, interceptors, JWT refresh
│   │   │   ├── auth.api.ts              # login(), register(), refreshToken(), logout()
│   │   │   ├── servers.api.ts           # getServers(), pingServer(), getServerDetail()
│   │   │   ├── ai.api.ts                # getAIRecommendation(), submitFeedback()
│   │   │   ├── diagnostics.api.ts       # submitDiagnosticsReport(), getHealthStatus()
│   │   │   └── profile.api.ts           # getProfile(), updateProfile(), getSubscription()
│   │   │
│   │   ├── vpn/
│   │   │   ├── XrayBridge.ts            # Native module wrapper: startXray, stopXray, getStats
│   │   │   ├── ConnectionManager.ts     # State machine: idle→connecting→connected→disconnecting
│   │   │   ├── ProtocolManager.ts       # VLESS/Reality/WebSocket/XHTTP/HTTPUpgrade selector
│   │   │   └── VpnConfig.ts             # Config builder: takes server+protocol, returns Xray JSON
│   │   │
│   │   ├── storage/
│   │   │   ├── mmkv.ts                  # MMKV instance initialization (encrypted)
│   │   │   ├── secureStore.ts           # expo-secure-store wrappers for credentials/tokens
│   │   │   └── storageKeys.ts           # Enum of all MMKV and SecureStore key names
│   │   │
│   │   └── diagnostics/
│   │       ├── DiagnosticsEngine.ts     # Polls XrayBridge for latency/jitter/packetLoss
│   │       ├── HopTracer.ts             # Traceroute-like hop enumeration
│   │       └── LogExporter.ts           # Writes diagnostic log to RNFS Documents dir
│   │
│   ├── ai-routing/
│   │   ├── AIRouteSelector.ts           # Core decision logic: conditions → protocol+server
│   │   ├── conditions.ts                # Network condition evaluators (latency, jitter, loss)
│   │   ├── protocols.ts                 # Protocol capability matrix and scoring
│   │   ├── fallbackChain.ts             # Ordered fallback list when primary protocol fails
│   │   └── decisionLogger.ts            # Logs AI decisions to aiStore.decisionLog
│   │
│   ├── state/                           # Zustand stores (see §9)
│   │   ├── vpnStore.ts
│   │   ├── serverStore.ts
│   │   ├── aiStore.ts
│   │   ├── authStore.ts
│   │   ├── diagnosticsStore.ts
│   │   └── settingsStore.ts
│   │
│   ├── theme/
│   │   ├── tokens.ts                    # All design tokens (see §7)
│   │   ├── typography.ts                # Text style presets keyed by role
│   │   ├── shadows.ts                   # Platform-aware shadow style factory
│   │   └── index.ts                     # Re-exports: import { tokens } from '@/theme'
│   │
│   ├── navigation/
│   │   ├── RootNavigator.tsx            # Stack: Splash → Auth → MainTabs
│   │   ├── MainTabsNavigator.tsx        # Bottom tabs: Home, Servers, AI, Activity, Profile
│   │   ├── types.ts                     # RootStackParamList, MainTabsParamList
│   │   └── linking.ts                   # Deep link config for vpn:// scheme
│   │
│   ├── types/
│   │   ├── vpn.types.ts                 # ConnectionState, Server, Protocol, VpnStats
│   │   ├── ai.types.ts                  # AIMode, DecisionLog, ProtocolChain
│   │   ├── user.types.ts                # User, Subscription, AuthToken
│   │   ├── diagnostics.types.ts         # Metric, HealthCheck, HopResult
│   │   └── api.types.ts                 # ApiResponse<T>, PaginatedResponse<T>, ApiError
│   │
│   ├── utils/
│   │   ├── formatters.ts                # ms→"24 ms", bytes→"1.2 MB/s", seconds→"00:14:22"
│   │   ├── validators.ts                # Server config validation, email/password rules
│   │   ├── platform.ts                  # Platform.select wrappers, IS_IOS/IS_ANDROID flags
│   │   └── logger.ts                    # Dev-only console wrapper, production no-op
│   │
│   └── assets/
│       ├── fonts/                       # Inter + JetBrains Mono .ttf files
│       ├── icons/                       # SVG source icons (loaded via react-native-svg)
│       └── images/                      # App icon, splash image, server flag sprites
│
├── android/                             # Standard bare RN android directory
├── ios/                                 # Standard bare RN ios directory
├── architecture.md                      # This document
├── package.json
├── tsconfig.json
├── babel.config.js
└── metro.config.js
```

**Path alias:** Configure `tsconfig.json` with `"@/*": ["src/*"]` and Metro with `extraNodeModules` so all imports use `@/screens/home/HomeScreen` instead of relative `../../` chains.

---

## 5. Shared Component Library

### GlassCard

**Purpose:** Glassmorphism container that wraps any content with a blurred background, border, and optional emerald glow. The single most-reused structural component in the app.

```typescript
interface GlassCardProps {
  children: React.ReactNode;
  glowVariant?: 'none' | 'subtle' | 'active';  // border-glow intensity
  padding?: number;                              // defaults to tokens.spacing.md (16)
  borderRadius?: number;                         // defaults to tokens.radius.xl (20)
  onPress?: () => void;                          // wraps in Pressable if provided
  style?: ViewStyle;
}
```

**Screens:** Home, Smart AI, Servers, Diagnostics, Profile, Settings  
**Animation dependencies:** None (static). Wraps animated children but does not animate itself.

---

### AIOrb

**Purpose:** The centerpiece of the Smart AI screen. Renders the animated core sphere, orbiting particle ring, and breathing pulse rings. Responds to AI processing state.

```typescript
interface AIOrbProps {
  size?: number;          // diameter of core sphere, default 112
  isThinking?: boolean;   // speeds up orbit, adds secondary ring
  mode?: AIMode;          // 'stealth' | 'speed' | 'streaming' | 'bypass' | 'smart' | 'shield'
  onPress?: () => void;
}
```

**Screens:** Smart AI (hero), Home (compact, 64px)  
**Animation dependencies:** `useBreathing`, `usePulseRings`, `useOrbit`

---

### ConnectButton

**Purpose:** The primary VPN connect/disconnect control. Multi-state button that drives the `useConnectTransition` animation sequence and dispatches to `ConnectionManager`.

```typescript
type ConnectionState = 'idle' | 'connecting' | 'connected' | 'disconnecting' | 'error';

interface ConnectButtonProps {
  state: ConnectionState;
  onConnect: () => Promise<void>;
  onDisconnect: () => Promise<void>;
  size?: number;           // outer diameter, default 160
  disabled?: boolean;
}
```

**Screens:** Home (primary), Settings (kill-switch variant as a smaller GlowButton)  
**Animation dependencies:** `useConnectTransition`, `usePulseRings`, `useBreathing`

---

### StatusPill

**Purpose:** Compact pill badge indicating current connection or system state. Used inline in headers, cards, and list items.

```typescript
type StatusVariant = 'connected' | 'connecting' | 'disconnected' | 'error' | 'warning' | 'info';

interface StatusPillProps {
  variant: StatusVariant;
  label: string;
  animate?: boolean;       // enables blinking dot for 'connecting' state
  size?: 'sm' | 'md';
}
```

**Screens:** Home (header), Servers (list items), Diagnostics (health checks)  
**Animation dependencies:** CSS-equivalent `useBreathing` on the dot only (low cost)

---

### MetricRow

**Purpose:** Single horizontal row showing a label, its current value, and an optional delta/trend indicator. Composable inside GlassCard for stat panels.

```typescript
interface MetricRowProps {
  label: string;
  value: string | number;
  unit?: string;                        // 'ms', 'MB/s', '%'
  delta?: number;                       // positive = better (green), negative = worse (red)
  valueColor?: string;                  // override for semantic coloring
  mono?: boolean;                       // renders value in JetBrains Mono
  icon?: React.ReactNode;
}
```

**Screens:** Diagnostics, Home (session stats panel)  
**Animation dependencies:** None.

---

### ServerCard

**Purpose:** A tappable list item representing a VPN server. Shows flag, location, ping, load bar, and protocol tags. Active state shows emerald border glow.

```typescript
interface ServerCardProps {
  server: Server;                       // from vpn.types.ts
  isActive?: boolean;
  onPress: (server: Server) => void;
  showProtocols?: boolean;              // show ProtocolChain molecule below name
  ping?: number;                        // live ping value in ms, overrides server.ping
}
```

**Screens:** Servers (list), Home (selected server mini-card)  
**Animation dependencies:** `useSpring` on border-color transition when `isActive` changes.

---

### BottomNav

**Purpose:** The persistent 5-tab navigation bar. Tab 3 (AI Center) is elevated above the bar with an emerald circle. Uses React Navigation's `BottomTabBarProps`.

```typescript
interface BottomNavProps {
  state: TabNavigationState<MainTabsParamList>;
  descriptors: BottomTabDescriptorMap;
  navigation: NavigationHelperType;
}
// Tabs: Home, Servers, AI (center, elevated), Activity, Profile
```

**Screens:** Renders on all Main Tab screens  
**Animation dependencies:** `useSpring` for tab indicator dot scale on press.

---

### AnimatedRing

**Purpose:** Single SVG circle ring that pulses outward and fades. The atom building block used inside `AIOrb` and `ConnectButton`. Accepts delay to enable staggered multi-ring sequences.

```typescript
interface AnimatedRingProps {
  size: number;             // diameter
  color?: string;           // default: tokens.colors.emerald[400]
  duration?: number;        // ms, default 4000
  delay?: number;           // ms, stagger offset
  borderStyle?: 'solid' | 'dashed';
}
```

**Screens:** Home (ConnectButton rings), Smart AI (AIOrb rings)  
**Animation dependencies:** `usePulseRings` (each ring is one instance)

---

### GlowButton

**Purpose:** Full-width or auto-width action button with emerald fill and radial glow shadow. Used for primary CTAs when ConnectButton is not present.

```typescript
type GlowButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';

interface GlowButtonProps {
  label: string;
  onPress: () => void;
  variant?: GlowButtonVariant;          // default: 'primary'
  loading?: boolean;                     // shows ActivityIndicator, disables press
  icon?: React.ReactNode;
  fullWidth?: boolean;
  disabled?: boolean;
}
```

**Screens:** Auth (Sign In / Register), Profile (Upgrade Plan, Log Out), Settings  
**Animation dependencies:** `useSpring` for scale on press-in/out.

---

### DiagnosticsChart

**Purpose:** SVG time-series line chart rendering up to 60 data points (1 per second) for latency, jitter, or packet loss. Auto-scrolls the window as new data arrives.

```typescript
interface DiagnosticsChartProps {
  data: number[];                       // most recent N values
  metric: 'latency' | 'jitter' | 'packetLoss';
  height?: number;                      // default 120
  accentColor?: string;                 // defaults per metric: emerald/blue/amber
  showGrid?: boolean;
  windowSize?: number;                  // how many points to render, default 60
}
```

**Screens:** Diagnostics  
**Animation dependencies:** None — SVG path recalculation on data change, no Reanimated needed.

---

## 6. Animation Architecture

### Timing Constants (`src/animations/timings.ts`)

```typescript
export const timings = {
  // Durations
  instant:     100,   // State dot blinks, toggle switch
  fast:        180,   // Button press scale feedback
  moderate:    280,   // Page section entrance reveal
  slow:        400,   // Screen transitions, ConnectButton state change
  xSlow:       800,   // Multi-step connect animation (phase 1)
  breathing:  4500,   // AIOrb breathing loop
  orbit:     16000,   // Orbital ring rotation (full cycle)
  pulse:      4000,   // Outward ring pulse (expand + fade)

  // Easing curves (Bezier strings for Reanimated withTiming)
  easeOut:         [0.0, 0.0, 0.2, 1.0]   as const,
  easeInOut:       [0.4, 0.0, 0.2, 1.0]   as const,
  spring:          { damping: 18, mass: 1, stiffness: 200 },
  springBouncy:    { damping: 12, mass: 1, stiffness: 180 },
  springSnappy:    { damping: 22, mass: 0.8, stiffness: 280 },
} as const;
```

### Reusable Animation Hooks

**`useBreathing(options?)`**  
Returns a shared value that oscillates between 1.0 and 1.06 (scale) and simultaneously pulses opacity between defined min/max. Used for the AIOrb core and any "alive" idle element. Pauses automatically when `useAppState` reports background.

```typescript
interface BreathingOptions {
  minScale?: number;    // default 1.0
  maxScale?: number;    // default 1.06
  minOpacity?: number;  // default 0.85
  maxOpacity?: number;  // default 1.0
  duration?: number;    // default timings.breathing
}
// Returns: { scaleAV: SharedValue<number>, opacityAV: SharedValue<number> }
```

**`usePulseRings(count, options?)`**  
Returns an array of `count` shared values, each representing one ring's outward progress (0→1). Rings are staggered by `timings.pulse / count` delay. At progress 1.0 the ring is fully expanded and transparent. Used inside `AnimatedRing`.

```typescript
interface PulseRingsOptions {
  duration?: number;       // default timings.pulse
  stagger?: number;        // ms between ring starts, default duration/count
}
// Returns: SharedValue<number>[]  (one per ring, 0=small+opaque, 1=large+transparent)
```

**`useOrbit(options?)`**  
Returns a single rotation shared value (0→360, wrapping) running `withRepeat(withTiming(...), -1)`. Used for the dashed orbit ring around AIOrb. Speed doubles when `isThinking` prop is passed.

```typescript
interface OrbitOptions {
  duration?: number;   // default timings.orbit
  clockwise?: boolean; // default true
}
// Returns: SharedValue<number>  (degrees, use with rotate transform)
```

**`useSectionReveal(triggerVisible: boolean)`**  
Entrance animation for sections entering the viewport. When `triggerVisible` flips to `true`, animates from `{ translateY: 20, opacity: 0 }` to `{ translateY: 0, opacity: 1 }` using `timings.moderate` + `easeOut`. Used in DiagnosticsScreen sections, SmartAIScreen mode grid.

```typescript
// Returns: { translateY: SharedValue<number>, opacity: SharedValue<number> }
// Compose into animatedStyle with useAnimatedStyle
```

**`useSpring(targetValue: number, config?)`**  
General-purpose spring that follows a target value. Pass a state-derived number (e.g. `isActive ? 1 : 0`) and consume the returned shared value in `useAnimatedStyle`. Used for border opacity changes, button scale feedback, and tab indicator.

```typescript
interface SpringConfig {
  damping?: number;
  mass?: number;
  stiffness?: number;
}
// Returns: SharedValue<number>
```

**`useConnectTransition(connectionState: ConnectionState)`**  
Orchestrates the full multi-phase VPN connect animation. Watching `connectionState`, it drives a timeline: (1) ConnectButton press scale → (2) rings expand outward → (3) button transitions from idle style to connecting spinner → (4) on connected, rings pulse green and button settles. Implemented as a sequence of `withSequence` / `withDelay` worklet calls.

```typescript
// Returns: {
//   buttonScaleAV: SharedValue<number>,
//   ringProgressAV: SharedValue<number>,
//   glowOpacityAV: SharedValue<number>,
//   labelOpacityAV: SharedValue<number>,
// }
```

### GPU-Safe Animation Rules

Only animate `transform` and `opacity`. Never animate layout-triggering properties.

| Property | Safe | Why |
|---|---|---|
| `transform: [{ scale }]` | Yes | Compositor-only, no layout recalc |
| `transform: [{ translateX/Y }]` | Yes | Compositor-only |
| `transform: [{ rotate }]` | Yes | Compositor-only |
| `opacity` | Yes | Compositor-only |
| `width`, `height` | **No** | Triggers layout + render |
| `top`, `left`, `bottom`, `right` | **No** | Triggers layout |
| `margin`, `padding` | **No** | Triggers layout |
| `backgroundColor` (interpolated) | Caution | Only via `interpolateColor` in worklet |
| `borderWidth` | **No** | Triggers layout |

To achieve "grow/shrink" effects use `scale` transform on a fixed-size container. To achieve "fade in from below" use `translateY` + `opacity`, never `height`.

### Battery Optimization

```typescript
// In useAppState.ts — broadcast background flag to all animation hooks
const { isBackground, isLowPowerMode } = useAppState();

// Rules enforced in each animation hook:
// 1. Pause breathing + orbit + pulse rings when isBackground === true
// 2. When isLowPowerMode === true:
//    - Disable orbit ring (stop withRepeat)
//    - Disable breathing glow expansion (freeze opacity at 1.0)
//    - Limit concurrent animations: max 2 active loops at once
//    - Pulse rings: reduce to 1 ring instead of 3
// 3. On low-end Android (capability tier 'low' from useDeviceCapability):
//    - Disable all decorative animations
//    - Disable expo-blur (render opaque bg-glass color instead)
//    - Particle count in AIOrb: 0
```

---

## 7. Theme Architecture

### `src/theme/tokens.ts`

```typescript
export interface ColorTokens {
  emerald: {
    200: string;  // #8BFFC9
    400: string;  // #00E87A — primary accent
    500: string;  // #00C966 — pressed state
    700: string;  // #007A3D
    900: string;  // #002E16
  };
  bg: {
    void:     string;  // #030609
    base:     string;  // #070D18
    surface:  string;  // #0D1828
    elevated: string;  // #111F35
    glass:    string;  // rgba(13,24,40,0.82)
  };
  border: {
    subtle:  string;   // rgba(255,255,255,0.05)
    default: string;   // rgba(255,255,255,0.08)
    glow:    string;   // rgba(0,232,122,0.28)
    active:  string;   // rgba(0,232,122,0.55)
  };
  text: {
    primary:   string; // #F0F6FF
    secondary: string; // #8FA8C8
    muted:     string; // #3D5570
    inverse:   string; // #030609
  };
  semantic: {
    blue:   string;    // #3399FF
    amber:  string;    // #FFB800
    red:    string;    // #FF4444
    purple: string;    // #9B77FF — stealth mode only
  };
}

export interface SpacingTokens {
  xs:   number;  // 4
  sm:   number;  // 8
  md:   number;  // 16
  lg:   number;  // 24
  xl:   number;  // 32
  '2xl': number; // 48
  '3xl': number; // 64
}

export interface TypographyTokens {
  fontFamily: {
    sans: string;  // 'Inter'
    mono: string;  // 'JetBrains Mono'
  };
  size: {
    xs:   number;  // 10
    sm:   number;  // 12
    base: number;  // 14
    md:   number;  // 16
    lg:   number;  // 20
    xl:   number;  // 24
    '2xl': number; // 32
    '3xl': number; // 48
    hero:  number; // 64
  };
  weight: {
    light:    '300';
    regular:  '400';
    medium:   '500';
    semibold: '600';
    bold:     '700';
  };
  letterSpacing: {
    tight:  number;  // -0.5
    normal: number;  // 0
    wide:   number;  // 0.5
    wider:  number;  // 1.0
    caps:   number;  // 1.5  (for uppercase labels)
  };
}

export interface MotionTokens {
  duration: typeof timings;  // re-exports timings.ts values
  reduceMotion: boolean;     // read from AccessibilityInfo.isReduceMotionEnabled
}

export interface ShadowTokens {
  // React Native shadow style objects
  card: {
    shadowColor: string;
    shadowOffset: { width: number; height: number };
    shadowOpacity: number;
    shadowRadius: number;
    elevation: number;       // Android only
  };
  emerald: {
    shadowColor: string;
    shadowOffset: { width: number; height: number };
    shadowOpacity: number;
    shadowRadius: number;
    elevation: number;
  };
  emeraldSm: {
    shadowColor: string;
    shadowOffset: { width: number; height: number };
    shadowOpacity: number;
    shadowRadius: number;
    elevation: number;
  };
}

export interface Tokens {
  colors:     ColorTokens;
  spacing:    SpacingTokens;
  typography: TypographyTokens;
  motion:     MotionTokens;
  shadows:    ShadowTokens;
  radius: {
    sm:   number;  // 8
    md:   number;  // 12
    lg:   number;  // 16
    xl:   number;  // 20
    '2xl': number; // 24
    '3xl': number; // 32
    full: number;  // 9999
  };
}

export const tokens: Tokens = { /* values inlined */ };
```

---

## 8. Screen–Component Dependency Map

| Component | Splash | Auth | Home | SmartAI | Servers | Diagnostics | Profile | Settings |
|---|:---:|:---:|:---:|:---:|:---:|:---:|:---:|:---:|
| **GlassCard** | | | ● | ● | ● | ● | ● | ● |
| **AIOrb** | | | ● (sm) | ● | | | | |
| **ConnectButton** | | | ● | | | | | |
| **StatusPill** | | | ● | ● | ● | ● | | |
| **MetricRow** | | | ● | | | ● | | |
| **ServerCard / ServerRow** | | | ● (1) | ● (1) | ● | | | |
| **BottomNav** | | | ● | ● | ● | ● | ● | |
| **AnimatedRing** | ● | | ● | ● | | | | |
| **GlowButton** | | ● | | | | | ● | ● |
| **DiagnosticsChart** | | | | | | ● | | |
| **StatusDot** | | | ● | ● | ● | ● | | |
| **ProtocolChain** | | | ● | ● | ● | | | |
| **AIBadge** | | | ● | ● | | | | |
| **Toggle** | | | | | | | ● | ● |
| **ModeGrid** | | | | ● | | | | |
| **NetworkQualityCard** | | | ● | | | ● | | |

---

## 9. State Architecture

### Store Map

#### `vpnStore` — Connection State

```typescript
interface VpnState {
  connectionState: ConnectionState;           // 'idle' | 'connecting' | 'connected' | 'disconnecting' | 'error'
  activeServer: Server | null;
  activeProtocol: Protocol | null;
  sessionStart: number | null;               // timestamp ms
  sessionBytes: { up: number; down: number };
  error: string | null;

  // Actions
  connect: (server: Server, protocol: Protocol) => Promise<void>;
  disconnect: () => Promise<void>;
  setConnectionState: (state: ConnectionState) => void;
  updateSessionBytes: (up: number, down: number) => void;
  clearError: () => void;
}
```

#### `serverStore` — Server List & Selection

```typescript
interface ServerState {
  servers: Server[];
  selectedServerId: string | null;
  pingCache: Record<string, number>;        // serverId → latency ms
  lastFetched: number | null;
  filter: ServerFilter;                     // region, protocol, load threshold

  // Actions
  setServers: (servers: Server[]) => void;
  selectServer: (id: string) => void;
  updatePing: (serverId: string, latency: number) => void;
  setFilter: (filter: Partial<ServerFilter>) => void;
}
```

#### `aiStore` — AI Routing Layer

```typescript
interface AIState {
  activeMode: AIMode;                        // 'smart' | 'speed' | 'stealth' | 'streaming' | 'bypass' | 'shield'
  isThinking: boolean;
  decisionLog: AIDecision[];                // last 20 routing decisions
  protocolChain: Protocol[];                // current active protocol stack
  lastDecisionAt: number | null;

  // Actions
  setMode: (mode: AIMode) => void;
  setThinking: (thinking: boolean) => void;
  appendDecision: (decision: AIDecision) => void;
  setProtocolChain: (chain: Protocol[]) => void;
}
```

#### `authStore` — Authentication

```typescript
interface AuthState {
  user: User | null;
  token: string | null;
  subscription: Subscription | null;
  isHydrated: boolean;                      // MMKV has been read on startup

  // Actions
  setUser: (user: User) => void;
  setToken: (token: string) => void;
  clearAuth: () => void;
  setSubscription: (sub: Subscription) => void;
}
```

#### `diagnosticsStore` — Metrics & Health

```typescript
interface DiagnosticsState {
  metrics: {
    latency:    number[];                   // circular buffer, last 60 values
    jitter:     number[];
    packetLoss: number[];
  };
  healthChecks: HealthCheck[];
  hops: HopResult[];
  isPolling: boolean;
  lastUpdated: number | null;

  // Actions
  appendMetric: (metric: 'latency' | 'jitter' | 'packetLoss', value: number) => void;
  setHealthChecks: (checks: HealthCheck[]) => void;
  setHops: (hops: HopResult[]) => void;
  setPolling: (polling: boolean) => void;
}
```

#### `settingsStore` — User Preferences

```typescript
interface SettingsState {
  autoConnect: boolean;
  killSwitch: boolean;
  splitTunneling: boolean;
  splitTunnelingApps: string[];             // package names
  notificationsEnabled: boolean;
  language: string;                         // ISO 639-1 code
  reducedAnimations: boolean;               // user override (separate from OS setting)

  // Actions
  toggle: (key: keyof BooleanSettings) => void;
  setSplitTunnelingApps: (apps: string[]) => void;
  setLanguage: (lang: string) => void;
}
```

### Store Persistence Pattern

Each store that needs persistence uses Zustand's `persist` middleware with an MMKV storage adapter:

```typescript
import { mmkv } from '@/services/storage/mmkv';

const mmkvStorage = {
  getItem: (key: string) => mmkv.getString(key) ?? null,
  setItem: (key: string, value: string) => mmkv.set(key, value),
  removeItem: (key: string) => mmkv.delete(key),
};

// Only persist fields that should survive app restart:
// authStore: token, user.id
// settingsStore: all fields
// serverStore: selectedServerId, pingCache (TTL: 5 min)
// vpnStore: NO persistence — start fresh on every launch
```

---

## 10. VPN Integration Layer

### XrayBridge (Native Module Wrapper)

`XrayBridge` is the only file in the codebase that directly imports `NativeModules`. All other services call through this wrapper.

```typescript
// src/services/vpn/XrayBridge.ts

interface XrayStats {
  upBytes:     number;
  downBytes:   number;
  latencyMs:   number;
  jitterMs:    number;
  packetLoss:  number;   // 0.0 – 1.0
  uptime:      number;   // seconds
}

interface XrayBridgeInterface {
  startXray: (config: string) => Promise<{ success: boolean; pid?: number; error?: string }>;
  stopXray:  () => Promise<{ success: boolean }>;
  getStats:  () => Promise<XrayStats>;
  isRunning: () => Promise<boolean>;
}

// Native module reference — wrapped so the rest of the app never imports NativeModules directly
const NativeXray = NativeModules.XrayBridge as XrayBridgeInterface;
export const XrayBridge: XrayBridgeInterface = NativeXray;
```

### ConnectionManager (State Machine)

States: `idle → connecting → connected → disconnecting → idle`  
Error transitions: any state → `error`  
`error → idle` via `clearError()`

```
┌──────┐  connect()   ┌──────────┐  xray started  ┌───────────┐
│ idle │ ───────────► │connecting│ ──────────────► │ connected │
└──────┘              └──────────┘                 └───────────┘
   ▲                       │                             │
   │                       │ failure                 disconnect()
   │                  ┌────▼────┐                        │
   │    clearError()  │  error  │                        ▼
   └──────────────────┴─────────┘          ┌──────────────────────┐
                                           │    disconnecting      │
                                           └──────────────────────┘
                                                       │ xray stopped
                                                       ▼
                                                    ┌──────┐
                                                    │ idle │
                                                    └──────┘
```

`ConnectionManager.connect()` sequence:
1. Dispatch `setConnectionState('connecting')` to `vpnStore`
2. Call `ProtocolManager.selectProtocol(server)` to get the best protocol
3. Call `VpnConfig.build(server, protocol)` to generate Xray JSON config string
4. Call `XrayBridge.startXray(configString)`
5. On success → `setConnectionState('connected')`, start `DiagnosticsEngine.startPolling()`
6. On failure → `setConnectionState('error')`, log to `aiStore` decision log

### ProtocolManager

Selects the optimal Xray protocol based on:
- Network type (WiFi / cellular / low-bandwidth)
- Server capability flags from `server.protocols[]`
- Current AI mode from `aiStore.activeMode`
- Last 5 connection success rates from `aiStore.decisionLog`

```typescript
type Protocol = 'VLESS-Reality' | 'VLESS-WS' | 'XHTTP' | 'HTTPUpgrade';

interface ProtocolManager {
  selectProtocol: (server: Server, networkInfo: NetworkInfo) => Protocol;
  buildFallbackChain: (server: Server) => Protocol[];
}
```

Priority matrix (default, Smart mode):

| Network | Primary | Fallback 1 | Fallback 2 |
|---|---|---|---|
| WiFi, strong signal | VLESS-Reality | XHTTP | VLESS-WS |
| Cellular 4G+ | VLESS-Reality | HTTPUpgrade | VLESS-WS |
| Cellular 3G / weak | HTTPUpgrade | VLESS-WS | XHTTP |
| WiFi, captive portal | VLESS-WS | HTTPUpgrade | — |

Stealth mode always uses VLESS-Reality. Speed mode uses the server's lowest-latency protocol regardless of obfuscation.

### DiagnosticsEngine

Polls `XrayBridge.getStats()` every 1000ms while `connectionState === 'connected'`. On each tick:
1. Appends new latency/jitter/packetLoss to the circular buffer in `diagnosticsStore`
2. Evaluates health thresholds (latency > 200ms = warn, > 500ms = error)
3. Triggers `AIRouteSelector.evaluate()` every 30 ticks to potentially recommend a protocol switch

### AIRouteSelector

```typescript
interface AIRouteSelectorInterface {
  evaluate: (conditions: NetworkConditions) => RoutingDecision | null;
  // Returns null if current config is still optimal
  // Returns RoutingDecision if switch is recommended

  forcedMode: (mode: AIMode) => RoutingDecision;
  // For user-initiated mode changes
}

interface RoutingDecision {
  recommendedServer:   Server | null;   // null = keep current
  recommendedProtocol: Protocol;
  confidence:          number;          // 0.0 – 1.0
  reason:              string;          // human-readable for decision log
  timestamp:           number;
}
```

---

## 11. Performance Strategy

### React.memo Boundaries

Apply `React.memo` to components that:
- Receive stable props (primitive or memoized references)
- Appear inside a `FlatList` (every list item **must** be memoized)
- Are expensive to render (SVG charts, blurred glass cards)

Do NOT memo:
- Components that always rerender with parent (screen-level components)
- Atoms with 1-2 props where memo overhead exceeds savings

```typescript
// Correct — ServerRow is inside FlatList, memoize with explicit comparator
export const ServerRow = React.memo(ServerRowComponent, (prev, next) =>
  prev.server.id === next.server.id &&
  prev.isActive === next.isActive &&
  prev.ping === next.ping
);
```

### useMemo / useCallback Rules

**useMemo:** Use when the computation is non-trivial (sorting server list by ping, building chart SVG path string) and when the result is passed to a memoized child.

**useCallback:** Use for every handler passed as a prop to `React.memo` children. Never create inline arrow functions in JSX for memoized components.

**Rule of thumb:** If you write `onPress={() => fn(arg)}` inside a render that passes to a memoized component, wrap it with `useCallback`.

### FlatList Optimization for Server List

```typescript
<FlatList
  data={servers}
  keyExtractor={(item) => item.id}
  renderItem={({ item }) => <ServerRow server={item} />}
  getItemLayout={(_, index) => ({
    length: SERVER_ROW_HEIGHT,    // 68 — fixed height, declared as const
    offset: SERVER_ROW_HEIGHT * index,
    index,
  })}
  removeClippedSubviews={true}   // Unmount off-screen items on Android
  maxToRenderPerBatch={12}
  windowSize={5}                 // Render 2.5 screens worth of items
  initialNumToRender={10}
/>
```

### Reanimated — No JS Thread Animation Policy

All animations **must** run in `worklets`. The following patterns are forbidden:

```typescript
// FORBIDDEN — runs on JS thread, causes dropped frames
Animated.timing(value, { toValue: 1, useNativeDriver: false }).start();

// FORBIDDEN — JS-thread setState inside animation callback
someSharedValue.value = withTiming(1, {}, () => {
  setState(something); // runOnJS is ok, but minimize it
});

// CORRECT — pure worklet
someSharedValue.value = withSpring(targetValue, timings.spring);
```

`runOnJS` is permitted only for: dispatching Zustand actions at animation completion (e.g., update connectionState after transition finishes).

### Low-End Android Optimizations

`useDeviceCapability` classifies devices as `'high'`, `'mid'`, or `'low'` based on total RAM and CPU core count. When `capability === 'low'`:

1. Replace `expo-blur` with a solid `bg-glass` color — no `backdropFilter`
2. Disable `usePulseRings` (return empty array, render 0 rings)
3. Freeze `useBreathing` (return static scale=1.0, opacity=1.0)
4. Disable `useOrbit` (return static rotation=0)
5. Limit concurrent `withRepeat` loops app-wide to 2 maximum
6. Disable `DiagnosticsChart` SVG path animation (render static snapshot)
7. Reduce `FlatList.maxToRenderPerBatch` from 12 to 6

These changes are invisible at the UI level — the same components render, just without motion.

---

## 12. Implementation Order

Build in this order. Each phase depends on the previous.

1. **Project bootstrap** — `npx react-native init SetaLink`, install all packages from stack table, configure Metro path aliases, configure ESLint + Prettier + TypeScript strict mode.

2. **Native module stub** — Create `android/app/src/main/java/.../XrayBridgeModule.java` and `ios/XrayBridge.m` as no-op stubs returning hardcoded mock data. This lets UI development proceed without a working Xray binary.

3. **Theme tokens** — Write `src/theme/tokens.ts` completely. Every color, spacing, radius, shadow, and typography value. This is the foundation every component depends on.

4. **Animation hooks** — Write all 6 hooks in `src/animations/`. They have no dependencies other than Reanimated and `timings.ts`. Write unit-testable worklet functions before the hooks.

5. **Atom components** — Build all 8 atoms. They depend only on `tokens.ts`. Each atom should have a Storybook story (or inline test screen).

6. **Navigation shell** — Write `RootNavigator` and `MainTabsNavigator` with placeholder screen components. Verify transitions work and TypeScript route types are complete.

7. **Zustand stores** — Write all 6 stores with MMKV persistence adapter. Write stores before services — services will dispatch to stores, not the reverse.

8. **Service layer** — Write `XrayBridge.ts`, `ConnectionManager.ts`, `ProtocolManager.ts`, `VpnConfig.ts`. Wire `ConnectionManager` to `vpnStore`. Wire `DiagnosticsEngine` to `diagnosticsStore`.

9. **Molecule components** — Build all 8 molecules, consuming atoms and tokens.

10. **Organism components** — Build all 8 organisms. `ConnectButton` and `AIOrb` are the most complex — build them last within this phase.

11. **API service layer** — Write `src/services/api/client.ts` and all `*.api.ts` files. Wire React Query hooks to the API functions.

12. **Screens — Auth and Splash** — First two screens. Validate navigation transitions and auth flow end-to-end with mock API.

13. **Screen — Home** — The most complex screen. Requires `ConnectButton`, `AIOrb`, `vpnStore`, `serverStore`, `aiStore` all wired. Build against the native stub.

14. **Screen — Servers** — `FlatList` with live ping polling. Validate `getItemLayout` performance with 100+ servers.

15. **Screen — Smart AI** — Mode grid, decision log display, `aiStore` integration.

16. **Screen — Diagnostics** — `DiagnosticsEngine` polling, chart rendering, log export.

17. **Screen — Profile and Settings** — Subscription display, settings toggles, logout flow.

18. **AI routing layer** — Write `AIRouteSelector`, `conditions.ts`, `protocols.ts`, `fallbackChain.ts`. Integration test: simulate degraded network, verify protocol switch recommendation.

19. **Real Xray binary integration** — Replace native module stubs with real Xray-core. Android: add `.so` files to `jniLibs/`, configure `CMakeLists.txt`. iOS: add framework to Xcode target.

20. **Performance pass** — Profile with Flipper / Android Profiler. Apply `React.memo` boundaries identified by render count. Verify no JS-thread animations. Test on a mid-range Android device (Snapdragon 665 class).

21. **Low-end device pass** — Test on a device reporting `capability === 'low'`. Verify all animation fallbacks activate correctly and the UI remains usable.

22. **Release build** — Configure Proguard rules for Xray native module, code signing, app icon, and splash screen assets.
