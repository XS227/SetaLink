import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Animated, ScrollView, StyleSheet, Text, TouchableOpacity, View,
} from 'react-native';
import ReanimatedView, {
  useAnimatedStyle, useSharedValue, withRepeat, withTiming, Easing as REasing,
} from 'react-native-reanimated';
import { useIsFocused } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Colors, Radius, Spacing, Typography } from '../design/tokens';
import { GoldBeatBurst }   from '../components/GoldBeatBurst';
import { RealCoin }        from '../components/RealCoin';
import { EmberField }      from '../components/EmberField';
import { StarlinkBanner }  from '../components/StarlinkBanner';
import { BottomNav, NavTab } from '../components/BottomNav';
import { ShahnamehHakimBanner } from '../components/ShahnamehHakimBanner';
import { HomeBanner }      from '../components/HomeBanner';
import { TopBar }          from '../components/TopBar';
import { EnergyBar }       from '../components/EnergyBar';
import { EnergyUpgradeModal } from '../components/EnergyUpgradeModal';
import { getEnergyTier }   from '../services/entitlementService';
import { MiniLuckWheel }   from '../components/MiniLuckWheel';
import { useTapEnergy }    from '../hooks/useTapEnergy';

import { useVpnStore }         from '../stores/vpnStore';
import { useAuthStore }        from '../stores/authStore';
import { useServerStore }      from '../stores/serverStore';
import { useZarStore }         from '../stores/zarStore';
import { useProfilePicStore }  from '../stores/profilePicStore';
import { useSessionTimer }     from '../hooks/useSessionTimer';
import { useSessionLifecycle } from '../hooks/useSessionLifecycle';
import { useGreeting }         from '../hooks/useGreeting';
import { useVpnStats }         from '../hooks/useVpnStats';
import { useT }                from '../i18n';
import { initAds, preloadInterstitial, gateActionWithAd, notifyVpnDisconnected } from '../services/adsService';
import { initZarSync, recordZarTap } from '../services/zarSyncService';
import { recordTap } from '../services/tapAnalytics';
import { getRealWallet } from '../services/realWalletService';
import { getProfileSummary } from '../services/realGramProfileService';
import { syncEntitlement } from '../services/entitlementService';

const STARLINK_INVITE_TARGET = 11;

function formatZar(n: number): string {
  return n >= 1000 ? `${(n / 1000).toFixed(1)}K` : String(n);
}

/** Hours elapsed since UTC midnight (matches zarStore's dayKey convention) —
 * floored at a few minutes so a fresh day doesn't divide by ~0. */
function hoursElapsedToday(): number {
  const now = new Date();
  const startOfDay = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return Math.max(1 / 12, (now.getTime() - startOfDay) / 3_600_000);
}

// Small colored dots orbiting the coin — the ﷼ coin reads as the sun,
// these as planets (+ one moon) going around it. Khabat, 2026-07-29: "det
// er bare 3 punkter som går rundt i 2D... tenk at den sølve ﷼ blir til
// sola og alle planetene skal gå i bane rundt sola i 3D." Real device
// motion is unverified (no simulator here), but the technique is the
// standard flat-2D-fakes-3D trick: squash the orbit into an ellipse
// (`tilt`) and tie scale/opacity/z-order to how far along the depth axis
// (sin of the orbit angle) each body currently is — near the viewer =
// bigger/brighter/in front, far = smaller/dimmer/behind. No new
// dependency; still plain Reanimated transforms, same technique as
// before, not real 3D.
//
// 2026-07-30: expanded from 3 planets to 6 (+ the moon), radii spread
// further out and speeds staggered more (closer = faster), after Khabat
// shared a full Three.js reference build (real WebGL solar system, camera-
// facing sun sprite, 8 orbiting bodies) asking for that richer feel. Not
// porting the reference wholesale — that's a WebGL/Three.js rewrite this
// app has zero dependency on today, can't be verified without a device or
// simulator (neither exists on this box), and would mean rebuilding the
// already-hardened tap-to-forge/hold-3s-to-disconnect gesture handling
// (RealCoin.tsx's own history is a long list of real touch-responder bugs
// fixed one at a time) on top of a WebView/GL bridge instead of RNGH's
// native gesture state machine. This keeps the same proven technique, just
// with more bodies — the actual ask ("planetene er fint om de dukker opp
// sånn") was about the *look*, not the render pipeline underneath it.
//
// Radii scaled ~0.78x on 2026-07-30 (test-120: "tap seksjonen er fortsatt
// for høy. det er mye luft mellom sirkelen og top og bunn") together with
// coinStage below — the outermost orbit's clearance requirement is what was
// forcing coinStage to 256, so shrinking both in lockstep is what actually
// tightens the visible gap around the coin, not just trimming padding
// around an unchanged stage.
const ORBIT_DOTS: OrbitBodyProps[] = [
  { duration: 6000,  radius: 58,  tilt: 0.4, size: 5, color: Colors.silver[300], phase: 0.3 },
  { duration: 9000,  radius: 66,  tilt: 0.4, size: 7, color: Colors.gold[100],   phase: 3.6 },
  { duration: 12000, radius: 73,  tilt: 0.4, size: 6, color: Colors.violet[400], reverse: true, phase: 1.4 },
  { duration: 16000, radius: 81,  tilt: 0.4, size: 6, color: Colors.ember[400],  phase: 5.0 },
  { duration: 20000, radius: 88,  tilt: 0.4, size: 8, color: Colors.gold[400],   reverse: true, phase: 2.5 },
  { duration: 25000, radius: 94,  tilt: 0.4, size: 6, color: Colors.violet[600], phase: 4.4 },
  // The moon: tighter orbit than the coin's own radius (66) so it visibly
  // swings in front of / behind the coin each pass — the "moon too" ask.
  { duration: 4200,  radius: 36, tilt: 0.55, size: 4, color: Colors.silver[100], reverse: true, phase: 1.0, isMoon: true },
];

