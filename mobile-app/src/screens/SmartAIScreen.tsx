import React, { useRef, useEffect, useCallback } from 'react';
import {
  View, Text, TouchableOpacity, ScrollView,
  StyleSheet, Animated, ActivityIndicator,
} from 'react-native';
import { Colors, Typography, Spacing, Radius, Layout } from '../design/tokens';
import { GlassCard }         from '../components/GlassCard';
import { BottomNav, NavTab } from '../components/BottomNav';

import { useAIStore, AI_MODES, AIFeatures } from '../stores/aiStore';
import { formatRelativeTime }               from '../utils/formatters';
import { useT }                             from '../i18n';
import { runOptimizer }                     from '../services/connectionOptimizer';
import { runAutoConnectLoop }               from '../services/autoConnector';
import { getAdapter }                       from '../services/vpnBridge';
import { useVpnStore }                      from '../stores/vpnStore';
import { useServerStore }                   from '../stores/serverStore';

// ── AI Orb ────────────────────────────────────────────────────────────────────

function AIOrb({ active, color }: { active: boolean; color: string }) {
  const pulse1 = useRef(new Animated.Value(1)).current;
  const pulse2 = useRef(new Animated.Value(1)).current;
  const rotate = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (active) {
      Animated.loop(
        Animated.parallel([
          Animated.sequence([
            Animated.timing(pulse1, { toValue: 1.4, duration: 1500, useNativeDriver: true }),
            Animated.timing(pulse1, { toValue: 1,   duration: 1500, useNativeDriver: true }),
          ]),
          Animated.sequence([
            Animated.delay(500),
            Animated.timing(pulse2, { toValue: 1.6, duration: 1500, useNativeDriver: true }),
            Animated.timing(pulse2, { toValue: 1,   duration: 1500, useNativeDriver: true }),
          ]),
        ])
      ).start();
      Animated.loop(
        Animated.timing(rotate, { toValue: 1, duration: 8000, useNativeDriver: true })
      ).start();
    } else {
      pulse1.setValue(1);
      pulse2.setValue(1);
    }
  }, [active]);

  const rotateStr = rotate.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] });

  return (
    <View style={orbStyles.wrapper}>
      {active && (
        <>
          <Animated.View style={[orbStyles.ring, { transform: [{ scale: pulse2 }], borderColor: color + '20' }]} />
          <Animated.View style={[orbStyles.ring, { width: 120, height: 120, borderRadius: 60, transform: [{ scale: pulse1 }], borderColor: color + '35' }]} />
        </>
      )}
      <Animated.View style={[orbStyles.orbit, { borderColor: color + '40', transform: [{ rotate: rotateStr }] }]} />
      <View style={[orbStyles.core, { shadowColor: color, backgroundColor: color + '15', borderColor: color + '60' }]}>
        <View style={[orbStyles.innerCore, { backgroundColor: color + '30' }]}>
          <Text style={[orbStyles.icon, { color }]}>◎</Text>
        </View>
      </View>
    </View>
  );
}

const orbStyles = StyleSheet.create({
  wrapper:   { width: 160, height: 160, alignItems: 'center', justifyContent: 'center' },
  ring:      { position: 'absolute', width: 150, height: 150, borderRadius: 75, borderWidth: 1 },
  orbit:     { position: 'absolute', width: 130, height: 130, borderRadius: 65, borderWidth: 1, borderStyle: 'dashed' },
  core:      { width: 80, height: 80, borderRadius: 40, borderWidth: 1, alignItems: 'center', justifyContent: 'center', shadowOffset: { width: 0, height: 0 }, shadowOpacity: 0.5, shadowRadius: 20, elevation: 8 },
  innerCore: { width: 56, height: 56, borderRadius: 28, alignItems: 'center', justifyContent: 'center' },
  icon:      { fontSize: 28 },
});

// ── Shared status helpers ─────────────────────────────────────────────────────

type ProfileStatus = 'pending' | 'testing' | 'success' | 'tcp-only' | 'fail' | 'skipped';

function statusColor(s: ProfileStatus | string): string {
  switch (s) {
    case 'success':  return Colors.emerald[400];
    case 'tcp-only': return '#7BCF8E';
    case 'fail':     return '#FF5A5A';
    case 'testing':  return '#FFB800';
    case 'skipped':  return Colors.text.muted;
    default:         return Colors.text.muted;
  }
}

