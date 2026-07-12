import React, { useRef, useEffect, useState } from 'react';
import {
  View, Text, TouchableOpacity, ScrollView,
  StyleSheet, Dimensions, Animated, Image, Linking,
} from 'react-native';
import { Colors, Typography, Spacing, Radius, Layout, Shadow } from '../design/tokens';
import { ConnectButton } from '../components/ConnectButton';
import { GoldBeatBurst } from '../components/GoldBeatBurst';
import { StatusBadge }   from '../components/StatusBadge';
import { TopBar }             from '../components/TopBar';
import { MetricPill }    from '../components/MetricPill';
import { CoverageIcon }  from '../components/CoverageIcon';
import { GlassCard }     from '../components/GlassCard';
import { BottomNav, NavTab } from '../components/BottomNav';
import { WatchAdCard } from '../components/WatchAdCard';

import { useVpnStore }         from '../stores/vpnStore';
import { useAuthStore }        from '../stores/authStore';
import { useAIStore }          from '../stores/aiStore';
import { useServerStore }      from '../stores/serverStore';
import { useSessionTimer }     from '../hooks/useSessionTimer';
import { useSessionLifecycle } from '../hooks/useSessionLifecycle';
import { useGreeting }         from '../hooks/useGreeting';
import { useVpnStats }         from '../hooks/useVpnStats';
import { formatBytes }         from '../utils/formatters';
import { computeHealthScore, dnsOkFromConnectionLog } from '../utils/healthScore';
import { getLastConnectProbeOk } from '../services/vpnBridge';
import { useT, trPhrase }     from '../i18n';
import { connectingPhaseLabel } from '../services/failureClassifier';
import { initAds, preloadInterstitial, showInterstitialOnConnect, showInterstitialAfterConnect } from '../services/adsService';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const LOGO_CONNECTED    = require('../assets/logo_connected.png') as number;
// eslint-disable-next-line @typescript-eslint/no-var-requires
const LOGO_DISCONNECTED = require('../assets/logo_disconnected.png') as number;
// eslint-disable-next-line @typescript-eslint/no-var-requires
const LOGO_MARK         = require('../assets/logo_mark.png') as number;

const { width } = Dimensions.get('window');

// StatusBadge status mapping
const STATUS_MAP = {
  idle:          'idle',
  connecting:    'connecting',
  connected:     'connected',
  disconnecting: 'connecting',
  failed:        'disconnected',
} as const;

// ConnectButton accepts only 4 states — map our 6 machine states down
const BUTTON_STATE_MAP: Record<string, 'idle' | 'connecting' | 'connected' | 'disconnecting'> = {
  idle:          'idle',
  connecting:    'connecting',
  connected:     'connected',
  disconnecting: 'disconnecting',
  failed:        'idle',
};

interface Props {
  onNavigate: (tab: NavTab) => void;
  activeTab:  NavTab;
}

function parseRemoteFromConfig(configJson: string): { address: string; port: number } | null {
  try {
    const cfg = JSON.parse(configJson) as { outbounds?: Array<{ settings?: { vnext?: Array<{ address?: string; port?: number }> } }> };
    const vnext = cfg.outbounds?.[0]?.settings?.vnext?.[0];
    if (vnext?.address) return { address: vnext.address, port: vnext.port ?? 443 };
  } catch {}
  return null;
}

