import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Animated, Image, ScrollView, StyleSheet, Text, TouchableOpacity, View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Colors, Radius, Spacing, Typography } from '../design/tokens';
import { GoldBeatBurst }   from '../components/GoldBeatBurst';
import { BottomNav, NavTab } from '../components/BottomNav';
import { REAL_TOKEN_IMAGE } from '../components/EcosystemBanner';

import { useVpnStore }         from '../stores/vpnStore';
import { useAuthStore }        from '../stores/authStore';
import { useServerStore }      from '../stores/serverStore';
import { useIdentityStore }    from '../stores/identityStore';
import { useDMStore }          from '../stores/dmStore';
import { useInboxStore }       from '../stores/inboxStore';
import { useSessionTimer }     from '../hooks/useSessionTimer';
import { useSessionLifecycle } from '../hooks/useSessionLifecycle';
import { useGreeting }         from '../hooks/useGreeting';
import { useVpnStats }         from '../hooks/useVpnStats';
import { useT }                from '../i18n';
import { initAds, preloadInterstitial, showInterstitialOnConnect, showInterstitialAfterConnect } from '../services/adsService';

import Svg, { Path } from 'react-native-svg';

const STARLINK_INVITE_TARGET = 11;

interface Props {
  onNavigate: (tab: NavTab) => void;
  activeTab:  NavTab;
}