function statusIcon(s: ProfileStatus | string): string {
  switch (s) {
    case 'success':  return '✓';
    case 'tcp-only': return '~';
    case 'fail':     return '✗';
    case 'testing':  return '…';
    case 'skipped':  return '↷';
    default:         return '○';
  }
}

// ── Feature i18n map ──────────────────────────────────────────────────────────

type FeatureTKeys = { label: string; desc: string };
type FeatureI18nMap = Record<keyof AIFeatures, { labelKey: string; descKey: string }>;

const FEATURE_I18N: FeatureI18nMap = {
  autoProtocol:        { labelKey: 'ai.feat.autoProto',  descKey: 'ai.feat.autoProtoD' },
  smartReconnect:      { labelKey: 'ai.feat.reconnect',  descKey: 'ai.feat.reconnectD' },
  domainRotation:      { labelKey: 'ai.feat.domainRot',  descKey: 'ai.feat.domainRotD' },
  cdnFallback:         { labelKey: 'ai.feat.cdn',        descKey: 'ai.feat.cdnD' },
  latencyAwareRouting: { labelKey: 'ai.feat.latency',    descKey: 'ai.feat.latencyD' },
};

// ── Phase labels ──────────────────────────────────────────────────────────────

function phaseLabel(phase: string, label: string, index: number, count: number): string {
  switch (phase) {
    case 'testing':        return `Testing profile ${index + 1}/${count}: ${label}`;
    case 'probe-validated':return `Internet confirmed: ${label}`;
    case 'retrying':       return label || 'All profiles failed — retrying…';
    case 'failed':         return 'All profiles failed — check server config';
    default:               return '';
  }
}

function phaseColor(phase: string): string {
  switch (phase) {
    case 'probe-validated': return Colors.emerald[400];
    case 'failed':          return '#FF5A5A';
    case 'retrying':        return '#FFB800';
    case 'testing':         return '#FFB800';
    default:                return Colors.text.muted;
  }
}

// ── Screen ────────────────────────────────────────────────────────────────────

interface Props {
  onNavigate: (tab: NavTab) => void;
  activeTab:  NavTab;
}

