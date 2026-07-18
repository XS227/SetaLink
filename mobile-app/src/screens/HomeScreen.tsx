import React, { useRef, useEffect, useState } from 'react';
import {
  View, Text, TouchableOpacity, ScrollView,
  StyleSheet, Dimensions, Animated, Image, Linking,
} from 'react-native';
import { Colors, Typography, Spacing, Radius, Layout, Shadow } from '../design/tokens';
import { ConnectButton } from '../components/ConnectButton';
import { GoldBeatBurst } from '../components/GoldBeatBurst';
import { StarlinkHeroCard } from '../components/StarlinkHeroCard';
import { StarlinkCelebration } from '../components/StarlinkCelebration';
import { StatusBadge }   from '../components/StatusBadge';
import { TopBar }             from '../components/TopBar';
import { MetricPill }    from '../components/MetricPill';
import { CoverageIcon }  from '../components/CoverageIcon';
import { GlassCard }     from '../components/GlassCard';
import { BottomNav, NavTab } from '../components/BottomNav';
import { WatchAdCard } from '../components/WatchAdCard';
import { HomeBanner } from '../components/HomeBanner';

import { useVpnStore }         from '../stores/vpnStore';
import { useAuthStore }        from '../stores/authStore';
import { useZarStore }         from '../stores/zarStore';
import { useAIStore }          from '../stores/aiStore';
import { useServerStore }      from '../stores/serverStore';
import { useStarlinkStore }    from '../stores/starlinkStore';
import { useSettingsStore }    from '../stores/settingsStore';
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
  const authToken = useAuthStore((s) => s.token);
  const autoConnect = useAIStore((s) => s.autoConnect);
  const getImportedCreds = useServerStore((s) => s.getImportedCreds);
  const selectedId = useServerStore((s) => s.selectedId);
  const timer = useSessionTimer(connectionState === 'connected', sessionStartedAt);
  const { uploadMbps, downloadMbps, pingMs } = useVpnStats();

  useSessionLifecycle();

  const isConnected     = connectionState === 'connected';
  const isTransitioning = connectionState === 'connecting'
    || connectionState === 'disconnecting';

  // Composite coverage score (route + DNS + ping + traffic). Formerly rendered
  // as a full-width card in the body; now surfaced as the top-bar coverage icon.
  const healthScore = computeHealthScore({
    connected:    isConnected,
    probeOk:      isConnected && (traceTestResult?.ok ?? getLastConnectProbeOk()),
    dnsOk:        dnsOkFromConnectionLog(connectionLog),
    pingMs:       pingMs || selectedServer?.ping || 0,
    downloadMbps, uploadMbps,
  });

  // Gold heartbeat celebration: fire one coin burst on each transition INTO
  // connected (never on re-render while already connected).
  const [goldBurst, setGoldBurst] = useState(0);
  const wasConnectedRef = useRef(false);
  useEffect(() => {
    if (isConnected && !wasConnectedRef.current) setGoldBurst(k => k + 1);
    wasConnectedRef.current = isConnected;
  }, [isConnected]);

  // b97: Starlink unlock/progress card data — fetched on mount and refreshed
  // after every connect (invite progress and hasConnected can both change).
  const starlinkStatus = useStarlinkStore((s) => s.status);
  useEffect(() => {
    if (authToken) useStarlinkStore.getState().fetch(authToken);
  }, [authToken]);

  // "Satellite Route Active" — once-per-device first-connect achievement
  // (b97 addendum #2). Server truth (`hasConnected`, node_usage-backed,
  // survives reinstalls) is the real gate; the local settingsStore flag is
  // only a same-session guard against a stale/slow usage-record double
  // firing this. Own ref (not shared with the gold-burst effect above) so
  // effect execution order between the two can never matter.
  const [starlinkBurst, setStarlinkBurst] = useState(0);
  const wasConnectedForStarlinkRef = useRef(false);
  useEffect(() => {
    const justConnected = isConnected && !wasConnectedForStarlinkRef.current;
    if (justConnected && selectedServer?.nodeType === 'STARLINK') {
      const settings = useSettingsStore.getState();
      if (starlinkStatus?.hasConnected === false && !settings.hasSeenStarlinkCelebration) {
        settings.markStarlinkCelebrationSeen();
        setStarlinkBurst(k => k + 1);
      }
      if (authToken) useStarlinkStore.getState().fetch(authToken);
    }
    wasConnectedForStarlinkRef.current = isConnected;
  }, [isConnected]); // eslint-disable-line react-hooks/exhaustive-deps

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

  // Warm up an interstitial so it's ready by the first Connect tap. Ad gates are
  // FAIL-CLOSED: ads only when the plan is known to be 'free', OR the backend has
  // explicitly flagged this device testMode (devices.test_mode) — a per-device ad
  // QA override for a premium tester, never inferred, always server-controlled.
  // An unloaded or stale-synced user must never show a premium account an ad.
  const userShowsAds = user?.plan === 'free' || !!user?.testMode;
  useEffect(() => {
    if (!userShowsAds) return;
    initAds().then(preloadInterstitial).catch(() => {});
  }, [userShowsAds]); // eslint-disable-line react-hooks/exhaustive-deps

  // Where Google is unreachable outside the tunnel (Iran), the tap-time ad is
  // never ready — show it once the tunnel is up instead, so the ad streams
  // through the tunnel instead of flashing blank.
  const adShownAtTapRef = useRef(false);
  const wasConnectedForAdsRef = useRef(false);
  useEffect(() => {
    if (isConnected && !wasConnectedForAdsRef.current) {
      if (userShowsAds && !adShownAtTapRef.current) {
        showInterstitialAfterConnect();
      }
      adShownAtTapRef.current = false;
    }
    wasConnectedForAdsRef.current = isConnected;
  }, [isConnected]); // eslint-disable-line react-hooks/exhaustive-deps

  // Tap-to-earn: while connected the coin mints ZAR (Shahnameh currency,
  // REAL conversion comes later). Disconnect lives on the TopBar power icon
  // and as hold-to-disconnect on the coin itself.
  const zarBalance = useZarStore((s) => s.balance);
  const [zarCapped, setZarCapped] = useState(false);
  const handleConnect = () => {
    if (connectionState === 'connected') {
      const res = useZarStore.getState().tap();
      setZarCapped(res.capped);
      if (res.earned > 0) setGoldBurst(k => k + 1);
      return;
    }
    if (connectionState === 'idle' || connectionState === 'failed') {
      // Block connect when free quota is exhausted
      if (user && user.plan === 'free' && user.quotaBytesUsed >= user.quotaBytesTotal) {
        (onNavigate as (tab: string) => void)('upgrade');
        return;
      }
      // Start connecting first so the ad can never delay or block the tunnel.
      connect();
      // Best-effort ad revenue on each new connection — free plan or an explicit
      // testMode override, and only if an interstitial is already loaded.
      adShownAtTapRef.current = userShowsAds
        ? showInterstitialOnConnect()
        : false;
    }
  };

  // Starlink hero card actions (b97). "Connect via Starlink" selects the
  // Starlink node then reuses whatever connect path is already correct for
  // the current state (fresh connect vs. switching an active session) —
  // same split ServersScreen uses elsewhere for server selection.
  const handleStarlinkConnect = () => {
    const nodeId = starlinkStatus?.node?.id;
    if (!nodeId) return;
    useServerStore.getState().selectServer(nodeId);
    if (connectionState === 'connected') {
      useVpnStore.getState().switchServer();
    } else if (connectionState === 'idle' || connectionState === 'failed') {
      connect();
    }
  };
  const handleStarlinkInvite  = () => (onNavigate as (tab: string) => void)('profile');
  const handleStarlinkUpgrade = () => (onNavigate as (tab: string) => void)('upgrade');

  const protocol = selectedServer
    ? `${selectedServer.protocol} · ${selectedServer.transport}`
    : 'VLESS · Reality';

  return (
    <View style={styles.screen}>
      {isConnected && <View style={styles.ambientGlow} pointerEvents="none" />}
      {/* Positioned relative to the screen root (not the scroll content) so
          it overlays the top of the viewport regardless of scroll offset. */}
      <StarlinkCelebration burstKey={starlinkBurst} />

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        {/* Header — B-16 declutter: dropped the in-app "Realink" logo+wordmark
            row (purely decorative — the user already knows what app this is)
            and the raw device/user-id line (still visible on Profile via
            IdentityHeader). One text line + the action row, not four. */}
        <Animated.View style={[styles.header, { opacity: headerOpacity }]}>
          <Text style={styles.greeting} numberOfLines={1}>{t(greeting)}</Text>
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

        {/* Server pill — B-17: moved ahead of the connect button (glanceable
            info first, primary action lower on the screen, closer to thumb
            reach). */}
        <Animated.View style={{ transform: [{ translateY: contentTranslate }] }}>
          <TouchableOpacity
            style={[styles.serverPill, isConnected && styles.serverPillActive]}
            onPress={() => onNavigate('servers')}
            activeOpacity={0.75}
          >
            <Text style={styles.serverFlag}>{selectedServer?.flag ?? '🌐'}</Text>
            <View style={styles.serverInfo}>
              <View style={styles.serverNameRow}>
                <Text style={styles.serverName}>
                  {selectedServer ? selectedServer.country : t('home.selectServer')}
                </Text>
                {/* Starlink exit indicator -- only while actually connected through
                    one, not just when one happens to be selected/queued (matches
                    the "connected to a Starlink exit" requirement, not "picked").
                    Relocated here 2026-07-17 during the b20-b22 merge: B-17 moved
                    the server pill up above the connect button, this is now the
                    only copy that actually renders. */}
                {isConnected && selectedServer?.nodeType === 'STARLINK' && (
                  <View style={styles.starlinkBadge}>
                    <Text style={styles.starlinkBadgeText}>🛰 {t('srv.starlink')}</Text>
                  </View>
                )}
              </View>
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

        {/* Connect button — B-17: ring shrunk (188 → 152, ConnectButton.tsx)
            and moved down in the scroll order (was right under the status
            row) so it sits lower on the initial viewport, closer to natural
            thumb reach. Right-biased (not centered): the button+burst cluster
            aligns to the right edge of the content column, with enough
            paddingRight (Spacing[10]=40, on top of the 20px screen padding)
            to clear AnimatedRing's pulse overflow (scales to 1.6x = ~46px
            beyond the button's edge) without clipping on narrow phones —
            see DECISIONS.md for the exact clearance math. */}
        <Animated.View style={[
          styles.connectArea,
          { transform: [{ translateY: contentTranslate }] },
        ]}>
          <View style={styles.connectButtonCluster}>
            <ConnectButton
              state={BUTTON_STATE_MAP[connectionState]}
              onPress={handleConnect}
              onLongPress={isConnected ? disconnect : undefined}
              disabled={isTransitioning}
            />
            {/* Heartbeat of the network — gold REAL coins pulse out on connect.
                Moved inside the same shrink-wrapped cluster as the button so
                its absoluteFillObject layer centers on the button itself,
                not the old full-width connectArea centre. */}
            <GoldBeatBurst burstKey={goldBurst} />
          </View>
          {isConnected && <Text style={styles.timer}>{timer}</Text>}
          {isConnected && (
            <View style={styles.zarPill}>
              <Text style={styles.zarText}>⚡ {zarBalance} ZAR</Text>
              <Text style={styles.zarHint}>
                {zarCapped ? t('home.zarCapReached') : t('home.zarHint')}
              </Text>
            </View>
          )}
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

        {/* b97: Starlink unlock/progress card — replaces the old Shahnameh
            promo slot, first in the repurposed promo order (Starlink, then
            the ad/reward surfaces below). Renders null until the first
            fetch resolves or if the server has no Starlink node configured
            at all — never an empty gap. */}
        <Animated.View style={{ transform: [{ translateY: contentTranslate }] }}>
          <StarlinkHeroCard
            status={starlinkStatus}
            isConnectedViaStarlink={isConnected && selectedServer?.nodeType === 'STARLINK'}
            onConnect={handleStarlinkConnect}
            onInvite={handleStarlinkInvite}
            onUpgrade={handleStarlinkUpgrade}
          />
        </Animated.View>

        {/* B-19: Home's two ad surfaces — 1 AdMob banner (rotates with the
            ecosystem promo, was built but never wired in) + 1 rewarded-video
            invite card. Both already gate ad-free for premium internally. */}
        <Animated.View style={{ transform: [{ translateY: contentTranslate }], marginTop: Spacing[3] }}>
          <HomeBanner showAds={userShowsAds} />
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
  // B-16: the sole header text line now (brand logo/wordmark + raw device-id
  // line removed — decorative/redundant, see the header comment above).
  greeting:     { flex: 1, fontSize: Typography.size.lg, fontFamily: Typography.family.heading, color: Colors.text.primary, letterSpacing: Typography.tracking.tight, marginRight: Spacing[3] },
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
  // B-17: right-biased thumb zone. paddingRight clears AnimatedRing's max
  // pulse overflow (~46px beyond the 152px button's edge at 1.6x scale) —
  // see the header comment above where this is used for the full math.
  connectArea:  { alignItems: 'flex-end', paddingVertical: Spacing[4], paddingRight: Spacing[10], gap: Spacing[3] },
  connectButtonCluster: { alignItems: 'center', justifyContent: 'center' },
  timer:        { fontSize: Typography.size.md, fontFamily: Typography.family.mono, color: Colors.text.secondary, letterSpacing: 2 },
  zarPill:      { alignItems: 'center', gap: 2, marginTop: Spacing[1] },
  zarText:      { fontSize: Typography.size.md, fontFamily: Typography.family.heading, color: Colors.gold[400], letterSpacing: 1 },
  zarHint:      { fontSize: Typography.size.xs, color: Colors.text.muted },
  serverPill:   { flexDirection: 'row', alignItems: 'center', backgroundColor: Colors.bg.surface, borderRadius: Radius.xl, borderWidth: 1, borderColor: Colors.border.default, padding: Spacing[4], gap: Spacing[3] },
  serverPillActive: { borderColor: Colors.border.glow, backgroundColor: 'rgba(0,232,122,0.04)' },
  serverFlag:   { fontSize: 28 },
  serverInfo:   { flex: 1 },
  serverNameRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing[2] },
  serverName:   { fontSize: Typography.size.base, fontFamily: Typography.family.heading, color: Colors.text.primary },
  serverSub:    { fontSize: Typography.size.xs, fontFamily: Typography.family.body, color: Colors.text.muted, marginTop: 2 },
  starlinkBadge: {
    backgroundColor: 'rgba(120,180,255,0.14)',
    borderRadius: Radius.full,
    borderWidth: 1,
    borderColor: 'rgba(120,180,255,0.35)',
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  starlinkBadgeText: {
    fontSize: 9,
    fontFamily: Typography.family.label,
    color: '#78B4FF',
    letterSpacing: 0.3,
  },
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