interface OrbitBodyProps {
  duration: number;
  radius: number;
  /** Vertical squash of the orbit circle into an ellipse — the "viewed at
   *  an angle" cue that reads as a tilted 3D ring instead of a flat 2D loop. */
  tilt: number;
  size: number;
  color: string;
  reverse?: boolean;
  /** Starting angle offset (radians) so bodies don't all launch aligned. */
  phase?: number;
  /** Moon orbits close enough to pass in front of the coin — needs real
   *  z-order switching, not just a dimmer/smaller far side, or it would
   *  just look like it's always sitting on top of or under the coin. */
  isMoon?: boolean;
}

function OrbitDot({ duration, radius, tilt, size, color, reverse, phase = 0, isMoon }: OrbitBodyProps) {
  const t = useSharedValue(0);
  useEffect(() => {
    t.value = withRepeat(withTiming(1, { duration, easing: REasing.linear }), -1, false);
  }, [t, duration]);
  const style = useAnimatedStyle(() => {
    const a = (reverse ? -1 : 1) * t.value * Math.PI * 2 + phase;
    const depth = Math.sin(a); // -1 (far side) .. 1 (near side)
    const scale = 0.55 + (depth + 1) / 2 * 0.7; // 0.55 far .. 1.25 near
    return {
      transform: [
        { translateX: Math.cos(a) * radius },
        { translateY: depth * radius * tilt },
        { scale },
      ],
      opacity: 0.35 + (depth + 1) / 2 * 0.65,
      zIndex: isMoon ? (depth > 0 ? 20 : -1) : Math.round(depth * 10),
    };
  });
  return (
    <ReanimatedView.View
      style={[
        { position: 'absolute', width: size, height: size, borderRadius: size / 2, backgroundColor: color },
        style,
      ]}
    />
  );
}

// Khabat, 2026-07-30 (test-120): "la det blinke lekent" — the Daily Luck
// header icon points at DailyLuckWheelScreen (live spin+grant since
// 2026-08-01, see that screen's own header). Kept the gentle opacity pulse
// as a "there's something fun here" nudge now that there's a real prize
// behind it, not just as an unfinished-feature signal.
function BlinkingLuckIcon() {
  const pulse = useSharedValue(0);
  useEffect(() => {
    pulse.value = withRepeat(
      withTiming(1, { duration: 900, easing: REasing.inOut(REasing.ease) }),
      -1,
      true,
    );
  }, [pulse]);
  const style = useAnimatedStyle(() => ({ opacity: 0.45 + pulse.value * 0.55 }));
  return (
    <ReanimatedView.View style={style}>
      <MiniLuckWheel size={20} />
    </ReanimatedView.View>
  );
}

interface Props {
  onNavigate: (tab: NavTab) => void;
  activeTab:  NavTab;
}

