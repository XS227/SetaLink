import React, { useEffect, useRef, useState } from 'react';
import {
  View, Text, ScrollView, StyleSheet, Animated, TouchableOpacity, Alert,
} from 'react-native';
import { Colors, Typography, Spacing, Radius, Layout } from '../design/tokens';
import { GlassCard } from '../components/GlassCard';
import { useDiagnosticsStore } from '../stores/diagnosticsStore';
import { useVpnStore }         from '../stores/vpnStore';
import { useAIStore }          from '../stores/aiStore';
import { formatElapsed } from '../hooks/useSessionTimer';
import { getNetworkInfo } from '../services/networkInfoService';
import { classifyFailure } from '../services/failureClassifier';

// ── PulsingDot — unchanged visual primitive ────────────────────────────────────

function PulsingDot({ color }: { color: string }) {
  const pulse = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1.6, duration: 900, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 1,   duration: 900, useNativeDriver: true }),
      ])
    ).start();
  }, []);

  return (
    <View style={{ alignItems: 'center', justifyContent: 'center' }}>
      <Animated.View style={{
        position: 'absolute', width: 14, height: 14, borderRadius: 7,
        backgroundColor: color,
        opacity: pulse.interpolate({ inputRange: [1, 1.6], outputRange: [0.3, 0] }),
        transform: [{ scale: pulse }],
      }} />
      <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: color }} />
    </View>
  );
}

// ── MetricCard ────────────────────────────────────────────────────────────────

function MetricCard({ label, value, unit, sub, color }: {
  label: string; value: string; unit?: string; sub?: string; color?: string;
}) {
  return (
    <GlassCard style={metStyles.card}>
      <Text style={metStyles.label}>{label}</Text>
      <Text style={[metStyles.value, color ? { color } : {}]}>
        {value}{unit && <Text style={metStyles.unit}> {unit}</Text>}
      </Text>
      {sub && <Text style={metStyles.sub}>{sub}</Text>}
    </GlassCard>
  );
}

const metStyles = StyleSheet.create({
  card:  { flex: 1, gap: 4, minWidth: '46%' },
  label: { fontSize: Typography.size.xs, fontFamily: Typography.family.label, color: Colors.text.muted, textTransform: 'uppercase', letterSpacing: 1 },
  value: { fontSize: Typography.size['2xl'], fontFamily: Typography.family.mono, color: Colors.text.primary, letterSpacing: -0.5 },
  unit:  { fontSize: Typography.size.sm, fontFamily: Typography.family.mono, color: Colors.text.muted },
  sub:   { fontSize: Typography.size.xs, fontFamily: Typography.family.body, color: Colors.text.muted },
});

// ── HealthRow ─────────────────────────────────────────────────────────────────

function HealthRow({ label, status, detail }: { label: string; status: 'ok' | 'warn' | 'fail'; detail: string }) {
  const color = status === 'ok' ? Colors.emerald[400] : status === 'warn' ? '#FFB800' : Colors.status.disconnected;
  const text  = status === 'ok' ? 'Healthy' : status === 'warn' ? 'Degraded' : 'Failed';
  return (
    <View style={hStyles.row}>
      <PulsingDot color={color} />
      <View style={hStyles.info}>
        <Text style={hStyles.label}>{label}</Text>
        <Text style={hStyles.detail}>{detail}</Text>
      </View>
      <View style={[hStyles.badge, { backgroundColor: color + '18', borderColor: color + '40' }]}>
        <Text style={[hStyles.badgeText, { color }]}>{text}</Text>
      </View>
    </View>
  );
}

const hStyles = StyleSheet.create({
  row:       { flexDirection: 'row', alignItems: 'center', gap: Spacing[3], paddingVertical: Spacing[3], borderBottomWidth: 1, borderBottomColor: Colors.border.subtle },
  info:      { flex: 1 },
  label:     { fontSize: Typography.size.sm, fontFamily: Typography.family.label, color: Colors.text.primary },
  detail:    { fontSize: Typography.size.xs, fontFamily: Typography.family.mono, color: Colors.text.muted, marginTop: 2 },
  badge:     { borderRadius: Radius.full, borderWidth: 1, paddingHorizontal: Spacing[3], paddingVertical: 3 },
  badgeText: { fontSize: Typography.size.xs, fontFamily: Typography.family.label, letterSpacing: 0.5 },
});

