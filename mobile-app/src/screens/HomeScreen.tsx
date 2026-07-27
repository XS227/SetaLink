import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Animated, ScrollView, StyleSheet, Text, TouchableOpacity, View,
} from 'react-native';
import ReanimatedView, {
  useAnimatedStyle, useSharedValue, withRepeat, withTiming, Easing as REasing,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Colors, Radius, Spacing, Typography } from '../design/tokens';
import { GoldBeatBurst }   from '../components/GoldBeatBurst';
import { RealCoin }        from '../components/RealCoin';
import { EmberField }      from '../components/EmberField';
import { StarlinkBanner }  from '../components/StarlinkBanner';
import { BottomNav, NavTab } from '../components/BottomNav';
import { EcosystemBanner } from '../components/EcosystemBanner';
import { HomeBanner }      from '../components/HomeBanner';

import { useVpnStore }         from '../stores/vpnStore';
import { useAuthStore }        from '../stores/authStore';
import { useServerStore }      from '../stores/serverStore';
import { useIdentityStore }    from '../stores/identityStore';
import { useDMStore }          from '../stores/dmStore';
import { useInboxStore }       from '../stores/inboxStore';
import { useZarStore }         from '../stores/zarStore';
import { useSessionTimer }     from '../hooks/useSessionTimer';
import { useSessionLifecycle } from '../hooks/useSessionLifecycle';
import { useGreeting }         from '../hooks/useGreeting';
import { useVpnStats }         from '../hooks/useVpnStats';
import { useT }                from '../i18n';
import { initAds, preloadInterstitial, gateActionWithAd, notifyVpnDisconnected } from '../services/adsService';
import { initZarSync, recordZarTap } from '../services/zarSyncService';
import { getProfileSummary } from '../services/realGramProfileService';

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

// Small colored dots orbiting the coin, purely decorative (theme pkg's
// `.orbit-dot` × 3 in 01-home.html) — ambient motion, not a data display.
const ORBIT_DOTS = [
  { duration: 9000,  radius: 78, color: Colors.gold[100] },
  { duration: 13000, radius: 78, color: Colors.violet[400], reverse: true },
  { duration: 16000, radius: 78, color: Colors.gold[400] },
];

