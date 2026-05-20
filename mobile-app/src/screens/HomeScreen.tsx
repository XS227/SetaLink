import React, { useRef, useEffect } from 'react';
import {
  View, Text, TouchableOpacity, ScrollView,
  StyleSheet, Dimensions, Animated, Image,
} from 'react-native';
import { Colors, Typography, Spacing, Radius, Layout, Shadow } from '../design/tokens';
import { ConnectButton } from '../components/ConnectButton';
import { StatusBadge }   from '../components/StatusBadge';
import { MetricPill }    from '../components/MetricPill';
import { NetworkQualityBar } from '../components/NetworkQualityBar';
import { GlassCard }     from '../components/GlassCard';
import { BottomNav, NavTab } from '../components/BottomNav';

import { useVpnStore }         from '../stores/vpnStore';
import { useAuthStore }        from '../stores/authStore';
import { useAIStore }          from '../stores/aiStore';
import { useSessionTimer }     from '../hooks/useSessionTimer';
import { useSessionLifecycle } from '../hooks/useSessionLifecycle';
import { useGreeting }         from '../hooks/useGreeting';
import { useVpnStats }         from '../hooks/useVpnStats';
import { formatBytes }         from '../utils/formatters';
import { useT }                from '../i18n';
import { connectingPhaseLabel } from '../services/failureClassifier';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const LOGO_SMALL = require('../assets/logo_mark.png') as number;

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
  const timer = useSessionTimer(connectionState === 'connected', sessionStartedAt);
  const { uploadMbps, downloadMbps, pingMs } = useVpnStats();

  useSessionLifecycle();

  const isConnected     = connectionState === 'connected';
  const isTransitioning = connectionState === 'connecting'
    || connectionState === 'disconnecting';

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

  const handleConnect = () => {
    if (connectionState === 'connected') { disconnect(); return; }
    if (connectionState === 'idle' || connectionState === 'failed') {
      // Block connect when free quota is exhausted
      if (user && user.plan === 'free' && user.quotaBytesUsed >= user.quotaBytesTotal) {
        (onNavigate as (tab: string) => void)('upgrade');
        return;
      }
      connect();
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
              <Image source={LOGO_SMALL} style={styles.brandLogoSmall} resizeMode="contain" />
              <Text style={styles.brandName}>SetaLink</Text>
            </View>
            <Text style={styles.greeting}>{greeting}</Text>
          </View>
          <TouchableOpacity
            style={styles.settingsBtn}
            onPress={() => onNavigate('settings' as NavTab)}
            activeOpacity={0.75}
          >
            <Text style={styles.settingsIcon}>⚙</Text>
          </TouchableOpacity>
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
              <Text style={styles.stealthBadgeText}>Stealth Active</Text>
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
        </Animated.View>

        {/* Smart status — friendly message while connecting */}
        {connectionState === 'connecting' && connectingLabel && (
          <Animated.View style={{ transform: [{ translateY: contentTranslate }] }}>
            <View style={styles.smartStatusRow}>
              <View style={styles.smartStatusDot} />
              <Text style={styles.smartStatusText}>{connectingLabel}</Text>
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
              <Text style={styles.errorCardText}>{error}</Text>
              <Text style={styles.errorCardHint}>Tap to retry</Text>
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

        {/* Network quality */}
        <Animated.View style={{ transform: [{ translateY: contentTranslate }] }}>
          <GlassCard glowColor={isConnected ? Colors.emerald[400] : undefined}>
            <NetworkQualityBar quality={isConnected
              ? Math.min(100, Math.max(0, Math.round(100 - (pingMs || selectedServer?.ping || 100) * 0.4)))
              : 0}
            />
          </GlassCard>
        </Animated.View>

        {/* Smart Connect Engine status */}
        <Animated.View style={{ transform: [{ translateY: contentTranslate }] }}>
          <TouchableOpacity
            style={styles.aiBtn}
            onPress={() => onNavigate('ai')}
            activeOpacity={0.8}
          >
            <View style={styles.aiBtnLeft}>
              <View style={[styles.aiOrb, autoConnect.isRunning && { borderColor: '#FFB800', shadowColor: '#FFB800' }]} />
              <View>
                <Text style={styles.aiBtnTitle}>
                  {autoConnect.isRunning ? 'Finding best route…' : isConnected ? 'Optimal route active' : 'Auto-route selection'}
                </Text>
                <Text style={styles.aiBtnSub}>
                  {autoConnect.isRunning
                    ? `Testing ${autoConnect.profiles.length} routes`
                    : isConnected && autoConnect.winningConfig
                      ? `Connected via ${autoConnect.winningConfig.label}`
                      : 'Tap for advanced options'}
                </Text>
              </View>
            </View>
            <View style={styles.aiArrow}>
              <Text style={styles.aiArrowText}>›</Text>
            </View>
          </TouchableOpacity>
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
                {traceTestRunning ? 'Testing…' : 'Test routing'}
              </Text>
            </TouchableOpacity>

            {traceTestResult && (
              <View style={[styles.traceResult, traceTestResult.ok ? styles.traceResultOk : styles.traceResultFail]}>
                {traceTestResult.ok ? (
                  <>
                    <Text style={styles.traceResultTitle}>Routing OK</Text>
                    <Text style={styles.traceResultLine}>IP: {traceTestResult.routedIp}</Text>
                    <Text style={styles.traceResultLine}>HTTP {traceTestResult.statusCode} · {traceTestResult.bytesIn} B</Text>
                  </>
                ) : (
                  <>
                    <Text style={styles.traceResultTitle}>Routing failed</Text>
                    <Text style={styles.traceResultLine}>
                      {traceTestResult.error ?? `HTTP ${traceTestResult.statusCode}`}
                    </Text>
                    <Text style={styles.traceResultHint}>
                      Server connected, but internet is not routed through VPN.
                    </Text>
                  </>
                )}
              </View>
            )}
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
  brandBlock:   { flex: 1, gap: 2 },
  brandRow:     { flexDirection: 'row', alignItems: 'center', gap: 7 },
  brandLogoSmall: { width: 22, height: 22, tintColor: Colors.emerald[400] },
  brandName:    { fontSize: Typography.size.base, fontFamily: Typography.family.heading, color: Colors.text.primary, letterSpacing: 0.5 },
  greeting:     { fontSize: Typography.size.xs, fontFamily: Typography.family.body, color: Colors.text.muted, letterSpacing: Typography.tracking.wide },
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
  aiOrb:        { width: 40, height: 40, borderRadius: 20, backgroundColor: 'rgba(0,232,122,0.12)', borderWidth: 1, borderColor: Colors.border.glow, shadowColor: Colors.emerald[400], shadowOffset: { width: 0, height: 0 }, shadowOpacity: 0.4, shadowRadius: 8, elevation: 4 },
  aiBtnTitle:   { fontSize: Typography.size.base, fontFamily: Typography.family.heading, color: Colors.text.primary },
  aiBtnSub:     { fontSize: Typography.size.xs, fontFamily: Typography.family.body, color: Colors.text.muted, marginTop: 2 },
  aiArrow:      { width: 28, height: 28, borderRadius: 14, backgroundColor: Colors.bg.elevated, alignItems: 'center', justifyContent: 'center' },
  aiArrowText:  { fontSize: 18, color: Colors.emerald[400] },
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
});