export function HomeScreen({ onNavigate, activeTab }: Props) {
  const { t } = useT();
  const insets = useSafeAreaInsets();
  const { greeting } = useGreeting();

  const {
    connectionState, selectedServer, sessionStartedAt,
    connect, disconnect, error,
  } = useVpnStore();

  const user         = useAuthStore((s) => s.user);
  const updateFromEntitlement = useAuthStore((s) => s.updateFromEntitlement);
  const servers      = useServerStore((s) => s.servers);
  const isFocused    = useIsFocused();

  // Real tap-to-earn ZAR (zarStore + zarSyncService — contract §8, shipped
  // 2026-07-19) was already fully built and wired into GameScreen, but
  // never into the Home coin it was actually designed for (recordZarTap's
  // own source param is literally 'game_hub' already). initZarSync is
  // idempotent (resets its interval, doesn't double-fire) so calling it
  // here alongside GameScreen's own call is safe.
  const zarBalance    = useZarStore((s) => s.balance);
  const zarEarnedToday = useZarStore((s) => s.earnedToday);
  const deviceIdForZar = user?.deviceId ?? '';
  useEffect(() => {
    if (deviceIdForZar) initZarSync(deviceIdForZar);
  }, [deviceIdForZar]);

  // Khabat, 2026-07-29: "saldo på forsiden viser null." Real bug, not a
  // display glitch — zarSyncService's reconcileFromServer() only ever
  // fires as the RESPONSE to a tap-sync flush, and that flush is gated
  // on pendingTaps > 0 (zarSyncService.ts ~L65). A user who opens Home
  // without tapping the coin first never triggers a flush, so the
  // locally-persisted balance (0 for a fresh store — new device, new
  // install, or a device_id that changed, see
  // [[realgram-device-recognition-mystery]]) is shown as-is, forever,
  // regardless of the real server balance. Pull the real balance once on
  // mount instead of waiting for a tap — reuses RealWalletCard's own
  // already-live real-wallet endpoint (wallet.zar), no new backend call.
  useEffect(() => {
    if (!deviceIdForZar) return;
    getRealWallet(deviceIdForZar)
      .then((w) => { if (typeof w.zar === 'number') useZarStore.getState().reconcileFromServer(w.zar); })
      .catch(() => {});
  }, [deviceIdForZar]);

  // Real zar/hr from owned+upgraded heroes (2026-07-27, B->A(105)) — same
  // number the Game tab's Shahnameh profile shows, can't drift from it.
  // Best-effort, silent: falls back to the tap-derived estimate below if
  // this hasn't loaded yet or the call fails (e.g. no linked account yet).
  // Also the one place Home picks up the real profile photo (profilePicStore)
  // for its header avatar chip below.
  const [zarPerHourFromCards, setZarPerHourFromCards] = useState<number | null>(null);
  const loadProfileExtras = useCallback((deviceId: string) => {
    return getProfileSummary(deviceId)
      .then((p) => {
        setZarPerHourFromCards(p.economy.zar_per_hour_from_cards);
        useProfilePicStore.getState().setUrl(p.identity?.profile_pic ?? '');
      })
      .catch(() => {});
  }, []);
  useEffect(() => {
    if (!deviceIdForZar) return;
    loadProfileExtras(deviceIdForZar);
  }, [deviceIdForZar, loadProfileExtras]);

  // Khabat, 2026-07-27: quota/balance shown on Home went stale after a
  // REAL->GB or ZAR->REAL conversion made on the Wallet tab — this screen
  // only ever synced entitlement/profile data once, on first mount, and
  // React Navigation keeps tab screens mounted between switches (same class
  // of bug RealGramProfileScreen's own B->A(111) refocus fix addressed for
  // its own numbers). Re-sync silently every time Home refocuses instead.
  // Skips the very first focus (the mount effects above already cover it)
  // so this never races the initial load.
  const homeMountedRef = useRef(false);
  useEffect(() => {
    if (!homeMountedRef.current) { homeMountedRef.current = true; return; }
    if (!isFocused || !deviceIdForZar) return;
    syncEntitlement(deviceIdForZar).then(updateFromEntitlement).catch(() => {});
    loadProfileExtras(deviceIdForZar);
  }, [isFocused, deviceIdForZar, updateFromEntitlement, loadProfileExtras]);

  const isConnected     = connectionState === 'connected';
  const isTransitioning = connectionState === 'connecting' || connectionState === 'disconnecting';
  const isBusy          = isTransitioning;

  const timer = useSessionTimer(isConnected, sessionStartedAt);
  const { pingMs, downloadMbps } = useVpnStats();

  // Khabat, 2026-07-30: "hastighet viser null forresten den må fikses" —
  // downloadMbps is a real per-3s-poll delta (useVpnStats.ts), so it
  // legitimately reads 0 whenever no traffic moved in that window (idle
  // connection, or the very first poll after connect) — accurate, but
  // reads as broken to a user glancing at a tap-game stat. Hold the last
  // real non-zero reading through idle gaps instead of flashing to 0;
  // still real measured throughput, never a fabricated number, and it
  // resets the moment the tunnel actually drops.
  const lastMbpsRef = useRef(0);
  useEffect(() => {
    if (!isConnected) { lastMbpsRef.current = 0; return; }
    if (downloadMbps > 0) lastMbpsRef.current = downloadMbps;
  }, [downloadMbps, isConnected]);
  const displayMBs = isConnected ? (downloadMbps > 0 ? downloadMbps : lastMbpsRef.current) : 0;
  // Khabat, 2026-07-31: "på forsiden står det fortsatt 0Mbps" — the 07-30
  // idle-hold fix above only covered the "no traffic this poll window" case.
  // Two compounding bugs left this chip stuck at 0 for any real connection
  // under standard speeds: (1) useVpnStats' `downloadMbps` field is actually
  // MB/s (bytes/1e6, see that file's own note — DiagnosticsScreen labels
  // the same number "MB/s"), silently shown here under a "Mbps" label with
  // no unit conversion — an 8x understatement before rounding even starts;
  // (2) `.toFixed(0)` then rounds anything under 1 (i.e. under 8 real Mbps,
  // the common case on a VPN/proxy tunnel) straight to "0". Converting to
  // true Mbps (*8) and keeping one decimal below 10 fixes both — this is
  // the only place that needs actual Mbps, so converting locally here
  // rather than changing the shared hook's unit and breaking Diagnostics'
  // MB/s-calibrated pct bars.
  const displayMbps = displayMBs * 8;

  // "Stability" used to be the literal hardcoded string '98' whenever
  // connected — not bound to anything real. Derives it from the same ping
  // reading the ping chip already shows instead (lower ping = higher
  // stability), so it's at least a real function of a real measurement
  // rather than a fixed prop.
  const effectivePing = pingMs || selectedServer?.ping || 0;
  const stabilityPct = isConnected
    ? (effectivePing > 0 ? Math.max(55, Math.min(99, Math.round(100 - effectivePing / 3))) : 97)
    : null;

  useSessionLifecycle();

  const [goldBurst, setGoldBurst] = useState(0);
  const wasConnectedRef = useRef(false);
  useEffect(() => {
    if (isConnected && !wasConnectedRef.current) setGoldBurst((k) => k + 1);
    wasConnectedRef.current = isConnected;
  }, [isConnected]);

  // Ad gates are FAIL-CLOSED: ads only when the plan is known to be 'free', OR
  // the backend has explicitly flagged this device testMode (devices.test_mode)
  // — a per-device ad QA override for a premium tester, never inferred, always
  // server-controlled. An unloaded or stale-synced user must never show a
  // premium account an ad. The quota-exhausted connect-block below is
  // deliberately left plan-only — a testMode tester has real premium quota
  // and must not be blocked from connecting.
  const userShowsAds = user?.plan === 'free' || !!user?.testMode;

  // Ad preload — only while the tunnel is already up. A preload kicked off
  // before Connect has nothing to load through in markets where Google is
  // blocked on the direct network (Iran); it just hangs/fails and, worse, used
  // to occupy the "loading" slot so the real post-connect load below couldn't
  // start. The connect transition below fires its own fresh load, so nothing
  // is lost by skipping this while disconnected.
  useEffect(() => {
    if (!userShowsAds || !isConnected) return;
    initAds().then(preloadInterstitial).catch(() => {});
  }, [userShowsAds, isConnected]);

  // Ad showing itself now happens entirely at the Connect/Disconnect tap
  // (handlePower below, via gateActionWithAd) — this effect only resets
  // in-flight ad-load state when the tunnel drops, so a load kicked off for
  // one connect attempt can't linger and get shown later, out of context,
  // by an unrelated trigger (the exact bug being fixed here).
  const wasConnectedForAdsRef = useRef(false);
  useEffect(() => {
    if (!isConnected && wasConnectedForAdsRef.current) {
      notifyVpnDisconnected();
    }
    wasConnectedForAdsRef.current = isConnected;
  }, [isConnected]);

  // Guards against a double-tap re-triggering a second ad gate while one is
  // still waiting on a load or on the user dismissing the ad — the button
  // stays in its "connected"/"disconnected" state throughout that brief
  // window (the actual connect()/disconnect() call is deliberately deferred
  // until the gate resolves), so isBusy alone wouldn't catch a rapid second
  // tap here.
  const adGateBusyRef = useRef(false);

  // Khabat, 2026-07-24: rapid repeat-tapping the power button while connected
  // was toggling the tunnel off almost immediately (single tap = instant
  // disconnect, no confirmation). RealCoin's own 3s hold gesture (see
  // handleCoinHold below) already enforces this — handlePower itself has no
  // separate tap path, only ever fires from a completed hold.
  const handlePower = useCallback(() => {
    if (isBusy || adGateBusyRef.current) return;
    if (isConnected) {
      // Tap-stream analytics (Khabat, 2026-07-29: "tap-telemetri ikke
      // komplett, kun coin-tap") — connect/disconnect was the one other
      // obviously-central tap missing from B-24's stream. Recorded with
      // the server/protocol still active at the moment of the tap (before
      // disconnect() tears it down), same connection-quality-correlation
      // intent the schema was built for.
      recordTap('game_hub', 'disconnect', selectedServer?.protocol, selectedServer?.id);
      if (userShowsAds) {
        // Khabat, 2026-07-21: show the ad FIRST, then actually disconnect —
        // previously this tore the tunnel down immediately and showed an ad
        // after, best-effort.
        adGateBusyRef.current = true;
        gateActionWithAd(() => { adGateBusyRef.current = false; disconnect(); });
      } else {
        disconnect();
      }
      return;
    }
    if (user && user.plan === 'free' && user.quotaBytesUsed >= user.quotaBytesTotal) {
      (onNavigate as (t: string) => void)('upgrade');
      return;
    }
    // No protocol/node yet — connection hasn't been established at tap
    // time, matches tapAnalytics.ts's own documented "only set when
    // VPN-connected at tap time" rule.
    recordTap('game_hub', 'connect');
    // Tunnel bring-up starts immediately, same as before (must never be
    // delayed by an ad network call — some markets block AdMob outright).
    // The ad is gated separately, in parallel, so it appears right away
    // instead of however long the old fire-and-forget load happened to take
    // — by the time the user dismisses it, the tunnel is very likely already
    // up and ready to browse.
    connect();
    if (userShowsAds) {
      adGateBusyRef.current = true;
      gateActionWithAd(() => { adGateBusyRef.current = false; });
    }
  }, [isBusy, isConnected, user, userShowsAds, connect, disconnect, onNavigate, selectedServer]);

  // Starlink referral progress (invite left/pct now computed inside
  // StarlinkBanner itself from these two raw values).
  const inviteCount  = user?.inviteCount ?? 0;
  const starlinkNode = servers.find((s) => s.nodeType === 'STARLINK');
  const hasStarlink  = inviteCount >= STARLINK_INVITE_TARGET || !!starlinkNode;

  // Active server info
  const activeServer = selectedServer;
  const isStarlinkActive = isConnected && activeServer?.nodeType === 'STARLINK';

  // Status-dot / status-text color — kept as the theme pkg's dedicated
  // "connected status" green (Colors.status.connected), distinct from the
  // coin's own gold/silver fill below (see tokens.ts §Colors.green comment).
  const powerColor = isBusy ? '#E8B84B' : isConnected ? Colors.status.connected : Colors.status.disconnected;

  // Real tap-to-earn, replacing the Phase-0 placeholder wiring (which sent
  // both tap and hold to handlePower, since zarStore wasn't hooked up to
  // this screen yet). Tap = forge real Zar (zarStore.tap(), server-synced
  // via zarSyncService) — gated on isConnected, matching the store's own
  // documented rule ("while the VPN is connected, each tap ... earns
  // ZAR"). Hold-3s stays exactly handlePower, now on its own callback
  // instead of sharing one with tap.
  const floatAnim = useRef(new Animated.Value(0)).current;
  const [floatText, setFloatText] = useState('');
  const spawnFloat = useCallback((gain: number) => {
    setFloatText(`+${gain}`);
    floatAnim.setValue(0);
    Animated.timing(floatAnim, { toValue: 1, duration: 900, useNativeDriver: true }).start();
  }, [floatAnim]);

  // Power/stamina — Khabat, 2026-07-30: RealGram was missing the Shahnameh
  // tap screen's stamina/cooldown mechanic entirely. Tap now spends energy;
  // out of energy = no reward until it regenerates (see useTapEnergy).
  // 2026-07-31: pool size is now a paid-upgrade tier (server-persisted,
  // entitlementService.ts's getEnergyTier/upgradeEnergyTier) instead of a
  // fixed constant — fetch the owned tier once on mount and feed its pool
  // size into the hook; a fresh device with no row yet defaults to tier 0
  // (1000) server-side, so 1000 here is just the pre-fetch placeholder, not
  // a second source of truth.
  const [energyMax, setEnergyMax] = useState(1000);
  const [showEnergyUpgrade, setShowEnergyUpgrade] = useState(false);
  useEffect(() => {
    if (!user?.deviceId) return;
    getEnergyTier(user.deviceId).then((res) => {
      setEnergyMax(res.tiers[res.tier]?.pool ?? 1000);
    }).catch(() => {});
  }, [user?.deviceId]);
  const tapEnergy = useTapEnergy(energyMax);

  const handleCoinForge = useCallback(() => {
    if (!isConnected) return;
    if (!tapEnergy.spend()) return;
    const result = useZarStore.getState().tap();
    recordZarTap();
    if (result.earned > 0) spawnFloat(result.earned);
  }, [isConnected, spawnFloat, tapEnergy]);

  const handleCoinHold = useCallback(() => { handlePower(); }, [handlePower]);

  const contentAnim = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(contentAnim, { toValue: 1, duration: 380, useNativeDriver: true }).start();
  }, []);
  const fadeStyle = { opacity: contentAnim };

  return (
    <View style={[styles.screen, { paddingTop: insets.top }]}>
      {isConnected && <View style={styles.ambientGlow} pointerEvents="none" />}
      <EmberField />

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[styles.content, { paddingBottom: 80 + insets.bottom }]}
        showsVerticalScrollIndicator={false}
      >
        {/* ── Header ── */}
        {/* Khabat, 2026-07-30: "burger meny funker kun på freedom siden" —
            Home kept its own pre-(199) avatar (direct navigate-to-profile,
            no menu) instead of getting the shared TopBar burger menu every
            other main screen already has. Same swap ServersScreen/
            WalletScreen/etc. already did; inbox is reachable from the menu
            now too, so the standalone envelope+badge (badge count was
            already known-stale, see TopBar.tsx's own header comment) is
            gone rather than kept alongside a second entry point.

            Khabat, 2026-07-30 (test-120): "på toppen så går velkommen tekst
            inn på profil bolde på persiske versjonen" — the greeting Text
            had `flex: 1` directly on it with no wrapping View; RN's Yoga
            gives a flexed Text node `flexBasis: auto` (content-based), not
            `0`, so it's sized by its own text content *before* being
            clamped to the row's remaining space, and only then does
            `numberOfLines` truncate — on a long RTL (Farsi) string measured
            against a differently-shaped avatar chip that can be enough
            slack for the truncation to land a beat late and visibly run
            into the avatar for one frame/measurement. Wrapping it in a
            plain View with `flex: 1, minWidth: 0` forces the row to compute
            available space first (`minWidth: 0` overrides Yoga's implicit
            min-content-size floor, the same fix this exact class of bug
            needs on web flexbox) — the Text inside just fills it and
            truncates, can't push past it regardless of script/string
            length. Unverified on a real Farsi device (no simulator here),
            but this is the correct general fix for the failure mode, not a
            guess at a magic number.

            Also added: TV + Daily Luck icon buttons, reusing the header's
            own now-fixed layout slack ("der er mye luft som kan for
            eksempel lykkejul ikonet stå") instead of the full-card entries
            elsewhere. Both route through onNavigate (same 'livetv'/
            'dailyluck' cases added to AppNavigator's makeOnNavigate this
            session) rather than new props, matching how every other
            TopBar-adjacent screen already wires secondary destinations. */}
        <Animated.View style={[styles.header, fadeStyle]}>
          <View style={styles.greetingWrap}>
            <Text style={styles.greeting} numberOfLines={1}>{t(greeting)}</Text>
          </View>
          <View style={styles.headerIcons}>
            <TouchableOpacity
              onPress={() => (onNavigate as (t: string) => void)('livetv')}
              style={styles.headerIconBtn}
              activeOpacity={0.75}
              accessibilityLabel={t('rghome.liveTv')}
            >
              <Text style={styles.headerIconGlyph}>📺</Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => (onNavigate as (t: string) => void)('dailyluck')}
              style={styles.headerIconBtn}
              activeOpacity={0.75}
              accessibilityLabel={t('dailyluck.title')}
            >
              <BlinkingLuckIcon />
            </TouchableOpacity>
          </View>
          <TopBar onNavigate={onNavigate as (tab: string) => void} />
        </Animated.View>

        {/* ── Starlink hero — theme pkg's 01-home.html §hero (stars +
             orbiting satellite + cyan wordmark), same tap target as the
             plain banner it replaces (whole card -> Freedom tab, where the
             real invite/connect flow lives via Freedom's own vip-variant
             StarlinkBanner). ── */}
        <Animated.View style={fadeStyle}>
          <TouchableOpacity onPress={() => onNavigate('servers')} activeOpacity={0.9}>
            <StarlinkBanner
              variant="hero"
              unlocked={hasStarlink}
              inviteCount={inviteCount}
              inviteTarget={STARLINK_INVITE_TARGET}
              onInvite={() => onNavigate('servers')}
            />
          </TouchableOpacity>
        </Animated.View>

        {/* ── VPN status card ── */}
        <Animated.View style={[styles.vpnCard, isConnected && styles.vpnCardActive, fadeStyle]}>
          {/* Server row */}
          <TouchableOpacity
            style={styles.serverRow}
            onPress={() => onNavigate('servers')}
            activeOpacity={0.75}
          >
            <Text style={styles.serverFlag}>{activeServer?.flag ?? '🌐'}</Text>
            <View style={styles.serverInfo}>
              <Text style={styles.serverName} numberOfLines={1}>
                {activeServer ? activeServer.country : t('home.selectServer')}
              </Text>
              <Text style={styles.serverCity} numberOfLines={1}>
                {activeServer
                  ? (isStarlinkActive ? '🛰 Starlink exit' : activeServer.city)
                  : t('home.tapToChoose')}
              </Text>
            </View>
            {activeServer && (
              <View style={styles.pingBadge}>
                <View style={[styles.pingDot, isConnected && styles.pingDotActive]} />
                <Text style={styles.pingText}>{pingMs || activeServer.ping || '—'}ms</Text>
              </View>
            )}
            <Text style={styles.chevron}>›</Text>
          </TouchableOpacity>

          {/* Khabat, 2026-07-31: "balance og zar/hr fra toppen kan flyttes
              inn på app area seksjin ... der den viser hvilket node man er
              koblet til, den trenger ikke å være såå lang" — the two big
              square pills that used to sit above this whole card (real
              zarStore data, same source as before, just relocated) are now
              a compact chip pair right under the connected-node row
              instead, matching the ping/speed/stability chip row's own
              compact style further down this same card. */}
          <View style={styles.walletChipRow}>
            <View style={styles.walletChip}>
              <View style={styles.pillDot} />
              <Text style={styles.walletChipValue}>{formatZar(zarBalance)}</Text>
            </View>
            <View style={styles.walletChip}>
              <Text style={[styles.walletChipValue, { color: Colors.status.connected }]}>
                +{formatZar(zarPerHourFromCards ?? (isConnected ? Math.round(zarEarnedToday / hoursElapsedToday()) : 0))}/hr
              </Text>
            </View>
          </View>

          {/* Divider */}
          <View style={styles.vpnDivider} />

          {/* Coin — RealCoin replaces the old plain power button (theme
              pkg, A->B(74)). Tap now forges real Zar (zarStore, gated on
              isConnected); hold-3s toggles the connection — see
              handleCoinForge/handleCoinHold above. */}
          <View style={styles.coinSection}>
            <Text style={styles.anvilTitle}>◦ {t('home.anvilTitle')}</Text>
            <View style={styles.coinStage}>
              {ORBIT_DOTS.map((d, i) => <OrbitDot key={i} {...d} />)}
              <RealCoin
                connected={isConnected}
                size={132}
                disabled={isBusy}
                onForge={handleCoinForge}
                onToggleConnection={handleCoinHold}
              />
              {!!floatText && (
                <Animated.Text
                  style={[
                    styles.floatNum,
                    {
                      opacity: floatAnim.interpolate({ inputRange: [0, 1], outputRange: [1, 0] }),
                      transform: [{ translateY: floatAnim.interpolate({ inputRange: [0, 1], outputRange: [0, -60] }) }],
                    },
                  ]}
                >
                  {floatText}
                </Animated.Text>
              )}
            </View>
            <Text style={styles.anvilHint}>{t('home.holdToDisconnect')}</Text>
            <View style={styles.connectStatus}>
              <View style={[styles.statusDot, { backgroundColor: powerColor }]} />
              <Text style={styles.statusText}>
                {isConnected
                  ? (timer || t('home.connected'))
                  : isBusy
                    ? t('home.connecting')
                    : t('home.disconnected')}
              </Text>
            </View>
            {error && !isConnected && !isBusy && (
              <Text style={styles.errorHint} numberOfLines={1}>{t('home.holdToRetry')}</Text>
            )}

            {/* Khabat, 2026-07-30: "de 3 boksene, ping og stability og
                hastighet kan stå som mindre ikoner inne på tap seksjonen" —
                folded the 3 separate bordered metric cards (a whole extra
                row below the VPN card) into one slim chip row inside the
                tap section itself. */}
            <View style={styles.metricChipRow}>
              <View style={styles.metricChip}>
                <Text style={styles.metricChipIcon}>📶</Text>
                <Text style={styles.metricChipValue}>{effectivePing > 0 ? `${effectivePing}ms` : '—'}</Text>
              </View>
              <View style={styles.metricChip}>
                <Text style={styles.metricChipIcon}>⚡</Text>
                <Text style={styles.metricChipValue}>{isConnected ? `${displayMbps.toFixed(displayMbps < 10 ? 1 : 0)}Mbps` : '—'}</Text>
              </View>
              <View style={styles.metricChip}>
                <Text style={styles.metricChipIcon}>◈</Text>
                <Text style={styles.metricChipValue}>{stabilityPct != null ? `${stabilityPct}%` : '—'}</Text>
              </View>
            </View>

            <EnergyBar
              energy={tapEnergy.energy}
              maxEnergy={tapEnergy.maxEnergy}
              pct={tapEnergy.pct}
              onPress={() => setShowEnergyUpgrade(true)}
            />
            {/* A→B(295), Khabat: "1k stamina går fort men jeg får ikke 1k
                zar" — ZAR is flat per tap while stamina cost scales with
                the owned tier; nothing in the UI ever said so. */}
            <Text style={styles.tapRateHint}>{t('home.tapRateHint')}</Text>
          </View>

          {/* GoldBeatBurst celebrates connect transition */}
          <GoldBeatBurst burstKey={goldBurst} />
        </Animated.View>

        {/* ── Shahnameh banner — Khabat, 2026-07-30: replaced the plain
             EcosystemBanner promo card with Hakim (Shahnameh's guide
             character) inviting the user in, speech-bubble style with
             cycling warm/motivating lines. EcosystemBanner itself is
             untouched — still used elsewhere (PremiumScreen's rotating
             promo). ── */}
        <Animated.View style={fadeStyle}>
          <ShahnamehHakimBanner onOpenGame={() => onNavigate('game')} />
        </Animated.View>

        {/* ── Ad banner — rotates AdMob banner ⇄ ecosystem promo (Khabat, 2026-07-18:
             re-added so AdMob can be verified from Home, not just the Freedom tab) ── */}
        <Animated.View style={fadeStyle}>
          <HomeBanner seed={0} showAds={userShowsAds} />
        </Animated.View>
      </ScrollView>

      <BottomNav active={activeTab} onPress={onNavigate} />

      <EnergyUpgradeModal
        visible={showEnergyUpgrade}
        deviceId={user?.deviceId ?? ''}
        onClose={() => setShowEnergyUpgrade(false)}
        onUpgraded={(_tier, newPool) => setEnergyMax(newPool)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen:         { flex: 1, backgroundColor: Colors.bg.void },
  ambientGlow:    {
    position: 'absolute', top: 0, left: 0, right: 0, height: 300,
    backgroundColor: Colors.gold[900], opacity: 0.1,
  },
  scroll:         { flex: 1 },
  content:        { paddingHorizontal: Spacing[5], paddingTop: Spacing[3], gap: Spacing[4] },

  // Header
  header:         { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing[2], paddingVertical: Spacing[2] },
  // minWidth: 0 is load-bearing, not decorative — see the RTL-overlap
  // comment at the header's JSX above.
  greetingWrap:   { flex: 1, minWidth: 0 },
  greeting:       { fontSize: Typography.size.lg, fontFamily: Typography.family.heading, color: Colors.text.primary, letterSpacing: -0.2 },
  headerIcons:    { flexDirection: 'row', alignItems: 'center', gap: Spacing[2] },
  headerIconBtn:  { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center', backgroundColor: Colors.bg.surface, borderWidth: 1, borderColor: Colors.border.default },
  headerIconGlyph:{ fontSize: 15 },

  // Balance pills
  pillDot:      { width: 6, height: 6, borderRadius: 3, backgroundColor: Colors.gold[400] },
  walletChipRow:   { flexDirection: 'row', gap: Spacing[2], marginTop: Spacing[2] },
  walletChip:      { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: Colors.bg.elevated, borderRadius: Radius.full, paddingHorizontal: Spacing[3], paddingVertical: 5 },
  walletChipValue: { fontSize: 11, fontFamily: Typography.family.mono, fontWeight: '700', color: Colors.text.primary },

  // VPN card
  vpnCard: {
    backgroundColor: Colors.bg.surface,
    borderRadius: Radius.xl,
    borderWidth: 1,
    borderColor: Colors.border.default,
    overflow: 'hidden',
  },
  vpnCardActive: { borderColor: Colors.border.goldGlow },
  serverRow:    { flexDirection: 'row', alignItems: 'center', gap: Spacing[3], padding: Spacing[4] },
  serverFlag:   { fontSize: 26 },
  serverInfo:   { flex: 1, gap: 2 },
  serverName:   { fontSize: 15, fontFamily: Typography.family.heading, color: Colors.text.primary },
  serverCity:   { fontSize: 12, color: Colors.text.muted, fontFamily: Typography.family.body },
  pingBadge:    { flexDirection: 'row', alignItems: 'center', gap: 4 },
  pingDot:      { width: 6, height: 6, borderRadius: 3, backgroundColor: Colors.text.muted },
  pingDotActive:{ backgroundColor: Colors.status.connected },
  pingText:     { fontSize: 11, color: Colors.text.secondary, fontFamily: Typography.family.mono },
  chevron:      { fontSize: 20, color: Colors.text.muted },
  vpnDivider:   { height: 1, backgroundColor: Colors.border.subtle, marginHorizontal: Spacing[4] },
  // Coin section — replaces the old inline connectRow/powerBtn. Vertical
  // padding trimmed twice now (Khabat, 2026-07-30 first pass: "tap boksen
  // også er for stor i høyden"; test-120 follow-up: still "mye luft mellom
  // sirkelen og top og bunn") — this time the orbit stage itself
  // (coinStage) shrunk too, alongside ORBIT_DOTS's radii above, since the
  // stage's own size was the actual source of most of the remaining air.
  coinSection:  { alignItems: 'center', paddingVertical: Spacing[2], gap: Spacing[2] },
  anvilTitle:   { fontSize: 11, fontFamily: Typography.family.label, color: Colors.text.muted, letterSpacing: 2, textTransform: 'uppercase' },
  anvilHint:    { fontSize: 10.5, fontFamily: Typography.family.body, color: Colors.text.muted, opacity: 0.75, marginTop: -4 },
  // 200, not 256 — shrunk 2026-07-30 alongside ORBIT_DOTS's radii (test-120:
  // "mye luft mellom sirkelen og top og bunn"). Outermost orbit is now
  // radius 94 + half the dot size (3) = 97 clearance needed; 200/2=100
  // leaves a small buffer, same margin ratio the old 256/120 pair had. Not
  // verified against a narrow phone's actual available width (no device/
  // simulator here) — worth a real look on the smallest screen Khabat tests on.
  coinStage:    { width: 200, height: 200, alignItems: 'center', justifyContent: 'center' },
  floatNum:     { position: 'absolute', top: '38%', fontSize: 15, fontFamily: Typography.family.mono, fontWeight: '700', color: Colors.gold[100] },
  connectStatus:{ flexDirection: 'row', alignItems: 'center', gap: 6 },
  statusDot:    { width: 7, height: 7, borderRadius: 4 },
  statusText:   { fontSize: 14, fontFamily: Typography.family.heading, color: Colors.text.primary },
  errorHint:    { fontSize: 11, color: Colors.red[400], fontFamily: Typography.family.body },

  // Metrics — small chips inside the tap section (replaces the old 3
  // full-width bordered cards below the VPN card).
  metricChipRow:   { flexDirection: 'row', gap: Spacing[2], marginTop: Spacing[2] },
  metricChip:      { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: Colors.bg.elevated, borderRadius: Radius.full, paddingHorizontal: Spacing[3], paddingVertical: 5 },
  metricChipIcon:  { fontSize: 11 },
  metricChipValue: { fontSize: 11, fontFamily: Typography.family.mono, color: Colors.text.secondary },
  tapRateHint:     { fontSize: 10.5, fontFamily: Typography.family.body, color: Colors.text.muted,
                     textAlign: 'center', marginTop: Spacing[2], opacity: 0.85 },
});