function OrbitDot({ duration, radius, color, reverse }: { duration: number; radius: number; color: string; reverse?: boolean }) {
  const t = useSharedValue(0);
  useEffect(() => {
    t.value = withRepeat(withTiming(1, { duration, easing: REasing.linear }), -1, false);
  }, [t, duration]);
  const style = useAnimatedStyle(() => {
    const a = (reverse ? -1 : 1) * t.value * Math.PI * 2;
    return { transform: [{ translateX: Math.cos(a) * radius }, { translateY: Math.sin(a) * radius }] };
  });
  return <ReanimatedView.View style={[{ position: 'absolute', width: 6, height: 6, borderRadius: 3, backgroundColor: color }, style]} />;
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
  const avatarEmoji  = useIdentityStore((s) => s.avatarEmoji);
  const avatarColor  = useIdentityStore((s) => s.avatarColor);
  const servers      = useServerStore((s) => s.servers);

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

  // Real zar/hr from owned+upgraded heroes (2026-07-27, B->A(105)) — same
  // number the Game tab's Shahnameh profile shows, can't drift from it.
  // Best-effort, silent: falls back to the tap-derived estimate below if
  // this hasn't loaded yet or the call fails (e.g. no linked account yet).
  const [zarPerHourFromCards, setZarPerHourFromCards] = useState<number | null>(null);
  useEffect(() => {
    if (!deviceIdForZar) return;
    let cancelled = false;
    getProfileSummary(deviceIdForZar)
      .then((p) => { if (!cancelled) setZarPerHourFromCards(p.economy.zar_per_hour_from_cards); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [deviceIdForZar]);

  const unreadOfficial = useInboxStore((s) => s.messages.filter((m) => !m.read).length);
  const unreadDm       = useDMStore((s) => s.messages.filter((m) => m.direction === 'in' && !m.read).length);
  const unreadTotal    = unreadOfficial + unreadDm;

  const isConnected     = connectionState === 'connected';
  const isTransitioning = connectionState === 'connecting' || connectionState === 'disconnecting';
  const isBusy          = isTransitioning;

  const timer = useSessionTimer(isConnected, sessionStartedAt);
  const { pingMs, downloadMbps } = useVpnStats();

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
  }, [isBusy, isConnected, user, userShowsAds, connect, disconnect, onNavigate]);

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

  const handleCoinForge = useCallback(() => {
    if (!isConnected) return;
    const result = useZarStore.getState().tap();
    recordZarTap();
    if (result.earned > 0) spawnFloat(result.earned);
  }, [isConnected, spawnFloat]);

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
        <Animated.View style={[styles.header, fadeStyle]}>
          <Text style={styles.greeting} numberOfLines={1}>{t(greeting)}</Text>
          <View style={styles.headerRight}>
            <TouchableOpacity
              style={styles.headerBtn}
              onPress={() => onNavigate('inbox' as NavTab)}
              hitSlop={10}
            >
              <Text style={styles.headerBtnIcon}>✉</Text>
              {unreadTotal > 0 && (
                <View style={styles.badge}>
                  <Text style={styles.badgeText}>{unreadTotal > 9 ? '9+' : String(unreadTotal)}</Text>
                </View>
              )}
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.avatarChip, { borderColor: avatarColor, backgroundColor: avatarColor + '22' }]}
              onPress={() => onNavigate('profile' as NavTab)}
              hitSlop={10}
            >
              <Text style={styles.avatarEmoji}>{avatarEmoji}</Text>
            </TouchableOpacity>
          </View>
        </Animated.View>

        {/* ── Balance pills — real zarStore data, not fabricated. Zar/hr
             prefers the server's real hero-income rate (economy.
             zar_per_hour_from_cards) once loaded — same number the Game
             tab shows, can't drift from it. Falls back to the older
             tap-derived estimate (earnedToday / hours elapsed today,
             connection-gated) until that first loads or if it never does. ── */}
        <Animated.View style={[styles.pillRow, fadeStyle]}>
          <View style={styles.pill}>
            <Text style={styles.pillLabel}>{t('home.balance')}</Text>
            <View style={styles.pillValueRow}>
              <View style={styles.pillDot} />
              <Text style={styles.pillValue}>{formatZar(zarBalance)}</Text>
            </View>
          </View>
          <View style={styles.pill}>
            <Text style={styles.pillLabel}>{t('home.zarPerHour')}</Text>
            <Text style={[styles.pillValue, { color: Colors.status.connected }]}>
              +{formatZar(zarPerHourFromCards ?? (isConnected ? Math.round(zarEarnedToday / hoursElapsedToday()) : 0))}
            </Text>
          </View>
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
          </View>

          {/* GoldBeatBurst celebrates connect transition */}
          <GoldBeatBurst burstKey={goldBurst} />
        </Animated.View>

        {/* ── Metrics row ── */}
        <Animated.View style={[styles.metricsRow, fadeStyle]}>
          <View style={styles.metricCard}>
            <Text style={styles.metricValue}>{isConnected ? (pingMs || activeServer?.ping || '—') : (activeServer?.ping ?? '—')}</Text>
            <Text style={styles.metricUnit}>ms</Text>
            <Text style={styles.metricLabel}>{t('home.ping')}</Text>
          </View>
          <View style={[styles.metricCard, styles.metricCardCenter]}>
            <Text style={styles.metricValue}>{isConnected ? downloadMbps.toFixed(0) : '—'}</Text>
            <Text style={styles.metricUnit}>Mbps</Text>
            <Text style={styles.metricLabel}>{t('home.speed')}</Text>
          </View>
          <View style={styles.metricCard}>
            <Text style={[styles.metricValue, isConnected && styles.metricValueActive]}>
              {isConnected ? '98' : '—'}
            </Text>
            <Text style={styles.metricUnit}>%</Text>
            <Text style={styles.metricLabel}>{t('home.stability')}</Text>
          </View>
        </Animated.View>

        {/* ── Shahnameh banner — Khabat, 2026-07-24: the old REAL/RealGram
             shortcut boxes both navigated to the same 'game' tab (verified
             while reading this code — functionally duplicate destinations),
             so replaced with one banner. Pinned (no rotation) and opens the
             game in-app via onOpenGame, same component PremiumScreen already
             uses unpinned for the rotating REAL/Shahnameh promo. ── */}
        <Animated.View style={fadeStyle}>
          <EcosystemBanner pin="shahnameh" onOpenGame={() => onNavigate('game')} />
        </Animated.View>

        {/* ── Ad banner — rotates AdMob banner ⇄ ecosystem promo (Khabat, 2026-07-18:
             re-added so AdMob can be verified from Home, not just the Freedom tab) ── */}
        <Animated.View style={fadeStyle}>
          <HomeBanner seed={0} showAds={userShowsAds} />
        </Animated.View>
      </ScrollView>

      <BottomNav active={activeTab} onPress={onNavigate} />
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
  header:         { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: Spacing[2] },
  greeting:       { flex: 1, fontSize: Typography.size.lg, fontFamily: Typography.family.heading, color: Colors.text.primary, letterSpacing: -0.2 },
  headerRight:    { flexDirection: 'row', alignItems: 'center', gap: Spacing[2] },
  headerBtn:      { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  headerBtnIcon:  { fontSize: 17, color: Colors.text.secondary },
  badge:          { position: 'absolute', top: 2, right: 2, minWidth: 14, height: 14, borderRadius: 7, backgroundColor: '#FF6B6B', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 2 },
  badgeText:      { color: '#fff', fontSize: 8, fontFamily: Typography.family.heading },
  avatarChip:     { width: 36, height: 36, borderRadius: 18, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center' },
  avatarEmoji:    { fontSize: 16 },

  // Balance pills
  pillRow:      { flexDirection: 'row', gap: Spacing[2] },
  pill:         { flex: 1, backgroundColor: Colors.bg.surface, borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.border.default, paddingHorizontal: Spacing[3], paddingVertical: Spacing[2] },
  pillLabel:    { fontSize: 9, fontFamily: Typography.family.label, color: Colors.text.muted, letterSpacing: 1, textTransform: 'uppercase' },
  pillValueRow: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 2 },
  pillDot:      { width: 8, height: 8, borderRadius: 4, backgroundColor: Colors.gold[400] },
  pillValue:    { fontSize: 15, fontFamily: Typography.family.mono, fontWeight: '700', color: Colors.text.primary, marginTop: 2 },

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
  // Coin section — replaces the old inline connectRow/powerBtn.
  coinSection:  { alignItems: 'center', paddingVertical: Spacing[5], gap: Spacing[3] },
  anvilTitle:   { fontSize: 11, fontFamily: Typography.family.label, color: Colors.text.muted, letterSpacing: 2, textTransform: 'uppercase' },
  anvilHint:    { fontSize: 10.5, fontFamily: Typography.family.body, color: Colors.text.muted, opacity: 0.75, marginTop: -4 },
  coinStage:    { width: 200, height: 200, alignItems: 'center', justifyContent: 'center' },
  floatNum:     { position: 'absolute', top: '38%', fontSize: 15, fontFamily: Typography.family.mono, fontWeight: '700', color: Colors.gold[100] },
  connectStatus:{ flexDirection: 'row', alignItems: 'center', gap: 6 },
  statusDot:    { width: 7, height: 7, borderRadius: 4 },
  statusText:   { fontSize: 14, fontFamily: Typography.family.heading, color: Colors.text.primary },
  errorHint:    { fontSize: 11, color: Colors.red[400], fontFamily: Typography.family.body },

  // Metrics
  metricsRow:   { flexDirection: 'row', gap: Spacing[3] },
  metricCard:   { flex: 1, backgroundColor: Colors.bg.surface, borderRadius: Radius.lg, padding: Spacing[3], alignItems: 'center', borderWidth: 1, borderColor: Colors.border.subtle, gap: 1 },
  metricCardCenter: { borderColor: Colors.border.default },
  metricValue:      { fontSize: 22, fontFamily: Typography.family.heading, color: Colors.text.primary, letterSpacing: -0.5 },
  metricValueActive:{ color: Colors.status.connected },
  metricUnit:   { fontSize: 10, color: Colors.text.muted, fontFamily: Typography.family.mono, marginTop: -2 },
  metricLabel:  { fontSize: 10, fontFamily: Typography.family.label, color: Colors.text.muted, letterSpacing: 0.8, textTransform: 'uppercase', marginTop: 2 },
});