export function HomeScreen({ onNavigate, activeTab }: Props) {
  const { t, isRTL } = useT();
  const {
    connectionState,
    selectedServer,
    sessionStartedAt,
    sessionBytes,
    error,
    smartStatus,
    reconnectAttempts,
    connectionLog,
    traceTestResult,
    traceTestRunning,
    connect,
    disconnect,
    runTraceTest,
  } = useVpnStore();

  const { greeting } = useGreeting();
  const user = useAuthStore((s) => s.user);
  const autoConnect = useAIStore((s) => s.autoConnect);
  const getImportedCreds = useServerStore((s) => s.getImportedCreds);
  const selectedId = useServerStore((s) => s.selectedId);
  const timer = useSessionTimer(connectionState === 'connected', sessionStartedAt);
  const { uploadMbps, downloadMbps, pingMs } = useVpnStats();

  useSessionLifecycle();

  const isConnected     = connectionState === 'connected';
  const isTransitioning = connectionState === 'connecting'
    || connectionState === 'disconnecting';

  // Gold heartbeat celebration: fire one coin burst on each transition INTO
  // connected (never on re-render while already connected).
  const [goldBurst, setGoldBurst] = useState(0);
  const wasConnectedRef = useRef(false);
  useEffect(() => {
    if (isConnected && !wasConnectedRef.current) setGoldBurst(k => k + 1);
    wasConnectedRef.current = isConnected;
  }, [isConnected]);

  // Composite coverage score (route + DNS + ping + traffic). Formerly rendered
  // as a full-width card in the body; now surfaced as the top-bar coverage icon.
  const healthScore = computeHealthScore({
    connected:    isConnected,
    probeOk:      isConnected && (traceTestResult?.ok ?? getLastConnectProbeOk()),
    dnsOk:        dnsOkFromConnectionLog(connectionLog),
    pingMs:       pingMs || selectedServer?.ping || 0,
    downloadMbps, uploadMbps,
  });

  // Friendly status message shown below connect button while connecting
  const connectingLabel = (() => {
    if (connectionState !== 'connecting') return null;
    if (smartStatus) return smartStatus;
    if (autoConnect.isRunning) {
      return connectingPhaseLabel(
        autoConnect.currentLabel,
        autoConnect.phase,
        autoConnect.result?.durationMs ? 1 : 0,
        autoConnect.currentIndex,
        autoConnect.profiles.length,
      );
    }
    return 'Establishing secure tunnel…';
  })();
  const localizedConnectingLabel = connectingLabel ? trPhrase(connectingLabel) : null;

  const headerOpacity    = useRef(new Animated.Value(0)).current;
  const contentTranslate = useRef(new Animated.Value(20)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(headerOpacity, {
        toValue: 1, duration: 500, useNativeDriver: true,
      }),
      Animated.spring(contentTranslate, {
        toValue: 0, damping: 20, stiffness: 200, useNativeDriver: true,
      }),
    ]).start();
  }, []);

  // Warm up an interstitial so it's ready by the first Connect tap (free users
  // only — premium is ad-free). Best-effort; failures are silent.
  useEffect(() => {
    if (user && user.plan !== 'free') return;
    initAds().then(preloadInterstitial).catch(() => {});
  }, [user?.plan]); // eslint-disable-line react-hooks/exhaustive-deps

  // Where Google is unreachable outside the tunnel (Iran), the tap-time ad is
  // never ready — show it once the tunnel is up instead, so the ad streams
  // through the tunnel instead of flashing blank.
  const adShownAtTapRef = useRef(false);
  const wasConnectedForAdsRef = useRef(false);
  useEffect(() => {
    if (isConnected && !wasConnectedForAdsRef.current) {
      if ((!user || user.plan === 'free') && !adShownAtTapRef.current) {
        showInterstitialAfterConnect();
      }
      adShownAtTapRef.current = false;
    }
    wasConnectedForAdsRef.current = isConnected;
  }, [isConnected]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleConnect = () => {
    if (connectionState === 'connected') { disconnect(); return; }
    if (connectionState === 'idle' || connectionState === 'failed') {
      // Block connect when free quota is exhausted
      if (user && user.plan === 'free' && user.quotaBytesUsed >= user.quotaBytesTotal) {
        (onNavigate as (tab: string) => void)('upgrade');
        return;
      }
      // Start connecting first so the ad can never delay or block the tunnel.
      connect();
      // Best-effort ad revenue on each new connection — free users only, and
      // only if an interstitial is already loaded (never blocks connect).
      adShownAtTapRef.current = (!user || user.plan === 'free')
        ? showInterstitialOnConnect()
        : false;
    }
  };

  const protocol = selectedServer
    ? `${selectedServer.protocol} · ${selectedServer.transport}`
    : 'VLESS · Reality';

  return (
    <View style={styles.screen}>
      {isConnected && <View style={styles.ambientGlow} pointerEvents="none" />}

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        {/* Header */}
        <Animated.View style={[styles.header, { opacity: headerOpacity }]}>
          <View style={styles.brandBlock}>
            <View style={styles.brandRow}>
              <Image source={isConnected ? LOGO_CONNECTED : LOGO_DISCONNECTED} style={styles.brandLogoSmall} resizeMode="contain" />
              <Text style={styles.brandName}>Realink</Text>
            </View>
            <Text style={styles.greeting}>{t(greeting)}</Text>
            {user && (user.userId || user.deviceId) && (
              <Text style={styles.userId} numberOfLines={1}>
                {user.userId || `SL-???-${user.deviceId.slice(-8).toUpperCase()}`}
              </Text>
            )}
          </View>
          <View style={styles.headerActions}>
            <CoverageIcon
              quality={healthScore}
              connected={isConnected}
              onPress={() => onNavigate('ai')}
            />
            <TopBar onNavigate={onNavigate as (tab: string) => void} />
          </View>
        </Animated.View>

        {/* Status row */}
        <Animated.View style={[
          styles.statusRow,
          { opacity: headerOpacity, transform: [{ translateY: contentTranslate }] },
        ]}>
          <StatusBadge status={STATUS_MAP[connectionState]} />
          {isConnected && (
            <View style={styles.protocolBadge}>
              <Text style={styles.protocolText}>{protocol}</Text>
            </View>
          )}
          {isConnected && autoConnect.winningConfig && (
            <View style={styles.stealthBadge}>
              <Text style={styles.stealthBadgeText}>{t('home.stealthActive')}</Text>
            </View>
          )}
        </Animated.View>

        {/* Connect button */}
        <Animated.View style={[
          styles.connectArea,
          { transform: [{ translateY: contentTranslate }] },
        ]}>
          <ConnectButton
            state={BUTTON_STATE_MAP[connectionState]}
            onPress={handleConnect}
            disabled={isTransitioning}
          />
          {isConnected && <Text style={styles.timer}>{timer}</Text>}
          {/* Heartbeat of the network — gold REAL coins pulse out on connect */}
          <GoldBeatBurst burstKey={goldBurst} />
        </Animated.View>

        {/* Smart status — friendly message while connecting */}
        {connectionState === 'connecting' && localizedConnectingLabel && (
          <Animated.View style={{ transform: [{ translateY: contentTranslate }] }}>
            <View style={styles.smartStatusRow}>
              <View style={styles.smartStatusDot} />
              <Text style={styles.smartStatusText}>{localizedConnectingLabel}</Text>
            </View>
          </Animated.View>
        )}

        {/* Error message after all routes exhausted */}
        {connectionState === 'failed' && error && (
          <Animated.View style={{ transform: [{ translateY: contentTranslate }] }}>
            <TouchableOpacity
              style={styles.errorCard}
              onPress={() => useVpnStore.getState().clearError()}
              activeOpacity={0.85}
            >
              <Text style={styles.errorCardText}>{trPhrase(error)}</Text>
              <Text style={styles.errorCardHint}>{t('home.tapToRetry')}</Text>
            </TouchableOpacity>
          </Animated.View>
        )}

        {/* Server pill */}
        <Animated.View style={{ transform: [{ translateY: contentTranslate }] }}>
          <TouchableOpacity
            style={[styles.serverPill, isConnected && styles.serverPillActive]}
            onPress={() => onNavigate('servers')}
            activeOpacity={0.75}
          >
            <Text style={styles.serverFlag}>{selectedServer?.flag ?? '🌐'}</Text>
            <View style={styles.serverInfo}>
              <Text style={styles.serverName}>
                {selectedServer ? selectedServer.country : t('home.selectServer')}
              </Text>
              <Text style={styles.serverSub}>
                {selectedServer
                  ? `${selectedServer.city} · ${selectedServer.protocol}`
                  : t('home.tapToChoose')}
              </Text>
            </View>
            <View style={styles.serverMeta}>
              <View style={[styles.pingDot, { backgroundColor: Colors.emerald[400] }]} />
              <Text style={styles.serverPing}>{selectedServer?.ping ?? '—'}ms</Text>
            </View>
            <Text style={styles.chevron}>›</Text>
          </TouchableOpacity>
        </Animated.View>

        {/* Metric row */}
        <Animated.View style={[styles.metricRow, { transform: [{ translateY: contentTranslate }] }]}>
          <MetricPill
            label={t('home.ping')}
            value={isConnected ? String(pingMs || selectedServer?.ping || '—') : (selectedServer ? String(selectedServer.ping) : '—')}
            unit={selectedServer ? 'ms' : ''}
            accent={isConnected}
            style={{ flex: 1 }}
          />
          <MetricPill
            label={t('home.upload')}
            value={isConnected ? String(uploadMbps.toFixed(1)) : '—'}
            unit={isConnected ? 'MB/s' : ''}
            style={{ flex: 1 }}
          />
          <MetricPill
            label={t('home.download')}
            value={isConnected ? String(downloadMbps.toFixed(1)) : '—'}
            unit={isConnected ? 'MB/s' : ''}
            style={{ flex: 1 }}
          />
        </Animated.View>

        {/* Smart Connect Engine status */}
        <Animated.View style={{ transform: [{ translateY: contentTranslate }] }}>
          <TouchableOpacity
            style={styles.aiBtn}
            onPress={() => onNavigate('ai')}
            activeOpacity={0.8}
          >
            <View style={styles.aiBtnLeft}>
              <View style={[styles.aiOrb, autoConnect.isRunning && { borderColor: '#FFB800', shadowColor: '#FFB800' }]}>
                <Image source={LOGO_MARK} style={styles.aiOrbLogo} resizeMode="contain" />
              </View>
              <View>
                <Text style={styles.aiBtnTitle}>
                  {autoConnect.isRunning ? t('home.findingRoute') : isConnected ? t('home.optimalRoute') : t('home.autoRoute')}
                </Text>
                <Text style={styles.aiBtnSub}>
                  {autoConnect.isRunning
                    ? t('home.testingRoutes').replace('{n}', String(autoConnect.profiles.length))
                    : isConnected && autoConnect.winningConfig
                      ? t('home.connectedVia').replace('{label}', autoConnect.winningConfig.label)
                      : t('home.tapAdvanced')}
                </Text>
              </View>
            </View>
            <View style={styles.aiArrow}>
              <Text style={styles.aiArrowText}>›</Text>
            </View>
          </TouchableOpacity>
        </Animated.View>

        {/* Watch ad → earn data */}
        <Animated.View style={{ transform: [{ translateY: contentTranslate }], marginTop: Spacing[3] }}>
          <WatchAdCard />
        </Animated.View>

        {/* Traffic stats (connected only) */}
        {isConnected && (
          <GlassCard style={styles.trafficCard}>
            <Text style={styles.cardLabel}>{t('home.sessionTraffic')}</Text>
            <View style={styles.trafficRow}>
              <View style={styles.trafficItem}>
                <Text style={styles.trafficIcon}>↑</Text>
                <Text style={styles.trafficValue}>{formatBytes(sessionBytes.sent)}</Text>
                <Text style={styles.trafficSub}>{t('home.sent')}</Text>
              </View>
              <View style={styles.trafficDivider} />
              <View style={styles.trafficItem}>
                <Text style={[styles.trafficIcon, { color: Colors.blue[400] }]}>↓</Text>
                <Text style={styles.trafficValue}>{formatBytes(sessionBytes.received)}</Text>
                <Text style={styles.trafficSub}>{t('home.received')}</Text>
              </View>
              <View style={styles.trafficDivider} />
              <View style={styles.trafficItem}>
                <Text style={styles.trafficIcon}>⬡</Text>
                <Text style={styles.trafficValue}>{selectedServer?.id?.toUpperCase() ?? '—'}</Text>
                <Text style={styles.trafficSub}>{t('home.node')}</Text>
              </View>
            </View>

            {/* Routing test */}
            <TouchableOpacity
              style={styles.traceBtn}
              onPress={runTraceTest}
              disabled={traceTestRunning}
              activeOpacity={0.75}
            >
              <Text style={styles.traceBtnText}>
                {traceTestRunning ? t('home.testing') : t('home.testRouting')}
              </Text>
            </TouchableOpacity>

            {traceTestResult && (
              <View style={[styles.traceResult, traceTestResult.ok ? styles.traceResultOk : styles.traceResultFail]}>
                {traceTestResult.ok ? (
                  <>
                    <Text style={styles.traceResultTitle}>{t('home.routingOk')}</Text>
                    <Text style={styles.traceResultLine}>IP: {traceTestResult.routedIp}</Text>
                    <Text style={styles.traceResultLine}>HTTP {traceTestResult.statusCode} · {traceTestResult.bytesIn} B</Text>
                  </>
                ) : (
                  <>
                    <Text style={styles.traceResultTitle}>{t('home.routingFailed')}</Text>
                    <Text style={styles.traceResultLine}>
                      {traceTestResult.error ?? `HTTP ${traceTestResult.statusCode}`}
                    </Text>
                    <Text style={styles.traceResultHint}>
                      {t('home.routingFailedHint')}
                    </Text>
                  </>
                )}
              </View>
            )}

            {/* Connection debug panel */}
            {(() => {
              const winner = autoConnect.winningConfig;
              const creds  = getImportedCreds(selectedId);
              const remote = winner?.configJson ? parseRemoteFromConfig(winner.configJson) : null;
              const addr   = remote?.address ?? creds?.address ?? '—';
              const port   = remote?.port    ?? creds?.port    ?? 0;
              const profileLabel = winner?.label ?? selectedServer?.protocol ?? '—';
              const transport    = winner?.label?.includes('WebSocket')   ? 'WS'
                                 : winner?.label?.includes('XHTTP')       ? 'XHTTP'
                                 : winner?.label?.includes('HTTPUpgrade') ? 'HTTPUpgrade'
                                 : 'Reality (TCP)';
              return (
                <View style={styles.debugPanel}>
                  <Text style={styles.debugTitle}>CONNECTION DEBUG</Text>
                  <View style={styles.debugRow}><Text style={styles.debugKey}>Profile</Text><Text style={styles.debugVal} numberOfLines={1}>{profileLabel}</Text></View>
                  <View style={styles.debugRow}><Text style={styles.debugKey}>Transport</Text><Text style={styles.debugVal}>{transport}</Text></View>
                  <View style={styles.debugRow}><Text style={styles.debugKey}>Remote</Text><Text style={styles.debugVal}>{addr}:{port}</Text></View>
                  {traceTestResult?.routedIp && (
                    <View style={styles.debugRow}><Text style={styles.debugKey}>Exit IP</Text><Text style={[styles.debugVal, traceTestResult.ok ? styles.debugValOk : styles.debugValErr]}>{traceTestResult.routedIp}</Text></View>
                  )}
                  {!traceTestResult && (
                    <Text style={styles.debugHint}>Tap "Test routing" above to detect exit IP</Text>
                  )}
                </View>
              );
            })()}
          </GlassCard>
        )}

        <View style={{ height: Layout.bottomNavHeight + Spacing[4] }} />
      </ScrollView>

      <BottomNav active={activeTab} onPress={onNavigate} />
    </View>
  );
}