export function SmartAIScreen({ onNavigate, activeTab }: Props) {
  const { t } = useT();
  const {
    activeMode, features, liveLog, selectMode, toggleFeature, activeModeDef,
    optimizer, setOptimizerRunning, setOptimizerProfiles, setOptimizerResult, clearOptimizerResult,
    autoConnect, startAutoConnect, updateAutoStatus, setAutoResult, setWinningConfig, clearAutoConnect,
  } = useAIStore();
  const mode = activeModeDef();

  const connectionState = useVpnStore(s => s.connectionState);
  const vpnConnect      = useVpnStore(s => s.connect);
  const selectedServer  = useVpnStore(s => s.selectedServer);
  const getImportedCreds = useServerStore(s => s.getImportedCreds);

  const isVpnIdle = connectionState === 'idle' || connectionState === 'failed';
  const anyRunning = optimizer.isRunning || autoConnect.isRunning;

  // ── Optimizer (rank profiles, VPN disconnected after) ─────────────────────

  const startOptimizer = useCallback(async () => {
    if (!selectedServer) return;
    const creds = getImportedCreds(selectedServer.id);
    if (!creds) return;

    clearOptimizerResult();
    setOptimizerRunning(true);

    try {
      const adapter = getAdapter();
      const result  = await runOptimizer(
        selectedServer, creds, adapter,
        (profiles) => setOptimizerProfiles([...profiles]),
      );
      setOptimizerResult(result);
    } catch {
      setOptimizerRunning(false);
    }
  }, [selectedServer, getImportedCreds, clearOptimizerResult, setOptimizerRunning, setOptimizerProfiles, setOptimizerResult]);

  // ── Auto Connect — autonomous loop (Phase 5: never gives up) ─────────────

  const isAutoMode = activeMode === 'auto' || activeMode === 'iran';
  // Holds the cancel function for the running loop
  const autoLoopCancelRef = useRef<(() => void) | null>(null);

  // Cancel loop when screen unmounts or user manually stops
  useEffect(() => {
    return () => { autoLoopCancelRef.current?.(); };
  }, []);

  const stopAutoConnectFlow = useCallback(() => {
    autoLoopCancelRef.current?.();
    autoLoopCancelRef.current = null;
    clearAutoConnect();
  }, [clearAutoConnect]);

  const startAutoConnectFlow = useCallback(async () => {
    if (!selectedServer) return;
    const creds = getImportedCreds(selectedServer.id);
    if (!creds) return;

    // Cancel any running loop before starting a new one
    autoLoopCancelRef.current?.();
    autoLoopCancelRef.current = null;

    clearAutoConnect();
    startAutoConnect(activeMode as 'auto' | 'iran');

    const adapter = getAdapter();

    const { promise, cancel } = runAutoConnectLoop(
      selectedServer,
      creds,
      adapter,
      activeMode as 'auto' | 'iran',
      (status, profiles) => updateAutoStatus(status, profiles as any),
    );
    autoLoopCancelRef.current = cancel;

    try {
      const result = await promise;
      autoLoopCancelRef.current = null;

      setAutoResult({
        winnerId:   result.winnerId,
        probeOk:    result.probeOk,
        durationMs: result.durationMs,
      });

      if (result.success && result.winnerConfig && result.winnerId) {
        const winnerProfile = result.profiles.find(p => p.id === result.winnerId);

        setWinningConfig({
          serverId:   selectedServer.id,
          profileId:  result.winnerId,
          configJson: result.winnerConfig,
          probeOk:    result.probeOk,
          label:      winnerProfile?.label ?? result.winnerId,
        });

        // Disconnect auto-connect tunnel then reconnect via vpnStore flow
        // so session tracking, watchdog, and stats all work correctly.
        try { await adapter.disconnect(); } catch {}
        await new Promise<void>(resolve => setTimeout(resolve, 500));
        vpnConnect();
      }
    } catch {
      autoLoopCancelRef.current = null;
      setAutoResult({ winnerId: null, probeOk: false, durationMs: 0 });
    }
  }, [
    selectedServer, getImportedCreds, activeMode,
    clearAutoConnect, startAutoConnect, updateAutoStatus,
    setAutoResult, setWinningConfig, vpnConnect,
  ]);

  // ── Auto-connect profile list ─────────────────────────────────────────────

  const autoProfiles = autoConnect.profiles;

  return (
    <View style={styles.screen}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        {/* Header */}
        <View style={styles.header}>
          <View>
            <Text style={styles.title}>{t('ai.title')}</Text>
            <Text style={styles.sub}>{t('ai.sub')}</Text>
          </View>
          <View style={[styles.aiBadge, { borderColor: mode.accentColor + '50' }]}>
            <View style={[styles.aiBadgeDot, { backgroundColor: mode.accentColor }]} />
            <Text style={[styles.aiBadgeText, { color: mode.accentColor }]}>{t('ai.active')}</Text>
          </View>
        </View>

        {/* AI Orb */}
        <View style={styles.orbArea}>
          <AIOrb active color={mode.accentColor} />
          <View style={styles.orbLabels}>
            <Text style={[styles.activeMode, { color: mode.accentColor }]}>{mode.label} {t('ai.modeLabel')}</Text>
            <Text style={styles.orbDescription}>{mode.description}</Text>
          </View>
        </View>

        {/* Protocol chain */}
        <GlassCard glowColor={mode.accentColor}>
          <Text style={styles.cardLabel}>{t('ai.protoChain')}</Text>
          <View style={styles.protoChain}>
            {mode.protocols.map((p, i) => (
              <React.Fragment key={p}>
                <View style={[styles.protoNode, { borderColor: mode.accentColor + '50' }]}>
                  <Text style={[styles.protoText, { color: mode.accentColor }]}>{p}</Text>
                </View>
                {i < mode.protocols.length - 1 && (
                  <Text style={styles.protoArrow}>→</Text>
                )}
              </React.Fragment>
            ))}
          </View>
        </GlassCard>

        {/* Mode selector grid */}
        <View>
          <Text style={styles.sectionTitle}>{t('ai.connModes')}</Text>
          <View style={styles.modeGrid}>
            {AI_MODES.map((m) => (
              <TouchableOpacity
                key={m.key}
                style={[
                  styles.modeCard,
                  activeMode === m.key && { borderColor: m.accentColor + '70', backgroundColor: m.accentColor + '0D' },
                ]}
                onPress={() => selectMode(m.key)}
                activeOpacity={0.75}
              >
                <Text style={[styles.modeIcon, { color: activeMode === m.key ? m.accentColor : Colors.text.muted }]}>
                  {m.icon}
                </Text>
                <Text style={[styles.modeLabel, { color: activeMode === m.key ? Colors.text.primary : Colors.text.secondary }]}>
                  {m.label}
                </Text>
                {activeMode === m.key && (
                  <View style={[styles.modeActiveDot, { backgroundColor: m.accentColor }]} />
                )}
              </TouchableOpacity>
            ))}
          </View>
        </View>

        {/* Feature toggles */}
        <GlassCard>
          <Text style={styles.cardLabel}>{t('ai.features')}</Text>
          {(Object.keys(FEATURE_I18N) as (keyof AIFeatures)[]).map((key, i) => {
            const { labelKey, descKey } = FEATURE_I18N[key];
            const label = t(labelKey as any);
            const desc  = t(descKey as any);
            const on    = features[key];
            return (
              <View key={key} style={[styles.toggleRow, i > 0 && styles.toggleRowBorder]}>
                <View style={styles.toggleLeft}>
                  <Text style={styles.toggleLabel}>{label}</Text>
                  <Text style={styles.toggleDesc}>{desc}</Text>
                </View>
                <TouchableOpacity
                  style={[styles.toggle, on ? { backgroundColor: Colors.emerald[400] } : { backgroundColor: Colors.bg.elevated }]}
                  onPress={() => toggleFeature(key)}
                  activeOpacity={0.8}
                >
                  <View style={[styles.toggleThumb, { transform: [{ translateX: on ? 16 : 0 }] }]} />
                </TouchableOpacity>
              </View>
            );
          })}
        </GlassCard>

        {/* ── Auto Connect (Auto / Iran mode) ─────────────────────────────── */}
        {isAutoMode && (
          <View>
            <Text style={styles.sectionTitle}>
              {activeMode === 'iran' ? 'Iran Mode · Auto Connect' : 'Smart Auto Connect'}
            </Text>
            <GlassCard glowColor={mode.accentColor}>
              <Text style={styles.cardLabel}>
                {activeMode === 'iran'
                  ? 'Tests Iran-optimised profiles · connects with first working route'
                  : 'Tests all profiles · auto-selects the best working route'}
              </Text>

              {/* Status / action row */}
              <View style={autoStyles.actionRow}>
                <View style={{ flex: 1 }}>
                  {autoConnect.isRunning ? (
                    <View style={autoStyles.runningRow}>
                      <ActivityIndicator size="small" color={mode.accentColor} />
                      <Text style={[autoStyles.runningLabel, { color: mode.accentColor }]}>
                        {phaseLabel(
                          autoConnect.phase,
                          autoConnect.currentLabel,
                          autoConnect.currentIndex,
                          autoConnect.profiles.length || 9,
                        )}
                      </Text>
                    </View>
                  ) : autoConnect.result ? (
                    autoConnect.result.winnerId ? (
                      <View>
                        <View style={autoStyles.winnerBadge}>
                          <Text style={[autoStyles.winnerIcon, { color: autoConnect.result.probeOk ? Colors.emerald[400] : '#7BCF8E' }]}>
                            {autoConnect.result.probeOk ? '✓' : '~'}
                          </Text>
                          <View>
                            <Text style={[autoStyles.winnerLabel, { color: Colors.emerald[400] }]}>
                              {autoConnect.winningConfig?.label ?? 'Best profile found'}
                            </Text>
                            <Text style={autoStyles.winnerSub}>
                              {'Internet confirmed · real traffic validated'}
                              {' · '}{(autoConnect.result.durationMs / 1000).toFixed(1)}s
                            </Text>
                          </View>
                        </View>
                        {connectionState === 'connected' && (
                          <Text style={autoStyles.connectedNote}>VPN connected via this profile</Text>
                        )}
                      </View>
                    ) : (
                      <Text style={autoStyles.failLabel}>All profiles failed — check server config</Text>
                    )
                  ) : (
                    <Text style={autoStyles.hintLabel}>
                      {!selectedServer
                        ? 'Import a server config first'
                        : !isVpnIdle
                        ? 'Disconnect VPN before running Auto Connect'
                        : activeMode === 'iran'
                        ? 'Tests 9 Iran-optimised routes in priority order'
                        : 'Tests 8 profiles — Reality, XHTTP, WebSocket, Emergency'}
                    </Text>
                  )}
                </View>

                {!autoConnect.isRunning && (
                  <TouchableOpacity
                    style={[
                      autoStyles.runBtn,
                      { borderColor: mode.accentColor + '60', backgroundColor: mode.accentColor + '15' },
                      (!isVpnIdle || !selectedServer) && autoStyles.runBtnDisabled,
                    ]}
                    onPress={startAutoConnectFlow}
                    disabled={!isVpnIdle || !selectedServer || anyRunning}
                    activeOpacity={0.75}
                  >
                    <Text style={[autoStyles.runBtnText, { color: mode.accentColor }]}>
                      {autoConnect.result?.winnerId ? 'Re-run' : 'Auto Connect'}
                    </Text>
                  </TouchableOpacity>
                )}
              </View>

              {/* Real-time profile chain */}
              {autoProfiles.length > 0 && (
                <View style={autoStyles.profileList}>
                  {autoProfiles.map((p) => (
                    <View key={p.id} style={autoStyles.profileRow}>
                      <View style={[autoStyles.iconWrap, { backgroundColor: statusColor(p.status) + '20' }]}>
                        {p.status === 'testing' ? (
                          <ActivityIndicator size="small" color="#FFB800" />
                        ) : (
                          <Text style={[autoStyles.iconText, { color: statusColor(p.status) }]}>
                            {statusIcon(p.status)}
                          </Text>
                        )}
                      </View>
                      <View style={{ flex: 1, minWidth: 0 }}>
                        <Text style={autoStyles.profileLabel} numberOfLines={1}>{p.label}</Text>
                        {p.status === 'testing' && (
                          <Text style={autoStyles.profileSub}>Testing…</Text>
                        )}
                        {p.status === 'success' && (
                          <Text style={[autoStyles.profileSub, { color: Colors.emerald[400] }]}>
                            {p.probeOk ? `Probe validated · ${p.latencyMs}ms` : `TCP connected · ${p.latencyMs}ms`}
                          </Text>
                        )}
                        {p.status === 'tcp-only' && (
                          <Text style={[autoStyles.profileSub, { color: '#FF8C00' }]}>
                            TCP connected but no internet confirmed — skipping
                          </Text>
                        )}
                        {p.status === 'fail' && p.error && (
                          <Text style={[autoStyles.profileSub, { color: '#FF5A5A' }]} numberOfLines={1}>
                            {p.error}
                          </Text>
                        )}
                        {p.status === 'skipped' && (
                          <Text style={autoStyles.profileSub}>Skipped</Text>
                        )}
                      </View>
                    </View>
                  ))}
                </View>
              )}
            </GlassCard>
          </View>
        )}

        {/* ── Connection Optimizer (rank profiles, stays disconnected) ─────── */}
        <View>
          <Text style={styles.sectionTitle}>Connection Optimizer</Text>
          <GlassCard>
            <Text style={styles.cardLabel}>Test and rank all profiles without connecting</Text>

            <View style={optStyles.actionRow}>
              <View style={{ flex: 1 }}>
                {optimizer.bestProfileId ? (
                  <View style={optStyles.bestBadge}>
                    <Text style={optStyles.bestIcon}>✓</Text>
                    <Text style={optStyles.bestLabel}>
                      {optimizer.profiles.find(p => p.id === optimizer.bestProfileId)?.label ?? 'Best profile found'}
                    </Text>
                  </View>
                ) : optimizer.isRunning ? (
                  <View style={optStyles.runningRow}>
                    <ActivityIndicator size="small" color="#FFB800" />
                    <Text style={optStyles.runningLabel}>Testing profiles…</Text>
                  </View>
                ) : optimizer.profiles.length > 0 ? (
                  <Text style={optStyles.noResultLabel}>No working profile found</Text>
                ) : (
                  <Text style={optStyles.hintLabel}>
                    {!selectedServer
                      ? 'Import a server config first'
                      : !isVpnIdle
                      ? 'Disconnect VPN to run optimizer'
                      : 'Tests multiple SNIs and transports to rank what works from your location'}
                  </Text>
                )}
              </View>

              {!optimizer.isRunning && (
                <TouchableOpacity
                  style={[
                    optStyles.runBtn,
                    (!isVpnIdle || !selectedServer) && optStyles.runBtnDisabled,
                  ]}
                  onPress={startOptimizer}
                  disabled={!isVpnIdle || !selectedServer || anyRunning}
                  activeOpacity={0.75}
                >
                  <Text style={optStyles.runBtnText}>
                    {optimizer.profiles.length > 0 ? 'Re-run' : 'Run Optimizer'}
                  </Text>
                </TouchableOpacity>
              )}
            </View>

            {optimizer.profiles.length > 0 && (
              <View style={optStyles.profileList}>
                {optimizer.profiles.map((p) => (
                  <View key={p.id} style={optStyles.profileRow}>
                    <View style={[optStyles.profileIconWrap, { backgroundColor: statusColor(p.status) + '20' }]}>
                      <Text style={[optStyles.profileIcon, { color: statusColor(p.status) }]}>
                        {p.status === 'testing' ? '…' : statusIcon(p.status)}
                      </Text>
                    </View>
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <Text style={optStyles.profileLabel} numberOfLines={1}>{p.label}</Text>
                      {p.status === 'testing' && <Text style={optStyles.profileSub}>Testing…</Text>}
                      {p.status === 'success' && (
                        <Text style={[optStyles.profileSub, { color: Colors.emerald[400] }]}>
                          Connected in {p.latencyMs}ms
                        </Text>
                      )}
                      {p.status === 'fail' && p.error && (
                        <Text style={[optStyles.profileSub, { color: '#FF5A5A' }]} numberOfLines={1}>
                          {p.error}
                        </Text>
                      )}
                      {p.status === 'skipped' && <Text style={optStyles.profileSub}>Skipped</Text>}
                    </View>
                    {p.status === 'pending' && <View style={optStyles.pendingDot} />}
                    {p.status === 'testing' && (
                      <ActivityIndicator size="small" color="#FFB800" style={{ marginLeft: Spacing[2] }} />
                    )}
                  </View>
                ))}
              </View>
            )}

            {optimizer.lastResult && (
              <Text style={optStyles.durationLabel}>
                Completed in {(optimizer.lastResult.durationMs / 1000).toFixed(1)}s
              </Text>
            )}
          </GlassCard>
        </View>

        {/* Live decision log */}
        <View>
          <Text style={styles.sectionTitle}>{t('ai.liveLog')}</Text>
          <GlassCard noPadding>
            {liveLog.slice(0, 6).map((entry, i) => (
              <View key={entry.id} style={[styles.logRow, i < Math.min(liveLog.length, 6) - 1 && styles.logRowBorder]}>
                <View style={[
                  styles.logDot,
                  { backgroundColor: entry.level === 'success' ? Colors.emerald[400] : entry.level === 'warn' ? '#FFB800' : Colors.text.muted },
                ]} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.logMsg}>{entry.message}</Text>
                  <Text style={styles.logTime}>{formatRelativeTime(new Date(entry.timestamp))}</Text>
                </View>
              </View>
            ))}
          </GlassCard>
        </View>

        <View style={{ height: Layout.bottomNavHeight + Spacing[4] }} />
      </ScrollView>

      <BottomNav active={activeTab} onPress={onNavigate} />
    </View>
  );
}