// ── Screen ────────────────────────────────────────────────────────────────────

interface DiagnosticsProps { onBack?: () => void }

export function DiagnosticsScreen({ onBack }: DiagnosticsProps) {
  const { snapshot, isRunning, elapsedSecs, liveStats, startMonitor, stopMonitor } =
    useDiagnosticsStore();
  const { connectionState, selectedServer, connectionLog, traceTestResult, traceTestRunning, runTraceTest } = useVpnStore();
  const autoConnect = useAIStore((s) => s.autoConnect);

  const [networkInfo, setNetworkInfo] = useState<{ localIp: string | null; publicIp: string | null } | null>(null);
  const [showTechLog, setShowTechLog] = useState(false);

  const handleRealInternetTest = async () => {
    if (connectionState !== 'connected') {
      Alert.alert('Not Connected', 'Connect to the VPN first, then run the real internet test.');
      return;
    }
    await runTraceTest();
  };

  useEffect(() => {
    startMonitor();
    getNetworkInfo().then(setNetworkInfo).catch(() => {});
    return () => stopMonitor();
  }, []);

  // Prefer live adapter stats over mock snapshot
  const displayPing         = liveStats?.ping         ?? snapshot?.ping         ?? 0;
  const displayUploadMbps   = liveStats?.uploadMbps   ?? snapshot?.uploadMbps   ?? 0;
  const displayDownloadMbps = liveStats?.downloadMbps ?? snapshot?.downloadMbps ?? 0;

  const conn = snapshot?.connection;

  // Progressive health check reveal: show one check every ~1.2s of elapsed time
  const allChecks     = snapshot?.healthChecks ?? [];
  const visibleCount  = isRunning
    ? Math.min(allChecks.length, Math.ceil((elapsedSecs + 0.1) / 1.2))
    : allChecks.length;
  const visibleChecks = allChecks.slice(0, visibleCount);
  const isScanning    = isRunning && visibleCount < allChecks.length;

  const pingQuality = (ping: number) =>
    ping < 40 ? 'Excellent' : ping < 80 ? 'Good' : ping < 120 ? 'Fair' : 'Poor';

  const lossLabel = (loss: number) =>
    loss === 0 ? 'No loss detected' : loss < 0.5 ? 'Minimal' : 'Elevated';

  const jitterLabel = (j: number) =>
    j < 3 ? 'Very stable' : j < 6 ? 'Stable' : 'Unstable';

  return (
    <View style={styles.screen}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        {/* Header */}
        <View style={styles.header}>
          <View style={styles.headerLeft}>
            {onBack && (
              <TouchableOpacity onPress={onBack} style={styles.backBtn} hitSlop={12}>
                <Text style={styles.backBtnText}>‹</Text>
              </TouchableOpacity>
            )}
            <View>
              <Text style={styles.title}>Diagnostics</Text>
              <Text style={styles.sub}>Live connection analysis</Text>
            </View>
          </View>
          <View style={styles.liveBadge}>
            <PulsingDot color={isScanning ? '#FFB800' : Colors.emerald[400]} />
            <Text style={styles.liveText}>
              {isScanning ? `SCANNING…` : isRunning ? `LIVE · ${formatElapsed(elapsedSecs)}` : 'IDLE'}
            </Text>
          </View>
        </View>

        {/* Metric grid */}
        <View style={styles.metricGrid}>
          <MetricCard
            label="Latency"
            value={displayPing ? String(displayPing) : '—'}
            unit="ms"
            sub={displayPing ? pingQuality(displayPing) : undefined}
            color={displayPing && displayPing < 60 ? Colors.emerald[400] : undefined}
          />
          <MetricCard
            label="Packet Loss"
            value={snapshot ? String(snapshot.packetLoss) : '—'}
            unit="%"
            sub={snapshot ? lossLabel(snapshot.packetLoss) : undefined}
            color={snapshot && snapshot.packetLoss === 0 ? Colors.emerald[400] : undefined}
          />
          <MetricCard
            label="Jitter"
            value={snapshot ? String(snapshot.jitter) : '—'}
            unit="ms"
            sub={snapshot ? jitterLabel(snapshot.jitter) : undefined}
          />
          <MetricCard
            label="Uptime"
            value={formatElapsed(elapsedSecs)}
            sub="This session"
          />
        </View>

        {/* Network info */}
        <GlassCard>
          <Text style={styles.cardLabel}>Network</Text>
          {[
            { key: 'Local IP',   val: networkInfo?.localIp  ?? 'Detecting…' },
            { key: 'Exit IP',    val: networkInfo?.publicIp ?? (connectionState === 'connected' ? 'Detecting…' : 'Not connected') },
            { key: 'VPN Server', val: selectedServer ? `${selectedServer.city}, ${selectedServer.country}` : '—' },
            { key: 'Protocol',   val: selectedServer ? selectedServer.protocol : '—' },
          ].map((item) => (
            <View key={item.key} style={styles.infoRow}>
              <Text style={styles.infoKey}>{item.key}</Text>
              <Text style={styles.infoVal}>{item.val}</Text>
            </View>
          ))}
        </GlassCard>

        {/* Protocol & route info */}
        <GlassCard glowColor={Colors.emerald[400]}>
          <Text style={styles.cardLabel}>Active Connection</Text>
          {conn ? [
            { key: 'Protocol',    val: conn.protocol },
            { key: 'Transport',   val: conn.transport },
            { key: 'Server SNI',  val: conn.serverSni },
            { key: 'Destination', val: conn.destination },
            { key: 'TLS Version', val: conn.tlsVersion },
            { key: 'Cipher',      val: conn.cipher },
            { key: 'ALPN',        val: conn.alpn },
          ].map((item) => (
            <View key={item.key} style={styles.infoRow}>
              <Text style={styles.infoKey}>{item.key}</Text>
              <Text style={styles.infoVal}>{item.val}</Text>
            </View>
          )) : (
            <Text style={styles.infoKey}>Connecting…</Text>
          )}
        </GlassCard>

        {/* Health checks */}
        <GlassCard>
          <View style={styles.healthHeader}>
            <Text style={styles.cardLabel}>Health Checks</Text>
            {isScanning && (
              <View style={styles.scanningBadge}>
                <Text style={styles.scanningText}>
                  {visibleCount}/{allChecks.length}
                </Text>
              </View>
            )}
          </View>
          {visibleChecks.map((hc) => (
            <HealthRow key={hc.label} label={hc.label} status={hc.status} detail={hc.detail} />
          ))}
          {isScanning && (
            <View style={styles.scanningRow}>
              <Text style={styles.scanningRowText}>Running checks…</Text>
            </View>
          )}
          <View style={{ height: 1 }} />
        </GlassCard>

        {/* Route trace */}
        <View>
          <Text style={styles.sectionTitle}>Route Trace</Text>
          <GlassCard noPadding>
            {(snapshot?.routeHops ?? []).map((hop, i, arr) => (
              <View key={hop.hop} style={[
                styles.hopRow,
                i < arr.length - 1 && { borderBottomWidth: 1, borderBottomColor: Colors.border.subtle },
              ]}>
                <View style={[styles.hopNum, i === arr.length - 1 && { opacity: 0.4 }]}>
                  <Text style={styles.hopNumText}>{hop.hop}</Text>
                </View>
                <View style={styles.hopConnector}>
                  <View style={styles.hopLine} />
                  <View style={[styles.hopDot, { backgroundColor: i === 3 ? Colors.emerald[400] : Colors.text.muted + '80' }]} />
                </View>
                <View style={styles.hopInfo}>
                  <Text style={styles.hopLabel}>{hop.label}</Text>
                  <Text style={styles.hopIp}>{hop.ip}</Text>
                </View>
                <Text style={[styles.hopRtt, { color: hop.rtt === '—' ? Colors.text.muted : Colors.emerald[400] }]}>
                  {hop.rtt}
                </Text>
              </View>
            ))}
          </GlassCard>
        </View>

        {/* Throughput */}
        <GlassCard>
          <Text style={styles.cardLabel}>Real-time Throughput</Text>
          <View style={styles.throughputRow}>
            {[
              { icon: '↑', color: Colors.emerald[400], value: displayUploadMbps   ? `${displayUploadMbps} MB/s`   : '—', pct: displayUploadMbps   / 10 },
              { icon: '↓', color: Colors.blue[400],    value: displayDownloadMbps ? `${displayDownloadMbps} MB/s` : '—', pct: displayDownloadMbps / 30 },
            ].map((item) => (
              <View key={item.icon} style={styles.throughputItem}>
                <Text style={[styles.throughputIcon, { color: item.color }]}>{item.icon}</Text>
                <View style={styles.throughputBar}>
                  <View style={[styles.throughputFill, { width: `${Math.min(100, item.pct * 100)}%` as any, backgroundColor: item.color }]} />
                </View>
                <Text style={styles.throughputVal}>{item.value}</Text>
              </View>
            ))}
          </View>
        </GlassCard>

        {/* Probe history — admin/tester mode */}
        {autoConnect.profiles.length > 0 && (
          <GlassCard>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: Spacing[3] }}>
              <Text style={styles.cardLabel}>Connection Probe Log</Text>
              <View style={{ flexDirection: 'row', gap: Spacing[2] }}>
                {autoConnect.winningConfig && (
                  <View style={{ backgroundColor: 'rgba(0,232,122,0.12)', borderRadius: Radius.full, borderWidth: 1, borderColor: Colors.border.glow, paddingHorizontal: Spacing[2], paddingVertical: 2 }}>
                    <Text style={{ fontSize: 10, fontFamily: Typography.family.mono, color: Colors.emerald[400] }}>WINNER</Text>
                  </View>
                )}
                <Text style={{ fontSize: 10, fontFamily: Typography.family.mono, color: Colors.text.muted }}>{autoConnect.profiles.length} routes</Text>
              </View>
            </View>
            {autoConnect.winningConfig && (
              <View style={{ backgroundColor: 'rgba(0,232,122,0.06)', borderRadius: Radius.md, borderWidth: 1, borderColor: Colors.border.glow, padding: Spacing[3], marginBottom: Spacing[3] }}>
                <Text style={{ fontSize: Typography.size.xs, fontFamily: Typography.family.label, color: Colors.emerald[400], marginBottom: 4 }}>SELECTED ROUTE</Text>
                <Text style={{ fontSize: Typography.size.sm, fontFamily: Typography.family.mono, color: Colors.text.primary }}>{autoConnect.winningConfig.label}</Text>
              </View>
            )}
            {autoConnect.profiles.map((p, i) => {
              const statusColor =
                p.status === 'success' ? Colors.emerald[400] :
                p.status === 'testing' ? '#FFB800' :
                p.status === 'skipped' ? Colors.text.muted + '60' :
                p.status === 'fail'  ? Colors.status.disconnected :
                Colors.text.muted;
              const statusIcon =
                p.status === 'success' ? '✓' :
                p.status === 'testing' ? '◌' :
                p.status === 'skipped' ? '—' :
                p.status === 'fail'  ? '✗' : '·';
              const techDetail = p.error ? classifyFailure(p.error).category : null;
              return (
                <View key={p.id} style={{ flexDirection: 'row', alignItems: 'flex-start', paddingVertical: Spacing[2], borderBottomWidth: i < autoConnect.profiles.length - 1 ? 1 : 0, borderBottomColor: Colors.border.subtle, gap: Spacing[3] }}>
                  <Text style={{ fontSize: 13, color: statusColor, fontFamily: Typography.family.mono, width: 16, marginTop: 1 }}>{statusIcon}</Text>
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontSize: Typography.size.xs, fontFamily: Typography.family.mono, color: p.status === 'skipped' ? Colors.text.muted : Colors.text.secondary }}>{p.label}</Text>
                    {p.latencyMs != null && p.status !== 'pending' && p.status !== 'skipped' && (
                      <Text style={{ fontSize: 10, fontFamily: Typography.family.mono, color: Colors.text.muted, marginTop: 1 }}>
                        {p.latencyMs}ms{techDetail ? ` · ${techDetail}` : ''}
                      </Text>
                    )}
                  </View>
                </View>
              );
            })}
          </GlassCard>
        )}

        {/* Tech log (raw) — hidden behind tap */}
        {connectionLog.length > 0 && (
          <TouchableOpacity
            style={{ paddingVertical: Spacing[2], alignItems: 'center' }}
            onPress={() => setShowTechLog(v => !v)}
            activeOpacity={0.7}
          >
            <Text style={{ fontSize: Typography.size.xs, fontFamily: Typography.family.mono, color: Colors.text.muted }}>
              {showTechLog ? '▲ Hide raw log' : '▾ Show raw log'}
            </Text>
          </TouchableOpacity>
        )}
        {showTechLog && connectionLog.length > 0 && (
          <GlassCard style={{ gap: 2 }}>
            <Text style={styles.cardLabel}>Raw Connection Log</Text>
            {connectionLog.map((line, i) => (
              <Text key={i} style={[
                { fontSize: 10, fontFamily: Typography.family.mono, color: Colors.text.muted, lineHeight: 16 },
                line.startsWith('✓') && { color: Colors.emerald[400] },
                line.startsWith('✗') && { color: Colors.status.disconnected },
              ]}>{line}</Text>
            ))}
          </GlassCard>
        )}

        {/* Real Internet Test */}
        <GlassCard>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: Spacing[3] }}>
            <Text style={styles.cardLabel}>Real Internet Test</Text>
            <View style={{ backgroundColor: 'rgba(0,232,122,0.08)', borderRadius: Radius.full, borderWidth: 1, borderColor: Colors.border.glow, paddingHorizontal: Spacing[2], paddingVertical: 2 }}>
              <Text style={{ fontSize: 9, fontFamily: Typography.family.mono, color: Colors.emerald[400] }}>1.1.1.1 TRACE</Text>
            </View>
          </View>
          <Text style={{ fontSize: Typography.size.xs, fontFamily: Typography.family.body, color: Colors.text.muted, marginBottom: Spacing[3] }}>
            Verifies traffic actually routes through the VPN tunnel. Tests DNS, TCP 443, HTTPS, and Cloudflare trace response.
          </Text>
          {traceTestResult && (
            <View style={{
              backgroundColor: traceTestResult.ok ? 'rgba(0,232,122,0.07)' : 'rgba(255,59,48,0.07)',
              borderRadius: Radius.md,
              borderWidth: 1,
              borderColor: traceTestResult.ok ? Colors.border.glow : Colors.status.disconnected + '40',
              padding: Spacing[3],
              marginBottom: Spacing[3],
              gap: 4,
            }}>
              <Text style={{ fontSize: Typography.size.xs, fontFamily: Typography.family.label, color: traceTestResult.ok ? Colors.emerald[400] : Colors.status.disconnected }}>
                {traceTestResult.ok ? '✓ INTERNET ROUTED THROUGH VPN' : '✗ INTERNET NOT ROUTED THROUGH VPN'}
              </Text>
              {traceTestResult.routedIp && (
                <Text style={{ fontSize: Typography.size.xs, fontFamily: Typography.family.mono, color: Colors.text.secondary }}>
                  Exit IP: {traceTestResult.routedIp}
                </Text>
              )}
              {traceTestResult.statusCode != null && (
                <Text style={{ fontSize: Typography.size.xs, fontFamily: Typography.family.mono, color: Colors.text.muted }}>
                  HTTP {traceTestResult.statusCode} · {traceTestResult.bytesIn ?? 0}B received
                </Text>
              )}
              {traceTestResult.error && (
                <Text style={{ fontSize: Typography.size.xs, fontFamily: Typography.family.mono, color: Colors.status.disconnected }}>
                  Error: {traceTestResult.error}
                </Text>
              )}
            </View>
          )}
          <TouchableOpacity
            style={[styles.exportBtn, { marginBottom: 0, borderColor: traceTestRunning ? Colors.border.default : Colors.border.glow }]}
            onPress={handleRealInternetTest}
            activeOpacity={0.8}
            disabled={traceTestRunning}
          >
            <Text style={[styles.exportText, traceTestRunning && { color: Colors.text.muted }]}>
              {traceTestRunning ? 'Testing…' : 'Run Real Internet Test'}
            </Text>
          </TouchableOpacity>
        </GlassCard>

        {/* Export */}
        <TouchableOpacity style={styles.exportBtn} activeOpacity={0.8}>
          <Text style={styles.exportText}>Export Diagnostic Report</Text>
        </TouchableOpacity>

        <View style={{ height: Spacing[12] }} />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen:         { flex: 1, backgroundColor: Colors.bg.base },
  scroll:         { flex: 1 },
  content:        { paddingTop: Layout.statusBarHeight + Spacing[2], paddingHorizontal: Layout.screenPadding, gap: Spacing[5] },
  header:         { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between' },
  headerLeft:     { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing[3] },
  backBtn:        { width: 36, height: 36, alignItems: 'center', justifyContent: 'center', backgroundColor: Colors.bg.surface, borderRadius: Radius.md, borderWidth: 1, borderColor: Colors.border.default, marginTop: 2 },
  backBtnText:    { fontSize: 22, color: Colors.text.secondary, lineHeight: 26 },
  title:          { fontSize: Typography.size['2xl'], fontFamily: Typography.family.heading, color: Colors.text.primary, letterSpacing: Typography.tracking.tight },
  sub:            { fontSize: Typography.size.sm, fontFamily: Typography.family.body, color: Colors.text.muted, marginTop: 2 },
  liveBadge:      { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: Colors.bg.surface, borderRadius: Radius.full, borderWidth: 1, borderColor: Colors.border.glow, paddingHorizontal: Spacing[3], paddingVertical: 6 },
  liveText:       { fontSize: Typography.size.xs, fontFamily: Typography.family.mono, color: Colors.emerald[400], letterSpacing: 1 },
  healthHeader:   { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: Spacing[3] },
  scanningBadge:  { backgroundColor: 'rgba(255,184,0,0.1)', borderRadius: Radius.full, borderWidth: 1, borderColor: 'rgba(255,184,0,0.35)', paddingHorizontal: Spacing[2], paddingVertical: 2 },
  scanningText:   { fontSize: Typography.size.xs, fontFamily: Typography.family.mono, color: '#FFB800' },
  scanningRow:    { paddingVertical: Spacing[3], alignItems: 'center' },
  scanningRowText:{ fontSize: Typography.size.xs, fontFamily: Typography.family.mono, color: Colors.text.muted, letterSpacing: 0.5 },
  metricGrid:     { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing[3] },
  cardLabel:      { fontSize: Typography.size.xs, fontFamily: Typography.family.label, color: Colors.text.muted, textTransform: 'uppercase', letterSpacing: 1, marginBottom: Spacing[3] },
  infoRow:        { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: Spacing[2] + 1, borderBottomWidth: 1, borderBottomColor: Colors.border.subtle },
  infoKey:        { fontSize: Typography.size.sm, fontFamily: Typography.family.body, color: Colors.text.muted },
  infoVal:        { fontSize: Typography.size.sm, fontFamily: Typography.family.mono, color: Colors.text.secondary, textAlign: 'right', maxWidth: '60%' },
  sectionTitle:   { fontSize: Typography.size.base, fontFamily: Typography.family.heading, color: Colors.text.primary, marginBottom: Spacing[3] },
  hopRow:         { flexDirection: 'row', alignItems: 'center', paddingHorizontal: Spacing[4], paddingVertical: Spacing[3], gap: Spacing[3] },
  hopNum:         { width: 24, height: 24, borderRadius: 12, backgroundColor: Colors.bg.elevated, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  hopNumText:     { fontSize: Typography.size.xs, fontFamily: Typography.family.mono, color: Colors.text.muted },
  hopConnector:   { alignItems: 'center', flexShrink: 0 },
  hopLine:        { position: 'absolute', width: 1, height: 40, backgroundColor: Colors.border.subtle, top: -20 },
  hopDot:         { width: 6, height: 6, borderRadius: 3 },
  hopInfo:        { flex: 1 },
  hopLabel:       { fontSize: Typography.size.sm, fontFamily: Typography.family.label, color: Colors.text.primary },
  hopIp:          { fontSize: Typography.size.xs, fontFamily: Typography.family.mono, color: Colors.text.muted, marginTop: 2 },
  hopRtt:         { fontSize: Typography.size.sm, fontFamily: Typography.family.mono },
  throughputRow:  { gap: Spacing[3] },
  throughputItem: { flexDirection: 'row', alignItems: 'center', gap: Spacing[3] },
  throughputIcon: { fontSize: Typography.size.lg, width: 20, textAlign: 'center' },
  throughputBar:  { flex: 1, height: 6, borderRadius: 3, backgroundColor: Colors.bg.elevated, overflow: 'hidden' },
  throughputFill: { height: '100%', borderRadius: 3 },
  throughputVal:  { fontSize: Typography.size.sm, fontFamily: Typography.family.mono, color: Colors.text.secondary, width: 80, textAlign: 'right' },
  exportBtn:      { borderWidth: 1, borderColor: Colors.border.glow, borderRadius: Radius.lg, paddingVertical: Spacing[4], alignItems: 'center', backgroundColor: 'rgba(0,232,122,0.05)' },
  exportText:     { fontSize: Typography.size.sm, fontFamily: Typography.family.label, color: Colors.emerald[400], letterSpacing: 0.5 },
});