const styles = StyleSheet.create({
  screen:       { flex: 1, backgroundColor: Colors.bg.base },
  ambientGlow:  {
    position: 'absolute', width, height: width, borderRadius: width / 2,
    backgroundColor: Colors.emerald[900], opacity: 0.12, top: -width * 0.3, left: 0,
  },
  scroll:       { flex: 1 },
  content:      { paddingTop: Layout.statusBarHeight, paddingHorizontal: Layout.screenPadding, gap: Spacing[4] },
  header:       { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingTop: Spacing[2] },
  headerActions:{ flexDirection: 'row', alignItems: 'center', gap: Spacing[2] },
  brandBlock:   { flex: 1, gap: 2 },
  brandRow:     { flexDirection: 'row', alignItems: 'center', gap: 7 },
  brandLogoSmall: { width: 22, height: 22 },
  brandName:    { fontSize: Typography.size.base, fontFamily: Typography.family.heading, color: Colors.text.primary, letterSpacing: 0.5 },
  greeting:     { fontSize: Typography.size.xs, fontFamily: Typography.family.body, color: Colors.text.muted, letterSpacing: Typography.tracking.wide },
  userId:       { fontSize: Typography.size.xs, fontFamily: Typography.family.mono, color: Colors.emerald[400], letterSpacing: 0.5, marginTop: 1 },
  settingsBtn:  { width: 40, height: 40, borderRadius: 20, backgroundColor: Colors.bg.surface, borderWidth: 1, borderColor: Colors.border.default, alignItems: 'center', justifyContent: 'center' },
  settingsIcon: { fontSize: 18, color: Colors.text.secondary },
  statusRow:    { flexDirection: 'row', alignItems: 'center', gap: Spacing[3], flexWrap: 'wrap' },
  protocolBadge:{ backgroundColor: 'rgba(0,232,122,0.1)', borderRadius: Radius.full, borderWidth: 1, borderColor: Colors.border.glow, paddingHorizontal: Spacing[3], paddingVertical: 4 },
  protocolText: { fontSize: Typography.size.xs, fontFamily: Typography.family.mono, color: Colors.emerald[400], letterSpacing: 0.5 },
  errorBadge:     { backgroundColor: 'rgba(255,80,80,0.1)', borderRadius: Radius.full, borderWidth: 1, borderColor: 'rgba(255,80,80,0.3)', paddingHorizontal: Spacing[3], paddingVertical: 4 },
  errorText:      { fontSize: Typography.size.xs, fontFamily: Typography.family.mono, color: Colors.status.disconnected },
  reconnectBadge: { backgroundColor: 'rgba(255,184,0,0.1)', borderRadius: Radius.full, borderWidth: 1, borderColor: 'rgba(255,184,0,0.35)', paddingHorizontal: Spacing[3], paddingVertical: 4 },
  reconnectText:  { fontSize: Typography.size.xs, fontFamily: Typography.family.mono, color: '#FFB800', letterSpacing: 0.3 },
  stealthBadge:   { backgroundColor: 'rgba(155,119,255,0.12)', borderRadius: Radius.full, borderWidth: 1, borderColor: 'rgba(155,119,255,0.35)', paddingHorizontal: Spacing[3], paddingVertical: 4 },
  stealthBadgeText: { fontSize: Typography.size.xs, fontFamily: Typography.family.label, color: '#9B77FF', letterSpacing: 0.5 },
  smartStatusRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing[2], paddingVertical: Spacing[2], paddingHorizontal: Spacing[1] },
  smartStatusDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: '#FFB800' },
  smartStatusText:{ fontSize: Typography.size.sm, fontFamily: Typography.family.body, color: Colors.text.muted, fontStyle: 'italic' },
  errorCard:      { backgroundColor: 'rgba(255,80,80,0.08)', borderRadius: Radius.xl, borderWidth: 1, borderColor: 'rgba(255,80,80,0.25)', padding: Spacing[4], alignItems: 'center', gap: Spacing[1] },
  errorCardText:  { fontSize: Typography.size.sm, fontFamily: Typography.family.body, color: Colors.status.disconnected, textAlign: 'center' },
  errorCardHint:  { fontSize: Typography.size.xs, fontFamily: Typography.family.body, color: Colors.text.muted },
  connectArea:  { alignItems: 'center', paddingVertical: Spacing[4], gap: Spacing[3] },
  timer:        { fontSize: Typography.size.md, fontFamily: Typography.family.mono, color: Colors.text.secondary, letterSpacing: 2 },
  serverPill:   { flexDirection: 'row', alignItems: 'center', backgroundColor: Colors.bg.surface, borderRadius: Radius.xl, borderWidth: 1, borderColor: Colors.border.default, padding: Spacing[4], gap: Spacing[3] },
  serverPillActive: { borderColor: Colors.border.glow, backgroundColor: 'rgba(0,232,122,0.04)' },
  serverFlag:   { fontSize: 28 },
  serverInfo:   { flex: 1 },
  serverName:   { fontSize: Typography.size.base, fontFamily: Typography.family.heading, color: Colors.text.primary },
  serverSub:    { fontSize: Typography.size.xs, fontFamily: Typography.family.body, color: Colors.text.muted, marginTop: 2 },
  serverMeta:   { flexDirection: 'row', alignItems: 'center', gap: 4 },
  pingDot:      { width: 6, height: 6, borderRadius: 3 },
  serverPing:   { fontSize: Typography.size.sm, fontFamily: Typography.family.mono, color: Colors.emerald[400] },
  chevron:      { fontSize: 20, color: Colors.text.muted, marginLeft: -4 },
  metricRow:    { flexDirection: 'row', gap: Spacing[3] },
  aiBtn:        { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: Colors.bg.surface, borderRadius: Radius.xl, borderWidth: 1, borderColor: 'rgba(0,232,122,0.15)', padding: Spacing[4], ...Shadow.card },
  aiBtnLeft:    { flexDirection: 'row', alignItems: 'center', gap: Spacing[3] },
  aiOrb:        { width: 40, height: 40, borderRadius: 20, backgroundColor: 'rgba(0,232,122,0.12)', borderWidth: 1, borderColor: Colors.border.glow, shadowColor: Colors.emerald[400], shadowOffset: { width: 0, height: 0 }, shadowOpacity: 0.4, shadowRadius: 8, elevation: 4, alignItems: 'center', justifyContent: 'center' },
  aiOrbLogo:    { width: 26, height: 26, tintColor: Colors.emerald[400] },
  aiBtnTitle:   { fontSize: Typography.size.base, fontFamily: Typography.family.heading, color: Colors.text.primary },
  aiBtnSub:     { fontSize: Typography.size.xs, fontFamily: Typography.family.body, color: Colors.text.muted, marginTop: 2 },
  aiArrow:      { width: 28, height: 28, borderRadius: 14, backgroundColor: Colors.bg.elevated, alignItems: 'center', justifyContent: 'center' },
  aiArrowText:  { fontSize: 18, color: Colors.emerald[400] },
  shahnamehCard:  { flexDirection: 'row', alignItems: 'center', gap: Spacing[3], backgroundColor: 'rgba(201,164,42,0.07)', borderRadius: Radius.xl, borderWidth: 1, borderColor: 'rgba(201,164,42,0.3)', padding: Spacing[4] },
  shahnamehIcon:  { fontSize: 26 },
  shahnamehTitle: { fontSize: Typography.size.base, fontFamily: Typography.family.heading, color: '#C9A42A' },
  shahnamehSub:   { fontSize: Typography.size.xs, fontFamily: Typography.family.body, color: Colors.text.muted, marginTop: 2 },
  trafficCard:  { gap: Spacing[3] },
  cardLabel:    { fontSize: Typography.size.xs, fontFamily: Typography.family.label, color: Colors.text.muted, textTransform: 'uppercase', letterSpacing: 1 },
  trafficRow:   { flexDirection: 'row', alignItems: 'center' },
  trafficItem:  { flex: 1, alignItems: 'center', gap: 4 },
  trafficIcon:  { fontSize: Typography.size.xl, color: Colors.emerald[400], fontFamily: Typography.family.heading },
  trafficValue: { fontSize: Typography.size.lg, fontFamily: Typography.family.heading, color: Colors.text.primary },
  trafficSub:   { fontSize: Typography.size.xs, fontFamily: Typography.family.body, color: Colors.text.muted, textTransform: 'uppercase', letterSpacing: 0.5 },
  trafficDivider:{ width: 1, height: 40, backgroundColor: Colors.border.subtle },
  traceBtn:      { marginTop: Spacing[3], alignSelf: 'center', paddingHorizontal: Spacing[5], paddingVertical: Spacing[2], borderRadius: Radius.full, borderWidth: 1, borderColor: Colors.border.glow, backgroundColor: 'rgba(0,232,122,0.07)' },
  traceBtnText:  { fontSize: Typography.size.xs, fontFamily: Typography.family.label, color: Colors.emerald[400], letterSpacing: 0.5 },
  traceResult:   { marginTop: Spacing[3], borderRadius: Radius.lg, padding: Spacing[3], gap: 4 },
  traceResultOk: { backgroundColor: 'rgba(0,232,122,0.08)', borderWidth: 1, borderColor: 'rgba(0,232,122,0.25)' },
  traceResultFail:{ backgroundColor: 'rgba(255,80,80,0.07)', borderWidth: 1, borderColor: 'rgba(255,80,80,0.25)' },
  traceResultTitle:{ fontSize: Typography.size.sm, fontFamily: Typography.family.heading, color: Colors.text.primary },
  traceResultLine: { fontSize: Typography.size.xs, fontFamily: Typography.family.mono, color: Colors.text.secondary },
  traceResultHint: { fontSize: Typography.size.xs, fontFamily: Typography.family.body, color: Colors.status.disconnected, marginTop: 2 },
  logPanel:      { gap: Spacing[1] },
  logPanelTitle: { fontSize: Typography.size.xs, fontFamily: Typography.family.label, color: Colors.text.muted, textTransform: 'uppercase', letterSpacing: 1, marginBottom: Spacing[1] },
  logEntry:      { fontSize: Typography.size.xs, fontFamily: Typography.family.mono, color: Colors.text.muted, lineHeight: 18 },
  logEntryOk:    { color: Colors.emerald[400] },
  logEntryError: { color: Colors.status.disconnected },
  debugPanel:    { marginTop: Spacing[3], borderTopWidth: 1, borderTopColor: Colors.border.subtle, paddingTop: Spacing[3], gap: 6 },
  debugTitle:    { fontSize: 9, fontFamily: Typography.family.label, color: Colors.text.muted, letterSpacing: 1.5, textTransform: 'uppercase', marginBottom: 2 },
  debugRow:      { flexDirection: 'row', justifyContent: 'space-between', gap: Spacing[2] },
  debugKey:      { fontSize: Typography.size.xs, fontFamily: Typography.family.label, color: Colors.text.muted, width: 72 },
  debugVal:      { fontSize: Typography.size.xs, fontFamily: Typography.family.mono, color: Colors.text.secondary, flex: 1, textAlign: 'right' },
  debugValOk:    { color: Colors.emerald[400] },
  debugValErr:   { color: Colors.status.disconnected },
  debugHint:     { fontSize: Typography.size.xs, fontFamily: Typography.family.body, color: Colors.text.muted, fontStyle: 'italic', marginTop: 2 },
});