function PowerIcon({ color }: { color: string }) {
  return (
    <Svg width={18} height={18} viewBox="0 0 24 24" fill="none">
      <Path d="M12 2v10" stroke={color} strokeWidth={2.5} strokeLinecap="round" />
      <Path d="M18.4 6.6a9 9 0 1 1-12.77.04" stroke={color} strokeWidth={2.5} strokeLinecap="round" />
    </Svg>
  );
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

  // Ad preload
  useEffect(() => {
    if (user?.plan !== 'free') return;
    initAds().then(preloadInterstitial).catch(() => {});
  }, [user?.plan]);

  const adShownAtTapRef       = useRef(false);
  const wasConnectedForAdsRef = useRef(false);
  useEffect(() => {
    if (isConnected && !wasConnectedForAdsRef.current) {
      if (user?.plan === 'free' && !adShownAtTapRef.current) showInterstitialAfterConnect();
      adShownAtTapRef.current = false;
    }
    wasConnectedForAdsRef.current = isConnected;
  }, [isConnected]);

  const handlePower = useCallback(() => {
    if (isBusy) return;
    if (isConnected) { disconnect(); return; }
    if (user && user.plan === 'free' && user.quotaBytesUsed >= user.quotaBytesTotal) {
      (onNavigate as (t: string) => void)('upgrade');
      return;
    }
    connect();
    adShownAtTapRef.current = user?.plan === 'free' ? showInterstitialOnConnect() : false;
  }, [isBusy, isConnected, user, connect, disconnect, onNavigate]);

  // Starlink referral progress
  const inviteCount  = user?.inviteCount ?? 0;
  const inviteLeft   = Math.max(0, STARLINK_INVITE_TARGET - inviteCount);
  const invitePct    = Math.min(1, inviteCount / STARLINK_INVITE_TARGET);
  const starlinkNode = servers.find((s) => s.nodeType === 'STARLINK');
  const hasStarlink  = inviteCount >= STARLINK_INVITE_TARGET || !!starlinkNode;

  // Active server info
  const activeServer = selectedServer;
  const isStarlinkActive = isConnected && activeServer?.nodeType === 'STARLINK';

  // Power button color
  const powerColor = isBusy
    ? '#E8B84B'
    : isConnected ? Colors.emerald[400] : '#FF6B6B';

  const contentAnim = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(contentAnim, { toValue: 1, duration: 380, useNativeDriver: true }).start();
  }, []);
  const fadeStyle = { opacity: contentAnim };

  return (
    <View style={[styles.screen, { paddingTop: insets.top }]}>
      {isConnected && <View style={styles.ambientGlow} pointerEvents="none" />}

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

        {/* ── Starlink banner ── */}
        <Animated.View style={fadeStyle}>
          <TouchableOpacity
            style={[styles.starlinkBanner, hasStarlink && styles.starlinkBannerActive]}
            onPress={() => onNavigate('servers')}
            activeOpacity={0.82}
          >
            <View style={styles.starlinkTop}>
              <View>
                <Text style={styles.starlinkLabel}>STARLINK</Text>
                <Text style={styles.starlinkTitle}>{hasStarlink ? t('home.starlinkUnlocked') : t('home.starlinkAccess')}</Text>
              </View>
              <View style={styles.starlinkCounter}>
                <Text style={styles.starlinkCountNum}>{inviteCount}</Text>
                <Text style={styles.starlinkCountSep}>/</Text>
                <Text style={styles.starlinkCountTarget}>{STARLINK_INVITE_TARGET}</Text>
              </View>
            </View>
            <View style={styles.progressTrack}>
              <View style={[styles.progressFill, { flex: invitePct }, hasStarlink && styles.progressFillDone]} />
              <View style={{ flex: Math.max(0, 1 - invitePct) }} />
            </View>
            {!hasStarlink && (
              <Text style={styles.starlinkHint}>
                {t('home.starlinkInviteHint').replace('{n}', String(inviteLeft))}
              </Text>
            )}
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

          {/* Connect row */}
          <View style={styles.connectRow}>
            <View style={styles.connectStatus}>
              <View style={[styles.statusDot, { backgroundColor: powerColor }]} />
              <Text style={styles.statusText}>
                {isConnected
                  ? (timer || t('home.connected'))
                  : isBusy
                    ? t('home.connecting')
                    : t('home.disconnected')}
              </Text>
              {error && !isConnected && !isBusy && (
                <Text style={styles.errorHint} numberOfLines={1}>{t('home.tapToRetry')}</Text>
              )}
            </View>

            <TouchableOpacity
              style={[styles.powerBtn, { borderColor: powerColor + '66' },
                      isConnected && { backgroundColor: powerColor + '18' }]}
              onPress={handlePower}
              disabled={isBusy}
              activeOpacity={0.75}
              accessibilityLabel={isConnected ? 'Disconnect VPN' : 'Connect VPN'}
            >
              <PowerIcon color={powerColor} />
            </TouchableOpacity>
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
            <Text style={[styles.metricValue, isConnected && { color: Colors.emerald[400] }]}>
              {isConnected ? '98' : '—'}
            </Text>
            <Text style={styles.metricUnit}>%</Text>
            <Text style={styles.metricLabel}>{t('home.stability')}</Text>
          </View>
        </Animated.View>

        {/* ── Shortcuts ── */}
        <Animated.View style={[styles.shortcutsRow, fadeStyle]}>
          <TouchableOpacity
            style={styles.shortcutRewards}
            onPress={() => onNavigate('game')}
            activeOpacity={0.82}
          >
            <Image source={{ uri: REAL_TOKEN_IMAGE }} style={styles.shortcutIcon} />
            <View style={styles.shortcutText}>
              <Text style={styles.shortcutTitle}>REAL</Text>
              <Text style={styles.shortcutSub}>{t('home.rewards')}</Text>
            </View>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.shortcutRealgram}
            onPress={() => onNavigate('game')}
            activeOpacity={0.82}
          >
            <Text style={styles.shortcutRealgramIcon}>💬</Text>
            <View style={styles.shortcutText}>
              <Text style={[styles.shortcutTitle, { color: Colors.emerald[400] }]}>RealGram</Text>
              <Text style={styles.shortcutSub}>{t('home.community')}</Text>
            </View>
          </TouchableOpacity>
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
    backgroundColor: Colors.emerald[900], opacity: 0.08,
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

  // Starlink banner
  starlinkBanner: {
    backgroundColor: Colors.bg.surface,
    borderRadius: Radius.xl,
    padding: Spacing[4],
    borderWidth: 1,
    borderColor: 'rgba(212,140,20,0.25)',
    gap: Spacing[2],
    overflow: 'hidden',
  },
  starlinkBannerActive: { borderColor: 'rgba(212,140,20,0.6)' },
  starlinkTop:    { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between' },
  starlinkLabel:  { fontSize: 10, fontFamily: Typography.family.heading, color: Colors.gold[600], letterSpacing: 2, textTransform: 'uppercase' },
  starlinkTitle:  { fontSize: 17, fontFamily: Typography.family.heading, color: Colors.gold[300], marginTop: 2 },
  starlinkCounter:{ flexDirection: 'row', alignItems: 'baseline', gap: 2 },
  starlinkCountNum: { fontSize: 28, fontFamily: Typography.family.heading, color: Colors.gold[300] },
  starlinkCountSep: { fontSize: 16, color: Colors.gold[600] },
  starlinkCountTarget: { fontSize: 16, color: Colors.gold[600] },
  progressTrack:  { height: 5, flexDirection: 'row', borderRadius: 3, overflow: 'hidden', backgroundColor: 'rgba(212,140,20,0.12)' },
  progressFill:   { backgroundColor: Colors.gold[500], borderRadius: 3 },
  progressFillDone: { backgroundColor: Colors.emerald[400] },
  starlinkHint:   { fontSize: 12, color: Colors.text.muted, fontFamily: Typography.family.body },

  // VPN card
  vpnCard: {
    backgroundColor: Colors.bg.surface,
    borderRadius: Radius.xl,
    borderWidth: 1,
    borderColor: Colors.border.default,
    overflow: 'hidden',
  },
  vpnCardActive: { borderColor: Colors.border.glow },
  serverRow:    { flexDirection: 'row', alignItems: 'center', gap: Spacing[3], padding: Spacing[4] },
  serverFlag:   { fontSize: 26 },
  serverInfo:   { flex: 1, gap: 2 },
  serverName:   { fontSize: 15, fontFamily: Typography.family.heading, color: Colors.text.primary },
  serverCity:   { fontSize: 12, color: Colors.text.muted, fontFamily: Typography.family.body },
  pingBadge:    { flexDirection: 'row', alignItems: 'center', gap: 4 },
  pingDot:      { width: 6, height: 6, borderRadius: 3, backgroundColor: Colors.text.muted },
  pingDotActive:{ backgroundColor: Colors.emerald[400] },
  pingText:     { fontSize: 11, color: Colors.text.secondary, fontFamily: Typography.family.mono },
  chevron:      { fontSize: 20, color: Colors.text.muted },
  vpnDivider:   { height: 1, backgroundColor: Colors.border.subtle, marginHorizontal: Spacing[4] },
  connectRow:   { flexDirection: 'row', alignItems: 'center', padding: Spacing[4], gap: Spacing[3] },
  connectStatus:{ flex: 1, gap: 2 },
  statusDot:    { width: 7, height: 7, borderRadius: 4, position: 'absolute', left: -14, top: 5 },
  statusText:   { fontSize: 14, fontFamily: Typography.family.heading, color: Colors.text.primary, paddingLeft: 0 },
  errorHint:    { fontSize: 11, color: '#FF6B6B', fontFamily: Typography.family.body },
  powerBtn:     { width: 44, height: 44, borderRadius: 22, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center' },

  // Metrics
  metricsRow:   { flexDirection: 'row', gap: Spacing[3] },
  metricCard:   { flex: 1, backgroundColor: Colors.bg.surface, borderRadius: Radius.lg, padding: Spacing[3], alignItems: 'center', borderWidth: 1, borderColor: Colors.border.subtle, gap: 1 },
  metricCardCenter: { borderColor: Colors.border.default },
  metricValue:  { fontSize: 22, fontFamily: Typography.family.heading, color: Colors.text.primary, letterSpacing: -0.5 },
  metricUnit:   { fontSize: 10, color: Colors.text.muted, fontFamily: Typography.family.mono, marginTop: -2 },
  metricLabel:  { fontSize: 10, fontFamily: Typography.family.label, color: Colors.text.muted, letterSpacing: 0.8, textTransform: 'uppercase', marginTop: 2 },

  // Shortcuts
  shortcutsRow: { flexDirection: 'row', gap: Spacing[3] },
  shortcutRewards: {
    flex: 1, flexDirection: 'row', alignItems: 'center', gap: Spacing[3],
    backgroundColor: 'rgba(212,175,55,0.08)',
    borderRadius: Radius.xl, padding: Spacing[4],
    borderWidth: 1, borderColor: 'rgba(212,175,55,0.2)',
  },
  shortcutRealgram: {
    flex: 1, flexDirection: 'row', alignItems: 'center', gap: Spacing[3],
    backgroundColor: 'rgba(0,232,122,0.06)',
    borderRadius: Radius.xl, padding: Spacing[4],
    borderWidth: 1, borderColor: 'rgba(0,232,122,0.18)',
  },
  shortcutIcon:        { width: 36, height: 36, borderRadius: 18 },
  shortcutRealgramIcon:{ fontSize: 28 },
  shortcutText:        { flex: 1, gap: 1 },
  shortcutTitle:       { fontSize: 13, fontFamily: Typography.family.heading, color: Colors.gold[300] },
  shortcutSub:         { fontSize: 11, color: Colors.text.muted, fontFamily: Typography.family.body },
});