// ── Auto Connect styles ───────────────────────────────────────────────────────

const autoStyles = StyleSheet.create({
  actionRow:    { flexDirection: 'row', alignItems: 'center', gap: Spacing[3], marginBottom: Spacing[3] },
  runBtn:       { borderRadius: Radius.lg, paddingHorizontal: Spacing[4], paddingVertical: Spacing[2], borderWidth: 1 },
  runBtnDisabled:{ opacity: 0.4 },
  runBtnText:   { fontSize: Typography.size.xs, fontFamily: Typography.family.label, letterSpacing: 0.5 },
  runningRow:   { flexDirection: 'row', alignItems: 'center', gap: Spacing[2], flexShrink: 1 },
  runningLabel: { fontSize: Typography.size.xs, fontFamily: Typography.family.body, flexShrink: 1 },
  hintLabel:    { fontSize: Typography.size.xs, fontFamily: Typography.family.body, color: Colors.text.muted, lineHeight: 18 },
  failLabel:    { fontSize: Typography.size.sm, fontFamily: Typography.family.body, color: '#FF5A5A' },
  winnerBadge:  { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing[2] },
  winnerIcon:   { fontSize: 16, marginTop: 1 },
  winnerLabel:  { fontSize: Typography.size.sm, fontFamily: Typography.family.label },
  winnerSub:    { fontSize: Typography.size.xs, fontFamily: Typography.family.mono, color: Colors.text.muted, marginTop: 2 },
  connectedNote:{ fontSize: Typography.size.xs, fontFamily: Typography.family.body, color: Colors.emerald[400], marginTop: Spacing[2] },
  profileList:  { gap: Spacing[2], borderTopWidth: 1, borderTopColor: Colors.border.subtle, paddingTop: Spacing[3] },
  profileRow:   { flexDirection: 'row', alignItems: 'center', gap: Spacing[3], paddingVertical: Spacing[1] },
  iconWrap:     { width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  iconText:     { fontSize: 13, fontWeight: '700' },
  profileLabel: { fontSize: Typography.size.sm, fontFamily: Typography.family.body, color: Colors.text.secondary },
  profileSub:   { fontSize: Typography.size.xs, fontFamily: Typography.family.mono, color: Colors.text.muted, marginTop: 1 },
});

// ── Optimizer styles ──────────────────────────────────────────────────────────

const optStyles = StyleSheet.create({
  actionRow:      { flexDirection: 'row', alignItems: 'center', gap: Spacing[3], marginBottom: Spacing[3] },
  runBtn:         { backgroundColor: Colors.emerald[400] + '20', borderRadius: Radius.lg, paddingHorizontal: Spacing[4], paddingVertical: Spacing[2], borderWidth: 1, borderColor: Colors.emerald[400] + '50' },
  runBtnDisabled: { opacity: 0.4 },
  runBtnText:     { fontSize: Typography.size.xs, fontFamily: Typography.family.label, color: Colors.emerald[400], letterSpacing: 0.5 },
  runningRow:     { flexDirection: 'row', alignItems: 'center', gap: Spacing[2] },
  runningLabel:   { fontSize: Typography.size.sm, fontFamily: Typography.family.body, color: '#FFB800' },
  hintLabel:      { fontSize: Typography.size.xs, fontFamily: Typography.family.body, color: Colors.text.muted, lineHeight: 18 },
  noResultLabel:  { fontSize: Typography.size.sm, fontFamily: Typography.family.body, color: '#FF5A5A' },
  bestBadge:      { flexDirection: 'row', alignItems: 'center', gap: Spacing[2] },
  bestIcon:       { fontSize: 16, color: Colors.emerald[400] },
  bestLabel:      { fontSize: Typography.size.sm, fontFamily: Typography.family.label, color: Colors.emerald[400] },
  profileList:    { gap: Spacing[2], borderTopWidth: 1, borderTopColor: Colors.border.subtle, paddingTop: Spacing[3] },
  profileRow:     { flexDirection: 'row', alignItems: 'center', gap: Spacing[3], paddingVertical: Spacing[1] },
  profileIconWrap:{ width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  profileIcon:    { fontSize: 13, fontWeight: '700' },
  profileLabel:   { fontSize: Typography.size.sm, fontFamily: Typography.family.body, color: Colors.text.secondary },
  profileSub:     { fontSize: Typography.size.xs, fontFamily: Typography.family.mono, color: Colors.text.muted, marginTop: 1 },
  pendingDot:     { width: 6, height: 6, borderRadius: 3, backgroundColor: Colors.text.muted, marginLeft: Spacing[2] },
  durationLabel:  { fontSize: Typography.size.xs, fontFamily: Typography.family.mono, color: Colors.text.muted, textAlign: 'right', marginTop: Spacing[3] },
});

// ── Main styles ───────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  screen:         { flex: 1, backgroundColor: Colors.bg.base },
  scroll:         { flex: 1 },
  content:        { paddingTop: Layout.statusBarHeight + Spacing[2], paddingHorizontal: Layout.screenPadding, gap: Spacing[5] },
  header:         { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  title:          { fontSize: Typography.size['2xl'], fontFamily: Typography.family.heading, color: Colors.text.primary, letterSpacing: Typography.tracking.tight },
  sub:            { fontSize: Typography.size.sm, fontFamily: Typography.family.body, color: Colors.text.muted, marginTop: 2 },
  aiBadge:        { flexDirection: 'row', alignItems: 'center', gap: 6, borderWidth: 1, borderRadius: Radius.full, paddingHorizontal: Spacing[3], paddingVertical: 6, backgroundColor: Colors.bg.surface },
  aiBadgeDot:     { width: 6, height: 6, borderRadius: 3 },
  aiBadgeText:    { fontSize: Typography.size.xs, fontFamily: Typography.family.label, letterSpacing: 1, textTransform: 'uppercase' },
  orbArea:        { alignItems: 'center', gap: Spacing[4], paddingVertical: Spacing[4] },
  orbLabels:      { alignItems: 'center', gap: Spacing[1] },
  activeMode:     { fontSize: Typography.size.xl, fontFamily: Typography.family.heading, letterSpacing: Typography.tracking.tight },
  orbDescription: { fontSize: Typography.size.sm, fontFamily: Typography.family.body, color: Colors.text.muted, textAlign: 'center', maxWidth: 280, lineHeight: 20 },
  cardLabel:      { fontSize: Typography.size.xs, fontFamily: Typography.family.label, color: Colors.text.muted, textTransform: 'uppercase', letterSpacing: 1, marginBottom: Spacing[3] },
  protoChain:     { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: Spacing[2] },
  protoNode:      { borderRadius: Radius.md, borderWidth: 1, paddingHorizontal: Spacing[3], paddingVertical: Spacing[1], backgroundColor: Colors.bg.elevated },
  protoText:      { fontSize: Typography.size.sm, fontFamily: Typography.family.mono, letterSpacing: 0.5 },
  protoArrow:     { fontSize: Typography.size.sm, color: Colors.text.muted },
  sectionTitle:   { fontSize: Typography.size.base, fontFamily: Typography.family.heading, color: Colors.text.primary, marginBottom: Spacing[3] },
  modeGrid:       { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing[3] },
  modeCard:       { width: '30%', backgroundColor: Colors.bg.surface, borderRadius: Radius.xl, borderWidth: 1, borderColor: Colors.border.default, padding: Spacing[4], alignItems: 'center', gap: Spacing[1], position: 'relative' },
  modeIcon:       { fontSize: 24 },
  modeLabel:      { fontSize: Typography.size.xs, fontFamily: Typography.family.label, textAlign: 'center' },
  modeActiveDot:  { position: 'absolute', top: 8, right: 8, width: 6, height: 6, borderRadius: 3 },
  toggleRow:      { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: Spacing[3], gap: Spacing[3] },
  toggleRowBorder:{ borderTopWidth: 1, borderTopColor: Colors.border.subtle },
  toggleLeft:     { flex: 1, gap: 2 },
  toggleLabel:    { fontSize: Typography.size.sm, fontFamily: Typography.family.label, color: Colors.text.primary },
  toggleDesc:     { fontSize: Typography.size.xs, fontFamily: Typography.family.body, color: Colors.text.muted },
  toggle:         { width: 40, height: 24, borderRadius: 12, justifyContent: 'center', paddingHorizontal: 3 },
  toggleThumb:    { width: 18, height: 18, borderRadius: 9, backgroundColor: Colors.text.primary },
  logRow:         { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing[3], padding: Spacing[4] },
  logRowBorder:   { borderBottomWidth: 1, borderBottomColor: Colors.border.subtle },
  logDot:         { width: 6, height: 6, borderRadius: 3, marginTop: 5, flexShrink: 0 },
  logMsg:         { fontSize: Typography.size.sm, fontFamily: Typography.family.body, color: Colors.text.secondary, lineHeight: 20 },
  logTime:        { fontSize: Typography.size.xs, fontFamily: Typography.family.mono, color: Colors.text.muted, marginTop: 2 },
});
